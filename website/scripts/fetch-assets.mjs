/**
 * Downloads planetary texture originals and elevation data by tier.
 *
 * This writes to `assets/originals`, which git ignores. Nothing serves those files. Run
 * `npm run textures` afterwards to generate the WebP derivatives under `public/textures`
 * that the browser is actually given, and which are committed.
 *
 *   node scripts/fetch-assets.mjs 1        # tier 1 only
 *   node scripts/fetch-assets.mjs 1 2      # tiers 1 and 2
 *   node scripts/fetch-assets.mjs --list   # show what each tier costs, download nothing
 */

import { createWriteStream } from "node:fs";
import { mkdir, readFile, stat } from "node:fs/promises";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

const OUT_DIR = "assets/originals";
const MANIFEST = "scripts/assets.manifest.json";
const USER_AGENT = "solar-system-sim/0.1 (educational simulation; asset fetch)";

const manifest = JSON.parse(await readFile(MANIFEST, "utf8"));
const args = process.argv.slice(2);
const listOnly = args.includes("--list");
const tiers = args.filter((a) => /^\d+$/.test(a)).map(Number);
const wanted = tiers.length > 0 ? tiers : [1];

const selected = manifest.assets.filter((a) => wanted.includes(a.tier));

function human(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}

async function headSize(url) {
  try {
    const res = await fetch(url, { method: "HEAD", headers: { "User-Agent": USER_AGENT } });
    const len = res.headers.get("content-length");
    return { ok: res.ok, status: res.status, bytes: len ? Number(len) : null };
  } catch (err) {
    return { ok: false, status: 0, bytes: null, error: err.message };
  }
}

if (listOnly) {
  console.log("tier  id                      size        status  url");
  for (const asset of manifest.assets) {
    const probe = await headSize(asset.url);
    const size = probe.bytes === null ? "unknown" : human(probe.bytes);
    console.log(
      `  ${asset.tier}   ${asset.id.padEnd(22)} ${size.padStart(10)}  ${String(probe.status).padStart(5)}   ${asset.url}`,
    );
  }
  process.exit(0);
}

await mkdir(OUT_DIR, { recursive: true });

const results = [];
for (const asset of selected) {
  const target = `${OUT_DIR}/${asset.file}`;
  try {
    const existing = await stat(target);
    if (existing.size > 0) {
      console.log(`  skip  ${asset.id.padEnd(22)} already present, ${human(existing.size)}`);
      results.push({ ...asset, bytes: existing.size, state: "present" });
      continue;
    }
  } catch {
    // not downloaded yet
  }

  const res = await fetch(asset.url, { headers: { "User-Agent": USER_AGENT } });
  if (!res.ok || !res.body) {
    console.log(`  FAIL  ${asset.id.padEnd(22)} HTTP ${res.status}`);
    results.push({ ...asset, bytes: 0, state: `failed HTTP ${res.status}` });
    continue;
  }

  await pipeline(Readable.fromWeb(res.body), createWriteStream(target));
  const written = await stat(target);
  console.log(`  ok    ${asset.id.padEnd(22)} ${human(written.size).padStart(10)}  -> ${target}`);
  results.push({ ...asset, bytes: written.size, state: "downloaded" });
}

const landed = results.filter((r) => r.bytes > 0);
console.log(
  `\n${landed.length} originals on disk, ${human(landed.reduce((s, r) => s + r.bytes, 0))}.`,
);
// Credits are written by `npm run textures`, not here. The licence conditions attach to the
// files this project redistributes, which are the resized derivatives under public/textures,
// and only the step that writes those can honestly describe them.
console.log("next: npm run textures");

const failed = results.filter((r) => r.bytes === 0);
if (failed.length > 0) {
  console.log(`\n${failed.length} failed:`);
  for (const f of failed) console.log(`  ${f.id}: ${f.state}  ${f.url}`);
  process.exit(1);
}
