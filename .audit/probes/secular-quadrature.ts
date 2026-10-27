/**
 * Independent check on the N-body's secular precession, by a completely different route:
 * orbit-average the exact disturbing function by quadrature, then apply Lagrange's equation
 * for the pericentre. No series expansion, no Laplace coefficients, no tabulated value.
 *
 *   dvarpi/dt = sqrt(1-e^2)/(n a^2 e) * d<R>/de,
 *   R = G m2 [ 1/|r1 - r2| - (r1.r2)/r2^3 ]
 *
 * The integrand is differentiated analytically rather than by finite difference, since
 * differencing <R> would need the quadrature accurate to ~1e-8 of its own value:
 *
 *   dR/de1 = G m2 [ (r2-r1)/|r2-r1|^3 - r2/r2^3 ] . dr1/de1
 *
 * and dr1/de1 at fixed mean anomaly follows from Kepler's equation, dE/de = sinE/(1 - e cosE).
 */
import { advance, positionOf, solarSystemAt, velocityOf, type MassiveBody } from "../../src/engine/nbody";
import { J2000_JD, jdTdb } from "../../src/engine/time";
import { AU_IN_METRES, GM_SUN, SECONDS_PER_DAY } from "../../src/engine/units";
import { add, dot, length, scale, sub } from "../../src/engine/vec";

const ARCSEC = 648_000 / Math.PI;
const CENTURY = 36_525 * SECONDS_PER_DAY;
const YEAR = 365.25 * SECONDS_PER_DAY;

const A_MERCURY = 0.38709927 * AU_IN_METRES;
const E_MERCURY = 0.20563593;
const GM_MERCURY = 22_031.87e9;

function solveE(meanAnomaly: number, e: number): number {
  let E = meanAnomaly;
  for (let i = 0; i < 60; i++) {
    const f = E - e * Math.sin(E) - meanAnomaly;
    const step = f / (1 - e * Math.cos(E));
    E -= step;
    if (Math.abs(step) < 1e-15) break;
  }
  return E;
}

/** Secular pericentre rate of an inner orbit from a coplanar circular exterior perturber. */
function secularRateByQuadrature(a1: number, e1: number, gm2: number, a2: number, n = 1200): number {
  const mu = GM_SUN + GM_MERCURY;
  const n1 = Math.sqrt(mu / (a1 * a1 * a1));
  const root = Math.sqrt(1 - e1 * e1);
  let integral = 0;

  for (let i = 0; i < n; i++) {
    const M1 = (2 * Math.PI * (i + 0.5)) / n;
    const E = solveE(M1, e1);
    const cosE = Math.cos(E);
    const sinE = Math.sin(E);
    const r1 = { x: a1 * (cosE - e1), y: a1 * root * sinE, z: 0 };

    // dr1/de1 at fixed M1, via dE/de = sinE / (1 - e cosE).
    const dEde = sinE / (1 - e1 * cosE);
    const dr1 = {
      x: a1 * (-sinE * dEde - 1),
      y: a1 * ((-e1 / root) * sinE + root * cosE * dEde),
      z: 0,
    };

    for (let j = 0; j < n; j++) {
      const theta = (2 * Math.PI * (j + 0.5)) / n;
      const r2 = { x: a2 * Math.cos(theta), y: a2 * Math.sin(theta), z: 0 };
      const d = sub(r2, r1);
      const dl = length(d);
      const gradient = sub(scale(d, 1 / (dl * dl * dl)), scale(r2, 1 / (a2 * a2 * a2)));
      integral += dot(gradient, dr1);
    }
  }

  const dRde = (gm2 * integral) / (n * n);
  return ((root / (n1 * a1 * a1 * e1)) * dRde) * ARCSEC * CENTURY;
}

/** The derived small-alpha limit: (3/4) sqrt(1-e^2) n (m2/M) alpha^3. */
function leadingOrder(a1: number, e1: number, gm2: number, a2: number): number {
  const n1 = Math.sqrt((GM_SUN + GM_MERCURY) / (a1 * a1 * a1));
  const alpha = a1 / a2;
  return 0.75 * Math.sqrt(1 - e1 * e1) * n1 * (gm2 / GM_SUN) * alpha ** 3 * ARCSEC * CENTURY;
}

