/**
 * Renders the app icon from the same imagery the app ships.
 *
 * Not drawn by hand, and not a screenshot either. A screenshot of the running app is whatever
 * the camera happened to be doing that day, and a hand-drawn globe is a picture of a different
 * product. This renders Earth the way the app renders it, from the same three textures, with
 * the same terminator and the same city lights on the night side, at a size and framing chosen
 * for an icon. Re-run it and you get the identical file.
 *
 * A plain ray-traced sphere rather than a GPU render, because an icon is one 1024 px image and
 * a software renderer has no driver, no context and no headless browser to go wrong. The
 * projection is orthographic: a perspective camera would make the disc subtly egg-shaped off
 * centre, and a planet seen from far away is orthographic anyway.
 *
 *   node scripts/make-icon.mjs
 */

import { mkdir, writeFile } from "node:fs/promises";
import sharp from "sharp";

const TEXTURES = "website/public/textures";
const SIZE = 1024;
/** Rendered at 3x and box-filtered down, which is what keeps the limb from stair-stepping. */
const SUPERSAMPLE = 3;

/** Earth's real axial tilt. The same number the app draws the seasons with. */
const TILT_DEG = 23.4392811;
/**
 * Which face. 20 degrees east puts Africa and Europe squarely in the lit half, which is the
 * most recognisable face of Earth at 40 pixels; the Pacific face is almost entirely ocean and
 * reads as a blue circle.
 */
const CENTRAL_LONGITUDE_DEG = 15;
/**
 * Sun up and to the left, so the terminator falls down the right.
 *
 * Chosen rather than inherited. Lighting straight down the view axis renders a fully lit disc,
 * which is a photograph of a globe; swinging the Sun round until about a fifth of the disc is
 * past the terminator shows the dawn line and the city lights behind it, which is the thing
 * this app actually draws and the one detail that says it is a simulator rather than a map.
 */
const SUN = normalise({ x: -0.72, y: 0.24, z: 0.65 });
/** Fraction of the frame the disc spans. Leaves room inside iOS's rounded-corner mask. */
const DISC_FRACTION = 0.82;

function normalise(v) {
  const m = Math.hypot(v.x, v.y, v.z);
  return { x: v.x / m, y: v.y / m, z: v.z / m };
}

/** Equirectangular sampler. Bilinear, because nearest shows as jagged coastlines at this size. */
function sampler({ data, width, height, channels }) {
  return (u, v) => {
    const x = u * width - 0.5;
    const y = v * height - 0.5;
    const x0 = Math.floor(x);
    const y0 = Math.min(height - 1, Math.max(0, Math.floor(y)));
    const fx = x - x0;
    const fy = y - y0;
    const y1 = Math.min(height - 1, y0 + 1);
    // Longitude wraps and latitude clamps, which is what an equirectangular map actually does.
    const xa = ((x0 % width) + width) % width;
    const xb = (xa + 1) % width;

    const at = (px, py) => {
      const i = (py * width + px) * channels;
      return [data[i], data[i + 1], data[i + 2]];
    };
    const [r00, g00, b00] = at(xa, y0);
    const [r10, g10, b10] = at(xb, y0);
    const [r01, g01, b01] = at(xa, y1);
    const [r11, g11, b11] = at(xb, y1);
    const lerp = (a, b, t) => a + (b - a) * t;
    return [
      lerp(lerp(r00, r10, fx), lerp(r01, r11, fx), fy),
      lerp(lerp(g00, g10, fx), lerp(g01, g11, fx), fy),
      lerp(lerp(b00, b10, fx), lerp(b01, b11, fx), fy),
    ];
  };
}

async function load(name) {
  const image = sharp(`${TEXTURES}/${name}`).removeAlpha().raw();
  const { data, info } = await image.toBuffer({ resolveWithObject: true });
  return sampler({ data, width: info.width, height: info.height, channels: info.channels });
}

const day = await load("earth-day.detail.webp");
const night = await load("earth-night.detail.webp");
const clouds = await load("earth-clouds.detail.webp");

const N = SIZE * SUPERSAMPLE;
const radius = (N * DISC_FRACTION) / 2;
const centre = N / 2;
const pixels = Buffer.alloc(N * N * 3);

