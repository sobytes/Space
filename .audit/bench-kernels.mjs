// THROWAWAY. Decides one thing: does the numeric core need a lower-level language?
// Real Standish elements, real Kepler solve, real gravity sum. No proxies.

const AU = 149_597_870_700;
const DEG = Math.PI / 180;

// JPL SSD approx_pos Table 1, valid 1800-2050. a(au) e I L longPeri longNode, then rates/century.
const ELEMENTS = [
  [0.38709927, 0.20563593, 7.00497902, 252.25032350, 77.45779628, 48.33076593,
   0.00000037, 0.00001906, -0.00594749, 149472.67411175, 0.16047689, -0.12534081],
  [0.72333566, 0.00677672, 3.39467605, 181.97909950, 131.60246718, 76.67984255,
   0.00000390, -0.00004107, -0.00078890, 58517.81538729, 0.00268329, -0.27769418],
  [1.00000261, 0.01671123, -0.00001531, 100.46457166, 102.93768193, 0.0,
   0.00000562, -0.00004392, -0.01294668, 35999.37244981, 0.32327364, 0.0],
  [1.52371034, 0.09339410, 1.84969142, -4.55343205, -23.94362959, 49.55953891,
   0.00001847, 0.00007882, -0.00813131, 19140.30268499, 0.44441088, -0.29257343],
  [5.20288700, 0.04838624, 1.30439695, 34.39644051, 14.72847983, 100.47390909,
   -0.00011607, -0.00013253, -0.00183714, 3034.74612775, 0.21252668, 0.20469106],
  [9.53667594, 0.05386179, 2.48599187, 49.95424423, 92.59887831, 113.66242448,
   -0.00125060, -0.00050991, 0.00193609, 1222.49362201, -0.41897216, -0.28867794],
  [19.18916464, 0.04725744, 0.77263783, 313.23810451, 170.95427630, 74.01692503,
   -0.00196176, -0.00004397, -0.00242939, 428.48202785, 0.40805281, 0.04240589],
  [30.06992276, 0.00859048, 1.77004347, -55.12002969, 44.96476227, 131.78422574,
   0.00026291, 0.00005105, 0.00035372, 218.45945325, -0.32241464, -0.00508664],
];

// GM in m^3/s^2. Sun plus the eight planetary systems, from JPL astro_par (km^3/s^2 * 1e9).
const GM = [1.32712440041e20, 2.203187e13, 3.2485859e14, 3.9860044e14, 4.282838e13,
            1.267127641e17, 3.794058484e16, 5.79455640e15, 6.83652710e15];

const out = new Float64Array(3);

function keplerPosition(el, T, out, o) {
  const a = (el[0] + el[6] * T) * AU;
  const e = el[1] + el[7] * T;
  const I = (el[2] + el[8] * T) * DEG;
  const L = (el[3] + el[9] * T) * DEG;
  const wbar = (el[4] + el[10] * T) * DEG;
  const node = (el[5] + el[11] * T) * DEG;

  const argPeri = wbar - node;
  let M = (L - wbar) % (2 * Math.PI);
  if (M > Math.PI) M -= 2 * Math.PI;
  if (M < -Math.PI) M += 2 * Math.PI;

  let E = M;
  for (let i = 0; i < 12; i++) {
    const dE = (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E));
    E -= dE;
    if (Math.abs(dE) < 1e-13) break;
  }

  const xo = a * (Math.cos(E) - e);
  const yo = a * Math.sqrt(1 - e * e) * Math.sin(E);

  const cw = Math.cos(argPeri), sw = Math.sin(argPeri);
  const cn = Math.cos(node), sn = Math.sin(node);
  const ci = Math.cos(I), si = Math.sin(I);

  const xp = cw * xo - sw * yo;
  const yp = sw * xo + cw * yo;

  out[o]     = cn * xp - sn * ci * yp;
  out[o + 1] = sn * xp + cn * ci * yp;
  out[o + 2] = si * yp;
}

const perturberPos = new Float64Array(9 * 3);

function fillPerturbers(T) {
  perturberPos[0] = 0; perturberPos[1] = 0; perturberPos[2] = 0;
  for (let i = 0; i < 8; i++) keplerPosition(ELEMENTS[i], T, perturberPos, (i + 1) * 3);
}

