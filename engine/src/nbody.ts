/**
 * Full mutual N-body gravity: every body pulls every other.
 *
 * There is one equation behind the whole solar system, and this is it. For bodies indexed i,
 * each with gravitational parameter mu_i = G m_i,
 *
 *     d^2 r_i / dt^2  =  sum over j != i  of  mu_j (r_j - r_i) / |r_j - r_i|^3
 *
 * That single line holds the Sun, the planets, and anything you add to the system together.
 * Everything the simulator knows about orbits is a consequence of it. What it does not have is
 * a closed-form solution: for two bodies you get Kepler's ellipse, and for three or more
 * Poincare showed there is no general solution in elementary functions. So the equation is
 * exact and the only honest way to evaluate it is to integrate it, step by step, which is what
 * the rest of this file does.
 *
 * Three quantities are constants of that motion, and they come from its symmetries rather than
 * from any choice made here. Translation invariance gives conserved momentum, rotation
 * invariance gives conserved angular momentum, and invariance under shifts in time gives
 * conserved energy. Noether's theorem is why each symmetry pairs with each constant. None of
 * the three is fed to the integrator, which makes all three free checks: the physics says they
 * must not drift, so any drift is numerical error and nothing else, and the gates below measure
 * exactly that.
 *
 * Why this mode exists. Elsewhere the engine puts planets on rails: positions come from the
 * Standish Keplerian tables, which are analytic fits, so adding a mass to the system changes
 * nothing about where Jupiter is. That is the right default, since the fits are accurate,
 * cheap, exactly reversible, and nothing drifts. This is the other mode. Initial conditions are
 * taken from those same ephemerides at a chosen epoch and then every body moves under the
 * gravity of every other, so a mass you add genuinely perturbs the rest. It is slower, it
 * drifts, and it is the only way to answer "what would happen if".
 *
 * Barycentric, not heliocentric. In a heliocentric frame the Sun is pinned and total momentum
 * is not conserved, which throws away the best available check on the integrator. Here the Sun
 * moves, momentum conservation holds to round-off, and the Sun's wobble about the barycentre is
 * itself a prediction to test: it should reach roughly one solar radius, dominated by Jupiter.
 */

import { heliocentricState } from "./kepler";
import { osculatingElements, type OsculatingElements } from "./elements";
import { PLANET_IDS, type PlanetId } from "./data/planets";
import { PHYSICAL } from "./data/physical";
import type { JdTdb } from "./time";
import {
  DAYS_PER_JULIAN_CENTURY,
  GM_SUN,
  SECONDS_PER_DAY,
  SECONDS_PER_JULIAN_YEAR,
} from "./units";
import { STATE_STRIDE, cross, sub, type Vec3 } from "./vec";

const STRIDE = STATE_STRIDE;

export interface MassiveBody {
  readonly id: string;
  /** Gravitational parameter, m^3 s^-2. */
  readonly gm: number;
  readonly position: Vec3;
  readonly velocity: Vec3;
}

export interface NBodySystem {
  readonly ids: readonly string[];
  readonly gm: Float64Array;
  /** Position and velocity per body, barycentric, metres and m/s. */
  readonly state: Float64Array;
  readonly startEpoch: JdTdb;
  /** Seconds elapsed since `startEpoch`. */
  elapsed: number;
}

/**
 * Builds the solar system from the analytic ephemeris at one instant.
 *
 * The Sun's velocity is not read from anywhere; it is set so the system's total momentum is
 * zero. That is what makes the barycentre stationary and turns momentum conservation into a
 * genuine check rather than something the initial conditions were fitted to.
 */
