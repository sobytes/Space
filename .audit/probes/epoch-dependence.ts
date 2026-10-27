import { influenceOf } from "../../src/engine/nbody";
import { jdUtcFromEpochMs, tdbFromUtc } from "../../src/engine/time";
import { SECONDS_PER_DAY, SECONDS_PER_JULIAN_YEAR } from "../../src/engine/units";

const limits = { tolerance: 1e-13, minStepSeconds: 60, maxStepSeconds: 5 * SECONDS_PER_DAY };
for (const iso of ["2000-01-01T12:00:00Z", "2026-01-01T00:00:00Z", "2040-01-01T00:00:00Z"]) {
  const epoch = tdbFromUtc(jdUtcFromEpochMs(Date.parse(iso)));
  for (const years of [10, 50]) {
    const r = influenceOf(epoch, "jupiter", years * SECONDS_PER_JULIAN_YEAR, [], limits);
    const sorted = [...r].filter((d) => d.id !== "sun").sort((a, b) => b.metres - a.metres);
    console.log(iso.slice(0, 10), `${years}yr`,
      sorted.slice(0, 3).map((d) => `${d.id} ${(d.metres / 1e6).toFixed(0)}Mm`).join("  "));
  }
}
