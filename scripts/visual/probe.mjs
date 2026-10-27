import { chromium } from "playwright";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page.on("pageerror", (e) => console.log("PAGEERROR:", e.message.slice(0, 300)));
page.on("console", (m) => { if (m.type() === "error") console.log("CONSOLE:", m.text().slice(0, 300)); });
await page.goto("http://localhost:3000", { waitUntil: "networkidle", timeout: 60000 });
await page.waitForSelector("canvas");
await page.waitForTimeout(12000);
const d = await page.evaluate(() => {
  const v = window.__solar;
  return v ? v.debug() : { error: "no __solar on window" };
});
console.log(JSON.stringify(d, null, 2));
await browser.close();
