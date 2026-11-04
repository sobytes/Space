/**
 * Asteroid scenarios: set one moving and find out where it ends up.
 *
 * Pure, like the rest of the engine, so the same function runs in a Web Worker, in a Node route
 * handler for the AI tools, and in the gates. The force model is assembled from the body
 * registry, so an asteroid feels every planet the simulation knows about plus the Sun.
 *
 * The honest limit, stated here rather than buried. The perturbing planets come from the
 * Standish element tables, whose own error reaches roughly 20 arcseconds for Earth. At one
 * astronomical unit that is about 14,000 km of uncertainty in Earth's position, which is larger
 * than many interesting close-approach distances. So this answers "does it hit, escape, or stay"
 * with confidence, and it does not claim to predict a flyby distance to the kilometre. Saying
 * otherwise would be the kind of overclaim that makes the whole thing worthless.
 */

import { BODY_CONTRACTS, BODY_IDS, type BodyId } from "../bodies/registry";
import { heliocentricPositionOf, heliocentricStateOf } from "../bodies/position";
import { J2000_JD, jdTdb, type JdTdb } from "../time";
import { AU_IN_METRES, GM_SUN } from "../units";
import { impactConsequences, type ImpactConsequences } from "./impact";
import { add, cross, dot, length, normalize, scale, sub, type Vec3 } from "../vec";
import {
  DEFAULT_LIMITS,
  eccentricityOf,
  propagate,
  sampleIntervalFor,
  type Fate,
  type ForceModel,
  type Perturber,
  type PropagationResult,
} from "../propagate";

const SECONDS_PER_DAY = 86_400;

/** Earth's atmosphere is where an impactor actually begins to matter, not the solid surface. */
const ENTRY_INTERFACE_M = 100_000;

export interface AsteroidLaunch {
  /** Where the body starts, as an offset from this body's centre. */
  readonly originBody: BodyId;
  /** Distance above the origin body's surface at release, metres. */
  readonly altitudeM: number;
  /** Speed relative to the origin body, m/s. */
  readonly speedMS: number;
  /** Direction in the ecliptic plane, degrees. Zero points along the body's orbital motion. */
  readonly headingDeg: number;
  /** Out-of-plane angle, degrees. */
  readonly inclinationDeg: number;
  readonly startEpoch: JdTdb;
  readonly durationYears: number;
  /** Diameter, metres. Used only for the impact energy estimate. */
  readonly diameterM: number;
  /** Bulk density, kg/m^3. 3000 is typical for a stony asteroid. */
  readonly densityKgM3: number;
}

export const DEFAULT_LAUNCH: AsteroidLaunch = {
  originBody: "mars",
  altitudeM: 5e9,
  speedMS: 6_000,
  headingDeg: 180,
  inclinationDeg: 0,
  startEpoch: jdTdb(J2000_JD),
  durationYears: 50,
  diameterM: 300,
  densityKgM3: 3_000,
};

/**
 * Builds the perturber set from the body registry. Each planet's position is a pure function of
 * time, which is what lets the integrator take an enormous step without a propagator's own
 * state going stale.
 */
export function perturbersFrom(startEpoch: JdTdb, include: readonly BodyId[] = BODY_IDS): Perturber[] {
  return include
    .filter((id) => id !== "sun")
    .map((id) => {
      const contract = BODY_CONTRACTS[id];
      return {
        id,
        gm: contract.gm,
        // Atmospheric entry counts as arrival, so Earth's capture radius includes it.
        radiusM: contract.equatorialRadiusM + (id === "embary" ? ENTRY_INTERFACE_M : 0),
        positionAt: (seconds: number) =>
          heliocentricPositionOf(id, jdTdb(startEpoch + seconds / SECONDS_PER_DAY)),
      } satisfies Perturber;
    });
}

export function asteroidForceModel(startEpoch: JdTdb): ForceModel {
  return { centralGm: GM_SUN, perturbers: perturbersFrom(startEpoch), relativistic: false };
}

/** Turns the launch controls into a heliocentric state vector. */
/**
 * The frame the release controls are expressed in.
 *
 * Along-track, outward and normal, built from the origin body's own motion, which is what
 * makes a heading of zero mean "keep pace with the planet". Exported because inverting it is
 * how a solved intercept is turned back into slider positions, and writing that inverse
 * against a guessed basis is how aiming silently failed: the asteroid was given a perfectly
 * correct speed in an entirely wrong direction and sat next to Mars for two years.
 */
export interface ReleaseFrame {
  readonly origin: Vec3;
  readonly carrierVelocity: Vec3;
  readonly alongTrack: Vec3;
  readonly outward: Vec3;
  readonly normal: Vec3;
}

