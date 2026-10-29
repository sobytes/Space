/**
 * Does every body actually appear when you focus it?
 *
 * The iOS app has no automated UI test, and this is the failure it kept having: a focus
 * change that leaves the camera at the wrong distance renders a black screen or a one-pixel
 * dot, and the build is perfectly green. Three separate causes so far, all silent:
 *
 *  - SceneKit's `allowsCameraControl` ignoring the supplied pointOfView, so writes to the
 *    camera went somewhere invisible and a pinch made the scene vanish;
 *  - the scene's scale being per-focus while the camera's distance was in scene units, so
 *    changing focus left the camera inside the body or billions of units out;
 *  - framing the whole satellite system by default, which put Jupiter 58 radii away and shrank
 *    it to one percent of the screen.
 *
 * So the check is pixels: launch focused on a body, screenshot, and measure how much of the
 * centre is lit. Nothing else catches this.
 *
 * Usage:  node mobile/ios/scripts/focus-probe.mjs [simulator-udid]
 */
import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import sharp from "sharp";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const OUT = join(ROOT, "artifacts", "ios-focus");
mkdirSync(OUT, { recursive: true });

const BUNDLE = "com.sobytes.solar";
/**
 * A spread of scales, each with the coverage it should actually produce.
 *
 * A focused body fills 80 to 90 percent of the centre. The Sun is deliberately different:
 * focusing it is the system view, a small disc in mostly empty space with orbit lines, which
 * measures around 20. Holding it to the same bar would mean either a failing check or a
 * threshold loose enough to pass a body that had vanished.
 */
const BODIES = [
  { id: "sun", minimumLit: 8, note: "system view: a small disc and orbit lines" },
  { id: "mercury", minimumLit: 25 },
  { id: "embary", minimumLit: 25 },
  { id: "jupiter", minimumLit: 25 },
  { id: "saturn", minimumLit: 25 },
  { id: "titan", minimumLit: 25 },
  { id: "moon", minimumLit: 25 },
  { id: "phobos", minimumLit: 25 },
];

const sh = (cmd, args) => execFileSync(cmd, args, { encoding: "utf8" }).trim();

function simulator() {
  if (process.argv[2]) return process.argv[2];
  const listed = sh("xcrun", ["simctl", "list", "devices", "available"]);
  const line = listed.split("\n").find((l) => /iPhone/.test(l) && /\(Booted\)/.test(l))
    ?? listed.split("\n").find((l) => /iPhone/.test(l));
  const match = line?.match(/\(([0-9A-F-]{36})\)/);
  if (!match) throw new Error("no iPhone simulator found. Pass a UDID.");
  return match[1];
}

function appPath() {
  const found = sh("bash", [
    "-lc",
    "find ~/Library/Developer/Xcode/DerivedData -name Solar.app "
      + "-path '*Debug-iphonesimulator*' -maxdepth 5 | head -1",
  ]);
  if (!found) throw new Error("no built app. Run `./build.sh ios` first.");
  return found;
}

/**
 * Reads the scene's own geometry, which the app logs once when given `-dumpScene`.
 *
 * Pixels answer "is anything on screen". They do not answer "is this node where it should
 * be": an attempt to check the orbits were centred on the Sun by comparing image centroids
 * read 53% off with entirely correct code, because the starfield dominated the sample.
 * Geometry questions get geometry answers, the same way the website has `__solar.debug()`.
 */
function sceneDebug(udid, since) {
  // Windowed from this launch, not "the last 30 seconds". A previous run's line is still in
  // the log and reading it reports the previous build's geometry, which is how a planted bug
  // appeared to survive a fix.
  const log = execFileSync("xcrun", [
    "simctl", "spawn", udid, "log", "show",
    "--start", since,
    "--predicate", 'process == "Solar"',
  ], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });

  const matches = [...log.matchAll(/SCENEDEBUG (\{.*?\})\s*$/gm)];
  if (matches.length === 0) return null;
  return JSON.parse(matches[matches.length - 1][1]);
}