export function solarSystemAt(
  epoch: JdTdb,
  extra: readonly MassiveBody[] = [],
  planets: readonly PlanetId[] = PLANET_IDS,
): NBodySystem {
  // The Sun defines the heliocentric frame, so its heliocentric state is zero by definition.
  // The loop above then hands it V_sun with no special case.
  const bodies: MassiveBody[] = [
    { id: "sun", gm: GM_SUN, position: { x: 0, y: 0, z: 0 }, velocity: { x: 0, y: 0, z: 0 } },
  ];

  for (const planet of planets) {
    const { position, velocity } = heliocentricState(planet, epoch);
    bodies.push({ id: planet, gm: PHYSICAL[planet].gm, position, velocity });
  }
  bodies.push(...extra);

  const count = bodies.length;
  const gm = new Float64Array(count);
  const state = new Float64Array(count * STRIDE);

  // The ephemeris is heliocentric, and the Sun it is measured against is itself accelerating,
  // so this is a frame conversion and not just a translation. Writing V for barycentric and v
  // for heliocentric, every planet gets V_i = v_i + V_sun, and demanding zero total momentum
  //     mu_sun V_sun + sum_i mu_i (v_i + V_sun) = 0
  // fixes the Sun's velocity as V_sun = -(sum_i mu_i v_i) / (mu_sun + sum_i mu_i).
  // The denominator is the whole system's mu, not the Sun's. Getting either half of this wrong
  // leaves every body carrying the same spurious velocity, which shows up as an equal-length
  // offset at unequal distances growing linearly in time. Jupiter alone contributes 12.5 m/s,
  // which is 395,000 km of drift per year, so the error is not subtle once you look for it.
  let totalGm = 0;
  const weightedPosition = { x: 0, y: 0, z: 0 };
  const weightedVelocity = { x: 0, y: 0, z: 0 };

  for (const body of bodies) {
    totalGm += body.gm;
    weightedPosition.x += body.gm * body.position.x;
    weightedPosition.y += body.gm * body.position.y;
    weightedPosition.z += body.gm * body.position.z;
    weightedVelocity.x += body.gm * body.velocity.x;
    weightedVelocity.y += body.gm * body.velocity.y;
    weightedVelocity.z += body.gm * body.velocity.z;
  }

  const centre = {
    x: weightedPosition.x / totalGm,
    y: weightedPosition.y / totalGm,
    z: weightedPosition.z / totalGm,
  };
  const sunVelocity = {
    x: -weightedVelocity.x / totalGm,
    y: -weightedVelocity.y / totalGm,
    z: -weightedVelocity.z / totalGm,
  };

  bodies.forEach((body, i) => {
    gm[i] = body.gm;
    const o = i * STRIDE;
    state[o] = body.position.x - centre.x;
    state[o + 1] = body.position.y - centre.y;
    state[o + 2] = body.position.z - centre.z;
    state[o + 3] = body.velocity.x + sunVelocity.x;
    state[o + 4] = body.velocity.y + sunVelocity.y;
    state[o + 5] = body.velocity.z + sunVelocity.z;
  });

  return { ids: bodies.map((b) => b.id), gm, state, startEpoch: epoch, elapsed: 0 };
}

/**
 * Mutual accelerations, computed pairwise so each pair's separation is evaluated once and
 * both bodies get equal and opposite impulses. That symmetry is what makes momentum
 * conservation exact to round-off rather than approximate.
 */
export function accelerations(gm: Float64Array, state: Float64Array, out: Float64Array): void {
  const count = gm.length;
  out.fill(0);

  for (let i = 0; i < count; i++) {
    const oi = i * STRIDE;
    for (let j = i + 1; j < count; j++) {
      const oj = j * STRIDE;
      const dx = state[oj] - state[oi];
      const dy = state[oj + 1] - state[oi + 1];
      const dz = state[oj + 2] - state[oi + 2];

      const r2 = dx * dx + dy * dy + dz * dz;
      const invR3 = 1 / (r2 * Math.sqrt(r2));

      const ai = gm[j] * invR3;
      const aj = gm[i] * invR3;

      out[i * 3] += dx * ai;
      out[i * 3 + 1] += dy * ai;
      out[i * 3 + 2] += dz * ai;

      out[j * 3] -= dx * aj;
      out[j * 3 + 1] -= dy * aj;
      out[j * 3 + 2] -= dz * aj;
    }
  }
}

/**
 * Dormand-Prince 5(4). Only the a and b coefficients appear. A Butcher tableau's c column
 * gives the stage times, and the force law above depends on position alone, never on t, so an
 * autonomous system never evaluates them.
 */
