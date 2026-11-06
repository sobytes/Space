/**
 * How long a day, a month and a year are here, and how they compare to the ones you know.
 *
 * Asked for after the orbit marks turned out to answer the wrong question: the point was not
 * "where will it be in nine days" but for a child to be able to see how the spin of a body and
 * its orbit relate to each other, and to Earth's.
 *
 * Everything here is derived rather than listed. The only inputs are the sidereal rotation
 * period, which is a measured constant on the contract, and the orbital periods, which come
 * from the same element tables that position the body. One formula does most of the work:
 *
 *     1 / solar day = 1 / sidereal spin - 1 / orbit about the Sun
 *
 * A spin is measured against the stars; a day is measured against the Sun. The difference is
 * that the body has also moved along its orbit and has to turn slightly further to bring the
 * Sun back overhead. That is the whole of why Earth's day is 24 hours while its spin is 23h
 * 56m, and the four minutes are not a rounding error: they accumulate to exactly one extra
 * spin per year, which is why a year holds 366.26 spins and 365.26 days.
 *
 * The same formula, unchanged, produces the three facts most worth showing a child. Venus
 * spins backwards, so its day is 117 Earth days while its year is 225, and a Venus year is
 * under two Venus days long. The Moon is locked to Earth, so its spin equals its orbit and the
 * formula hands back 29.5 days, which is the synodic month: a fortnight of daylight and then a
 * fortnight of night. And Jupiter turns in under ten hours, so its year holds about 10,500
 * days despite lasting twelve of ours.
 */

import { BODY_CONTRACTS, type BodyId } from "./bodies/registry";
import { SHORT_SPAN } from "./data/planets";
import { DAYS_PER_JULIAN_YEAR, DAYS_PER_JULIAN_CENTURY } from "./units";

/** The planet whose heliocentric orbit this body shares. A moon rides its planet's. */
function planetAncestor(id: BodyId): BodyId | null {
  let current: BodyId | null = id;
  while (current !== null) {
    const next: BodyId = current;
    if (BODY_CONTRACTS[next].ephemeris.kind === "standish-elements") return next;
    current = BODY_CONTRACTS[next].parent;
  }
  return null;
}

/**
 * How long this body takes to go once round the Sun, in days.
 *
 * A moon returns its planet's. That is not an approximation made for convenience: the Moon
 * does orbit the Sun, once a year, with a path that is always concave towards it. Its monthly
 * trip around Earth is a wobble on that.
 */
export function heliocentricPeriodDays(id: BodyId): number {
  const planet = planetAncestor(id);
  if (!planet) return DAYS_PER_JULIAN_YEAR;
  const contract = BODY_CONTRACTS[planet];
  if (contract.ephemeris.kind !== "standish-elements") return DAYS_PER_JULIAN_YEAR;
  const rate = SHORT_SPAN.elements[contract.ephemeris.planet].ratePerCentury.meanLongitudeDeg;
  return (360 / rate) * DAYS_PER_JULIAN_CENTURY;
}

/**
 * Sunrise to sunrise, from the spin against the stars and the trip around the Sun.
 *
 * Signed input, because a retrograde spin is a negative sidereal period and the subtraction
 * handles it without a special case: Venus comes out at -116.75, whose magnitude is the right
 * answer and whose sign says the Sun rises in the west.
 *
 * The singular case is real rather than defensive. A body whose spin period equals its year,
 * locked to the Sun as Mercury nearly is, never brings the Sun back overhead at all: one side
 * faces it forever. The arithmetic says infinity and that is the correct answer.
 */
export function solarDayDays(siderealDays: number, heliocentricDays: number): number {
  const inverse = 1 / siderealDays - 1 / heliocentricDays;
  return inverse === 0 ? Infinity : 1 / inverse;
}

