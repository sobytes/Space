/**
 * Re-resolve every surface photograph and check it is still a photograph.
 *
 * The feature's one constraint is that the pictures are real: taken by an instrument on or
 * near the surface of the world they show, with nothing generated. That is harder to hold
 * than it sounds, because NASA's image library is full of artist's impressions, mission
 * concept art and computed perspective views rendered from radar altimetry. A search for
 * "Venus surface" returns a Magellan elevation model drawn as a landscape, which looks
 * exactly like a photograph of Venus and is not one. That one got past a first filter here,
 * because its own description calls it a perspective view rather than a rendering.
 *
 * So this asks NASA what each curated asset actually is, and rejects anything whose own words
 * describe it as made rather than taken. It also checks the URLs still serve, because the
 * size suffix is not predictable per asset and a guess returns 403.
 *
 * Online, so deliberately not part of ./build.sh check. Run it with ./build.sh imagery.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

/**
 * Words that mean the image was made rather than taken.
 *
 * "perspective view" and "3-d" earn their place: Magellan radar altimetry rendered as a
 * landscape is the single most convincing fake photograph of another world in existence, and
 * it is published by NASA with no artist credit at all.
 */
const NOT_A_PHOTOGRAPH = [
  "artist", "concept", "illustration", "rendering", "rendered", "animation",
  "simulated", "simulation", "perspective view", "3-d perspective", "artwork",
];

const source = readFileSync(join(ROOT, "engine/src/data/surface-imagery.ts"), "utf8");
const ids = [...source.matchAll(/nasaId:\s*"([^"]+)"/g)].map((m) => m[1]);
const urls = [...source.matchAll(/url:\s*\n?\s*"([^"]+)"/g)].map((m) => m[1]);

if (ids.length === 0) {
  console.log("no curated images found; the parser or the data has moved");
  process.exit(1);
}
console.log(`checking ${ids.length} curated photographs\n`);

let failures = 0;

for (const [index, id] of ids.entries()) {
  let meta;
  try {
    const response = await fetch(`https://images-api.nasa.gov/search?nasa_id=${id}`);
    meta = (await response.json())?.collection?.items?.[0]?.data?.[0];
  } catch {
    meta = null;
  }

  if (!meta) {
    console.log(`  ${id.padEnd(16)} UNREACHABLE or withdrawn`);
    failures += 1;
    continue;
  }

  const blob = `${meta.title ?? ""} ${meta.description ?? ""}`.toLowerCase();
  const made = NOT_A_PHOTOGRAPH.filter((word) => blob.includes(word));

  const url = urls[index];
  let served = "";
  try {
    const head = await fetch(url, { method: "HEAD" });
    served = head.ok ? `${Math.round(Number(head.headers.get("content-length") ?? 0) / 1024)}KB` : `HTTP ${head.status}`;
    if (!head.ok) failures += 1;
  } catch {
    served = "UNREACHABLE";
    failures += 1;
  }

  if (made.length > 0) {
    failures += 1;
    console.log(`  ${id.padEnd(16)} NOT A PHOTOGRAPH: its description says ${made.join(", ")}`);
  } else {
    console.log(`  ${id.padEnd(16)} photograph, ${served.padEnd(12)} ${(meta.title ?? "").slice(0, 52)}`);
  }
}

console.log();
if (failures > 0) {
  console.log(`${failures} problems`);
  process.exit(1);
}
console.log(`all ${ids.length} are real photographs and still served`);