const A: readonly (readonly number[])[] = [
  [],
  [1 / 5],
  [3 / 40, 9 / 40],
  [44 / 45, -56 / 15, 32 / 9],
  [19372 / 6561, -25360 / 2187, 64448 / 6561, -212 / 729],
  [9017 / 3168, -355 / 33, 46732 / 5247, 49 / 176, -5103 / 18656],
  [35 / 384, 0, 500 / 1113, 125 / 192, -2187 / 6784, 11 / 84],
];
const B5 = [35 / 384, 0, 500 / 1113, 125 / 192, -2187 / 6784, 11 / 84, 0] as const;
const B4 = [5179 / 57600, 0, 7571 / 16695, 393 / 640, -92097 / 339200, 187 / 2100, 1 / 40] as const;

export interface NBodyLimits {
  readonly tolerance: number;
  readonly minStepSeconds: number;
  readonly maxStepSeconds: number;
}

export const DEFAULT_NBODY_LIMITS: NBodyLimits = {
  tolerance: 1e-12,
  minStepSeconds: 60,
  maxStepSeconds: 86_400 * 10,
};

interface Scratch {
  readonly k: Float64Array[];
  readonly tmp: Float64Array;
  readonly accel: Float64Array;
  readonly y5: Float64Array;
  readonly y4: Float64Array;
}

export function createScratch(count: number): Scratch {
  const n = count * STRIDE;
  return {
    k: Array.from({ length: 7 }, () => new Float64Array(n)),
    tmp: new Float64Array(n),
    accel: new Float64Array(count * 3),
    y5: new Float64Array(n),
    y4: new Float64Array(n),
  };
}

/**
 * One adaptive Dormand-Prince step over the whole system.
 *
 * `requestedStep` may be negative. Newton's equations are time-reversible, so integrating
 * backwards is as valid as forwards and is what the simulator's reverse-time control runs on.
 * The step controller works in magnitude with the direction carried separately, since comparing
 * a negative step against a minimum would otherwise reject every reverse step immediately.
 *
 * Dormand-Prince is not symplectic, so a backward run does not retrace a forward one bit for
 * bit. It retraces it to the integrator's tolerance, which is the honest guarantee.
 */
export function stepSystem(
  system: NBodySystem,
  requestedStep: number,
  limits: NBodyLimits,
  scratch: Scratch,
): { taken: number; next: number } {
  const { gm, state } = system;
  const count = gm.length;
  const n = count * STRIDE;
  const { k, tmp, accel, y5, y4 } = scratch;

  const direction = Math.sign(requestedStep) || 1;
  let magnitude = Math.abs(requestedStep);

  for (;;) {
    const h = direction * magnitude;
    for (let stage = 0; stage < 7; stage++) {
      for (let i = 0; i < n; i++) {
        let v = state[i];
        for (let j = 0; j < stage; j++) {
          const a = A[stage][j];
          if (a !== 0) v += h * a * k[j][i];
        }
        tmp[i] = v;
      }

      accelerations(gm, tmp, accel);
      for (let b = 0; b < count; b++) {
        const o = b * STRIDE;
        k[stage][o] = tmp[o + 3];
        k[stage][o + 1] = tmp[o + 4];
        k[stage][o + 2] = tmp[o + 5];
        k[stage][o + 3] = accel[b * 3];
        k[stage][o + 4] = accel[b * 3 + 1];
        k[stage][o + 5] = accel[b * 3 + 2];
      }
    }

    let error = 0;
    for (let i = 0; i < n; i++) {
      let s5 = 0;
      let s4 = 0;
      for (let stage = 0; stage < 7; stage++) {
        s5 += B5[stage] * k[stage][i];
        s4 += B4[stage] * k[stage][i];
      }
      y5[i] = state[i] + h * s5;
      y4[i] = state[i] + h * s4;
      const scale = Math.max(1, Math.abs(y5[i]));
      error = Math.max(error, Math.abs(y5[i] - y4[i]) / scale);
    }

    if (error > limits.tolerance && magnitude > limits.minStepSeconds) {
      magnitude = Math.max(
        limits.minStepSeconds,
        magnitude * Math.max(0.2, 0.9 * (limits.tolerance / error) ** 0.2),
      );
      continue;
    }

    state.set(y5);
    system.elapsed += h;
    const next = Math.min(
      limits.maxStepSeconds,
      magnitude * Math.min(5, 0.9 * (limits.tolerance / Math.max(error, 1e-18)) ** 0.2),
    );
    return { taken: h, next };
  }
}

