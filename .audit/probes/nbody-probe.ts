/** Measurement run. Establishes the numbers the nbody gate will assert. */
import {
  advance, barycentre, positionOf, solarSystemAt, totalAngularMomentum,
  totalEnergy, totalMomentum, velocityOf, type NBodyLimits,
} from "../../src/engine/nbody";
import { heliocentricPosition } from "../../src/engine/kepler";
import { SHORT_SPAN, PLANET_IDS, type PlanetId } from "../../src/engine/data/planets";
import { J2000_JD, jdTdb } from "../../src/engine/time";
import { SECONDS_PER_DAY } from "../../src/engine/units";
import { length, sub, cross, dot, scale, add, type Vec3 } from "../../src/engine/vec";
import { GM_SUN } from "../../src/engine/units";


const YEAR = 365.25 * SECONDS_PER_DAY;
const ARCSEC = 648_000 / Math.PI;
const R_SUN = 6.957e8;

const limits: NBodyLimits = { tolerance: 1e-13, minStepSeconds: 60, maxStepSeconds: SECONDS_PER_DAY };

// ---- conservation over 100 years ----
{
  const sys = solarSystemAt(jdTdb(J2000_JD));
  const e0 = totalEnergy(sys), p0 = totalMomentum(sys), l0 = totalAngularMomentum(sys);
  const t0 = Date.now();
  const { steps } = advance(sys, 100 * YEAR, limits);
  const ms = Date.now() - t0;
  const e1 = totalEnergy(sys), p1 = totalMomentum(sys), l1 = totalAngularMomentum(sys);
  console.log("=== conservation, 100 yr, 9 bodies ===");
  console.log("steps", steps, "wall ms", ms);
  console.log("energy  rel drift", Math.abs((e1 - e0) / e0).toExponential(3));
  console.log("ang mom rel drift", (length(sub(l1, l0)) / length(l0)).toExponential(3));
  // Momentum has units of gm times velocity. Divide by the system's total gm to read it as the
  // barycentre's drift velocity, which is the quantity with a physical scale to judge against.
  const totalGm = sys.gm.reduce((a, b) => a + b, 0);
  console.log("barycentre drift speed m/s", (length(p0) / totalGm).toExponential(2),
              "->", (length(p1) / totalGm).toExponential(2));
  console.log("barycentre drift m", length(barycentre(sys)).toExponential(3));
}

// ---- the Sun's wobble about the barycentre ----
{
  const sys = solarSystemAt(jdTdb(J2000_JD));
  let min = Infinity, max = 0;
  for (let i = 0; i < 120; i++) {
    advance(sys, 0.25 * YEAR, { ...limits, maxStepSeconds: 5 * SECONDS_PER_DAY });
    const d = length(positionOf(sys, "sun"));
    min = Math.min(min, d); max = Math.max(max, d);
  }
  console.log("\n=== Sun about the barycentre, 30 yr ===");
  console.log("min", (min / R_SUN).toFixed(3), "R_sun   max", (max / R_SUN).toFixed(3), "R_sun");
  console.log("max km", (max / 1000).toFixed(0));
}

// ---- divergence from the analytic ephemeris ----
{
  console.log("\n=== N-body versus Standish, same initial conditions ===");
  for (const years of [1, 10, 100]) {
    const sys = solarSystemAt(jdTdb(J2000_JD));
    advance(sys, years * YEAR, { ...limits, maxStepSeconds: 5 * SECONDS_PER_DAY });
    const epoch = jdTdb(J2000_JD + years * 365.25);
    const sun = positionOf(sys, "sun");
    const row: Record<string, string> = { years: String(years) };
    for (const p of PLANET_IDS) {
      const nb = sub(positionOf(sys, p), sun);
      const an = heliocentricPosition(p, epoch, SHORT_SPAN);
      row[p] = (length(sub(nb, an)) / 1000).toFixed(0);
    }
    console.log("separation km:", JSON.stringify(row));
  }
}

// ---- Mercury's perihelion, Newtonian, from the planets alone ----
{
  const sys = solarSystemAt(jdTdb(J2000_JD));
  const samples: { t: number; lon: number }[] = [];
  const perihelionLongitude = (): number => {
    const sun = positionOf(sys, "sun");
    const r = sub(positionOf(sys, "mercury"), sun);
    const v = sub(velocityOf(sys, "mercury"), velocityOf(sys, "sun"));
    // Eccentricity vector: e = ((v.v - mu/r) r - (r.v) v) / mu. Points at perihelion.
    const mu = GM_SUN + 22_031.87e9;
    const rn = length(r);
    const e = scale(add(scale(r, dot(v, v) - mu / rn), scale(v, -dot(r, v))), 1 / mu);
    return Math.atan2(e.y, e.x);
  };
  const span = 300, stepYears = 0.1;
  for (let i = 0; i * stepYears <= span; i++) {
    if (i > 0) advance(sys, stepYears * YEAR, limits);
    samples.push({ t: i * stepYears, lon: perihelionLongitude() });
  }
  // Unwrap then least-squares fit the secular rate.
  let unwrapped = samples[0].lon;
  const pts = samples.map((s, i) => {
    if (i > 0) {
      let d = s.lon - samples[i - 1].lon;
      while (d > Math.PI) d -= 2 * Math.PI;
      while (d < -Math.PI) d += 2 * Math.PI;
      unwrapped += d;
    }
    return { t: s.t, y: unwrapped };
  });
  const n = pts.length;
  const mt = pts.reduce((a, p) => a + p.t, 0) / n;
  const my = pts.reduce((a, p) => a + p.y, 0) / n;
  const slope =
    pts.reduce((a, p) => a + (p.t - mt) * (p.y - my), 0) /
    pts.reduce((a, p) => a + (p.t - mt) ** 2, 0);
  console.log("\n=== Mercury perihelion advance, Newtonian, planets only ===");
  console.log("span yr", span, "samples", n);
  console.log("rate arcsec/century", (slope * ARCSEC * 100).toFixed(2));
  console.log("Le Verrier / modern planetary value ~531.6 arcsec/century");
}
