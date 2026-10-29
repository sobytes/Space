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
import { heliocentricPositionOf } from "../bodies/position";
import { J2000_JD, jdTdb, type JdTdb } from "../time";
import { AU_IN_METRES, GM_SUN } from "../units";
import { add, cross, length, normalize, scale, sub, type Vec3 } from "../vec";
import {
  DEFAULT_LIMITS,
  eccentricityOf,
  propagate,
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
export function initialStateFor(launch: AsteroidLaunch): { position: Vec3; velocity: Vec3 } {
  const origin = heliocentricPositionOf(launch.originBody, launch.startEpoch);

  // The origin body's own motion, from a short central difference of its position. Using the
  // body's real velocity rather than zero is what makes "drop it near Mars" behave like Mars.
  const dt = 60;
  const ahead = heliocentricPositionOf(
    launch.originBody,
    jdTdb(launch.startEpoch + dt / SECONDS_PER_DAY),
  );
  const behind = heliocentricPositionOf(
    launch.originBody,
    jdTdb(launch.startEpoch - dt / SECONDS_PER_DAY),
  );
  const carrierVelocity = scale(sub(ahead, behind), 1 / (2 * dt));

  const alongTrack = normalize(carrierVelocity);
  const outward = normalize(origin);
  const normal = normalize(cross(outward, alongTrack));

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

  return {
    position: add(origin, scale(outward, releaseRadius)),
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
    sampleIntervalSeconds: durationSeconds / 2_000,
    closeApproachThresholdM: 0.2 * AU_IN_METRES,
  });

  const final = result.samples[result.samples.length - 1];
  const eccentricity = eccentricityOf(GM_SUN, final.position, final.velocity);
  const r = length(final.position);
  const energy = length(final.velocity) ** 2 / 2 - GM_SUN / r;
  const semiMajorAxis = energy < 0 ? -GM_SUN / (2 * energy) : null;

  return {
    result,
    summary: describeFate(result.fate, launch),
    impact:
      result.fate.kind === "impact"
        ? impactEnergy(launch.diameterM, launch.densityKgM3, length(final.velocity))
        : null,
    finalEccentricity: eccentricity,
    finalSemiMajorAxisAu: semiMajorAxis === null ? null : semiMajorAxis / AU_IN_METRES,
  };
}
