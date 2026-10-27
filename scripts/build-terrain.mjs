/**
 * Turns a raw planetary elevation model into normal maps the renderer can use, and into a
 * tile pyramid for close zoom.
 *
 * Why normal maps rather than displacement. Three.js displaces existing vertices along their
 * normal with no tessellation, so crater relief on a whole-planet sphere needs the geometry to
 * already be there. Even a 2048x1024 segment sphere puts one vertex every 5.3 km on the Moon,
 * which makes a 20 km crater four vertices wide. A normal map changes the lighting instead, and
 * lighting is what makes a crater read as a crater through the terminator.
 *
 * Why a pyramid. An 8192-wide global map is 1,332 m per texel on the Moon. That resolves roughly
 * 13 km craters convincingly and goes blurrier than the screen once the camera is inside about
 * 1,500 km. No global texture at any practical size fixes that, so close range needs tiles.
 *
 *   node scripts/build-terrain.mjs --source /tmp/ldem_64.img --body moon
 */

import { createWriteStream } from "node:fs";
import { mkdir, open, stat, writeFile } from "node:fs/promises";
import sharp from "sharp";

const args = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? fallback : args[i + 1];
};

/**
 * LOLA LDEM_64: simple cylindrical, 64 pixels per degree, 16-bit signed integers, big-endian
 * as PDS publishes them. Elevation in metres is the sample times the scaling factor, measured
 * from a 1737400 m reference sphere.
 */
const SOURCES = {
  moon: {
    path: arg("source", "/tmp/ldem_64.img"),
    width: 23_040,
    height: 11_520,
    scalingFactor: 0.5,
    referenceRadiusM: 1_737_400,
    bigEndian: true,
    source:
      "LRO LOLA GDR, https://pds-geosciences.wustl.edu/lro/lro-l-lola-3-rdr-v1/lrolol_1xxx/data/lola_gdr/cylindrical/img/ldem_64.img",
  },
};

const bodyId = arg("body", "moon");
const spec = SOURCES[bodyId];
if (!spec) throw new Error(`no elevation source configured for "${bodyId}"`);

const GLOBAL_WIDTH = Number(arg("width", 8192));
const GLOBAL_HEIGHT = GLOBAL_WIDTH / 2;
const TILE_SIZE = 512;
const PYRAMID_LEVELS = Number(arg("levels", 3));
const OUT_DIR = `public/terrain/${bodyId}`;

const info = await stat(spec.path);
const expected = spec.width * spec.height * 2;
if (info.size !== expected) {
  throw new Error(
    `${spec.path} is ${info.size} bytes; ${spec.width}x${spec.height} 16-bit should be ${expected}. ` +
      `Either the download is incomplete or the dimensions are wrong.`,
  );
}

await mkdir(OUT_DIR, { recursive: true });
const handle = await open(spec.path, "r");

/** Reads one source row as elevations in metres. */
const rowBytes = spec.width * 2;
const rowBuffer = Buffer.allocUnsafe(rowBytes);

async function readSourceRow(y, out) {
  await handle.read(rowBuffer, 0, rowBytes, y * rowBytes);
  for (let x = 0; x < spec.width; x++) {
    const raw = spec.bigEndian ? rowBuffer.readInt16BE(x * 2) : rowBuffer.readInt16LE(x * 2);
    out[x] = raw * spec.scalingFactor;
  }
}

/**
 * Box-downsamples the source to the working resolution, one output row at a time, so a 530 MB
 * file never has to be resident. Elevations stay in metres as float32.
 */
async function downsample(targetWidth, targetHeight) {
  const grid = new Float32Array(targetWidth * targetHeight);
  const sourceRow = new Float32Array(spec.width);
  const accumulator = new Float64Array(targetWidth);
  const counts = new Uint32Array(targetWidth);

  const rowsPer = spec.height / targetHeight;
  const colsPer = spec.width / targetWidth;

  for (let ty = 0; ty < targetHeight; ty++) {
    accumulator.fill(0);
    counts.fill(0);

    const from = Math.floor(ty * rowsPer);
    const to = Math.min(spec.height, Math.max(from + 1, Math.floor((ty + 1) * rowsPer)));

    for (let sy = from; sy < to; sy++) {
      await readSourceRow(sy, sourceRow);
      for (let sx = 0; sx < spec.width; sx++) {
        const tx = Math.min(targetWidth - 1, Math.floor(sx / colsPer));
        accumulator[tx] += sourceRow[sx];
        counts[tx] += 1;
      }
    }

    for (let tx = 0; tx < targetWidth; tx++) {
      grid[ty * targetWidth + tx] = counts[tx] ? accumulator[tx] / counts[tx] : 0;
    }

    if (ty % 256 === 0) {
      process.stdout.write(`\r  downsampling ${((ty / targetHeight) * 100).toFixed(0)}%   `);
    }
  }
  process.stdout.write(`\r  downsampling 100%      \n`);
  return grid;
}

/**
 * Tangent-space normal map from an equirectangular height grid.
 *
 * The horizontal sample spacing shrinks as cos(latitude), so a naive central difference blows
 * up near the poles and produces a ring of garbage normals. Clamping the spacing to its value
 * at 85 degrees keeps the poles sane; the distortion there is a property of the projection,
 * not of the terrain.
 */
