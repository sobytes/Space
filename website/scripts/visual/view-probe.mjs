/**
 * The lighting presets and the moon framing, measured rather than eyeballed.
 *
 * A shader injected through onBeforeCompile either compiles or silently falls back, and a
 * camera preset can look plausible while pointing the wrong way, so both get checked against
 * numbers: the fraction of the disc that is lit, and whether the Moon lands inside the frame.
 */
import { chromium } from "playwright";
import sharp from "sharp";
import { artifact } from "./artifacts.mjs";

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1000, height: 700 } });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
// A body with no elevation model probes for one and gets a 404, which is the designed
// fallback to its texture rather than a failure. Everything else counts.
page.on("response", (r) => {
  if (r.status() === 404 && !r.url().includes("/terrain/")) errors.push(`404 ${r.url()}`);
});
await page.goto("http://localhost:3000", { waitUntil: "domcontentloaded" });
await page.waitForSelector("canvas");
await page.waitForTimeout(5000);
await page.evaluate(() => {
  window.__solar.setFocus("embary");
  window.__solar.send({ kind: "togglePause" });
});
await page.waitForTimeout(2500);

/** Mean brightness of the central disc region, which is Earth at this framing. */
async function discBrightness(name) {
  const buffer = await page.screenshot({ clip: { x: 300, y: 150, width: 400, height: 400 } });
  await sharp(buffer).toFile(artifact(`view-${name}.png`));
  const { data, info } = await sharp(buffer).raw().toBuffer({ resolveWithObject: true });
  let sum = 0;
  let lit = 0;
  const px = info.width * info.height;
  for (let i = 0; i < px; i++) {
    const v = (data[i * info.channels] + data[i * info.channels + 1] + data[i * info.channels + 2]) / 3;
    sum += v;
    if (v > 40) lit += 1;
  }
  return { mean: sum / px, litFraction: lit / px };
}

const results = {};
for (const [name, degrees] of [["day", 0], ["terminator", 90], ["night", 180]]) {
  await page.evaluate((d) => window.__solar.requestView({ kind: "sunAngle", degrees: d }), degrees);
  await page.waitForTimeout(2500);
  results[name] = await discBrightness(name);
  console.log(
    `${name.padEnd(11)} mean brightness ${results[name].mean.toFixed(1).padStart(6)}` +
    `   lit fraction ${(results[name].litFraction * 100).toFixed(1)}%`,
  );
}

/**
 * Fit moons, checked by camera distance rather than only by whether the Moon is on screen.
 *
 * Whether the Moon happens to start in frame depends on the date, since it moves right round
 * its orbit every 27 days, so an on-screen check alone silently becomes a no-op on about half
 * the days of the month. The distance the camera pulls back to is deterministic.
 */
console.log("\n=== fit moons ===");
// Furthest satellite in the registry for each, and its apoapsis in km. Taken from
// satelliteSystemRadiusM, which is the same number the camera frames against.
for (const [body, furthestMoon, apoapsisKm] of [
  ["embary", "moon", 405_696],
  ["jupiter", "callisto", 1_895_879],
  ["saturn", "phoebe", 15_049_822],
]) {
  await page.evaluate((b) => window.__solar.setFocus(b), body);
  await page.waitForTimeout(3000);
  const before = await page.evaluate(() => window.__solar.snapshot().distanceToFocus / 1000);
  await page.evaluate(() => window.__solar.requestView({ kind: "frameMoons" }));
  await page.waitForTimeout(3500);
  const after = await page.evaluate((moonId) => {
    const onScreen = (p) => p && Math.abs(p.ndcX) <= 1 && Math.abs(p.ndcY) <= 1 && !p.behindCamera;
    const furthest = window.__solar.screen.find((p) => p.id === moonId);
    return {
      km: window.__solar.snapshot().distanceToFocus / 1000,
      furthestOnScreen: onScreen(furthest),
      ndc: furthest ? [furthest.ndcX, furthest.ndcY] : null,
    };
  }, furthestMoon);
  const ratio = after.km / before;
  console.log(
    `${body.padEnd(8)} camera ${before.toFixed(0)} -> ${after.km.toFixed(0)} km (${ratio.toFixed(1)}x)` +
    `   ${furthestMoon} apoapsis ${apoapsisKm.toLocaleString()} km` +
    `   in frame: ${after.furthestOnScreen} at ndc(${after.ndc?.map((v) => v.toFixed(2)).join(", ")})`,
  );
  // The claim is that the furthest moon ends up in frame. Because the framing is sized to its
  // apoapsis, that holds wherever it happens to be in its orbit today.
  if (!after.furthestOnScreen) { console.log(`FAIL: ${furthestMoon} is not in frame`); process.exit(1); }
  if (after.km < apoapsisKm) { console.log(`FAIL: ${body} camera is inside its moon system`); process.exit(1); }
  if (ratio < 3) { console.log(`FAIL: ${body} camera barely moved`); process.exit(1); }
}
await page.evaluate(() => window.__solar.setFocus("embary"));
await page.waitForTimeout(2500);
await page.screenshot({ path: artifact("view-fit-moons.png") });

/**
 * The night side must actually show city lights.
 *
 * Measured: 12.2 mean brightness with the lights absent, 20.2 with them present, so 16 sits
 * clear of both. This threshold is the only thing standing between a working night side and a
 * silent regression, because every way this feature breaks is quiet. The shader compiles and
 * adds zero if the texture uniform is null, three hands out a cached program from another
 * planet if the cache key is missing, and adding after tone mapping costs a factor of twenty
 * in brightness. None of those raise an error.
 */
let failed = false;
if (results.night.mean < 16) {
  console.log(`FAIL: night side reads ${results.night.mean.toFixed(1)}, below the 16 that means ` +
              "the city lights are rendering");
  failed = true;
}
if (results.day.litFraction <= results.terminator.litFraction) {
  console.log("FAIL: the day view is not more lit than the terminator view"); failed = true;
}
if (results.terminator.litFraction <= results.night.litFraction) {
  console.log("FAIL: the terminator view is not more lit than the night view"); failed = true;
}
if (errors.length) { console.log("page errors:", errors.slice(0, 3)); failed = true; }
if (failed) process.exit(1);
console.log("\nOK");
await browser.close();