async function litFraction(file) {
  const image = sharp(file);
  const { width, height } = await image.metadata();
  // The middle third, where a framed body sits. Avoids counting the HUD or the starfield.
  const { data, info } = await image
    .extract({
      left: Math.floor(width / 4),
      top: Math.floor(height / 3),
      width: Math.floor(width / 2),
      height: Math.floor(height / 3),
    })
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true });

  let lit = 0;
  for (let i = 0; i < data.length; i += info.channels) if (data[i] > 40) lit += 1;
  return (100 * lit) / (info.width * info.height);
}

const udid = simulator();
const app = appPath();
// Already booted throws; that is the normal case and not a failure.
try { execFileSync("xcrun", ["simctl", "boot", udid], { stdio: "ignore" }); } catch { /* booted */ }
execFileSync("xcrun", ["simctl", "install", udid, app]);

let failures = 0;
for (const { id: body, minimumLit, note } of BODIES) {
  try { execFileSync("xcrun", ["simctl", "terminate", udid, BUNDLE], { stdio: "ignore" }); } catch { /* not running */ }
  /**
   * The Sun is reached by switching focus from Earth, not by starting there.
   *
   * Those are different code paths and have not had the same bugs. Orbit geometry built
   * against a stale origin is invisible when the first focus is the Sun, because the origin
   * is zero there, and wrong by an astronomical unit when you arrive from Earth.
   */
  // Log timestamps are local time to the second; a second early avoids a boundary miss.
  const launchedAt = new Date(Date.now() - 1000)
    .toLocaleString("sv-SE", { hour12: false })
    .replace("T", " ");
  const args = body === "sun"
    ? ["-focus", "embary", "-focusAfter", "sun", "-startHidden", "-dumpScene"]
    : ["-focus", body, "-startHidden"];
  execFileSync("xcrun", ["simctl", "launch", udid, BUNDLE, ...args], { stdio: "ignore" });

  await new Promise((resolve) => setTimeout(resolve, body === "sun" ? 10000 : 6000));
  const file = join(OUT, `${body}.png`);
  execFileSync("xcrun", ["simctl", "io", udid, "screenshot", file], { stdio: "ignore" });

  const lit = await litFraction(file);
  let ok = lit >= minimumLit;
  if (!ok) failures += 1;

  if (body === "sun") {
    /**
     * Are the orbits drawn about the Sun?
     *
     * Each drawn orbit's closest point to the origin must be its perihelion, a(1 - e).
     * Measured: 0.0003 relative error with correct geometry, which is the 256-sample
     * discretisation, against 1.18 with an origin baked into the vertices. A factor of four
     * thousand, so the threshold is not delicate.
     *
     * The vertex centroid is deliberately not the test. Sampling uniformly in time biases it
     * toward aphelion by (3/2) a e, so Uranus reads 1.36 units from the Sun with entirely
     * correct geometry, which is indistinguishable from a one-au offset.
     */
    const scene = sceneDebug(udid, launchedAt);
    if (scene === null) {
      console.log(`${"".padEnd(9)} no scene debug output; cannot check the orbits`);
      failures += 1;
    } else {
      const error = scene.maxPerihelionError;
      const centred = error < 0.01 && scene.sunToRootUnits < 1e-6;
      console.log(
        `${"".padEnd(9)} orbits: perihelion error ${error.toExponential(1)}, `
          + `Sun to heliocentric root ${scene.sunToRootUnits.toExponential(1)} units  `
          + `${centred ? "ok" : "NOT DRAWN ABOUT THE SUN"}`,
      );
      if (!centred) {
        failures += 1;
        ok = false;
      }
    }
  }
  console.log(
    `${body.padEnd(9)} ${lit.toFixed(1).padStart(5)}% lit  (needs ${minimumLit})  `
      + `${ok ? "ok" : "TOO DARK"}${note ? `  ${note}` : ""}`,
  );
}

if (failures > 0) {
  console.log(`\n${failures} of ${BODIES.length} bodies do not frame when focused`);
  process.exit(1);
}
console.log(`\nall ${BODIES.length} bodies frame when focused`);
