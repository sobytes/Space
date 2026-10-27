/** How much does each planet move the others? Differential, so only gravity is being measured. */
import { influenceOf } from "../../src/engine/nbody";
import { PLANET_IDS } from "../../src/engine/data/planets";
import { J2000_JD, jdTdb } from "../../src/engine/time";
import { SECONDS_PER_DAY } from "../../src/engine/units";

const YEAR = 365.25 * SECONDS_PER_DAY;
const limits = { tolerance: 1e-13, minStepSeconds: 60, maxStepSeconds: 5 * SECONDS_PER_DAY };

for (const years of [10, 100]) {
  console.log(`\n=== displacement caused by each body's mass over ${years} years, km ===`);
  const table = PLANET_IDS.map((remove) => {
    const result = influenceOf(jdTdb(J2000_JD), remove, years * YEAR, [], limits);
    const row: Record<string, string> = { "mass removed": remove };
    for (const d of result) {
      if (d.id === "sun") continue;
      row[d.id] = (d.metres / 1000).toFixed(0);
    }
    return row;
  });
  console.table(table);
}
