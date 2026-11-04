/**
 * Turns the downloaded originals into the images the browser actually gets.
 *
 * The originals are 8192 x 4096 JPEGs, 78 MB for fourteen of them. That is the right archive
 * to keep and the wrong thing to serve: a visitor would download a Blu-ray's worth of planet
 * to look at spheres a few hundred pixels across, and 78 MB of licensed binaries have no place
 * in a public repository either. So the originals stay out of git under `assets/originals`,
 * fetched by `npm run assets`, and the derivatives this writes are committed. That is what
 * makes the deployed site show real photography: the files are simply there, with no
 * build-time network call that can fail and no asset host to keep alive.
 *
 * Two sizes per texture. `base` is loaded for every body in the scene. `detail` is loaded only
 * for the body the camera is focused on, which is the only one ever large enough to tell the
 * difference, and it is skipped where the original is no bigger than `base`. The split keeps
 * the first paint near 2 MB while a planet you fly up to still resolves at 4096.
 *
 * WebP at quality 82 rather than JPEG: same visible result, between a third and a half the
 * bytes, and alpha for Saturn's ring, which JPEG cannot carry at all.
 *
 *   node scripts/build-textures.mjs           # build what is missing or stale
 *   node scripts/build-textures.mjs --force   # rebuild everything
 *   node scripts/build-textures.mjs --check   # verify, write nothing, exit 1 if stale
 */

import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import sharp from "sharp";

const SOURCE_DIR = "assets/originals";
const OUT_DIR = "public/textures";
const MANIFEST = "scripts/assets.manifest.json";
const QUALITY = 82;

const args = new Set(process.argv.slice(2));
const force = args.has("--force");
const checkOnly = args.has("--check");

const manifest = JSON.parse(await readFile(MANIFEST, "utf8"));
const served = manifest.assets.filter((asset) => asset.web);

function human(bytes) {
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
}

async function mtimeOrNull(path) {
  try {
    return (await stat(path)).mtimeMs;
  } catch {
    return null;
  }
}

/** Every derivative this build is responsible for, flattened out of the manifest. */
function variantsOf(asset) {
  const out = [{ suffix: "", width: asset.web.base }];
  if (asset.web.detail && asset.web.detail > asset.web.base) {
    out.push({ suffix: ".detail", width: asset.web.detail });
  }
  return out;
}

await mkdir(OUT_DIR, { recursive: true });

const missingSources = [];
const stale = [];
const built = [];
let total = 0;

for (const asset of served) {
  const source = `${SOURCE_DIR}/${asset.file}`;
  const sourceTime = await mtimeOrNull(source);

  for (const variant of variantsOf(asset)) {
    const target = `${OUT_DIR}/${asset.id}${variant.suffix}.webp`;
    const targetTime = await mtimeOrNull(target);

    if (sourceTime === null) {
      // A derivative already committed is the thing that matters; the original is only how it
      // was made. A clone with no originals is therefore fine, and silence here is correct.
      if (targetTime === null) missingSources.push(`${asset.id} -> ${source}`);
      if (targetTime !== null) total += (await stat(target)).size;
      continue;
    }

    const upToDate = targetTime !== null && targetTime >= sourceTime;
    if (upToDate && !force) {
      total += (await stat(target)).size;
      continue;
    }
    if (checkOnly) {
      stale.push(target);
      continue;
    }

    // `withoutEnlargement` so an original smaller than the requested width is copied at its
    // own size rather than upscaled into a blurrier file than the one it came from.
    await sharp(source)
      .resize({ width: variant.width, withoutEnlargement: true })
      .webp({ quality: QUALITY, effort: 5 })
      .toFile(target);

    const written = await stat(target);
    total += written.size;
    built.push(target);
    console.log(`  ${asset.id}${variant.suffix}`.padEnd(28), `${variant.width}px`.padStart(7), human(written.size).padStart(9));
  }
}

