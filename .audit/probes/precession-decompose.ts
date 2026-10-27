/**
 * Two questions. Does the fitted rate depend on the span (long-period contamination), and what
 * does each planet contribute on its own? The second gives a per-planet table to compare
 * against the classical first-order breakdown, which is additive by construction.
 */
import { advance, positionOf, solarSystemAt, velocityOf } from "../../src/engine/nbody";
import { PLANET_IDS, type PlanetId } from "../../src/engine/data/planets";
import { J2000_JD, jdTdb } from "../../src/engine/time";
import { GM_SUN, SECONDS_PER_DAY } from "../../src/engine/units";
import { add, dot, length, scale, sub } from "../../src/engine/vec";

const YEAR = 365.25 * SECONDS_PER_DAY;
const ARCSEC = 648_000 / Math.PI;
const GM_MERCURY = 22_031.87e9;
const LIMITS = { tolerance: 1e-13, minStepSeconds: 60, maxStepSeconds: SECONDS_PER_DAY };

function fitRate(planets: readonly PlanetId[], spanYears: number, startYear = 0): number {
  const sys = solarSystemAt(jdTdb(J2000_JD + startYear * 365.25), [], planets);
  const longitude = (): number => {
    const r = sub(positionOf(sys, "mercury"), positionOf(sys, "sun"));
    const v = sub(velocityOf(sys, "mercury"), velocityOf(sys, "sun"));
    const mu = GM_SUN + GM_MERCURY;
    const e = scale(add(scale(r, dot(v, v) - mu / length(r)), scale(v, -dot(r, v))), 1 / mu);
    return Math.atan2(e.y, e.x);
  };
  const stepYears = 0.05;
  const count = Math.floor(spanYears / stepYears);
  let previous = longitude();
  let unwrapped = previous;
  let st = 0, sy = unwrapped, stt = 0, sty = 0;
  for (let i = 1; i <= count; i++) {
    advance(sys, stepYears * YEAR, LIMITS);
    const now = longitude();
    let d = now - previous;
    while (d > Math.PI) d -= 2 * Math.PI;
    while (d < -Math.PI) d += 2 * Math.PI;
    unwrapped += d;
    previous = now;
    const t = i * stepYears;
    st += t; sy += unwrapped; stt += t * t; sty += t * unwrapped;
  }
  const n = count + 1;
  return ((n * sty - st * sy) / (n * stt - st * st)) * ARCSEC * 100;
}

console.log("=== does the span change the answer? all eight planets ===");
console.table([100, 200, 300, 600, 1000].map((span) => ({
  "span (yr)": span,
  "rate (arcsec/cy)": fitRate(PLANET_IDS, span).toFixed(2),
})));

console.log("\n=== does the start epoch change the answer? 300 yr spans ===");
console.table([0, 300, 600, -300].map((start) => ({
  "start (yr from J2000)": start,
  "rate (arcsec/cy)": fitRate(PLANET_IDS, 300, start).toFixed(2),
})));

console.log("\n=== one perturber at a time, Sun + Mercury + X, 600 yr ===");
const singles = PLANET_IDS.filter((p) => p !== "mercury").map((p) => ({
  perturber: p,
  "rate (arcsec/cy)": fitRate(["mercury", p], 600),
}));
let sum = 0;
for (const s of singles) sum += s["rate (arcsec/cy)"];
console.table(singles.map((s) => ({ ...s, "rate (arcsec/cy)": s["rate (arcsec/cy)"].toFixed(2) })));
console.log("sum of separate contributions:", sum.toFixed(2));
console.log("all eight together, 600 yr      :", fitRate(PLANET_IDS, 600).toFixed(2));
console.log("Mercury alone (should be ~0)    :", fitRate(["mercury"], 600).toFixed(4));
