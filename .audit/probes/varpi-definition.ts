/**
 * Two definitions of the perihelion longitude, measured side by side.
 *
 *  projected: atan2(e_y, e_x), the ecliptic longitude of the eccentricity vector.
 *  classical: varpi = Omega + omega, with omega measured in the body's own orbital plane.
 *
 * They agree only for a coplanar orbit. Mercury is inclined 7 degrees, and the classical
 * planetary-perturbation figure is quoted for the second one.
 */
import { advance, positionOf, solarSystemAt, velocityOf } from "../../src/engine/nbody";
import { PLANET_IDS, type PlanetId } from "../../src/engine/data/planets";
import { J2000_JD, jdTdb } from "../../src/engine/time";
import { GM_SUN, SECONDS_PER_DAY } from "../../src/engine/units";
import { add, cross, dot, length, normalize, scale, sub, type Vec3 } from "../../src/engine/vec";

const ARCSEC = 648_000 / Math.PI;
const YEAR = 365.25 * SECONDS_PER_DAY;
const GM_MERCURY = 22_031.87e9;
const LIMITS = { tolerance: 1e-13, minStepSeconds: 60, maxStepSeconds: SECONDS_PER_DAY };

interface Angles { projected: number; classical: number; node: number; inclinationDeg: number }

function angles(r: Vec3, v: Vec3, mu: number): Angles {
  const h = cross(r, v);
  const hHat = normalize(h);
  const e = scale(add(scale(r, dot(v, v) - mu / length(r)), scale(v, -dot(r, v))), 1 / mu);
  // Ascending node direction: where the orbit crosses the ecliptic going north.
  const node = normalize({ x: -h.y, y: h.x, z: 0 });
  const ascendingNode = Math.atan2(h.x, -h.y);
  // omega is the in-plane angle from the node to perihelion, signed by the orbit normal.
  const argument = Math.atan2(dot(hHat, cross(node, e)), dot(node, e));
  return {
    projected: Math.atan2(e.y, e.x),
    classical: ascendingNode + argument,
    node: ascendingNode,
    inclinationDeg: (Math.acos(hHat.z) * 180) / Math.PI,
  };
}

function fit(planets: readonly PlanetId[], spanYears: number) {
  const sys = solarSystemAt(jdTdb(J2000_JD), [], planets);
  const read = (): Angles => {
    const r = sub(positionOf(sys, "mercury"), positionOf(sys, "sun"));
    const v = sub(velocityOf(sys, "mercury"), velocityOf(sys, "sun"));
    return angles(r, v, GM_SUN + GM_MERCURY);
  };

  const keys = ["projected", "classical", "node"] as const;
  const first = read();
  const unwrapped: Record<string, number> = { projected: first.projected, classical: first.classical, node: first.node };
  const previous: Record<string, number> = { ...unwrapped };
  const acc: Record<string, { st: number; sy: number; stt: number; sty: number }> = {};
  for (const k of keys) acc[k] = { st: 0, sy: unwrapped[k], stt: 0, sty: 0 };

  const stepYears = 0.05;
  const count = Math.floor(spanYears / stepYears);
  for (let i = 1; i <= count; i++) {
    advance(sys, stepYears * YEAR, LIMITS);
    const now = read();
    const t = i * stepYears;
    for (const k of keys) {
      let d = now[k] - previous[k];
      while (d > Math.PI) d -= 2 * Math.PI;
      while (d < -Math.PI) d += 2 * Math.PI;
      unwrapped[k] += d;
      previous[k] = now[k];
      const a = acc[k];
      a.st += t; a.sy += unwrapped[k]; a.stt += t * t; a.sty += t * unwrapped[k];
    }
  }
  const n = count + 1;
  const rate = (k: string) => {
    const a = acc[k];
    return ((n * a.sty - a.st * a.sy) / (n * a.stt - a.st * a.st)) * ARCSEC * 100;
  };
  return {
    projected: rate("projected"),
    classical: rate("classical"),
    node: rate("node"),
    inclinationDeg: first.inclinationDeg,
  };
}

const all = fit(PLANET_IDS, 600);
console.log("Mercury, all eight planets, 600 yr, arcsec/century");
console.log("  inclination to ecliptic   ", all.inclinationDeg.toFixed(3), "deg");
console.log("  projected longitude rate  ", all.projected.toFixed(2));
console.log("  classical varpi = O + w   ", all.classical.toFixed(2));
console.log("  node rate (dOmega/dt)     ", all.node.toFixed(2));
console.log("  difference                ", (all.classical - all.projected).toFixed(2));

console.log("\nper perturber, classical definition");
console.table(PLANET_IDS.filter((p) => p !== "mercury").map((p) => {
  const r = fit(["mercury", p], 600);
  return {
    perturber: p,
    "projected": r.projected.toFixed(2),
    "classical varpi": r.classical.toFixed(2),
    "node rate": r.node.toFixed(2),
  };
}));