if (checkOnly) {
  if (stale.length > 0) {
    console.log(`${stale.length} derivative(s) missing or older than their original:`);
    for (const path of stale) console.log(`  ${path}`);
    console.log("\nrun: npm run textures");
    process.exit(1);
  }
  console.log(`all ${served.length} served textures up to date, ${human(total)} on disk`);
  process.exit(0);
}

if (missingSources.length > 0) {
  console.log(`\n${missingSources.length} original(s) absent and no derivative committed:`);
  for (const line of missingSources) console.log(`  ${line}`);
  console.log("\nrun: npm run assets");
  process.exit(1);
}

/**
 * The credits page is generated here rather than by the fetch script, because this is the
 * step that produces the files the project actually redistributes. Several of these images
 * are CC BY: credit is a licence condition, and so is saying that the image was changed,
 * which it was -- every one is resized and re-encoded. A hand-written credits page drifts
 * from the assets the moment anyone adds one, and a hand-written one cannot know that.
 */
async function sizeOf(path) {
  try {
    return (await stat(path)).size;
  } catch {
    return 0;
  }
}

const credited = [];
for (const asset of served) {
  const files = [];
  for (const variant of variantsOf(asset)) {
    const name = `${asset.id}${variant.suffix}.webp`;
    const bytes = await sizeOf(`${OUT_DIR}/${name}`);
    if (bytes > 0) files.push({ name, bytes, width: variant.width });
  }
  if (files.length > 0) credited.push({ asset, files });
}

const usedLicences = [...new Set(credited.map((c) => c.asset.licence))];
const creditedBytes = credited.reduce(
  (sum, c) => sum + c.files.reduce((s, f) => s + f.bytes, 0),
  0,
);

const attribution = `# Attribution

Generated by \`scripts/build-textures.mjs\` from \`scripts/assets.manifest.json\` and the files
actually written to \`public/textures\`. Do not edit by hand.

${credited.length} textures, ${human(creditedBytes)} as served.

## Every image here has been modified

None of these files is the publisher's original. Each was downloaded at up to 8192 x 4096,
resized to the widths below, and re-encoded as WebP at quality ${QUALITY}, so that a visitor
downloads a few megabytes rather than seventy-eight. Nothing else was altered: no colour
grading, no retouching, no compositing. The originals are reachable at the source URLs below
and this project claims no rights over any of them.

## Licences in use

${usedLicences
  .map((key) => {
    const l = manifest.licences[key];
    return `### ${l.name}\n\n${l.requires}\n\nTerms: ${l.url}\n`;
  })
  .join("\n")}
## Textures

| Asset | Served as | Width | Size | Licence | Original |
|---|---|---|---|---|---|
${credited
  .flatMap(({ asset, files }) =>
    files.map(
      (f) =>
        `| ${asset.id} | \`${f.name}\` | ${f.width} | ${human(f.bytes)} | ${manifest.licences[asset.licence].name} | ${asset.url} |`,
    ),
  )
  .join("\n")}

## Deliberately not used

${manifest.excluded.map((e) => `- **${e.source}**: ${e.reason}`).join("\n")}

## Orbital and physical data

Planetary positions are computed in-app from the Keplerian element tables published at
https://ssd.jpl.nasa.gov/planets/approx_pos.html. Rotational elements follow the IAU Working
Group on Cartographic Coordinates and Rotational Elements, as encoded in NASA NAIF's
\`pck00011.tpc\`. Physical parameters come from https://ssd.jpl.nasa.gov/planets/phys_par.html
and the NASA Planetary Fact Sheet.

Validation compares against JPL Horizons (https://ssd.jpl.nasa.gov/horizons/), queried at
development time only. Per JPL's API policy their endpoints are never called from the browser.

Data courtesy NASA/JPL-Caltech. This project is not endorsed by NASA or JPL.
`;

await writeFile("public/ATTRIBUTION.md", attribution);

console.log(
  `\n${built.length} rebuilt, ${credited.length} textures served, ${human(total)} total in ${OUT_DIR}.`,
);
console.log("public/ATTRIBUTION.md regenerated.");
