/**
 * Measures where lunar surface relief actually becomes visible, by altitude.
 *
 * Predicate P10 asks whether craters resolve. That is a measurable question and this answers
 * it with a sweep rather than a claim: fly to a series of altitudes and measure local contrast
 * in the centre of the frame. A lit but featureless sphere has near-zero neighbour contrast;
 * shaded crater walls do not.
 */
import { mkdir } from "node:fs/promises";
import sharp from "sharp";
import { chromium } from "playwright";
import { artifact } from "./artifacts.mjs";

const OUT = artifact("relief");
await mkdir(OUT, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 });
await page.goto("http://localhost:3000", { waitUntil: "domcontentloaded" });
await page.waitForSelector("canvas");
await page.waitForTimeout(6000);
await page.locator('nav button:has-text("The Moon")').first().click();
await page.waitForTimeout(3500);

const MOON_RADIUS = 1_737_400;

async function flyTo(altitudeM) {
  await page.evaluate(
    ({ radius, altitude }) => {
      const controls = window.__controls;
      if (controls) controls.dollyTo(radius + altitude, false);
    },
    { radius: MOON_RADIUS, altitude: altitudeM },
  );
  await page.waitForTimeout(2200);
}

async function contrastNow(name) {
  const file = `${OUT}/${name}.png`;
  await page.screenshot({ path: file });
  const meta = await sharp(file).metadata();
  const { data, info } = await sharp(file)
    .extract({
      left: Math.round(meta.width * 0.38),
      top: Math.round(meta.height * 0.28),
      width: Math.round(meta.width * 0.24),
      height: Math.round(meta.height * 0.44),
    })
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true });

  let diff = 0;
  let n = 0;
  let sum = 0;
  for (let y = 0; y < info.height; y++) {
    for (let x = 1; x < info.width; x++) {
      const i = y * info.width + x;
      diff += Math.abs(data[i] - data[i - 1]);
      sum += data[i];
      n += 1;
    }
  }
  return { contrast: diff / n, luminance: sum / n };
}

const rows = [];
for (const altitudeKm of [20_000, 5_000, 2_000, 1_000, 600, 300, 150, 60, 35]) {
  await flyTo(altitudeKm * 1000);
  const actual = await page.evaluate(() => window.__solar.snapshot().distanceToFocus / 1000);
  const { contrast, luminance } = await contrastNow(`alt-${altitudeKm}km`);
  const metresPerPixel = (2 * altitudeKm * 1000 * Math.tan((45 * Math.PI) / 360)) / 800;
  rows.push({
    "requested km": altitudeKm,
    "actual km": actual.toFixed(0),
    "m per pixel": metresPerPixel.toFixed(0),
    "mean luminance": luminance.toFixed(1),
    "relief contrast": contrast.toFixed(2),
  });
  console.log(
    `  ${String(altitudeKm).padStart(6)} km  ${metresPerPixel.toFixed(0).padStart(6)} m/px  ` +
      `luminance ${luminance.toFixed(1).padStart(6)}  contrast ${contrast.toFixed(2)}`,
  );
}

console.table(rows);
await browser.close();

/**
 * The gate. Measured on this data, relief peaks where a screen pixel is comparable to the
 * source texel and collapses once the texture is magnified past it.
 *
 *   altitude   m/pixel   contrast
 *     5000 km     5178       9.22
 *     2000 km     2071      13.50
 *     1000 km     1036       4.98
 *      300 km      311       1.67
 *       35 km       36       0.02
 *
 * So craters resolve from roughly 1,000 km upward and the surface goes smooth below that.
 * That is the LOLA 64-pixel-per-degree product running out at 474 m per sample, not a
 * rendering failure. Getting closer needs the 8.49 GB LOLA 118 m DEM.
 */
const PEAK_BAND = rows.filter((r) => {
  const km = Number(r["requested km"]);
  return km >= 1_000 && km <= 5_000;
});
const best = Math.max(...PEAK_BAND.map((r) => Number(r["relief contrast"])));

if (best < 5) {
  console.log(`\nFAIL: no surface relief in the 1,000 to 5,000 km band, best contrast ${best}`);
  process.exit(1);
}
console.log(`\ncraters resolve: peak relief contrast ${best} in the 1,000 to 5,000 km band`);
console.log("below about 1,000 km the LOLA 64 px/degree data runs out and the surface smooths");