export function releaseFrame(originBody: BodyId, startEpoch: JdTdb): ReleaseFrame {
  const origin = heliocentricPositionOf(originBody, startEpoch);

  // The body's own motion, from a short central difference of its position. Using the real
  // velocity rather than zero is what makes "drop it near Mars" behave like Mars.
  const dt = 60;
  const ahead = heliocentricPositionOf(originBody, jdTdb(startEpoch + dt / SECONDS_PER_DAY));
  const behind = heliocentricPositionOf(originBody, jdTdb(startEpoch - dt / SECONDS_PER_DAY));
  const carrierVelocity = scale(sub(ahead, behind), 1 / (2 * dt));

  /**
   * Orthonormalised, which it was not before.
   *
   * `outward` is the direction away from the Sun and `alongTrack` is the direction of motion,
   * and those are only perpendicular for a circular orbit. Mars's eccentricity of 0.093 tilts
   * them about five degrees apart, so the three "axes" the heading and climb controls were
   * measured against were not axes at all. The forward direction still came out a unit
   * vector, because it was normalised afterwards, which is why nothing looked wrong: the
   * controls simply did not mean quite what they said, and the map could not be inverted.
   * Solving an intercept and feeding the angles back reproduced the velocity to within 230
   * m/s, and the asteroid left at the right speed in the wrong direction.
   *
   * Gram-Schmidt against the direction of motion fixes both. Along-track is kept exactly,
   * because keeping pace with the planet is the one case that has to stay true.
   */
  const alongTrack = normalize(carrierVelocity);
  const radial = normalize(origin);
  const alongComponent = dot(radial, alongTrack);
  const outward = normalize(sub(radial, scale(alongTrack, alongComponent)));
  return { origin, carrierVelocity, alongTrack, outward, normal: normalize(cross(outward, alongTrack)) };
}

/**
 * Turn a required heliocentric velocity into the speed, heading and climb the controls take.
 *
 * The exact inverse of the direction built in `initialStateFor`, using the same frame object
 * so the two cannot drift apart. `asteroid.test.ts` round-trips it.
 */
export function releaseAnglesFor(
  frame: ReleaseFrame,
  requiredVelocity: Vec3,
): { speedMS: number; headingDeg: number; inclinationDeg: number } {
  const relative = sub(requiredVelocity, frame.carrierVelocity);
  const speedMS = length(relative);
  if (speedMS === 0) return { speedMS: 0, headingDeg: 0, inclinationDeg: 0 };

  const unit = scale(relative, 1 / speedMS);
  const climb = Math.asin(Math.max(-1, Math.min(1, dot(unit, frame.normal))));
  const heading = Math.atan2(dot(unit, frame.outward), dot(unit, frame.alongTrack));
  return {
    speedMS,
    headingDeg: ((heading * 180) / Math.PI + 360) % 360,
    inclinationDeg: (climb * 180) / Math.PI,
  };
}

export function initialStateFor(launch: AsteroidLaunch): { position: Vec3; velocity: Vec3 } {
  const { origin, carrierVelocity, alongTrack, outward, normal } =
    releaseFrame(launch.originBody, launch.startEpoch);

  const heading = (launch.headingDeg * Math.PI) / 180;
  const climb = (launch.inclinationDeg * Math.PI) / 180;

  const direction = normalize(
    add(
      add(
        scale(alongTrack, Math.cos(heading) * Math.cos(climb)),
        scale(outward, Math.sin(heading) * Math.cos(climb)),
      ),
      scale(normal, Math.sin(climb)),
    ),
  );

  const releaseRadius = BODY_CONTRACTS[launch.originBody].equatorialRadiusM + launch.altitudeM;

  // Released on the sunward-outward side, using the true radial rather than the
  // orthonormalised one: where the object starts is a position, not a direction in the
  // control frame, and it should be genuinely radial.
  const radial = normalize(origin);
  return {
    position: add(origin, scale(radial, releaseRadius)),
    velocity: add(carrierVelocity, scale(direction, launch.speedMS)),
  };
}

export interface ImpactEstimate {
  readonly massKg: number;
  readonly speedMS: number;
  readonly energyJoules: number;
  readonly energyMegatonsTnt: number;
  readonly comparison: string;
}

/** One tonne of TNT, joules, by the standard definition. */
const JOULES_PER_TONNE_TNT = 4.184e9;

/**
 * Kinetic energy at arrival, converted to the unit the literature uses.
 *
 * This is the energy delivered to the top of the atmosphere, not the energy that reaches the
 * ground. A stony body a few tens of metres across loses most of it to airburst. Crater
 * scaling is a separate model and this is deliberately not pretending to be one.
 */
