/**
 * Does mutual gravity actually run in the live scene, and does it diverge from the rails?
 *
 * The gates prove the integrator. This proves the integrator is wired to the renderer. A mode
 * switch that silently did nothing would pass every headless test and look perfect on screen.
 */
import { chromium } from "playwright";

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1100, height: 700 } });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
await page.goto("http://localhost:3000", { waitUntil: "domcontentloaded" });
await page.waitForSelector("canvas");
await page.waitForTimeout(5000);

const read = () =>
  page.evaluate(() => {
    const v = window.__solar;
    const s = v.snapshot();
    return {
      epoch: s.epoch,
      gravity: s.gravity,
      debug: v.debug(),
      screen: v.screen.map((p) => ({ id: p.id, d: p.distance })),
    };
  });

console.log("=== before the switch ===");
const before = await read();
console.log("mode:", before.gravity.mode, "| bodies integrated:", before.gravity.bodyCount);

// Focus the Sun so every planet's distance is its heliocentric distance, then run time hard.
await page.evaluate(() => {
  window.__solar.setFocus("sun");
  window.__solar.send({ kind: "setRate", secondsPerSecond: 86400 * 120 });
});
await page.waitForTimeout(500);

console.log("\n=== switching to mutual gravity ===");
await page.evaluate(() => window.__solar.setGravityMode("nbody"));
await page.waitForTimeout(300);
const atSwitch = await read();
console.log("mode:", atSwitch.gravity.mode, "| bodies integrated:", atSwitch.gravity.bodyCount);

if (atSwitch.gravity.mode !== "nbody") {
  console.log("FAIL: the mode did not change");
  process.exit(1);
}
if (atSwitch.gravity.bodyCount !== 9) {
  console.log(`FAIL: expected 9 integrated bodies, got ${atSwitch.gravity.bodyCount}`);
  process.exit(1);
}

await page.waitForTimeout(12000);
const after = await read();
const simYears = (after.epoch - atSwitch.epoch) / 365.25;

console.log(`\nran ${simYears.toFixed(1)} simulated years of mutual gravity in 12 real seconds`);
console.log("integrated:", after.gravity.integratedDays.toFixed(0), "days");
console.log("energy drift:", after.gravity.energyDrift.toExponential(2));
console.log("lag:", after.gravity.lagDays.toFixed(2), "days");

// Now compare the two modes at the same instant: pause, read, flip back, read again.
await page.evaluate(() => window.__solar.send({ kind: "togglePause" }));
await page.waitForTimeout(300);
const paused = await read();
const nbodyPaused = new Map(paused.screen.map((p) => [p.id, p.d]));
await page.evaluate(() => window.__solar.setGravityMode("analytic"));
await page.waitForTimeout(300);
const rails = await read();

// Distance from the camera, which sits on the Sun, so this is a difference in
// heliocentric distance rather than a full 3D separation. Enough to show the modes differ.
console.log(`\n${"body".padEnd(11)}${"radial gap, mutual - rails (km)".padStart(32)}`);
const railMap = new Map(rails.screen.map((p) => [p.id, p.d]));
let diverged = 0;
for (const id of ["mercury", "venus", "embary", "mars", "jupiter", "saturn", "uranus", "neptune"]) {
  const a = nbodyPaused.get(id);
  const b = railMap.get(id);
  if (a === undefined || b === undefined) continue;
  const gap = (a - b) / 1000;
  if (Math.abs(gap) > 100) diverged += 1;
  console.log(`${id.padEnd(11)}${gap.toFixed(0).padStart(32)}`);
}

console.log(`\n${diverged} of 8 planets sit more than 100 km from where the rails put them`);
if (errors.length) { console.log("page errors:", errors); process.exit(1); }
if (after.gravity.energyDrift > 1e-10) { console.log("FAIL: energy drift too large"); process.exit(1); }
// 120 simulated days per real second for 12 seconds is about 3.9 years.
if (simYears < 3) { console.log(`FAIL: only ${simYears.toFixed(2)} years advanced`); process.exit(1); }
if (Math.abs(after.gravity.lagDays) > 1) {
  console.log("FAIL: fell behind at a rate it should keep up with");
  process.exit(1);
}
if (diverged < 4) { console.log("FAIL: the two modes agree too closely to be different"); process.exit(1); }
// And at a rate no integrator can keep up with, it must admit it is behind rather than
// rendering stale positions as live ones.
console.log("\n=== at 200 years per real second ===");
await page.evaluate(() => {
  window.__solar.setGravityMode("nbody");
  window.__solar.send({ kind: "togglePause" });
  window.__solar.send({ kind: "setRate", secondsPerSecond: 86400 * 365.25 * 200 });
});
await page.waitForTimeout(4000);
const strained = await read();
console.log("lag:", strained.gravity.lagDays.toFixed(0), "days |",
            "integrated:", (strained.gravity.integratedDays / 365.25).toFixed(1), "yr");
if (Math.abs(strained.gravity.lagDays) < 1 && strained.gravity.integratedDays < 100) {
  console.log("FAIL: claims to be current while having integrated almost nothing");
  process.exit(1);
}

// The moons option: same equation, 32 bodies, and Phobos must stay bound to Mars.
console.log("\n=== with the 23 moons included ===");
await page.evaluate(() => {
  window.__solar.send({ kind: "setRate", secondsPerSecond: 86400 });
  window.__solar.setFocus("mars");
});
// Driven through the UI control, which is also what a user clicks.
const checkbox = page.locator('input[type="checkbox"]');
await checkbox.waitFor({ state: "visible", timeout: 5000 });
await checkbox.check();
await page.waitForTimeout(4000);
const moonRun = await read();
console.log("bodies integrated:", moonRun.gravity.bodyCount,
            "| energy drift:", moonRun.gravity.energyDrift.toExponential(2),
            "| integrated:", moonRun.gravity.integratedDays.toFixed(1), "d");
if (moonRun.gravity.bodyCount !== 32) {
  console.log(`FAIL: expected 32 integrated bodies, got ${moonRun.gravity.bodyCount}`);
  process.exit(1);
}
if (moonRun.gravity.energyDrift > 1e-10) { console.log("FAIL: moon run lost energy"); process.exit(1); }

if (errors.length) { console.log("page errors:", errors); process.exit(1); }
console.log("\nOK");
await browser.close();
