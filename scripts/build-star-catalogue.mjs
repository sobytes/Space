/**
 * Builds the background star field from the Yale Bright Star Catalogue, 5th Revised Edition.
 *
 * Source: VizieR V/50 (Hoffleit & Warren 1991), https://cdsarc.cds.unistra.fr/viz-bin/cat/V/50
 *
 * BSC5 is the right catalogue here rather than Hipparcos. It is naked-eye complete to about
 * magnitude 6.5 with roughly 9,100 entries, which is exactly the sky a human sees, and it
 * compresses to a file small enough to ship in the bundle. Hipparcos has 118,218 stars, which
 * is 13x the data for stars nobody can see with the naked eye anyway.
 *
 * Output is a flat Float32Array, four values per star: right ascension and declination in
 * radians (J2000), visual magnitude, and B-V colour index. Colour is left as B-V rather than
 * baked to RGB so the renderer can tune the temperature-to-colour mapping without a refetch.
 */

import { writeFile } from "node:fs/promises";
import { gunzipSync } from "node:zlib";

const SOURCE = "https://cdsarc.cds.unistra.fr/ftp/V/50/catalog.gz";
const OUT_BIN = "public/data/bsc5.bin";
const OUT_META = "public/data/bsc5.json";

const res = await fetch(SOURCE, {
  headers: { "User-Agent": "solar-system-sim/0.1 (educational simulation)" },
});
if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${SOURCE}`);

const raw = gunzipSync(Buffer.from(await res.arrayBuffer())).toString("latin1");
const lines = raw.split("\n");

/** Fixed-width columns per the VizieR V/50 ReadMe, 1-indexed and inclusive. */
const col = (line, from, to) => line.slice(from - 1, to);
const num = (line, from, to) => {
  const t = col(line, from, to).trim();
  return t === "" ? null : Number(t);
};

const stars = [];
let skippedNoPosition = 0;
let skippedNovaOrCluster = 0;

for (const line of lines) {
  if (line.length < 100) continue;

  const raHours = num(line, 76, 77);
  const raMin = num(line, 78, 79);
  const raSec = num(line, 80, 83);
  const decSign = col(line, 84, 84);
  const decDeg = num(line, 85, 86);
  const decMin = num(line, 87, 88);
  const decSec = num(line, 89, 90);
  const vmag = num(line, 103, 107);

  if (raHours === null || decDeg === null || vmag === null) {
    // About 14 BSC5 entries are novae or clusters carrying no stellar position.
    if (col(line, 5, 14).trim() !== "") skippedNovaOrCluster += 1;
    else skippedNoPosition += 1;
    continue;
  }

  const ra = ((raHours + raMin / 60 + (raSec ?? 0) / 3600) / 24) * 2 * Math.PI;
  const decMagnitude = decDeg + (decMin ?? 0) / 60 + (decSec ?? 0) / 3600;
  const dec = (decSign === "-" ? -decMagnitude : decMagnitude) * (Math.PI / 180);
  const bv = num(line, 110, 114);

  stars.push([ra, dec, vmag, bv ?? 0]);
}

stars.sort((a, b) => a[2] - b[2]);

const buffer = new Float32Array(stars.length * 4);
for (let i = 0; i < stars.length; i++) {
  buffer[i * 4] = stars[i][0];
  buffer[i * 4 + 1] = stars[i][1];
  buffer[i * 4 + 2] = stars[i][2];
  buffer[i * 4 + 3] = stars[i][3];
}

await writeFile(OUT_BIN, Buffer.from(buffer.buffer));

const magnitudes = stars.map((s) => s[2]);
const meta = {
  source: SOURCE,
  catalogue: "Yale Bright Star Catalogue, 5th Revised Edition (Hoffleit & Warren 1991), VizieR V/50",
  epoch: "J2000",
  generatedAt: new Date().toISOString(),
  count: stars.length,
  stride: 4,
  layout: ["rightAscensionRad", "declinationRad", "visualMagnitude", "colourIndexBV"],
  brightestMagnitude: magnitudes[0],
  faintestMagnitude: magnitudes[magnitudes.length - 1],
  bytes: buffer.byteLength,
  skipped: { noPosition: skippedNoPosition, novaOrCluster: skippedNovaOrCluster },
};
await writeFile(OUT_META, JSON.stringify(meta, null, 2) + "\n");

console.log(`${stars.length} stars -> ${OUT_BIN} (${(buffer.byteLength / 1024).toFixed(1)} KB)`);
console.log(`magnitude range ${meta.brightestMagnitude} to ${meta.faintestMagnitude}`);
console.log(`skipped: ${skippedNoPosition} without position, ${skippedNovaOrCluster} nova/cluster entries`);
console.log(`\nbrightest ten, as a sanity check (Sirius should be first at about -1.46):`);
for (const s of stars.slice(0, 10)) {
  const raH = ((s[0] / (2 * Math.PI)) * 24).toFixed(3);
  const decD = ((s[1] * 180) / Math.PI).toFixed(2);
  console.log(`  mag ${String(s[2]).padStart(6)}  RA ${raH.padStart(7)} h  Dec ${decD.padStart(7)} deg  B-V ${s[3]}`);
}