export function impactEnergy(
  diameterM: number,
  densityKgM3: number,
  speedMS: number,
): ImpactEstimate {
  const radius = diameterM / 2;
  const massKg = ((4 / 3) * Math.PI * radius ** 3) * densityKgM3;
  const energyJoules = 0.5 * massKg * speedMS ** 2;
  const megatons = energyJoules / (JOULES_PER_TONNE_TNT * 1e6);

  const comparison =
    megatons < 0.02
      ? "below the Chelyabinsk airburst of 2013, about 0.5 Mt"
      : megatons < 5
        ? "the scale of the 1908 Tunguska airburst, usually put at 3 to 15 Mt"
        : megatons < 1e5
          ? "larger than any weapon ever detonated, the 50 Mt Tsar Bomba"
          : "the scale of the Chicxulub impact, around 100 million Mt";

  return { massKg, speedMS, energyJoules, energyMegatonsTnt: megatons, comparison };
}

export interface AsteroidOutcome {
  readonly result: PropagationResult;
  readonly summary: string;
  readonly impact: ImpactEstimate | null;
  /**
   * What the impact actually does where it lands: airburst or crater, how wide, how far the
   * blast reaches.
   *
   * The energy alone was the whole answer before, and energy is the least interesting part.
   * The same rock is a crater on the Moon and an airburst on Earth, and megatons cannot tell
   * you which.
   */
  readonly consequences: ImpactConsequences | null;
  readonly finalEccentricity: number;
  readonly finalSemiMajorAxisAu: number | null;
}

function describeFate(fate: Fate, launch: AsteroidLaunch): string {
  switch (fate.kind) {
    case "impact": {
      const years = fate.atSeconds / (SECONDS_PER_DAY * 365.25);
      return `Struck ${BODY_CONTRACTS[fate.body as BodyId]?.displayName ?? fate.body} after ${years.toFixed(2)} years.`;
    }
    case "escaped": {
      const years = fate.atSeconds / (SECONDS_PER_DAY * 365.25);
      return `Thrown onto an unbound orbit, eccentricity ${fate.eccentricity.toFixed(3)}, leaving the solar system after ${years.toFixed(1)} years.`;
    }
    case "step-limit":
      return "Hit the integrator's step budget before the run finished. Shorten the duration or loosen the tolerance.";
    case "propagating":
      return `Still in orbit after ${launch.durationYears} years.`;
  }
}

export function runAsteroid(launch: AsteroidLaunch): AsteroidOutcome {
  const initial = initialStateFor(launch);
  const model = asteroidForceModel(launch.startEpoch);
  const durationSeconds = launch.durationYears * 365.25 * SECONDS_PER_DAY;

  const result = propagate({
    model,
    initial,
    durationSeconds,
    limits: { ...DEFAULT_LIMITS, tolerance: 1e-10, maxSteps: 400_000 },
    sampleIntervalSeconds: sampleIntervalFor(GM_SUN, initial, durationSeconds),
    closeApproachThresholdM: 0.2 * AU_IN_METRES,
  });

  const final = result.samples[result.samples.length - 1];
  const eccentricity = eccentricityOf(GM_SUN, final.position, final.velocity);
  const r = length(final.position);
  const energy = length(final.velocity) ** 2 / 2 - GM_SUN / r;
  const semiMajorAxis = energy < 0 ? -GM_SUN / (2 * energy) : null;

  /**
   * Impact speed is relative to the body that was hit, not to the Sun.
   *
   * This used the heliocentric speed, which for anything striking Earth is wrong by up to a
   * factor of two in either direction: Earth is itself travelling at 30 km/s, so a rock
   * overtaking it from behind arrives gently and one meeting it head-on arrives at 60. Energy
   * goes as the square of that, so the error reached a factor of four in the headline number.
   */
  const struck =
    result.fate.kind === "impact"
      ? (() => {
          const at = jdTdb(launch.startEpoch + result.fate.atSeconds / SECONDS_PER_DAY);
          const body = heliocentricStateOf(result.fate.body as BodyId, at);
          return length(sub(final.velocity, body.velocity));
        })()
      : null;

  return {
    result,
    summary: describeFate(result.fate, launch),
    impact:
      struck === null ? null : impactEnergy(launch.diameterM, launch.densityKgM3, struck),
    consequences:
      struck === null || result.fate.kind !== "impact"
        ? null
        : impactConsequences({
            target: result.fate.body as BodyId,
            diameterM: launch.diameterM,
            densityKgM3: launch.densityKgM3,
            speedMS: struck,
            // The most probable angle for a randomly arriving body, and the one Collins et
            // al. use when nothing better is known.
            angleDeg: 45,
          }),
    finalEccentricity: eccentricity,
    finalSemiMajorAxisAu: semiMajorAxis === null ? null : semiMajorAxis / AU_IN_METRES,
  };
}