function gravity(rx, ry, rz, out) {
  let ax = 0, ay = 0, az = 0;
  for (let i = 0; i < 9; i++) {
    const o = i * 3;
    const dx = perturberPos[o] - rx;
    const dy = perturberPos[o + 1] - ry;
    const dz = perturberPos[o + 2] - rz;
    const r2 = dx * dx + dy * dy + dz * dz;
    const inv = GM[i] / (r2 * Math.sqrt(r2));
    ax += dx * inv; ay += dy * inv; az += dz * inv;
  }
  out[0] = ax; out[1] = ay; out[2] = az;
}

function rk4Step(s, T, dt, refreshPerturbers) {
  const a = new Float64Array(3);
  const k = [new Float64Array(6), new Float64Array(6), new Float64Array(6), new Float64Array(6)];
  const tmp = new Float64Array(6);
  const frac = [0, 0.5, 0.5, 1];
  for (let stage = 0; stage < 4; stage++) {
    for (let i = 0; i < 6; i++) {
      tmp[i] = stage === 0 ? s[i] : s[i] + k[stage - 1][i] * dt * frac[stage];
    }
    if (refreshPerturbers) fillPerturbers(T + (dt * frac[stage]) / (86400 * 36525));
    gravity(tmp[0], tmp[1], tmp[2], a);
    k[stage][0] = tmp[3]; k[stage][1] = tmp[4]; k[stage][2] = tmp[5];
    k[stage][3] = a[0];   k[stage][4] = a[1];   k[stage][5] = a[2];
  }
  for (let i = 0; i < 6; i++) {
    s[i] += (dt / 6) * (k[0][i] + 2 * k[1][i] + 2 * k[2][i] + k[3][i]);
  }
}

function time(label, iterations, fn) {
  const t0 = process.hrtime.bigint();
  const sink = fn(iterations);
  const t1 = process.hrtime.bigint();
  const ns = Number(t1 - t0);
  return { label, perSec: (iterations / ns) * 1e9, ns, sink };
}

const CASES = {
  gravity: (n) => {
    fillPerturbers(0.25);
    let s = 0;
    const a = new Float64Array(3);
    for (let i = 0; i < n; i++) {
      gravity(2.1e11 + i, 1.3e11, 4e9, a);
      s += a[0];
    }
    return s;
  },
  kepler8: (n) => {
    let s = 0;
    for (let i = 0; i < n; i++) {
      fillPerturbers(i * 1e-7);
      s += perturberPos[3];
    }
    return s;
  },
  rk4_recompute: (n) => {
    const st = new Float64Array([2.1e11, 1.3e11, 4e9, 5e3, 2.4e4, 1e2]);
    for (let i = 0; i < n; i++) rk4Step(st, 0.25, 3600, true);
    return st[0];
  },
  rk4_frozen: (n) => {
    const st = new Float64Array([2.1e11, 1.3e11, 4e9, 5e3, 2.4e4, 1e2]);
    fillPerturbers(0.25);
    for (let i = 0; i < n; i++) rk4Step(st, 0.25, 3600, false);
    return st[0];
  },
};

const ITER = { gravity: 3_000_000, kepler8: 300_000, rk4_recompute: 200_000, rk4_frozen: 500_000 };
const RUNS = 7;
const results = {};
for (const k of Object.keys(CASES)) results[k] = [];

for (const k of Object.keys(CASES)) CASES[k](Math.floor(ITER[k] / 10)); // warm the JIT

for (let run = 0; run < RUNS; run++) {
  for (const k of Object.keys(CASES)) {
    const r = time(k, ITER[k], CASES[k]);
    results[k].push(r);
  }
}

const median = (xs) => { const s = [...xs].sort((a, b) => a - b); return s[(s.length - 1) >> 1]; };

console.log(`node ${process.version}  runs=${RUNS}  interleaved A,B,C,D per run\n`);
console.log("kernel           median ops/s      min         max       sink (proves work ran)");
for (const k of Object.keys(CASES)) {
  const ps = results[k].map((r) => r.perSec);
  console.log(
    k.padEnd(16),
    median(ps).toExponential(3).padStart(12),
    Math.min(...ps).toExponential(3).padStart(11),
    Math.max(...ps).toExponential(3).padStart(11),
    "  " + results[k][0].sink.toExponential(6),
  );
}
