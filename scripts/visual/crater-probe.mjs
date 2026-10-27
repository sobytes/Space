import { chromium } from "playwright";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
await page.goto("http://localhost:3000", { waitUntil: "domcontentloaded" });
await page.waitForSelector("canvas");
await page.waitForTimeout(6000);
await page.locator('nav button:has-text("The Moon")').first().click();
await page.waitForTimeout(3000);

for (const label of ["after focus", "after dolly"]) {
  if (label === "after dolly") {
    await page.mouse.move(640, 400);
    for (let i = 0; i < 22; i++) { await page.mouse.wheel(0, -500); await page.waitForTimeout(100); }
    await page.waitForTimeout(3000);
  }
  const d = await page.evaluate(() => {
    const v = window.__solar;
    const s = v.snapshot();
    const dbg = v.debug();
    return {
      altitudeKm: s.distanceToFocus/1000,
      sunDirection: s.sunDirection,
      camera: dbg.cameraPosition,
      near: dbg.cameraNear, far: dbg.cameraFar,
      // Angle between camera direction and sun direction, from the body.
      cosAngle: (() => {
        const c = dbg.cameraPosition, sd = s.sunDirection;
        const m = Math.hypot(c.x,c.y,c.z) || 1;
        return (c.x*sd.x + c.y*sd.y + c.z*sd.z)/m;
      })(),
    };
  });
  console.log(label, JSON.stringify(d, null, 1));
}
await browser.close();
