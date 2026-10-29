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
  execFileSync("xcrun", [
    "simctl", "launch", udid, BUNDLE, "-focus", body, "-startHidden",
  ], { stdio: "ignore" });

  await new Promise((resolve) => setTimeout(resolve, 6000));
  const file = join(OUT, `${body}.png`);
  execFileSync("xcrun", ["simctl", "io", udid, "screenshot", file], { stdio: "ignore" });

  const lit = await litFraction(file);
  const ok = lit >= minimumLit;
  if (!ok) failures += 1;
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
