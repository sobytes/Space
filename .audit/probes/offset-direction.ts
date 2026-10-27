/** Is the residual divergence a common translation, or genuinely per-planet? */
import { advance, positionOf, solarSystemAt, velocityOf } from "../../src/engine/nbody";
import { heliocentricPosition } from "../../src/engine/kepler";
import { SHORT_SPAN, PLANET_IDS } from "../../src/engine/data/planets";
import { J2000_JD, jdTdb } from "../../src/engine/time";
import { SECONDS_PER_DAY } from "../../src/engine/units";
import { length, sub, cross, dot, normalize, scale } from "../../src/engine/vec";

const YEAR = 365.25 * SECONDS_PER_DAY;
const sys = solarSystemAt(jdTdb(J2000_JD));
advance(sys, YEAR, { tolerance: 1e-13, minStepSeconds: 60, maxStepSeconds: 5 * SECONDS_PER_DAY });
const epoch = jdTdb(J2000_JD + 365.25);
const sun = positionOf(sys, "sun");

const offsets = PLANET_IDS.map((p) => {
  const r = sub(positionOf(sys, p), sun);
  const v = sub(velocityOf(sys, p), velocityOf(sys, "sun"));
  const d = sub(r, heliocentricPosition(p, epoch, SHORT_SPAN));
  const radial = normalize(r);
  const normal = normalize(cross(r, v));
  const along = cross(normal, radial);
  return {
    planet: p,
    "|d| km": (length(d) / 1000).toFixed(0),
    "radial km": (dot(d, radial) / 1000).toFixed(0),
    "along-track km": (dot(d, along) / 1000).toFixed(0),
    "normal km": (dot(d, normal) / 1000).toFixed(0),
    unit: normalize(d),
  };
});
console.table(offsets.map(({ unit, ...rest }) => rest));

console.log("\npairwise angle between offset directions, degrees");
console.log("(near 0 everywhere would mean one common translation)");
const rows = offsets.map((a) => {
  const row: Record<string, string> = { planet: a.planet };
  for (const b of offsets) {
    row[b.planet] = ((Math.acos(Math.max(-1, Math.min(1, dot(a.unit, b.unit)))) * 180) / Math.PI).toFixed(0);
  }
  return row;
});
console.table(rows);
