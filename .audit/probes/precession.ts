/** Mercury's Newtonian perihelion advance, with the sampling cadence swept to expose aliasing. */
import { advance, positionOf, solarSystemAt, totalEnergy, velocityOf } from "../../src/engine/nbody";
import { J2000_JD, jdTdb } from "../../src/engine/time";
import { GM_SUN, SECONDS_PER_DAY } from "../../src/engine/units";
import { add, dot, length, scale, sub } from "../../src/engine/vec";

const YEAR = 365.25 * SECONDS_PER_DAY;
const ARCSEC = 648_000 / Math.PI;
const GM_MERCURY = 22_031.87e9;
const MERCURY_PERIOD_YEARS = 0.2408467;

function rate(spanYears: number, stepYears: number): { rate: number; drift: number; n: number } {
  const sys = solarSystemAt(jdTdb(J2000_JD));
  const e0 = totalEnergy(sys);
  const limits = { tolerance: 1e-13, minStepSeconds: 60, maxStepSeconds: SECONDS_PER_DAY };

  const longitude = (): number => {
    const r = sub(positionOf(sys, "mercury"), positionOf(sys, "sun"));
    const v = sub(velocityOf(sys, "mercury"), velocityOf(sys, "sun"));
    // Eccentricity vector e = ((v.v - mu/r) r - (r.v) v)/mu points from the focus at perihelion.
    const mu = GM_SUN + GM_MERCURY;
    const e = scale(add(scale(r, dot(v, v) - mu / length(r)), scale(v, -dot(r, v))), 1 / mu);
    return Math.atan2(e.y, e.x);
  };

  const count = Math.floor(spanYears / stepYears);
  let previous = longitude();
  let unwrapped = previous;
  let st = 0, sy = 0, stt = 0, sty = 0;
  const accumulate = (t: number, y: number) => { st += t; sy += y; stt += t * t; sty += t * y; };
  accumulate(0, unwrapped);

  for (let i = 1; i <= count; i++) {
    advance(sys, stepYears * YEAR, limits);
    const now = longitude();
    let d = now - previous;
    while (d > Math.PI) d -= 2 * Math.PI;
    while (d < -Math.PI) d += 2 * Math.PI;
    unwrapped += d;
    previous = now;
    accumulate(i * stepYears, unwrapped);
  }

  const n = count + 1;
  const slope = (n * sty - st * sy) / (n * stt - st * st);
  return { rate: slope * ARCSEC * 100, drift: Math.abs((totalEnergy(sys) - e0) / e0), n };
}

console.log("Mercury's period is", MERCURY_PERIOD_YEARS.toFixed(4), "yr");
const rows = [0.1, 0.05, 0.02, 0.01, 0.005].map((step) => {
  const r = rate(300, step);
  return {
    "step (yr)": step,
    "samples per orbit": (MERCURY_PERIOD_YEARS / step).toFixed(1),
    samples: r.n,
    "rate (arcsec/cy)": r.rate.toFixed(2),
    "energy drift": r.drift.toExponential(2),
  };
});
console.table(rows);