const tilt = (TILT_DEG * Math.PI) / 180;
const cosTilt = Math.cos(tilt);
const sinTilt = Math.sin(tilt);
const spin = (CENTRAL_LONGITUDE_DEG * Math.PI) / 180;

for (let py = 0; py < N; py++) {
  for (let px = 0; px < N; px++) {
    // Screen space, y upwards, in units of the disc radius.
    const sx = (px + 0.5 - centre) / radius;
    const sy = (centre - py - 0.5) / radius;
    const r2 = sx * sx + sy * sy;
    const out = (py * N + px) * 3;

    if (r2 >= 1) {
      /**
       * Off the disc: space, plus the atmosphere's glow.
       *
       * The glow is why the background is not simply black. A hard-edged disc on black reads
       * as a sticker; a few pixels of scattered blue at the limb is what makes it read as a
       * planet with air on it, which is the whole subject of the app.
       */
      const d = Math.sqrt(r2) - 1;
      const glow = Math.exp(-d * 38) * 0.7;
      pixels[out] = Math.round(8 + glow * 44);
      pixels[out + 1] = Math.round(10 + glow * 108);
      pixels[out + 2] = Math.round(16 + glow * 205);
      continue;
    }

    const sz = Math.sqrt(1 - r2);

    // Un-tilt the view direction to get the body-fixed normal: the pole leans toward the
    // viewer's upper right by the obliquity, so the texture has to be read in the frame that
    // leans with it rather than in screen axes.
    const nx0 = sx;
    const ny0 = sy * cosTilt + sz * sinTilt;
    const nz0 = -sy * sinTilt + sz * cosTilt;

    const latitude = Math.asin(Math.max(-1, Math.min(1, ny0)));
    const longitude = Math.atan2(nx0, nz0) + spin;
    const u = ((longitude / (2 * Math.PI) + 0.5) % 1 + 1) % 1;
    const v = 0.5 - latitude / Math.PI;

    // Lambert against the real Sun direction. The surface normal in screen space is just the
    // point on the unit sphere, so this is the dot product and nothing more.
    const lambert = sx * SUN.x + sy * SUN.y + sz * SUN.z;

    /**
     * The terminator, softened over a few degrees.
     *
     * A hard step is wrong and looks wrong: the Sun is half a degree across, so Earth's
     * terminator is a gradient tens of kilometres wide, and atmospheric scattering widens
     * what you actually see to a visible band. `smoothstep` over the same small range the
     * app's shader uses puts the dawn line where the eye expects it.
     */
    const t = Math.max(0, Math.min(1, (lambert + 0.09) / 0.26));
    const lit = t * t * (3 - 2 * t);

    const [dr, dg, db] = day(u, v);
    const [nr, ng, nb] = night(u, v);
    const [cr] = clouds(u, v);

    // Clouds are a greyscale map used as coverage, which is how the app treats them too.
    const cloud = (cr / 255) * 0.92;
    const dayR = dr + (255 - dr) * cloud;
    const dayG = dg + (255 - dg) * cloud;
    const dayB = db + (255 - db) * cloud;

    // Ambient so the night side is never pure black: Earth has a full Moon and airglow, and a
    // black crescent on a dark icon just looks like the disc has a bite out of it.
    const ambient = 0.055;
    const shade = ambient + lit * (1 - ambient);

    /**
     * City lights, and the one place this departs from a physical model on purpose.
     *
     * They are faded in only where the Sun has actually set, and faded out under thick cloud,
     * because lights glowing through an overcast daylit limb is the artefact that gives a
     * composited Earth away.
     */
    const nightMask = (1 - lit) * (1 - cloud * 0.7);
    const lamp = 1.35 * nightMask;

    // A thin rim of atmosphere on the inside of the limb, strongest where it is lit.
    const rim = Math.pow(r2, 7) * Math.max(0, lambert + 0.4) * 0.55;

    const r = dayR * shade + nr * lamp + 40 * rim;
    const g = dayG * shade + ng * lamp + 104 * rim;
    const b = dayB * shade + nb * lamp + 200 * rim;

    pixels[out] = Math.min(255, Math.round(r));
    pixels[out + 1] = Math.min(255, Math.round(g));
    pixels[out + 2] = Math.min(255, Math.round(b));
  }
}