function normalMapFrom(grid, width, height, radiusM) {
  const rgb = Buffer.allocUnsafe(width * height * 3);
  const metresPerTexelY = (Math.PI * radiusM) / height;
  const minCos = Math.cos((85 * Math.PI) / 180);

  let minElevation = Infinity;
  let maxElevation = -Infinity;

  for (let y = 0; y < height; y++) {
    const latitude = (0.5 - (y + 0.5) / height) * Math.PI;
    const metresPerTexelX = Math.max(
      (2 * Math.PI * radiusM * Math.max(Math.cos(latitude), minCos)) / width,
      1e-6,
    );

    const yUp = Math.max(0, y - 1);
    const yDown = Math.min(height - 1, y + 1);

    for (let x = 0; x < width; x++) {
      // Longitude wraps, so the horizontal neighbours do too.
      const xLeft = (x - 1 + width) % width;
      const xRight = (x + 1) % width;

      const left = grid[y * width + xLeft];
      const right = grid[y * width + xRight];
      const up = grid[yUp * width + x];
      const down = grid[yDown * width + x];

      const here = grid[y * width + x];
      if (here < minElevation) minElevation = here;
      if (here > maxElevation) maxElevation = here;

      const dzdx = (right - left) / (2 * metresPerTexelX);
      const dzdy = (down - up) / (2 * metresPerTexelY);

      const length = Math.sqrt(dzdx * dzdx + dzdy * dzdy + 1);
      const o = (y * width + x) * 3;
      rgb[o] = Math.round(((-dzdx / length) * 0.5 + 0.5) * 255);
      rgb[o + 1] = Math.round(((-dzdy / length) * 0.5 + 0.5) * 255);
      rgb[o + 2] = Math.round(((1 / length) * 0.5 + 0.5) * 255);
    }
  }

  return { rgb, minElevation, maxElevation };
}

console.log(`${bodyId}: ${spec.width}x${spec.height} 16-bit, ${(info.size / 1e6).toFixed(0)} MB`);
console.log(`building a ${GLOBAL_WIDTH}x${GLOBAL_HEIGHT} working grid`);

const grid = await downsample(GLOBAL_WIDTH, GLOBAL_HEIGHT);
const { rgb, minElevation, maxElevation } = normalMapFrom(
  grid,
  GLOBAL_WIDTH,
  GLOBAL_HEIGHT,
  spec.referenceRadiusM,
);

console.log(`elevation range ${minElevation.toFixed(0)} to ${maxElevation.toFixed(0)} m`);

const globalPath = `${OUT_DIR}/normal-global.jpg`;
await sharp(rgb, { raw: { width: GLOBAL_WIDTH, height: GLOBAL_HEIGHT, channels: 3 } })
  .jpeg({ quality: 92, chromaSubsampling: "4:4:4" })
  .toFile(globalPath);

/**
 * The tile pyramid. Level 0 is two tiles covering the sphere, and each level doubles in both
 * directions, which is the standard equirectangular quadtree. Tiles are cut from the working
 * grid at full resolution for the level, so a deep level is genuinely sharper rather than an
 * upscale of the global map.
 */
const manifest = { body: bodyId, tileSize: TILE_SIZE, levels: [], source: spec.source };

for (let level = 0; level <= PYRAMID_LEVELS; level++) {
  const tilesX = 2 ** (level + 1);
  const tilesY = 2 ** level;
  const levelWidth = tilesX * TILE_SIZE;
  const levelHeight = tilesY * TILE_SIZE;

  const levelGrid =
    levelWidth === GLOBAL_WIDTH && levelHeight === GLOBAL_HEIGHT
      ? grid
      : await downsample(levelWidth, levelHeight);

  const { rgb: levelRgb } = normalMapFrom(
    levelGrid,
    levelWidth,
    levelHeight,
    spec.referenceRadiusM,
  );

  await mkdir(`${OUT_DIR}/${level}`, { recursive: true });
  const image = sharp(levelRgb, {
    raw: { width: levelWidth, height: levelHeight, channels: 3 },
  });

  for (let ty = 0; ty < tilesY; ty++) {
    for (let tx = 0; tx < tilesX; tx++) {
      await image
        .clone()
        .extract({ left: tx * TILE_SIZE, top: ty * TILE_SIZE, width: TILE_SIZE, height: TILE_SIZE })
        .jpeg({ quality: 90, chromaSubsampling: "4:4:4" })
        .toFile(`${OUT_DIR}/${level}/${tx}-${ty}.jpg`);
    }
  }

  const metresPerTexel = (2 * Math.PI * spec.referenceRadiusM) / levelWidth;
  manifest.levels.push({ level, tilesX, tilesY, levelWidth, levelHeight, metresPerTexel });
  console.log(
    `  level ${level}: ${tilesX}x${tilesY} tiles, ${levelWidth}x${levelHeight}, ${metresPerTexel.toFixed(0)} m/texel`,
  );
}

await writeFile(
  `${OUT_DIR}/manifest.json`,
  JSON.stringify(
    {
      ...manifest,
      globalNormalMap: "normal-global.jpg",
      globalWidth: GLOBAL_WIDTH,
      globalHeight: GLOBAL_HEIGHT,
      elevationRangeM: [minElevation, maxElevation],
      referenceRadiusM: spec.referenceRadiusM,
      generatedAt: new Date().toISOString(),
    },
    null,
    2,
  ) + "\n",
);

await handle.close();
console.log(`\nwrote ${OUT_DIR}`);
