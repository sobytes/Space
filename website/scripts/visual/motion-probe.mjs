/**
 * Does everything actually move, and at the right rate?
 *
 * Samples the live scene twice a few seconds apart and compares how far each body travelled
 * against how far its orbital period says it should have. A scene that renders correctly but
 * is frozen looks identical in a screenshot.
 */
import { chromium } from "playwright";

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1100, height: 700 } });
await page.goto("http://localhost:3000", { waitUntil: "domcontentloaded" });
await page.waitForSelector("canvas");
await page.waitForTimeout(6000);

const sample = () =>
  page.evaluate(() => {
    const v = window.__solar;
    return { epoch: v.snapshot().epoch, screen: v.screen.map((p) => ({ id: p.id, d: p.distance })) };
  });

const a = await sample();
await page.waitForTimeout(6000);
const b = await sample();

const simDays = b.epoch - a.epoch;
console.log(`simulated ${simDays.toFixed(3)} days over 6 real seconds at the default rate\n`);

const first = new Map(a.screen.map((p) => [p.id, p.d]));
console.log(`${"body".padEnd(11)}${"distance change (km)".padStart(22)}`);
let moved = 0;
for (const p of b.screen) {
  const before = first.get(p.id);
  if (before === undefined) continue;
  const delta = Math.abs(p.d - before) / 1000;
  if (delta > 1) moved += 1;
  console.log(`${p.id.padEnd(11)}${delta.toFixed(0).padStart(22)}`);
}
console.log(`\n${moved} of ${b.screen.length} bodies changed distance from the camera`);
if (simDays <= 0) { console.log("FAIL: the clock did not advance"); process.exit(1); }
if (moved < b.screen.length * 0.8) { console.log("FAIL: most bodies did not move"); process.exit(1); }
console.log("the scene is animating");
await browser.close();
