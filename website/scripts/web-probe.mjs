/**
 * Does the browser client actually show what it claims to?
 *
 * The iOS client has had `mobile/ios/scripts/focus-probe.mjs` for a while: it launches the
 * app, reads the scene's own geometry, and checks invariants no unit test can see. The web
 * had nothing equivalent, and the gap cost something concrete. Render space is the engine's
 * frame unswizzled, so the ecliptic pole is z, while three.js defaults a camera's up to y and
 * the camera rig had a comment asserting y was the pole. Focusing any body therefore rolled
 * the view ninety degrees and drew every other planet's orbit as a vertical line. It survived
 * because the only view anyone checked was the system view, which sat almost straight down
 * the pole, and that is the one orientation where up does not matter.
 *
 * Needs the dev server. Run it with `./build.sh website probe`.
 */
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const ORIGIN = process.env.SOLAR_ORIGIN ?? "http://localhost:3000";
const OUT = join(fileURLToPath(new URL("../../", import.meta.url)), "artifacts", "web");
mkdirSync(OUT, { recursive: true });

/**
 * Read the camera's own basis out of the page.
 *
 * The screen axes in world space are the first three columns of the camera's world matrix,
 * so this asks the renderer where right and up actually point rather than recomputing it
 * from inputs and agreeing with itself.
 */
const cameraBasis = () => {
  const camera = window.__controls?.camera;
  if (!camera) return null;
  const e = camera.matrixWorld.elements;
  return {
    right: { x: e[0], y: e[1], z: e[2] },
    up: { x: e[4], y: e[5], z: e[6] },
    position: { x: e[12], y: e[13], z: e[14] },
  };
};

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const notFound = new Set();
const errors = [];
page.on("response", (r) => {
  if (r.status() === 404) notFound.add(new URL(r.url()).pathname);
});
page.on("pageerror", (e) => errors.push(e.message));

await page.goto(ORIGIN, { waitUntil: "domcontentloaded" });
// The scene animates and streams forever, so there is no idle to wait for.
await page.waitForTimeout(9000);

let failures = 0;
const fail = (message) => {
  failures += 1;
  console.log(`  ${message}`);
};

/**
 * With a body focused, is the ecliptic plane horizontal on screen?
 *
 * Asked as geometry rather than as pixels. The horizontal screen axis in world space must be
 * perpendicular to the ecliptic pole; when it is, a plane seen edge-on runs left to right. A
 * ninety degree roll makes this dot product one instead of zero, so the check fails by the
 * whole range rather than by a margin.
 */
for (const body of ["Mercury", "Earth", "Jupiter"]) {
  await page.getByRole("button", { name: body, exact: true }).first().click();
  await page.waitForTimeout(4500);
  await page.screenshot({ path: join(OUT, `focus-${body.toLowerCase()}.png`) });

  const basis = await page.evaluate(cameraBasis);
  if (!basis) {
    fail(`${body.padEnd(9)} no camera to inspect`);
    continue;
  }
  // The pole is +z in render space; see contracts/units-and-frames.
  const rightDotPole = Math.abs(basis.right.z);
  const upDotPole = Math.abs(basis.up.z);
  const level = rightDotPole < 0.02;
  console.log(
    `  ${body.padEnd(9)} screen-right . pole = ${rightDotPole.toFixed(4)}, `
      + `screen-up . pole = ${upDotPole.toFixed(3)}  ${level ? "ok" : "VIEW IS ROLLED"}`,
  );
  if (!level) failures += 1;
}

await page.getByRole("button", { name: "The Sun", exact: true }).first().click();
await page.waitForTimeout(5000);
await page.screenshot({ path: join(OUT, "system.png") });

/**
 * The system view must not be looking down the pole.
 *
 * Not a style preference. Near the pole the up vector stops meaning anything, which is
 * exactly why a ninety degree roll everywhere else went unnoticed for so long: the one view
 * being checked was the one that could not show it.
 */
const system = await page.evaluate(cameraBasis);
const { x, y, z } = system.position;
const elevationDeg = (Math.atan2(Math.abs(z), Math.hypot(x, y)) * 180) / Math.PI;
const orrery = elevationDeg > 5 && elevationDeg < 55;
console.log(
  `  ${"system".padEnd(9)} camera sits ${elevationDeg.toFixed(1)} degrees above the ecliptic  `
    + `${orrery ? "ok" : "TOO CLOSE TO THE POLE"}`,
);
if (!orrery) failures += 1;

console.log(`  ${"assets".padEnd(9)} ${notFound.size} requests returned 404  ${notFound.size === 0 ? "ok" : "MISSING"}`);
if (notFound.size > 0) {
  failures += 1;
  for (const path of [...notFound].slice(0, 5)) console.log(`            ${path}`);
}

console.log(`  ${"errors".padEnd(9)} ${errors.length} uncaught page errors  ${errors.length === 0 ? "ok" : "THROWN"}`);
if (errors.length > 0) {
  failures += 1;
  for (const message of errors.slice(0, 3)) console.log(`            ${message.slice(0, 140)}`);
}

await browser.close();
if (failures > 0) {
  console.log(`\n${failures} checks failed`);
  process.exit(1);
}
console.log("\nthe browser client renders the system the right way up");
