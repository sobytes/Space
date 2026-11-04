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
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
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
 * focusing it is the system view, a small disc in mostly empty space with orbit lines, and it
 * measures a few percent. Holding it to the same bar would mean either a failing check or a
 * threshold loose enough to pass a body that had vanished.
 *
 * The Sun's bar was 8 and is now 1.5, and the change is a correction rather than a loosening.
 * It was set while the Sun was drawn at 0.54 scene units, which was itself the bug that buried
 * Mercury inside it; at the correct 0.16 units the same scene lights a ninth of the pixels.
 * Coverage was never a strong check on the system view and is now a weak one, so the real
 * gates there are the three geometric ones below: the orbits close on the right perihelion,
 * the floating origin is carried, and no planet is inside the Sun's disc. Each of those fails
 * by orders of magnitude rather than by a few percent.
 */
const BODIES = [
  { id: "sun", minimumLit: 1.5, note: "system view: a small disc and orbit lines" },
  /**
   * Mars, with its moons, checked by geometry rather than by pixels.
   *
   * Reported from the phone as "why dont i see moons". Phobos from the default six radii is
   * 0.46 pixels across: it is drawn, it is in frame, it is in the right place, and it is
   * invisible. No amount of screenshot coverage distinguishes that from a moon that is not
   * being positioned at all, which is why this case reads the marker instead.
   */
  {
    id: "mars",
    minimumLit: 25,
    moons: { visible: ["phobos"], mode: "marker" },
    // Mars is also where the moon orbit paths are checked: two moons, both with orbits small
    // enough that a heliocentric sampling error shows up as a factor of seventy rather than
    // as a subtle wobble.
    orbitError: 0.01,
  },
  /**
   * Jupiter after framing its satellite system, which is the other half of the same report.
   *
   * At the default framing the Galileans are outside the frustum entirely, Io orbiting at
   * 5.9 Jupiter radii against a camera at six. Pulling back is the answer, and the thing
   * worth gating is that pulling back actually puts them on screen.
   */
  { id: "jupiter", minimumLit: 25 },
  {
    id: "jupiter",
    label: "jupiter-fit",
    // Pulled back to the satellite system, the planet occupies about one percent of the
    // middle third, so coverage is not the check here. The moon report below is.
    minimumLit: 0.4,
    extraArgs: ["-fitMoons"],
    note: "satellite system framed",
    moons: { visible: ["io", "europa", "ganymede", "callisto"], mode: "any" },
  },
  { id: "mercury", minimumLit: 25 },
  { id: "embary", minimumLit: 25 },
  { id: "saturn", minimumLit: 25 },
  { id: "titan", minimumLit: 25 },
  { id: "moon", minimumLit: 25 },
  { id: "phobos", minimumLit: 25 },
];

const sh = (cmd, args) => execFileSync(cmd, args, { encoding: "utf8" }).trim();

/**
 * Is each named moon actually visible, by whichever route applies?
 *
 * `marker` demands the dot specifically, because that case exists precisely when the sphere
 * is sub-pixel and a check that accepted the sphere would pass on a build with no markers at
 * all. `any` accepts either, because a framed satellite system legitimately resolves some
 * moons as geometry and leaves the small ones to their markers.
 */