export interface AdvanceResult {
  readonly steps: number;
  /** Seconds of the request left unintegrated, signed. Nonzero only when `maxSteps` ran out. */
  readonly remainingSeconds: number;
}

/**
 * Integrates the system by `durationSeconds`, which may be negative.
 *
 * `maxSteps` bounds the work. A frame loop running at a high time rate can ask for more
 * simulated time than it can afford to integrate, and the honest response is to do what fits
 * and report the shortfall rather than to drop frames or to silently take a step size that
 * would wreck the orbits. Callers with no deadline leave it unbounded.
 */
export function advance(
  system: NBodySystem,
  durationSeconds: number,
  limits: NBodyLimits = DEFAULT_NBODY_LIMITS,
  maxSteps = Number.POSITIVE_INFINITY,
): AdvanceResult {
  // A non-finite duration makes the loop's first comparison false, so it would return zero
  // steps and look like a clean success. That cost a probe run to find.
  if (!Number.isFinite(durationSeconds)) {
    throw new Error(`advance needs a finite duration, got ${durationSeconds}`);
  }
  if (durationSeconds === 0) return { steps: 0, remainingSeconds: 0 };

  const direction = Math.sign(durationSeconds);
  const scratch = createScratch(system.gm.length);
  let remaining = Math.abs(durationSeconds);
  let step = Math.min(limits.maxStepSeconds, 86_400);
  let steps = 0;

  while (remaining > 0 && steps < maxSteps) {
    const { taken, next } = stepSystem(
      system,
      direction * Math.min(step, remaining),
      limits,
      scratch,
    );
    remaining -= Math.abs(taken);
    step = next;
    steps += 1;
  }

  return { steps, remainingSeconds: direction * Math.max(0, remaining) };
}

export function positionOf(system: NBodySystem, id: string): Vec3 {
  const i = system.ids.indexOf(id);
  const o = i * STRIDE;
  return { x: system.state[o], y: system.state[o + 1], z: system.state[o + 2] };
}

export function velocityOf(system: NBodySystem, id: string): Vec3 {
  const i = system.ids.indexOf(id);
  const o = i * STRIDE;
  return { x: system.state[o + 3], y: system.state[o + 4], z: system.state[o + 5] };
}

/** Total energy per unit of the gravitational constant, so it compares across runs. */
export function totalEnergy(system: NBodySystem): number {
  const { gm, state } = system;
  const count = gm.length;
  let kinetic = 0;
  let potential = 0;

  for (let i = 0; i < count; i++) {
    const o = i * STRIDE;
    kinetic += 0.5 * gm[i] * (state[o + 3] ** 2 + state[o + 4] ** 2 + state[o + 5] ** 2);
    for (let j = i + 1; j < count; j++) {
      const oj = j * STRIDE;
      const r = Math.hypot(state[oj] - state[o], state[oj + 1] - state[o + 1], state[oj + 2] - state[o + 2]);
      potential -= (gm[i] * gm[j]) / r;
    }
  }
  return kinetic + potential;
}

export function totalMomentum(system: NBodySystem): Vec3 {
  const { gm, state } = system;
  const p = { x: 0, y: 0, z: 0 };
  for (let i = 0; i < gm.length; i++) {
    const o = i * STRIDE;
    p.x += gm[i] * state[o + 3];
    p.y += gm[i] * state[o + 4];
    p.z += gm[i] * state[o + 5];
  }
  return p;
}

export function totalAngularMomentum(system: NBodySystem): Vec3 {
  const { gm, state } = system;
  const l = { x: 0, y: 0, z: 0 };
  for (let i = 0; i < gm.length; i++) {
    const o = i * STRIDE;
    const r = { x: state[o], y: state[o + 1], z: state[o + 2] };
    const v = { x: state[o + 3], y: state[o + 4], z: state[o + 5] };
    const c = cross(r, v);
    l.x += gm[i] * c.x;
    l.y += gm[i] * c.y;
    l.z += gm[i] * c.z;
  }
  return l;
}

