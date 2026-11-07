/**
 * Draws the label boxes the app computed over a screenshot of the app drawing them.
 *
 * The one question a scene dump cannot answer on its own. The dump says where `placeLabels`
 * put each plate; the screenshot says where the renderer drew the text. Printing the dump
 * proves only that the arithmetic is self-consistent, which it was through two separate
 * reports of labels sitting away from their planets.
 *
 * Launches paused, which is the part that makes it mean anything. The dump is written three
 * seconds before the screenshot is taken, so at any rate above real time the two describe
 * different frames; an overlay built from them shows every box offset from its text and reads
 * as a placement bug. That instrument error was published twice before `-paused` existed.
 *
 * Usage:  node mobile/ios/scripts/label-overlay.mjs <tag> [app arguments...]
 *   e.g.  node mobile/ios/scripts/label-overlay.mjs system \
 *           -focus embary -focusAfter sun -startHidden -paused -dumpScene
 *
 * Writes artifacts/<tag>-base.png, artifacts/<tag>.png and artifacts/<tag>.json.
 */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import sharp from "sharp";

const BUNDLE = "com.sobytes.solar";
const args = process.argv.slice(2);
const tag = args.shift();

const sh = (cmd, a) => execFileSync(cmd, a, { encoding: "utf8" }).trim();
const booted = sh("xcrun", ["simctl", "list", "devices", "booted"]).match(/\(([0-9A-F-]{36})\)/)[1];

try { sh("xcrun", ["simctl", "terminate", booted, BUNDLE]); } catch {}
const app = sh("find", [
  `${process.env.HOME}/Library/Developer/Xcode/DerivedData`, "-name", "Solar.app",
  "-path", "*Debug-iphonesimulator*", "-maxdepth", "6",
]).split("\n")[0];
sh("xcrun", ["simctl", "install", booted, app]);
sh("xcrun", ["simctl", "launch", booted, BUNDLE, ...args]);

await new Promise((r) => setTimeout(r, 11_000));

const png = `artifacts/${tag}-base.png`;
sh("xcrun", ["simctl", "io", booted, "screenshot", png]);
const container = sh("xcrun", ["simctl", "get_app_container", booted, BUNDLE, "data"]);
const dump = JSON.parse(readFileSync(`${container}/Documents/scene-debug.json`, "utf8"));
writeFileSync(`artifacts/${tag}.json`, JSON.stringify(dump, null, 1));

const meta = await sharp(png).metadata();
const scale = meta.width / 402;

const rects = [];
for (const label of dump.labels) {
  const b = dump.bodyScreen[label.id];
  // The plate, as placeLabels sized it. Same arithmetic, so a mismatch on screen is a
  // mismatch between the module and the renderer rather than between two guesses.
  const name = dump.displayNames?.[label.id] ?? label.id;
  const w = label.detail ? Math.max(name.length * 6 + 14, 124) : name.length * 6 + 14;
  const h = label.detail ? 36 : 21;
  rects.push(
    `<rect x="${(label.x - w / 2) * scale}" y="${(label.y - h / 2) * scale}" width="${w * scale}" height="${h * scale}" fill="none" stroke="#ff00ff" stroke-width="3"/>`,
  );
  if (b) {
    rects.push(
      `<circle cx="${b.x * scale}" cy="${b.y * scale}" r="${Math.max(10, b.radiusPx * 1.6) * scale}" fill="none" stroke="#00ff66" stroke-width="3"/>`,
      `<line x1="${b.x * scale}" y1="${b.y * scale}" x2="${label.x * scale}" y2="${label.y * scale}" stroke="#00ff66" stroke-width="1.5" stroke-dasharray="6 6"/>`,
    );
  }
}
const svg = `<svg width="${meta.width}" height="${meta.height}" xmlns="http://www.w3.org/2000/svg">${rects.join("")}</svg>`;
await sharp(png)
  .composite([{ input: Buffer.from(svg), top: 0, left: 0 }])
  .toFile(`artifacts/${tag}.png`);

console.log("id        label(x,y)      body(x,y)        gap pt  detail clamped");
for (const p of dump.labels) {
  const b = dump.bodyScreen[p.id];
  const gap = b ? Math.hypot(p.x - b.x, p.y - b.y).toFixed(1) : "-";
  console.log(
    `${p.id.padEnd(9)} ${p.x.toFixed(0).padStart(4)},${p.y.toFixed(0).padEnd(5)}  ` +
      `${(b ? b.x.toFixed(0) : "-").padStart(7)},${(b ? b.y.toFixed(0) : "-").padEnd(7)} ${String(gap).padStart(7)}  ` +
      `${String(!!p.detail).padEnd(6)} ${p.clamped}`,
  );
}