function moonsVisible(scene, { visible, mode }) {
  const report = scene?.bodyReport ?? {};
  return visible.map((id) => {
    const body = report[id];
    if (!body) return { id, ok: false, why: "not in the scene at all" };
    const px = body.apparentRadiusPx ?? 0;
    const marker = body.markerOpacity ?? 0;
    const resolvable = px >= 1;
    const marked = marker > 0.3;
    const ok = mode === "marker" ? marked : resolvable || marked;
    return {
      id,
      ok,
      why: `${px.toFixed(2)} px, marker ${marker.toFixed(2)}`,
    };
  });
}

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
function sceneDebug(udid) {
  // Read out of the app's container, not out of the log. `log show` wraps and truncates a
  // long message, and the report passed that length the moment it carried all 32 bodies, so
  // the app writes a file and this reads it. The probe used to parse the log line and silently
  // found nothing after the app changed, reporting "cannot check the orbits" rather than a
  // failure of the thing it was meant to check.
  const container = sh("xcrun", ["simctl", "get_app_container", udid, BUNDLE, "data"]);
  const file = join(container, "Documents", "scene-debug.json");
  if (!existsSync(file)) return null;
  return JSON.parse(readFileSync(file, "utf8"));
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
for (const { id: body, label, minimumLit, note, moons, extraArgs, orbitError } of BODIES) {
  // Two cases can share a body: Jupiter is checked both at its default framing and
  // pulled back to its satellite system, and they must not overwrite each other's
  // screenshot.
  const name = label ?? body;
  try { execFileSync("xcrun", ["simctl", "terminate", udid, BUNDLE], { stdio: "ignore" }); } catch { /* not running */ }
  /**
   * The Sun is reached by switching focus from Earth, not by starting there.
   *
   * Those are different code paths and have not had the same bugs. Orbit geometry built
   * against a stale origin is invisible when the first focus is the Sun, because the origin
   * is zero there, and wrong by an astronomical unit when you arrive from Earth.
   */
  /**
   * Delete the previous run's report before launching.
   *
   * The same hazard the log window had, moved to a file: a launch that never writes one leaves
   * the previous body's geometry on disk, and the probe then checks the wrong scene and passes.
   * A planted bug survived its own fix that way once already.
   */
  try {
    const container = sh("xcrun", ["simctl", "get_app_container", udid, BUNDLE, "data"]);
    rmSync(join(container, "Documents", "scene-debug.json"), { force: true });
  } catch { /* not installed yet */ }
  const needsScene = body === "sun" || body === "saturn" || moons !== undefined
    || orbitError !== undefined;
  const args = body === "sun"
    ? ["-focus", "embary", "-focusAfter", "sun", "-startHidden", "-dumpScene"]
    : ["-focus", body, "-startHidden", ...(extraArgs ?? []), ...(needsScene ? ["-dumpScene"] : [])];
  execFileSync("xcrun", ["simctl", "launch", udid, BUNDLE, ...args], { stdio: "ignore" });

  await new Promise((resolve) => setTimeout(resolve, body === "sun" ? 10000 : needsScene ? 9000 : 6000));
  const file = join(OUT, `${name}.png`);
  execFileSync("xcrun", ["simctl", "io", udid, "screenshot", file], { stdio: "ignore" });

  const lit = await litFraction(file);
  let ok = lit >= minimumLit;
  if (!ok) failures += 1;

  if (orbitError !== undefined) {
    /**
     * Are the moons' orbits drawn about their planet?
     *
     * Each drawn orbit's closest point to its own anchor must be its periapsis. Sampled
     * heliocentrically, as they were, a moon's path over one of its own periods is dominated
     * by where the planet went in that time: Phobos goes round Mars in 7.7 hours while Mars
     * travels 660,000 km, so the path came out seventy times longer than the orbit and in
     * the wrong place. No line appeared on screen at all, which looks like a feature that
     * was never built rather than one that is broken.
     */
    const scene = sceneDebug(udid);
    const worst = scene?.maxPerihelionError ?? Infinity;
    const correct = worst < orbitError;
    console.log(
      `${"".padEnd(9)} moon orbits: worst periapsis error ${worst.toExponential(1)} `
        + `(needs < ${orbitError})  ${correct ? "ok" : "NOT DRAWN ABOUT THE PLANET"}`,
    );
    if (!correct) {
      failures += 1;
      ok = false;
    }
  }

  if (needsScene) {
    /**
     * Does an edge pointer point at the body it names?
     *
     * The arrow is eight pixels across, so a screenshot cannot answer this and neither can a
     * person looking at one: the first version aimed correctly and sat on the wrong side of
     * the word, which looks identical at that size. The bearing and the direction from the
     * viewport centre to the label must be the same angle, and that is arithmetic.
     */
    const scene = sceneDebug(udid);
    const labels = scene?.labels ?? [];
    const clamped = labels.filter((l) => l.clamped);
    const wrong = clamped.filter((l) => {
      const direction = (Math.atan2(l.y - 874 / 2, l.x - 402 / 2) * 180) / Math.PI;
      return Math.abs(((l.bearingDeg - direction + 180) % 360) - 180) > 1;
    });
    console.log(
      `${"".padEnd(9)} labels: ${labels.length} drawn, ${clamped.length} pointing off screen  `
        + `${wrong.length === 0 ? "ok" : `${wrong.length} POINT THE WRONG WAY`}`,
    );
    if (wrong.length > 0) {
      failures += 1;
      ok = false;
    }
  }

  if (moons) {
    const results = moonsVisible(sceneDebug(udid), moons);
    for (const moon of results) {
      console.log(
        `${"".padEnd(9)} ${moon.id.padEnd(10)} ${moon.why.padEnd(28)} `
          + `${moon.ok ? "visible" : "NOT VISIBLE"}`,
      );
    }
    if (results.some((m) => !m.ok)) {
      failures += 1;
      ok = false;
    }
  }

  if (body === "saturn") {
    /**
     * Saturn's rings, measured rather than eyeballed.
     *
     * The A ring's outer edge is 136,775 km against a 60,268 km equatorial radius, so the
     * rings reach 2.269 planet radii. They were once drawn about ten times that, because the
     * geometry is built in planet radii and was attached to a node with no scale, so a ratio
     * of 2.27 was read as 2.27 scene units while Saturn itself was 0.16. It looked like a
     * stylistic choice rather than a bug, which is why it needs a number.
     */
    const scene = sceneDebug(udid);
    const extent = scene?.saturnRingOuterInPlanetRadii ?? 0;
    const correct = Math.abs(extent - 2.269) < 0.01;
    console.log(
      `${"".padEnd(9)} rings reach ${extent.toFixed(3)} planet radii (contract says 2.269)  `
        + `${correct ? "ok" : "WRONG EXTENT"}`,
    );
    if (!correct) {
      failures += 1;
      ok = false;
    }
  }

  if (body === "saturn") {
    /**
     * Does the node that carries the floating origin actually carry it?
     *
     * Checked on a planet rather than on the Sun, which is the whole point. The origin is zero
     * when the Sun is focused, so a root left at the identity is accidentally correct there and
     * wrong by an astronomical unit everywhere else. It stayed that way because the only
     * geometry parented to the root was planetary orbit paths, which are only drawn in the
     * system view. The moment anything else hung off it, a moon's orbit or a ride-along
     * trajectory, it was drawn off screen rather than visibly misplaced.
     */
    const scene = sceneDebug(udid);
    const offset = scene?.focusUnderRootUnits ?? Infinity;
    const carried = offset < 1e-3;
    console.log(
      `${"".padEnd(9)} floating origin: focused body sits ${offset.toExponential(1)} units `
        + `from the camera origin  ${carried ? "ok" : "ROOT CARRIES NO ORIGIN"}`,
    );
    if (!carried) {
      failures += 1;
      ok = false;
    }
  }

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
    const scene = sceneDebug(udid);
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

      /**
       * Is any body buried inside the drawn Sun?
       *
       * Three separate times a change to how radii are drawn has swallowed Mercury, and the
       * screenshot check above cannot see it: the Sun alone still lights the same number of
       * pixels, so the system view passes while a planet is simply gone. Each cause was
       * different and each was silent. A shared exaggeration constant, then a shared
       * compression curve applied to the star as well as the planets, then an edit adding the
       * star exemption that matched nothing and wrote no change.
       *
       * The measurement is the body's near edge, not its centre: (distance - radius) over the
       * Sun's drawn radius. Below one the discs overlap. Mercury, the worst case by a wide
       * margin, reads 1.855 when correct and 0.546 with the star exemption missing, so the
       * bar sits between them with room on both sides.
       */
      const sunRadius = scene.bodyReport?.sun?.radiusUnits ?? 0;
      const clearances = Object.entries(scene.bodyReport ?? {})
        .filter(([id]) => id !== "sun")
        .map(([id, b]) => [id, (b.distanceUnits - b.radiusUnits) / sunRadius])
        .sort((a, b) => a[1] - b[1]);
      const [worstId, worstClearance] = clearances[0] ?? ["none", 0];
      const clear = sunRadius > 0 && worstClearance > 1.25;
      console.log(
        `${"".padEnd(9)} closest body to the drawn Sun: ${worstId} at `
          + `${worstClearance.toFixed(2)} sun radii from its surface (needs > 1.25)  `
          + `${clear ? "ok" : "BURIED IN THE SUN"}`,
      );
      if (!clear) {
        failures += 1;
        ok = false;
      }
    }
  }
  console.log(
    `${name.padEnd(11)} ${lit.toFixed(1).padStart(5)}% lit  (needs ${minimumLit})  `
      + `${ok ? "ok" : "TOO DARK"}${note ? `  ${note}` : ""}`,
  );
}

if (failures > 0) {
  console.log(`\n${failures} of ${BODIES.length} bodies do not frame when focused`);
  process.exit(1);
}
console.log(`\nall ${BODIES.length} bodies frame when focused`);