/** Mass-weighted centre of the system. Should stay put. */
export function barycentre(system: NBodySystem): Vec3 {
  const { gm, state } = system;
  let total = 0;
  const c = { x: 0, y: 0, z: 0 };
  for (let i = 0; i < gm.length; i++) {
    const o = i * STRIDE;
    total += gm[i];
    c.x += gm[i] * state[o];
    c.y += gm[i] * state[o + 1];
    c.z += gm[i] * state[o + 2];
  }
  return { x: c.x / total, y: c.y / total, z: c.z / total };
}

/**
 * Zeroes a body's mass in place, leaving it in the system as a massless tracer.
 *
 * Removing the entry instead would renumber every index and, worse, change the barycentre and
 * the momentum-zeroing, so the two runs would no longer start from identical initial
 * conditions. Keeping the body and zeroing its pull makes the comparison exact: the only
 * difference between the two integrations is the one term under test.
 *
 * The cost is that the modified system no longer has zero total momentum, so its barycentre
 * drifts. Compare positions relative to the Sun, which removes any common drift.
 */
export function zeroMass(system: NBodySystem, id: string): void {
  const index = system.ids.indexOf(id);
  if (index < 0) throw new Error(`${id} is not in this system`);
  system.gm[index] = 0;
}

export interface Displacement {
  readonly id: string;
  /** How far this body ends up from where it would have been, metres. */
  readonly metres: number;
}

/**
 * How much one body's gravity moves everything else.
 *
 * Two integrations from bit-identical initial conditions, differing only in whether `id` has
 * mass. The separation that opens up between them is that body's gravitational influence and
 * nothing else: no ephemeris fit error, no integrator bias, since both runs carry the same ones.
 * This is the honest measurement of "do the planets pull each other", and the answer it gives
 * for an added body is the answer for a hypothetical one too.
 */
export function influenceOf(
  epoch: JdTdb,
  id: string,
  durationSeconds: number,
  extra: readonly MassiveBody[] = [],
  limits: NBodyLimits = DEFAULT_NBODY_LIMITS,
): readonly Displacement[] {
  const withMass = solarSystemAt(epoch, extra);
  const without = solarSystemAt(epoch, extra);
  zeroMass(without, id);

  advance(withMass, durationSeconds, limits);
  advance(without, durationSeconds, limits);

  const sunA = positionOf(withMass, "sun");
  const sunB = positionOf(without, "sun");

  return withMass.ids
    .filter((body) => body !== id)
    .map((body) => {
      const a = positionOf(withMass, body);
      const b = positionOf(without, body);
      return {
        id: body,
        metres: Math.hypot(
          a.x - sunA.x - (b.x - sunB.x),
          a.y - sunA.y - (b.y - sunB.y),
          a.z - sunA.z - (b.z - sunB.z),
        ),
      };
    });
}

/**
 * Apsidal and nodal precession rates, measured by integrating and fitting.
 *
 * This is the headline test of the whole mode. Mercury's perihelion advance under the pull of
 * the other planets is the oldest quantitative result in solar-system dynamics: Le Verrier
 * computed it in 1859, found the observed advance larger than the planets could explain, and
 * the gap stood open until general relativity closed it. A mutual-gravity integrator that
 * cannot reproduce the Newtonian part of that number is not simulating gravity.
 *
 * `relativity.ts` supplies the other 43 arcsec/century. The two are independent: this function
 * integrates Newtonian gravity only, so the number it returns is the planetary contribution
 * alone and the two terms add.
 *
 * Both longitude conventions are returned, because they differ and the difference is not noise.
 * See `elements.ts` on why varpi is the one to quote.
 */

const ARCSEC_PER_RADIAN = 648_000 / Math.PI;
const SECONDS_PER_JULIAN_CENTURY = DAYS_PER_JULIAN_CENTURY * SECONDS_PER_DAY;

/** Accumulates a least-squares slope without holding the samples. */
class SlopeFit {
  private n = 0;
  private sumT = 0;
  private sumY = 0;
  private sumTT = 0;
  private sumTY = 0;

  add(t: number, y: number): void {
    this.n += 1;
    this.sumT += t;
    this.sumY += y;
    this.sumTT += t * t;
    this.sumTY += t * y;
  }

  get slope(): number {
    const denominator = this.n * this.sumTT - this.sumT * this.sumT;
    if (denominator === 0) throw new Error("slope needs at least two distinct sample times");
    return (this.n * this.sumTY - this.sumT * this.sumY) / denominator;
  }

