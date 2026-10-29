/**
 * Copies the website's assets into the app bundle: textures, downsized, and the star
 * catalogue as-is.
 *
 * The website's textures are the real NASA and USGS imagery and run to 81 MB, with Mercury
 * alone at 15 MB. That is right for a browser that streams them and wrong for an app binary,
 * so each one is resampled to a width a phone can actually resolve at this zoom. The source
 * files stay the single copy; these are a derived artifact and are git-ignored, the same way
 * `website/public/textures` is.
 *
 * Which texture belongs to which body is not decided here. It comes from the body contracts,
 * so the phone and the website cannot end up showing different imagery for the same planet.
 *
 * Run from the repository root:  node mobile/ios/sync-assets.mjs
 * Or through:                    ./build.sh ios assets
 */
import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import sharp from "sharp";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const SOURCE = join(ROOT, "website/public/textures");
const TARGET = join(ROOT, "mobile/ios/App/Resources/Textures");

/**
 * 2048 across. A planet never exceeds about 400 points on a phone at system zoom, and even
 * filling the screen on an iPad it is under 1200, so 2048 leaves headroom for a close pass
 * without carrying imagery nobody can see. Mercury drops from 15 MB to a few hundred KB.
 */
const WIDTH = 2048;
const QUALITY = 82;

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

const missing = [...wanted].filter(
  (id) => !existsSync(join(TARGET, `${id}.jpg`)) && !existsSync(join(TARGET, `${id}.png`)),
);
if (missing.length > 0) {
  console.error(`contracts name textures with no source file: ${missing.join(", ")}`);
  process.exit(1);
}