const rendered = sharp(pixels, { raw: { width: N, height: N, channels: 3 } });

/**
 * Every size this project needs, written where each client expects to find it.
 *
 * Three channels throughout, never four. An App Store icon with an alpha channel is rejected
 * at submission, and the rejection names the transparency rather than the file, which is a
 * confusing half hour. Nothing here is transparent anyway: the background is space.
 */
const TARGETS = [
  // iOS takes one 1024 and derives the rest, which is why there is no ladder of sizes here.
  { path: "mobile/ios/App/Assets.xcassets/AppIcon.appiconset/icon-1024.png", size: 1024 },
  /**
   * Next.js App Router conventions: these filenames are the configuration, and there is no
   * link tag to write. `favicon.ico` was deleted rather than replaced, because Next serves it
   * at a higher priority than `icon.png` and leaving the stock one there meant every tab
   * showed the Next.js logo while the correct icon sat unused beside it.
   */
  { path: "website/src/app/icon.png", size: 512 },
  { path: "website/src/app/apple-icon.png", size: 180 },
  { path: "artifacts/icon-preview.png", size: 1024 },
];

/**
 * A real `.ico`, because the well-known path is requested whether or not a link tag exists.
 *
 * Next emits `<link rel="icon" href="/icon.png">` and modern browsers honour it, but feed
 * readers, link unfurlers and anything following the 1994 convention still ask for
 * `/favicon.ico` and got a 404. ICO has allowed a PNG payload per entry since Vista, so this
 * is a 22-byte header per size wrapped around images already rendered above rather than a
 * BMP encoder.
 */
function icoFrom(entries) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // 1 means icon rather than cursor
  header.writeUInt16LE(entries.length, 4);

  const directory = Buffer.alloc(16 * entries.length);
  let offset = header.length + directory.length;
  entries.forEach(({ size, png }, i) => {
    const at = i * 16;
    // 256 is written as 0: the field is one byte and 256 does not fit.
    directory.writeUInt8(size >= 256 ? 0 : size, at);
    directory.writeUInt8(size >= 256 ? 0 : size, at + 1);
    directory.writeUInt8(0, at + 2); // palette size, 0 for truecolour
    directory.writeUInt8(0, at + 3); // reserved
    directory.writeUInt16LE(1, at + 4); // colour planes
    directory.writeUInt16LE(32, at + 6); // bits per pixel
    directory.writeUInt32LE(png.length, at + 8);
    directory.writeUInt32LE(offset, at + 12);
    offset += png.length;
  });

  return Buffer.concat([header, directory, ...entries.map((e) => e.png)]);
}

for (const { path, size } of TARGETS) {
  await mkdir(path.slice(0, path.lastIndexOf("/")), { recursive: true });
  const png = await rendered
    .clone()
    .resize(size, size, { kernel: "lanczos3" })
    .removeAlpha()
    .png({ compressionLevel: 9 })
    .toBuffer();
  await writeFile(path, png);
  console.log(`  ${String(size).padStart(4)}px  ${(png.length / 1024).toFixed(0).padStart(5)} KB  ${path}`);
}

const icoSizes = [16, 32, 48];
const ico = icoFrom(
  await Promise.all(
    icoSizes.map(async (size) => ({
      size,
      /**
       * RGBA here, unlike every PNG above.
       *
       * Next decodes this file at build time to emit its metadata, and rejects a non-RGBA
       * payload with "Format error decoding Ico: The PNG is not in RGBA format!" That is not
       * a warning: the route throws and every page returns 500, so an opaque favicon took the
       * whole site down. The alpha channel is fully opaque; only the channel count matters.
       * The App Store's no-alpha rule applies to the icon above and not to this one.
       */
      png: await rendered
        .clone()
        .resize(size, size, { kernel: "lanczos3" })
        .ensureAlpha(1)
        .png({ compressionLevel: 9 })
        .toBuffer(),
    })),
  ),
);
// `src/app`, not `public`. Next's metadata system owns this filename and serves it from the
// app directory; the same file under public/ is shadowed and returns 404.
await writeFile("website/src/app/favicon.ico", ico);
console.log(`  ${icoSizes.join("/")}px  ${(ico.length / 1024).toFixed(0).padStart(5)} KB  website/src/app/favicon.ico`);
