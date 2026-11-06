/**
 * The Sun's whole life, and what it does to everything orbiting it.
 *
 * The rest of this engine runs on element tables fitted for a few thousand years either side
 * of now, because that is the span over which a planet's position means anything. This module
 * is the other scale entirely: it asks what happens over billions of years, where positions
 * stop mattering and the star itself is the thing that changes.
 *
 * The headline is counter-intuitive and worth having. The Sun is not a fixed lamp. It was
 * about 70 per cent as bright when Earth formed and it has brightened steadily ever since, so
 * the habitable zone has been sweeping outwards across the solar system for four and a half
 * billion years and has not stopped. Earth's remaining time as a water world is set by that
 * drift and runs out long before the Sun becomes a red giant: roughly a billion years, against
 * five until the main sequence ends.
 *
 * Three regimes, modelled with decreasing confidence and labelled as such.
 *
 * On the main sequence the luminosity comes from Gough's standard relation, which is a closed
 * form good across the whole main sequence and reproduces the faint young Sun at formation.
 *
 * On the red giant branch there is no closed form worth writing, so this interpolates between
 * published waypoints from Schröder and Connon Smith's model and says so. An interpolation
 * between two real points is a weaker claim than a model and a much stronger one than a guess.
 *
 * After the helium flash the Sun burns helium, pulses on the asymptotic branch and throws off
 * its envelope, and this does not attempt any of it. It reports the end state, a white dwarf
 * of a little over half the Sun's mass, and skips the detail rather than inventing it.
 */

import { BODY_CONTRACTS, type BodyId } from "./bodies/registry";
import { HABITABLE_ZONE_AU, heliocentricDistanceM } from "./habitability";
import { AU_IN_METRES } from "./units";

/**
 * The Sun's present age, in billions of years.
 *
 * From the standard solar model, which fits helioseismology and the neutrino flux rather than
 * meteorite dating, and lands on the same number: Bahcall, Pinsonneault and Basu 2001.
 */
export const SOLAR_AGE_NOW_GYR = 4.57;

/** Where the main sequence ends and this module stops modelling and starts interpolating. */
export const MAIN_SEQUENCE_END_GYR = 10.0;

/** The tip of the red giant branch, from Schröder 2008. */
export const RED_GIANT_TIP_GYR = 12.167;

export type SolarPhase =
  | "main-sequence"
  | "subgiant"
  | "red-giant"
  | "helium-burning"
  | "white-dwarf";

export interface SolarState {
  readonly ageGyr: number;
  /** Negative in the past. The number a person actually wants to read. */
  readonly fromNowGyr: number;
  readonly phase: SolarPhase;
  /** Luminosity as a multiple of today's. */
  readonly luminosity: number;
  /** Radius as a multiple of today's. */
  readonly radius: number;
  /** Mass as a fraction of today's. Only the giant phases lose any. */
  readonly mass: number;
  readonly effectiveTemperatureK: number;
  /** How much of this is modelled and how much interpolated. */
  readonly confidence: "modelled" | "interpolated" | "end state";
}

/** Today's effective temperature, K. */
const SOLAR_TEFF_NOW_K = 5772;

/**
 * Luminosity on the main sequence, relative to today.
 *
 *     L(t) / L_now = 1 / (1 + (2/5)(1 - t / t_now))
 *
 * Gough 1981. The whole of the faint young Sun problem is in this one line: at t = 0 it gives
 * 1/1.4, so the Sun shone at 71 per cent of today's output when Earth formed, which is not
 * enough to keep liquid water on a planet with today's atmosphere. Earth had liquid water
 * anyway, and reconciling those two facts is still an open problem in atmospheric science.
 */
export function mainSequenceLuminosity(ageGyr: number): number {
  return 1 / (1 + 0.4 * (1 - ageGyr / SOLAR_AGE_NOW_GYR));
}

/**
 * Published waypoints past the main sequence, interpolated between rather than modelled.
 *
 * Schröder 2008, by Schröder and Connon Smith, which is the paper this part of the subject is
 * usually argued from. At the tip of the red giant branch the Sun reaches 2730 times today's
 * luminosity and 256 times its radius, having shed a third of its mass, and that expansion
 * reaches past Venus. Their result on Earth is the interesting one: the Sun's mass loss lifts
 * Earth's orbit outwards, and it is still not enough, because tidal drag on the bloated star
 * pulls the planet back in faster than the orbit expands.
 */
const WAYPOINTS: readonly { ageGyr: number; luminosity: number; radius: number; mass: number }[] = [
  { ageGyr: MAIN_SEQUENCE_END_GYR, luminosity: mainSequenceLuminosity(MAIN_SEQUENCE_END_GYR), radius: 1.38, mass: 1 },
  { ageGyr: 11.6, luminosity: 54, radius: 11, mass: 0.999 },
  { ageGyr: RED_GIANT_TIP_GYR, luminosity: 2730, radius: 256, mass: 0.668 },
];

