/**
 * Drives the real app in a real browser and captures what it actually draws.
 *
 * This exists because "the server returned 200" proves nothing about a WebGL scene. It collects
 * console errors and failed requests too, since a missing texture or a shader failure shows up
 * as a black screen that a screenshot alone would not explain.
 *
 *   node scripts/visual/capture.mjs                 # default shots
 *   node scripts/visual/capture.mjs --out dir       # write somewhere else
 */

import { mkdir, writeFile } from "node:fs/promises";
import sharp from "sharp";
import { chromium } from "playwright";

const BASE = process.env.SOLAR_URL ?? "http://localhost:3000";
const outIndex = process.argv.indexOf("--out");
const OUT = outIndex === -1 ? "artifacts/visual" : process.argv[outIndex + 1];

await mkdir(OUT, { recursive: true });

const browser = await chromium.launch({
  args: ["--use-gl=angle", "--use-angle=metal", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"],
});
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 2 });

const consoleErrors = [];
const failedRequests = [];
page.on("console", (message) => {
  if (message.type() === "error") consoleErrors.push(message.text());
});
page.on("pageerror", (error) => consoleErrors.push(`pageerror: ${error.message}`));
page.on("requestfailed", (request) =>
  failedRequests.push(`${request.url()} ${request.failure()?.errorText ?? ""}`),
);
page.on("response", (response) => {
  if (response.status() >= 400) failedRequests.push(`${response.url()} HTTP ${response.status()}`);
});

// The star field alone lights roughly 0.4% of the scene region, so the bar sits above that:
// a body in frame has to contribute real area, not just a scatter of single pixels.
const BODY_VISIBLE_THRESHOLD = 0.012;

const settle = (ms) => page.waitForTimeout(ms);

console.log(`opening ${BASE}`);
await page.goto(BASE, { waitUntil: "networkidle", timeout: 60_000 });

await page.waitForSelector("canvas", { timeout: 30_000 });

/**
 * Waits until the scene region actually lights up rather than guessing at a fixed delay.
 * The app loads 78MB of 8K textures and decoding those takes real time, so a fixed wait either
 * flakes or wastes minutes. Polling the thing being measured is both faster and honest.
 */
async function waitForScene(label, timeoutMs = 90_000) {
  const started = Date.now();
  let best = 0;
  while (Date.now() - started < timeoutMs) {
    const probe = `${OUT}/.probe.png`;
    await page.screenshot({ path: probe });
    const { sceneLitFraction } = await analyseSceneRegion(probe);
    best = Math.max(best, sceneLitFraction);
    if (sceneLitFraction >= BODY_VISIBLE_THRESHOLD) {
      console.log(`  ${label}: scene lit ${(sceneLitFraction * 100).toFixed(3)}% after ${((Date.now() - started) / 1000).toFixed(1)}s`);
      return true;
    }
    await settle(1_500);
  }
  console.log(`  ${label}: TIMED OUT, best scene lit ${(best * 100).toFixed(3)}%`);
  return false;
}

await waitForScene("first paint");

/**
 * Measures the rendered PNG rather than the live canvas.
 *
 * The first version of this read the WebGL canvas through a 2D context and reported every shot
 * as pure black. That was the measurement, not the scene: without `preserveDrawingBuffer` the
 * drawing buffer is already cleared by the time a probe can copy it. Playwright's screenshot
 * goes through the compositor and sees what a human sees, so the analysis happens on those
 * bytes instead.
 */
async function analyse(file) {
  const { data, info } = await sharp(file).raw().toBuffer({ resolveWithObject: true });
  const channels = info.channels;
  let lit = 0;
  let sum = 0;
  const pixels = info.width * info.height;

  for (let i = 0; i < data.length; i += channels) {
    const luminance = data[i] * 0.2126 + data[i + 1] * 0.7152 + data[i + 2] * 0.0722;
    sum += luminance;
    if (luminance > 8) lit += 1;
  }

  return {
    width: info.width,
    height: info.height,
    litFraction: lit / pixels,
    meanLuminance: sum / pixels,
  };
}

/** The HUD alone lights a fixed share of the frame, so a scene test must exclude it. */
async function analyseSceneRegion(file) {
  const meta = await sharp(file).metadata();
  const left = Math.round(meta.width * 0.08);
  const top = Math.round(meta.height * 0.18);
  const width = Math.round(meta.width * 0.6);
  const height = Math.round(meta.height * 0.6);
  const cropped = `${file.replace(/\.png$/, "")}-scene.png`;
  await sharp(file).extract({ left, top, width, height }).toFile(cropped);
  const stats = await analyse(cropped);
  return { sceneLitFraction: stats.litFraction, sceneMeanLuminance: stats.meanLuminance };
}

const shots = [];

async function shot(name, note) {
  const file = `${OUT}/${name}.png`;
  await page.screenshot({ path: file });
  const stats = await analyse(file);
  const scene = await analyseSceneRegion(file);
  shots.push({ name, note, file, ...stats, ...scene });
  console.log(
    `  ${name.padEnd(22)} frame lit ${(stats.litFraction * 100).toFixed(2)}%` +
      `  scene lit ${(scene.sceneLitFraction * 100).toFixed(3)}%` +
      `  scene luminance ${scene.sceneMeanLuminance.toFixed(2)}`,
  );
}

await shot("01-initial", "default view, focused on Earth");

const bodies = ["Jupiter", "Saturn", "The Sun", "The Moon", "Mars", "Uranus"];
for (const name of bodies) {
  const button = page.locator(`nav button:has-text("${name}")`).first();
  if ((await button.count()) === 0) continue;
  await button.click();
  await settle(2_000);
  await waitForScene(name, 25_000);
  await shot(`body-${name.toLowerCase().replace(/\s+/g, "-")}`, `focused on ${name}`);
}

const report = {
  url: BASE,
  capturedAt: new Date().toISOString(),
  shots,
  consoleErrors,
  failedRequests,
};
await writeFile(`${OUT}/report.json`, JSON.stringify(report, null, 2) + "\n");

await browser.close();

console.log(`\n${shots.length} screenshots in ${OUT}`);
if (consoleErrors.length) {
  console.log(`\n${consoleErrors.length} console errors:`);
  for (const error of consoleErrors.slice(0, 12)) console.log(`  ${error.slice(0, 220)}`);
}
if (failedRequests.length) {
  console.log(`\n${failedRequests.length} failed requests:`);
  for (const request of [...new Set(failedRequests)].slice(0, 12)) console.log(`  ${request.slice(0, 200)}`);
}

const blank = shots.filter((s) => (s.sceneLitFraction ?? 0) < BODY_VISIBLE_THRESHOLD);
if (blank.length) {
  console.log(
    `\nFAIL: ${blank.length} shots show no body in the scene region: ${blank.map((s) => s.name).join(", ")}`,
  );
  process.exit(1);
}
console.log("\nevery shot shows a body in frame");