export interface TimeSense {
  readonly id: BodyId;
  /** One turn against the stars, days. Negative means it turns backwards. */
  readonly siderealSpinDays: number;
  /** Sunrise to sunrise, days. Negative means the Sun rises in the west. */
  readonly solarDayDays: number;
  /** Once round the Sun, days. A moon shares its planet's. */
  readonly yearDays: number;
  /** Its own days in its own year. Earth's 365.26 is this number, not a definition. */
  readonly solarDaysPerYear: number;
  /** Spins against the stars in one year. Always exactly one more than the days, prograde. */
  readonly spinsPerYear: number;
  readonly spinsBackwards: boolean;
  /** Spin and orbit equal, so one face is held towards whatever it orbits. */
  readonly tidallyLocked: boolean;
  /** For a moon: once round its planet against the stars, days. Null for a planet. */
  readonly monthDays: number | null;
  /** For a moon: full phase to full phase as seen from its planet, days. */
  readonly synodicMonthDays: number | null;
  /**
   * Trips round its planet against the stars, per Earth year. 13.37 for the Moon.
   *
   * One more than the phase cycles below, for exactly the reason a year holds one more spin
   * than it holds days: the same lap that gets lost to going round the Sun.
   */
  readonly orbitsPerEarthYear: number | null;
  /**
   * Full moon to full moon, per Earth year. 12.37, which is the number people actually count,
   * and the reason a calendar with twelve months drifts against the sky.
   */
  readonly phaseCyclesPerEarthYear: number | null;
  /** Its day measured in Earth days, which is the comparison a person actually has. */
  readonly dayInEarthDays: number;
  readonly yearInEarthYears: number;
}

/**
 * Full phase to full phase, which is longer than one trip round the planet.
 *
 * The Moon returns to the same place against the stars in 27.32 days, and is not full again
 * until 29.53, because in that time the Earth has carried it about 27 degrees further round
 * the Sun and it has to catch up. The same beat frequency as the solar day, one rung up.
 */
function synodicDays(orbitDays: number, heliocentricDays: number): number {
  const inverse = 1 / orbitDays - 1 / heliocentricDays;
  return inverse === 0 ? Infinity : 1 / inverse;
}

/** Within this fraction, a spin and an orbit are called equal. */
const LOCK_TOLERANCE = 0.02;

/**
 * Earth's own orbital period, which is what "an Earth year" is compared against here.
 *
 * Not the Julian year of 365.25 days. That is a unit of time defined for convenience and is
 * 0.006 days short of Earth's actual trip, and mixing the two breaks the identity that
 * orbits per year minus phase cycles per year is exactly one. Using the real orbit makes it
 * exact, which is the point of stating it.
 */
function earthYearDays(): number {
  return heliocentricPeriodDays("embary");
}

export function timeSense(id: BodyId): TimeSense {
  const contract = BODY_CONTRACTS[id];
  const siderealSpinDays = contract.siderealRotationDays;
  const yearDays = heliocentricPeriodDays(id);
  const solarDay = solarDayDays(siderealSpinDays, yearDays);

  const monthDays =
    contract.ephemeris.kind === "mean-elements-about-parent"
      ? contract.ephemeris.periodDays
      : null;

  // Locked to whatever it goes round: its planet for a moon, the Sun for a planet.
  const against = monthDays ?? yearDays;
  const tidallyLocked =
    Math.abs(Math.abs(siderealSpinDays) - against) / against < LOCK_TOLERANCE;

  return {
    id,
    siderealSpinDays,
    solarDayDays: solarDay,
    yearDays,
    solarDaysPerYear: Number.isFinite(solarDay) ? yearDays / Math.abs(solarDay) : 0,
    spinsPerYear: yearDays / Math.abs(siderealSpinDays),
    spinsBackwards: siderealSpinDays < 0,
    tidallyLocked,
    monthDays,
    synodicMonthDays: monthDays === null ? null : synodicDays(monthDays, yearDays),
    orbitsPerEarthYear: monthDays === null ? null : earthYearDays() / monthDays,
    phaseCyclesPerEarthYear:
      monthDays === null ? null : earthYearDays() / synodicDays(monthDays, yearDays),
    dayInEarthDays: Math.abs(solarDay),
    yearInEarthYears: yearDays / earthYearDays(),
  };
}