  get samples(): number {
    return this.n;
  }
}

/** Tracks an angle across branch cuts so a secular trend can be fitted through it. */
class Unwrapped {
  private previous: number;
  private total: number;

  constructor(initial: number) {
    this.previous = initial;
    this.total = initial;
  }

  push(angle: number): number {
    let delta = angle - this.previous;
    while (delta > Math.PI) delta -= 2 * Math.PI;
    while (delta < -Math.PI) delta += 2 * Math.PI;
    this.total += delta;
    this.previous = angle;
    return this.total;
  }

  get value(): number {
    return this.total;
  }
}

export interface PrecessionOptions {
  readonly body: string;
  readonly epoch: JdTdb;
  readonly spanYears: number;
  readonly planets?: readonly PlanetId[];
  readonly extra?: readonly MassiveBody[];
  /** Sampling interval. The fitted rate is insensitive to it; see nbody.test.ts. */
  readonly sampleYears?: number;
  readonly limits?: NBodyLimits;
}

export interface PrecessionResult {
  /** Secular rate of varpi = Omega + omega. The classical quantity. */
  readonly pericentreArcsecPerCentury: number;
  /** Secular rate of the eccentricity vector's ecliptic longitude. Differs when inclined. */
  readonly projectedArcsecPerCentury: number;
  readonly nodeArcsecPerCentury: number;
  readonly samples: number;
  /** Relative energy drift over the run. The integration's own error bar. */
  readonly energyDrift: number;
}

export function apsidalPrecession(options: PrecessionOptions): PrecessionResult {
  const limits = options.limits ?? DEFAULT_NBODY_LIMITS;
  const system = solarSystemAt(options.epoch, options.extra ?? [], options.planets);
  const index = system.ids.indexOf(options.body);
  if (index < 0) throw new Error(`${options.body} is not in this system`);
  const gm = GM_SUN + system.gm[index];
  const startEnergy = totalEnergy(system);

  const read = (): OsculatingElements =>
    osculatingElements(
      gm,
      sub(positionOf(system, options.body), positionOf(system, "sun")),
      sub(velocityOf(system, options.body), velocityOf(system, "sun")),
    );

  const first = read();
  const pericentre = new Unwrapped(first.longitudeOfPericentreRad);
  const projected = new Unwrapped(first.projectedPericentreLongitudeRad);
  const node = new Unwrapped(first.longitudeOfAscendingNodeRad);
  const fits = { pericentre: new SlopeFit(), projected: new SlopeFit(), node: new SlopeFit() };
  fits.pericentre.add(0, pericentre.value);
  fits.projected.add(0, projected.value);
  fits.node.add(0, node.value);

  const sampleYears = options.sampleYears ?? 0.05;
  const steps = Math.floor(options.spanYears / sampleYears);
  if (steps < 2) throw new Error("the span must cover at least two samples");

  for (let i = 1; i <= steps; i++) {
    advance(system, sampleYears * SECONDS_PER_JULIAN_YEAR, limits);
    const now = read();
    const t = i * sampleYears;
    fits.pericentre.add(t, pericentre.push(now.longitudeOfPericentreRad));
    fits.projected.add(t, projected.push(now.projectedPericentreLongitudeRad));
    fits.node.add(t, node.push(now.longitudeOfAscendingNodeRad));
  }

  const toArcsecPerCentury = (radPerYear: number) => radPerYear * ARCSEC_PER_RADIAN * 100;
  return {
    pericentreArcsecPerCentury: toArcsecPerCentury(fits.pericentre.slope),
    projectedArcsecPerCentury: toArcsecPerCentury(fits.projected.slope),
    nodeArcsecPerCentury: toArcsecPerCentury(fits.node.slope),
    samples: fits.pericentre.samples,
    energyDrift: Math.abs((totalEnergy(system) - startEnergy) / startEnergy),
  };
}

/** Radians per second to arcsec per Julian century, for comparing against `secular.ts`. */
export const radPerSecondToArcsecPerCentury = (rate: number): number =>
  rate * ARCSEC_PER_RADIAN * SECONDS_PER_JULIAN_CENTURY;
