/**
 * Copies the website's assets into the app bundle: textures, downsized, and the star
 * catalogue as-is.
 *
 * The website's textures are the real NASA and USGS imagery and run to 81 MB, with Mercury
 * alone at 15 MB. That is right for a browser that streams them and wrong for an app binary,
 * so each one is resampled to a width a phone can actually resolve at this zoom. The source
 * files stay the single copy; these are a derived artifact and are git-ignored, the same way
 * `website/assets/originals` is.
 *
 * Which texture belongs to which body is not decided here. It comes from the body contracts,
 * so the phone and the website cannot end up showing different imagery for the same planet.
 *
 * Run from the repository root:  node mobile/ios/sync-assets.mjs
 * Or through:                    ./build.sh ios assets
 */
import {
  copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync,
} from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import sharp from "sharp";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const SOURCE = join(ROOT, "website/assets/originals");
const TARGET = join(ROOT, "mobile/ios/App/Resources/Textures");

/**
 * 2048 across. A planet never exceeds about 400 points on a phone at system zoom, and even
 * filling the screen on an iPad it is under 1200, so 2048 leaves headroom for a close pass
 * without carrying imagery nobody can see. Mercury drops from 15 MB to a few hundred KB.
 */
const WIDTH = 2048;
const QUALITY = 82;

/**
 * Normal maps get 4096, double the albedo textures.
 *
 * A normal map carries surface slope, and halving it halves the slope detail that produces
 * the shading, so craters go soft a full zoom level earlier than the albedo would.
 */
const NORMAL_WIDTH = 4096;

if (!existsSync(SOURCE)) {
  console.error(
    `No textures at ${SOURCE}.\n` +
      "Run `npm run assets 1` first; they are git-ignored and fetched on demand.",
  );
  process.exit(1);
}

const { BODY_CONTRACTS } = await import(`${ROOT}engine/src/bodies/registry.ts`);

// Only what a body actually names. A texture nothing references is dead weight in the binary.
const wanted = new Set();
for (const contract of Object.values(BODY_CONTRACTS)) {
  const appearance = contract.appearance;
  for (const id of [
    appearance.albedoTextureId,
    appearance.nightTextureId,
    appearance.cloudTextureId,
    appearance.ringSystem?.textureId,
  ]) {
    if (typeof id === "string") wanted.add(id);
  }
}

rmSync(TARGET, { recursive: true, force: true });
mkdirSync(TARGET, { recursive: true });

let copied = 0;
let sourceBytes = 0;
let targetBytes = 0;

for (const file of readdirSync(SOURCE)) {
  const id = file.replace(/\.(jpg|png)$/, "");
  if (!wanted.has(id)) continue;

  const from = join(SOURCE, file);
  // Always JPEG out: a ring texture needs its alpha, everything else does not.
  const isRing = file.endsWith(".png");
  const to = join(TARGET, isRing ? `${id}.png` : `${id}.jpg`);

  const pipeline = sharp(from).resize({ width: WIDTH, withoutEnlargement: true });
  await (isRing ? pipeline.png({ compressionLevel: 9 }) : pipeline.jpeg({ quality: QUALITY })).toFile(to);

  sourceBytes += statSync(from).size;
  targetBytes += statSync(to).size;
  copied += 1;
}

const mb = (bytes) => (bytes / 1024 / 1024).toFixed(1);
console.log(
  `${copied} textures into App/Resources/Textures: ${mb(sourceBytes)} MB source -> ${mb(targetBytes)} MB bundled`,
);

/**
 * The star catalogue, copied rather than transformed.
 *
 * 9,096 stars of the Yale Bright Star Catalogue as a flat Float32Array, four values each:
 * right ascension and declination in radians, visual magnitude, and B-V colour index. 142 KB,
 * so there is nothing to gain by reducing it, and both clients reading the identical bytes is
 * worth more than the saving would be.
 */
const CATALOGUE = join(ROOT, "website/public/data/bsc5.bin");
if (existsSync(CATALOGUE)) {
  const resources = join(ROOT, "mobile/ios/App/Resources");
  mkdirSync(resources, { recursive: true });
  copyFileSync(CATALOGUE, join(resources, "bsc5.bin"));
  console.log(`star catalogue: ${(statSync(CATALOGUE).size / 1024).toFixed(0)} KB`);
} else {
  console.error(`No star catalogue at ${CATALOGUE}. Run \`npm run stars\` first.`);
  process.exit(1);
}

/**
 * Terrain: the manifest and the global normal map, per body that has one.
 *
 * The normal map is what makes craters shade correctly through the terminator at orbital
 * range, and it is one texture rather than a pyramid, so it belongs in the bundle. The tile
 * pyramid does not: the Moon's is 13 MB across four levels and is streamed on demand from the
 * same host, exactly as the website streams it.
 *
 * Resampled to 4096 rather than the textures' 2048. A normal map carries the surface slope,
 * and halving it halves the slope detail that produces the shading; craters go soft a full
 * zoom level earlier.
 */
const TERRAIN_SOURCE = join(ROOT, "website/public/terrain");
if (existsSync(TERRAIN_SOURCE)) {
  const terrainTarget = join(ROOT, "mobile/ios/App/Resources/Terrain");
  rmSync(terrainTarget, { recursive: true, force: true });
  mkdirSync(terrainTarget, { recursive: true });

  for (const body of readdirSync(TERRAIN_SOURCE)) {
    const manifestPath = join(TERRAIN_SOURCE, body, "manifest.json");
    const normalPath = join(TERRAIN_SOURCE, body, "normal-global.jpg");
    if (!existsSync(manifestPath) || !existsSync(normalPath)) continue;

    const resampled = await sharp(normalPath)
      .resize({ width: NORMAL_WIDTH, withoutEnlargement: true })
      .jpeg({ quality: 88 })
      .toFile(join(terrainTarget, `${body}-normal.jpg`));

    /**
     * The manifest is rewritten, not copied.
     *
     * `globalWidth` is what the tile selector uses to decide whether the global map already
     * out-resolves the screen, so a manifest still claiming the source's 8192 after the image
     * was resampled to 4096 makes the app believe its texels are twice as fine as they are.
     * It then never requests a tile, and the only symptom is detail that quietly stops
     * improving as you descend. Flattened with the body in the filename because an iOS bundle
     * does not preserve a nested resource tree reliably.
     */
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    manifest.globalWidth = resampled.width;
    manifest.globalNormalMap = `${body}-normal.jpg`;
    writeFileSync(
      join(terrainTarget, `${body}-manifest.json`),
      JSON.stringify(manifest, null, 2),
    );

    const before = statSync(normalPath).size;
    const after = statSync(join(terrainTarget, `${body}-normal.jpg`)).size;
    console.log(
      `terrain ${body}: normal map ${mb(before)} MB -> ${mb(after)} MB, manifest copied`,
    );
  }
} else {
  console.log("no terrain built; run `npm run terrain` to add crater relief");
}

const missing = [...wanted].filter(
  (id) => !existsSync(join(TARGET, `${id}.jpg`)) && !existsSync(join(TARGET, `${id}.png`)),
);
if (missing.length > 0) {
  console.error(`contracts name textures with no source file: ${missing.join(", ")}`);
  process.exit(1);
}