/** Hours below two days, then days, then years. Whatever a person would actually say. */
export function formatDuration(days: number): string {
  const magnitude = Math.abs(days);
  if (magnitude < 2) {
    const hours = magnitude * 24;
    const whole = Math.floor(hours);
    const minutes = Math.round((hours - whole) * 60);
    // 23h 60m is not a thing anyone writes.
    return minutes === 60 ? `${whole + 1}h 00m` : `${whole}h ${String(minutes).padStart(2, "0")}m`;
  }
  if (magnitude < 700) return `${magnitude.toFixed(1)} Earth days`;
  return `${(magnitude / heliocentricPeriodDays("embary")).toFixed(1)} Earth years`;
}

/**
 * The single most surprising true thing about time on this body, in one paragraph.
 *
 * Shared rather than written twice, and gated as an exact string, because this is the part a
 * child actually reads and two clients telling them different things about the same planet is
 * worse than either telling them nothing. Every number in it is computed above; none is
 * written into the sentence.
 *
 * The branches are not stylistic. Each one is a genuinely different relationship between spin
 * and orbit, and picking the wrong sentence for a body would state something false: a locked
 * moon has no separate day and month to compare, a retrograde body's Sun rises in the west,
 * and a body whose day exceeds its year has to be described the other way up.
 */
export function timeHeadline(id: BodyId): string {
  const t = timeSense(id);
  const day = formatDuration(t.dayInEarthDays);

  if (t.id === "sun") {
    return `The Sun turns once every ${formatDuration(Math.abs(t.siderealSpinDays))}, but not `
      + "as one piece: it is a ball of gas, so its equator laps its poles. Nothing here has a "
      + "day, because there is no sunrise to count from.";
  }

  if (t.tidallyLocked && t.monthDays !== null) {
    const parent = BODY_CONTRACTS[BODY_CONTRACTS[t.id].parent ?? "embary"].displayName;
    return `Locked to ${parent}: it turns exactly once each time it goes round, so the same `
      + `face is always pointed at ${parent} and the other side was never seen until a `
      + `spacecraft went to look. One day here lasts ${day}, which is about half that in `
      + "sunlight and then the same again in darkness.";
  }

  if (t.solarDaysPerYear < 1) {
    return `A day here is longer than a year. One sunrise to the next takes ${day}, while a `
      + `full trip round the Sun takes only ${formatDuration(t.yearDays)}, so it goes round `
      + `the Sun ${(1 / t.solarDaysPerYear).toFixed(1)} times between one sunrise and the next.`;
  }

  if (t.spinsBackwards) {
    return `It spins backwards, so the Sun rises in the west. A day here lasts ${day} and a `
      + `year ${formatDuration(t.yearDays)}, which means the whole year is only `
      + `${t.solarDaysPerYear.toFixed(1)} of its own days long.`;
  }

  if (t.solarDaysPerYear > 1000) {
    return `It turns in ${day}, faster than any rocky planet, so even though a year here `
      + `lasts ${formatDuration(t.yearDays)} it holds about `
      + `${Math.round(t.solarDaysPerYear).toLocaleString()} of its own days.`;
  }

  /**
   * The default, and the one that explains where a day comes from at all.
   *
   * A spin is measured against the stars and a day against the Sun. They differ because the
   * body moves along its orbit while it turns, and the shortfall adds up to exactly one extra
   * spin per year. That is why the two numbers below always differ by one.
   */
  return `A day here is ${day}, but one full spin takes `
    + `${formatDuration(Math.abs(t.siderealSpinDays))}. The difference is that it also moves `
    + "along its orbit while it turns, so it has to turn a little further to bring the Sun "
    + `back round. Those slivers add up: a year holds ${t.solarDaysPerYear.toFixed(2)} days `
    + `but ${t.spinsPerYear.toFixed(2)} spins, exactly one more.`;
}