/** The same configuration, integrated. Coplanar Mercury at perihelion, circular perturber. */
function secularRateByIntegration(a1: number, e1: number, gm2: number, a2: number, spanYears: number): number {
  const vMercury = Math.sqrt(((GM_SUN + GM_MERCURY) * (1 + e1)) / (a1 * (1 - e1)));
  const mercury: MassiveBody = {
    id: "mercury", gm: GM_MERCURY,
    position: { x: a1 * (1 - e1), y: 0, z: 0 },
    velocity: { x: 0, y: vMercury, z: 0 },
  };
  const perturber: MassiveBody = {
    id: "perturber", gm: gm2,
    position: { x: a2, y: 0, z: 0 },
    velocity: { x: 0, y: Math.sqrt((GM_SUN + gm2) / a2), z: 0 },
  };
  const sys = solarSystemAt(jdTdb(J2000_JD), [mercury, perturber], []);
  const longitude = (): number => {
    const r = sub(positionOf(sys, "mercury"), positionOf(sys, "sun"));
    const v = sub(velocityOf(sys, "mercury"), velocityOf(sys, "sun"));
    const mu = GM_SUN + GM_MERCURY;
    const e = scale(add(scale(r, dot(v, v) - mu / length(r)), scale(v, -dot(r, v))), 1 / mu);
    return Math.atan2(e.y, e.x);
  };
  const limits = { tolerance: 1e-13, minStepSeconds: 60, maxStepSeconds: SECONDS_PER_DAY };
  const stepYears = 0.05;
  const count = Math.floor(spanYears / stepYears);
  let previous = longitude(), unwrapped = previous;
  let st = 0, sy = unwrapped, stt = 0, sty = 0;
  for (let i = 1; i <= count; i++) {
    advance(sys, stepYears * YEAR, limits);
    const now = longitude();
    let d = now - previous;
    while (d > Math.PI) d -= 2 * Math.PI;
    while (d < -Math.PI) d += 2 * Math.PI;
    unwrapped += d; previous = now;
    const t = i * stepYears;
    st += t; sy += unwrapped; stt += t * t; sty += t * unwrapped;
  }
  const m = count + 1;
  return ((m * sty - st * sy) / (m * stt - st * st)) * ARCSEC * 100;
}

const CASES = [
  { name: "Venus mass @ 0.7233 au", gm: 324_858.59e9, au: 0.72333566 },
  { name: "Earth+Moon @ 1.0000 au", gm: (398_600.44 + 4_902.8) * 1e9, au: 1.00000261 },
  { name: "Jupiter @ 5.2029 au", gm: 126_712_764.1e9, au: 5.20288700 },
  { name: "Jupiter mass @ 50 au", gm: 126_712_764.1e9, au: 50 },
  { name: "Jupiter mass @ 200 au", gm: 126_712_764.1e9, au: 200 },
];

console.log("Secular pericentre rate of Mercury, arcsec/century. Coplanar, circular perturber.");
console.table(CASES.map((c) => {
  const a2 = c.au * AU_IN_METRES;
  const quad = secularRateByQuadrature(A_MERCURY, E_MERCURY, c.gm, a2);
  const lead = leadingOrder(A_MERCURY, E_MERCURY, c.gm, a2);
  const nbody = secularRateByIntegration(A_MERCURY, E_MERCURY, c.gm, a2, 600);
  return {
    case: c.name,
    alpha: (A_MERCURY / a2).toFixed(4),
    "quadrature": quad.toFixed(4),
    "N-body": nbody.toFixed(4),
    "quad vs N-body": `${(100 * Math.abs(quad - nbody) / Math.abs(quad)).toFixed(3)}%`,
    "leading order": lead.toFixed(4),
    "lead/quad": (lead / quad).toFixed(4),
  };
}));
