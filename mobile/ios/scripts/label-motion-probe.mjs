/**
 * Do the labels actually move while the clock runs?
 *
 * The narrowest question this repository has needed a probe for, and the one that cost three
 * reports. Placement is arithmetic and several gates already check it; what shipped was a
 * SwiftUI layer that ran that arithmetic once at launch and never again, so the names sat
 * where the planets had been while the planets went round. Every gate that asked the engine
 * passed, because the engine was right.
 *
 * It has to be pixels. Everything else perturbs it, which was measured rather than assumed:
 *
 *  - a counter written from inside the label layer makes the layer re-evaluate, so the
 *    instrument repairs the fault and reports zero drift;
 *  - an XCUITest reading a label's frame forces a layout pass with the same effect, and
 *    measured the frozen build moving 69 points in three seconds.
 *
 * So this looks at the screen, twice, the way a person did. Text is near-white and barely
 * saturated, and unlike a star it comes in dense runs, so the two are separable without
 * knowing where any label is meant to be.
 *
 * Usage:  node mobile/ios/scripts/label-motion-probe.mjs [simulator-udid]
 */
import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import sharp from "sharp";

const BUNDLE = "com.sobytes.solar";
const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const OUT = join(ROOT, "artifacts", "ios-label-motion");
mkdirSync(OUT, { recursive: true });

const sh = (cmd, args) => execFileSync(cmd, args, { encoding: "utf8" }).trim();

/**
 * Pixels that belong to a glyph, as a flat mask.
 *
 * Bright and nearly grey catches text and rejects every planet, all of which are coloured.
 * The density test is what rejects the starfield: a star is a dot or two, a letter stroke sits
 * in a neighbourhood of other strokes. Without it the mask is mostly sky and never changes.
 */
async function textMask(file) {
  const { data, info } = await sharp(file).raw().toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info;
  const bright = new Uint8Array(width * height);
  for (let i = 0, p = 0; i < data.length; i += channels, p += 1) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    if (max > 170 && max - min < 40) bright[p] = 1;
  }
  // Dense neighbourhoods only, counted on a coarse grid so this stays linear.
  const cell = 12;
  const cols = Math.ceil(width / cell);
  const rows = Math.ceil(height / cell);
  const counts = new Uint16Array(cols * rows);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (bright[y * width + x]) counts[Math.floor(y / cell) * cols + Math.floor(x / cell)] += 1;
    }
  }
  const mask = new Set();
  for (let i = 0; i < counts.length; i += 1) if (counts[i] >= 10) mask.add(i);
  return mask;
}

const udid = process.argv[2] ?? sh("xcrun", ["simctl", "list", "devices", "booted"])
  .match(/\(([0-9A-F-]{36})\)/)?.[1];
if (!udid) throw new Error("no booted simulator. Pass a UDID.");

const app = sh("bash", ["-lc",
  "find ~/Library/Developer/Xcode/DerivedData -name Solar.app "
    + "-path '*Debug-iphonesimulator*' -maxdepth 6 | head -1"]);
if (!app) throw new Error("no built app. Run `./build.sh ios` first.");

try { execFileSync("xcrun", ["simctl", "terminate", udid, BUNDLE], { stdio: "ignore" }); } catch { /* idle */ }
execFileSync("xcrun", ["simctl", "install", udid, app], { stdio: "ignore" });
/**
 * A year a second, panels hidden.
 *
 * The rate is the whole point. At real time a frozen label drifts a fraction of a pixel a
 * second and every screenshot of it looks perfect, which is why this went out: the probes all
 * ran at the default clock.
 */
execFileSync("xcrun", ["simctl", "launch", udid, BUNDLE,
  "-focus", "embary", "-focusAfter", "sun", "-startHidden", "-rate", "6"], { stdio: "ignore" });

const shots = [];
for (const [index, wait] of [12_000, 6_000].entries()) {
  await new Promise((resolve) => setTimeout(resolve, wait));
  const file = join(OUT, `${index === 0 ? "first" : "second"}.png`);
  execFileSync("xcrun", ["simctl", "io", udid, "screenshot", file], { stdio: "ignore" });
  shots.push(file);
}

const [a, b] = await Promise.all(shots.map(textMask));
const shared = [...a].filter((cell) => b.has(cell)).length;
const union = new Set([...a, ...b]).size;
const overlap = union === 0 ? 1 : shared / union;

/**
 * How much of the text is still in the same place six seconds and six years later.
 *
 * Frozen, almost all of it is: only the digits under each name change, and they change in
 * place. Tracking, the names follow planets that have gone most of the way round, and the two
 * masks barely meet. Measured both ways against the real defect: 95% with the shipped
 * code, 34% with the fix. The bar sits between them with room on both sides rather than
 * against either.
 */
const tracking = overlap < 0.6;
console.log(
  `  ${"labels".padEnd(9)} ${(overlap * 100).toFixed(0)}% of the text is in the same place `
    + `after six years  ${tracking ? "ok" : "FROZEN: the label layer is not re-running"}`,
);
if (union < 20) {
  console.log(`  ${"labels".padEnd(9)} only ${union} text cells found, so this proved nothing`);
  process.exit(1);
}
process.exit(tracking ? 0 : 1);
