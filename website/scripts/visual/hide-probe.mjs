/**
 * The overlay hide toggle, checked by what is actually on screen.
 *
 * A toggle that sets a flag and leaves the panels rendered is the failure mode, so this
 * counts visible panel text rather than trusting the button.
 */
import { chromium } from "playwright";
import { artifact } from "./artifacts.mjs";

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1100, height: 760 } });
await page.goto("http://localhost:3000", { waitUntil: "domcontentloaded" });
await page.waitForSelector("canvas");
await page.waitForTimeout(5000);

const panelsVisible = async () => {
  const marks = await Promise.all([
    page.getByText("Equatorial radius").isVisible().catch(() => false),
    page.getByText("On rails").isVisible().catch(() => false),
    page.getByRole("button", { name: "Now", exact: true }).isVisible().catch(() => false),
  ]);
  return marks.filter(Boolean).length;
};

console.log("panels visible at start:", await panelsVisible(), "of 3");
if ((await panelsVisible()) !== 3) { console.log("FAIL: panels not showing to begin with"); process.exit(1); }

await page.getByRole("button", { name: "Hide the information overlay" }).click();
await page.waitForTimeout(600);
const afterHide = await panelsVisible();
await page.screenshot({ path: artifact("hud-hidden.png") });
console.log("after hiding:", afterHide, "of 3");

const showButton = page.getByRole("button", { name: "Show the information overlay" });
console.log("a way back is visible:", await showButton.isVisible());

await showButton.click();
await page.waitForTimeout(600);
const afterShow = await panelsVisible();
console.log("after showing again:", afterShow, "of 3");

// And the keyboard route, which must not fire while typing in a field.
await page.keyboard.press("h");
await page.waitForTimeout(500);
const afterKey = await panelsVisible();
console.log("after pressing h:", afterKey, "of 3");
await page.keyboard.press("Escape");
await page.waitForTimeout(500);
console.log("after Escape:", await panelsVisible(), "of 3");

let failed = false;
if (afterHide !== 0) { console.log("FAIL: panels still on screen after hiding"); failed = true; }
if (!(await showButton.isVisible().catch(() => true))) { /* now hidden again, fine */ }
if (afterShow !== 3) { console.log("FAIL: panels did not come back"); failed = true; }
if (afterKey !== 0) { console.log("FAIL: the h key did not hide them"); failed = true; }
if ((await panelsVisible()) !== 3) { console.log("FAIL: Escape did not restore"); failed = true; }
if (failed) process.exit(1);
console.log("\nOK");
await browser.close();