function interpolate(ageGyr: number): { luminosity: number; radius: number; mass: number } {
  for (let i = 1; i < WAYPOINTS.length; i++) {
    const a = WAYPOINTS[i - 1];
    const b = WAYPOINTS[i];
    if (ageGyr <= b.ageGyr) {
      const t = (ageGyr - a.ageGyr) / (b.ageGyr - a.ageGyr);
      // Geometric in luminosity and radius, which span three orders of magnitude between
      // waypoints; a straight line in those would be a straight line through nothing.
      return {
        luminosity: a.luminosity * (b.luminosity / a.luminosity) ** t,
        radius: a.radius * (b.radius / a.radius) ** t,
        mass: a.mass + (b.mass - a.mass) * t,
      };
    }
  }
  const last = WAYPOINTS[WAYPOINTS.length - 1];
  return { luminosity: last.luminosity, radius: last.radius, mass: last.mass };
}

/**
 * What the Sun is doing at a given age.
 *
 * Radius on the main sequence comes from the luminosity at a roughly constant effective
 * temperature, which is the standard first-order statement and holds to about ten per cent
 * across the main sequence; the temperature then follows from the Stefan-Boltzmann law so the
 * three quantities stay consistent with each other rather than being listed independently.
 */
export function solarStateAt(ageGyr: number): SolarState {
  const fromNowGyr = ageGyr - SOLAR_AGE_NOW_GYR;

  if (ageGyr <= MAIN_SEQUENCE_END_GYR) {
    const luminosity = mainSequenceLuminosity(ageGyr);
    const radius = Math.sqrt(luminosity);
    return {
      ageGyr,
      fromNowGyr,
      phase: "main-sequence",
      luminosity,
      radius,
      mass: 1,
      // L = 4 pi R^2 sigma T^4, so holding R to sqrt(L) holds T fixed by construction.
      effectiveTemperatureK: SOLAR_TEFF_NOW_K * (luminosity / radius ** 2) ** 0.25,
      confidence: "modelled",
    };
  }

  if (ageGyr <= RED_GIANT_TIP_GYR) {
    const { luminosity, radius, mass } = interpolate(ageGyr);
    return {
      ageGyr,
      fromNowGyr,
      phase: ageGyr < 11.0 ? "subgiant" : "red-giant",
      luminosity,
      radius,
      mass,
      effectiveTemperatureK: SOLAR_TEFF_NOW_K * (luminosity / radius ** 2) ** 0.25,
      confidence: "interpolated",
    };
  }

  /**
   * After the tip, the end state and nothing in between.
   *
   * Helium burning, the asymptotic branch and the planetary nebula all happen here and none of
   * them is modelled. A white dwarf of 0.54 solar masses and roughly Earth's radius is where it
   * finishes, and that is reported as a destination rather than a trajectory.
   */
  return {
    ageGyr,
    fromNowGyr,
    phase: ageGyr < 12.4 ? "helium-burning" : "white-dwarf",
    luminosity: ageGyr < 12.4 ? 50 : 0.001,
    radius: ageGyr < 12.4 ? 10 : 0.0084,
    mass: 0.54,
    effectiveTemperatureK: ageGyr < 12.4 ? 4500 : 25_000,
    confidence: "end state",
  };
}

export interface HabitableZone {
  readonly innerAu: number;
  readonly outerAu: number;
  /** Where a water world goes into runaway greenhouse. Earth's deadline. */
  readonly runawayGreenhouseAu: number;
}

/**
 * Where the habitable zone sits at a given age.
 *
 * The edges are flux thresholds, so they scale with the square root of luminosity and nothing
 * else: a star four times brighter puts the same flux twice as far out. The constants are the
 * Kopparapu et al. 2013 limits the habitability panel already uses, so the zone drawn here and
 * the verdict printed there cannot drift apart.
 */
export function habitableZoneAt(ageGyr: number): HabitableZone {
  const scale = Math.sqrt(solarStateAt(ageGyr).luminosity);
  return {
    innerAu: HABITABLE_ZONE_AU.runawayGreenhouse * scale,
    outerAu: HABITABLE_ZONE_AU.maximumGreenhouse * scale,
    runawayGreenhouseAu: HABITABLE_ZONE_AU.runawayGreenhouse * scale,
  };
}

/** Whether a body is inside the zone at that age, by its present semi-major axis. */
export function insideHabitableZoneAt(body: BodyId, ageGyr: number): boolean {
  const au = heliocentricDistanceM(body) / AU_IN_METRES;
  const zone = habitableZoneAt(ageGyr);
  return au >= zone.innerAu && au <= zone.outerAu;
}

