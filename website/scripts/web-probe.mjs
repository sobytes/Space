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

/**
 * In the system view, is every planet you can see actually named, and do any two names overlap?
 *
 * Measured off the drawn plates rather than off the placement module's own arithmetic, which
 * is the only way this question can be answered. `placeLabels` reserves a box per label from
 * an estimate of how wide the text will render; a reservation that is too small packs two
 * labels close enough to collide on screen while every number in the module agrees with
 * itself. Printing the module's output proves nothing about either failure.
 *
 * Both failures were real and were reported from the phone as one sentence: "the labels are
 * nowhere near the planets, look at Mars". In the system view the four inner planets land
 * inside a hundred points of the Sun, the thinning rule was a circle round each anchor, and
 * the Sun's label suppressed Mercury, Venus, Earth and Mars outright. What was left were edge
 * pointers aimed at bodies that were not on screen.
 */
const plates = await page.evaluate(() => {
  const drawn = Array.from(document.querySelectorAll("div"))
    .filter((d) => d.className.includes("-translate-x-1/2") && d.className.includes("rounded-lg"))
    .map((d) => {
      const r = d.getBoundingClientRect();
      return { text: d.textContent ?? "", x: r.x, y: r.y, w: r.width, h: r.height };
    });
  /**
   * What the viewport says is on screen, which is what the labels are answerable to.
   *
   * No threshold on apparent radius, unlike the iOS probe. The browser draws bodies at true
   * scale with a marker dot under them, so in the system view Mercury's disc is 0.0014 pixels
   * across and the dot is what a viewer sees and clicks. A radius threshold ported straight
   * from the phone, where a floor keeps the drawn disc at three pixels, filtered out every
   * body and left this check passing over an empty list.
   */
  const onScreen = (window.__solar?.screen ?? [])
    .filter((p) => !p.behindCamera && Math.abs(p.ndcX) <= 1 && Math.abs(p.ndcY) <= 1)
    .map((p) => p.id);
  return { drawn, onScreen };
});

const names = new Set(plates.drawn.map((p) => p.text));
// Moons are named only when the focus is their planet; in the system view a moon sits on its
// planet to within a pixel and a label there names either of them equally.
const planets = ["sun", "mercury", "venus", "embary", "mars", "jupiter", "saturn", "uranus", "neptune"];
const display = {
  sun: "The Sun", mercury: "Mercury", venus: "Venus", embary: "Earth", mars: "Mars",
  jupiter: "Jupiter", saturn: "Saturn", uranus: "Uranus", neptune: "Neptune",
};
const unnamed = plates.onScreen
  .filter((id) => planets.includes(id))
  .filter((id) => ![...names].some((text) => text.startsWith(display[id])));
console.log(
  `  ${"labels".padEnd(9)} ${plates.drawn.length} drawn over ${plates.onScreen.length} visible bodies  `
    + `${unnamed.length === 0 ? "ok" : `${unnamed.join(", ")} UNNAMED`}`,
);
if (unnamed.length > 0) failures += 1;
// A check that found nothing to check is not a check. This passed over an empty list once.
if (plates.onScreen.length === 0) {
  fail("labels    nothing was on screen to label, so that check proved nothing");
}

const collisions = [];
for (let i = 0; i < plates.drawn.length; i += 1) {
  for (let j = i + 1; j < plates.drawn.length; j += 1) {
    const a = plates.drawn[i];
    const b = plates.drawn[j];
    if (a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h) {
      collisions.push(`${a.text.slice(0, 12)} / ${b.text.slice(0, 12)}`);
    }
  }
}
console.log(
  `  ${"plates".padEnd(9)} ${collisions.length} overlapping pairs  `
    + `${collisions.length === 0 ? "ok" : collisions.slice(0, 3).join("; ")}`,
);
if (collisions.length > 0) failures += 1;

/**
 * Do the labels still move once the clock is running fast?
 *
 * The iPhone client shipped a label layer that computed placement once, at launch, and never
 * again. The names sat where the planets had been while the planets went round. At real time
 * that is a fraction of a pixel a second, so every probe on both clients passed, because every
 * probe ran at the default clock. This browser is structurally safe today, for a reason that
 * is one `setFrame` call deep and could be removed by anyone tidying a render loop.
 *
 * Reading positions out of the DOM does not perturb React, which is the difference from the
 * phone: there the same question needs pixels, because touching the view re-animates it.
 */
await page.evaluate(() => window.__solar?.send({ kind: "setRate", secondsPerSecond: 31_557_600 }));
await page.waitForTimeout(1500);

const where = () => page.evaluate(() =>
  Object.fromEntries(
    Array.from(document.querySelectorAll("div"))
      .filter((d) => d.className.includes("-translate-x-1/2") && d.className.includes("rounded-lg"))
      .map((d) => {
        const r = d.getBoundingClientRect();
        // Keyed by the name, not the whole text: the date underneath changes on its own and
        // would make a frozen label look as though it had moved.
        return [(d.textContent ?? "").replace(/[\d\u00b7:+\-\s].*$/, ""), [r.x, r.y]];
      }),
  ));

const first = await where();
await page.waitForTimeout(4000);
const second = await where();

const stuck = Object.keys(first)
  .filter((name) => second[name])
  // The focused body sits at the origin and its label legitimately never moves.
  .filter((name) => name !== "TheSun" && name !== "The")
  .filter((name) => Math.hypot(second[name][0] - first[name][0], second[name][1] - first[name][1]) < 2);
const compared = Object.keys(first).filter((name) => second[name]).length;
console.log(
  `  ${"tracking".padEnd(9)} ${compared - stuck.length}/${compared} labels moved over four years  `
    + `${stuck.length === 0 && compared > 1 ? "ok" : `${stuck.join(", ") || "nothing to compare"} FROZEN`}`,
);
if (stuck.length > 0 || compared < 2) failures += 1;

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