/**
 * What the inner edge of the habitable zone does to a body, and when.
 *
 * Three outcomes rather than a number and a null, because null was doing two jobs. Mercury is
 * already inside the edge and always has been; Mars is outside it and the Sun runs out of
 * main sequence before the edge gets there. Those are opposite facts and returning the same
 * nothing for both invites a caller to print the same sentence for Mercury and Mars.
 */
export type HabitableZoneCrossing =
  | { readonly kind: "already-inside" }
  | { readonly kind: "not-before-the-end"; readonly luminosityNeeded: number }
  | { readonly kind: "crosses"; readonly fromNowGyr: number; readonly ageGyr: number };

/**
 * Solved by inverting the luminosity relation rather than by searching, because it inverts
 * cleanly: the edge sits at `sqrt(L) * k`, so the luminosity that puts it at distance `d` is
 * `(d/k)^2`, and Gough's relation gives the age for that luminosity directly.
 */
export function runawayGreenhouseCrossing(body: BodyId): HabitableZoneCrossing {
  const au = heliocentricDistanceM(body) / AU_IN_METRES;
  const luminosityNeeded = (au / HABITABLE_ZONE_AU.runawayGreenhouse) ** 2;
  if (luminosityNeeded <= 1) return { kind: "already-inside" };

  // Invert L = 1 / (1 + 0.4(1 - t/t_now)) for t.
  const ageGyr = SOLAR_AGE_NOW_GYR * (1 - (1 / luminosityNeeded - 1) / 0.4);
  if (ageGyr > MAIN_SEQUENCE_END_GYR) return { kind: "not-before-the-end", luminosityNeeded };
  return { kind: "crosses", fromNowGyr: ageGyr - SOLAR_AGE_NOW_GYR, ageGyr };
}

/** Whether the Sun's photosphere reaches a body's present orbit at that age. */
export function engulfedAt(body: BodyId, ageGyr: number): boolean {
  const au = heliocentricDistanceM(body) / AU_IN_METRES;
  const solarRadiusAu = (BODY_CONTRACTS.sun.equatorialRadiusM * solarStateAt(ageGyr).radius)
    / AU_IN_METRES;
  return solarRadiusAu >= au;
}

export interface DeepTimeEvent {
  readonly ageGyr: number;
  readonly title: string;
  readonly detail: string;
  readonly source: string;
}

/**
 * The dated events worth marking, each with where the date comes from.
 *
 * Deliberately short. A timeline of thirteen billion years can carry a hundred captions and
 * say less than six, and every one of these is a number someone published rather than a round
 * figure that reads well.
 */
export const DEEP_TIME_EVENTS: readonly DeepTimeEvent[] = [
  {
    ageGyr: 0,
    title: "The Sun forms, at 71 per cent of today's brightness",
    detail:
      "Faint enough that Earth should have been frozen solid for its first two billion years. "
      + "It was not: there is liquid water in the rock record from 4.4 billion years ago. "
      + "Reconciling the two is the faint young Sun problem and it is still open.",
    source: "Gough 1981",
  },
  {
    ageGyr: SOLAR_AGE_NOW_GYR,
    title: "Now",
    detail: "The Sun has brightened by about 40 per cent since it formed and is still rising.",
    source: "Bahcall 2001",
  },
  {
    ageGyr: SOLAR_AGE_NOW_GYR + 1.0,
    title: "Earth leaves the habitable zone",
    detail:
      "The inner edge sweeps past 1 au and Earth goes into a moist greenhouse: water reaches "
      + "the stratosphere, is broken up by ultraviolet and the hydrogen escapes. The oceans "
      + "are lost long before the Sun becomes a giant, and nothing about the planet causes it.",
    source: "Caldeira 1992",
  },
  {
    ageGyr: MAIN_SEQUENCE_END_GYR,
    title: "The main sequence ends",
    detail:
      "Hydrogen in the core runs out after about ten billion years. The Sun leaves the main "
      + "sequence and starts to swell, and the modelling here stops and the interpolation "
      + "between published points begins.",
    source: "Schröder 2008",
  },
  {
    ageGyr: RED_GIANT_TIP_GYR,
    title: "The red giant tip: 256 times its radius, 2730 times its light",
    detail:
      "The photosphere reaches past Venus. Mercury and Venus are destroyed. Earth's orbit is "
      + "lifted outwards by the Sun's mass loss and that still does not save it: tidal drag on "
      + "the giant pulls the planet in faster than the orbit widens.",
    source: "Schröder 2008",
  },
  {
    ageGyr: 12.4,
    title: "A white dwarf, half a Sun in an Earth-sized sphere",
    detail:
      "The envelope is thrown off and what is left is the burnt-out core, about 0.54 solar "
      + "masses, cooling for the rest of time. Whatever is left of the outer planets orbits it "
      + "in the dark.",
    source: "Schröder 2008",
  },
];
