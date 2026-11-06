/**
 * Emits the cross-platform conformance suite from the engine.
 *
 * One set of cases, in JSON, that every client's test suite runs. The engine is the reference
 * implementation, so the cases are generated from it rather than typed, and a port that
 * disagrees with any of them is wrong by definition.
 *
 * This replaces the arrangement where each platform had its own tests and one of them wrote
 * an artifact the other checked. That caught drift in what it covered and nothing else: every
 * new function needed a bespoke snapshot, two runners, and a format agreed between them.
 * Here a domain is a list of cases, and adding a platform means writing one more runner.
 *
 * The cases are committed. They change only when the engine's answers change, which is
 * exactly when every port needs to be told.
 *
 * Run from the repository root:  node scripts/generate-conformance.mjs
 * Or:                            ./build.sh conformance
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const OUT = join(ROOT, "contracts/conformance");
mkdirSync(OUT, { recursive: true });

const units = await import(`${ROOT}engine/src/units.ts`);
const time = await import(`${ROOT}engine/src/time.ts`);
const kepler = await import(`${ROOT}engine/src/kepler.ts`);
const elements = await import(`${ROOT}engine/src/elements.ts`);
const rotation = await import(`${ROOT}engine/src/rotation.ts`);
const position = await import(`${ROOT}engine/src/bodies/position.ts`);
const registry = await import(`${ROOT}engine/src/bodies/registry.ts`);
const planets = await import(`${ROOT}engine/src/data/planets.ts`);
const relativity = await import(`${ROOT}engine/src/relativity.ts`);
const nbody = await import(`${ROOT}engine/src/nbody.ts`);
const secular = await import(`${ROOT}engine/src/secular.ts`);
const propagate = await import(`${ROOT}engine/src/propagate.ts`);
const tiles = await import(`${ROOT}website/src/view/core/tiles.ts`);
const labels = await import(`${ROOT}engine/src/labels.ts`);
const orbitTime = await import(`${ROOT}engine/src/orbit-time.ts`);
const timeSense = await import(`${ROOT}engine/src/time-sense.ts`);
const when = await import(`${ROOT}engine/src/when.ts`);
const solarTime = await import(`${ROOT}engine/src/solar-time.ts`);
const deepTime = await import(`${ROOT}engine/src/deep-time.ts`);

/** Epochs chosen to exercise the element drift, the leap table and the model seam. */
const EPOCHS = [
  2378496.5,  // 1800-01-01, the short-span table's first year
  2433282.5,  // 1950-01-01
  2451545.0,  // J2000
  2460676.5,  // 2025-01-01
  2469807.5,  // 2050-01-01, the short-span table's last year
];

const round = (v) => (Number.isFinite(v) ? Number(v.toPrecision(15)) : v);
const vec = (v) => ({ x: round(v.x), y: round(v.y), z: round(v.z) });

const domains = {};

/**
 * Why domains carry an absolute tolerance as well as a relative one.
 *
 * A relative tolerance is the right test for a quantity of ordinary magnitude and the wrong
 * one for a quantity near zero. Earth's inclination to the ecliptic is 4e-7 radians, computed
 * as acos of something within 1e-13 of one, and acos is ill-conditioned there: acos(1 - eps)
 * is about sqrt(2 eps), so a last-bit difference in the input becomes 1e-8 in the angle. Two
 * correct implementations differing in their order of operations then look like a port bug.
 *
 * The comparison is |a - b| <= relative * |expected| + absolute, which is strict where strict
 * means something and tolerant only where the quantity itself has no significant digits left.
 */

/**
 * Constants and unit conversions. The cheapest cases here and the ones most worth having: a
 * port that rounds the astronomical unit is wrong everywhere at once, quietly.
 */
domains.units = {
  absoluteTolerance: 0,
  description: "Defined constants and the boundary conversions every client does.",
  tolerance: 0,
  cases: [
    { id: "au-in-metres", expected: units.AU_IN_METRES },
    { id: "gm-sun", expected: units.GM_SUN },
    { id: "seconds-per-day", expected: units.SECONDS_PER_DAY },
    { id: "days-per-julian-century", expected: units.DAYS_PER_JULIAN_CENTURY },
    { id: "days-per-julian-year", expected: units.DAYS_PER_JULIAN_YEAR },
    { id: "speed-of-light", expected: units.SPEED_OF_LIGHT_M_S },
    { id: "km-to-metres", input: { km: 384400 }, expected: units.toMetresFromKm(units.km(384400)) },
    { id: "au-to-metres", input: { au: 5.2 }, expected: units.toMetresFromAu(units.au(5.2)) },
    { id: "degrees-to-radians", input: { deg: 23.4392911 }, expected: units.toRadians(units.deg(23.4392911)) },
    { id: "normalise-angle-signed", input: { radians: 7.5 }, expected: units.normalizeAngleSigned(7.5) },
    { id: "normalise-angle-negative", input: { radians: -7.5 }, expected: units.normalizeAngleSigned(-7.5) },
  ],
};

/**
 * Time scales. The leap-second boundaries are the cases that matter: a client that hardcodes
 * the current offset is correct only for dates after the last insertion.
 */
domains.time = {
  absoluteTolerance: 1e-12,
  description: "UTC, TAI, TT and TDB, including leap-second boundaries.",
  tolerance: 1e-12,
  cases: [
    ...[2441317.5, 2443144.5, 2451179.5, 2457754.5, 2460676.5].map((jd) => ({
      id: `tai-minus-utc-${jd}`,
      input: { jdUtc: jd },
      expected: time.taiMinusUtcSeconds(time.jdUtc(jd)),
    })),
    ...EPOCHS.map((jd) => ({
      id: `tt-from-utc-${jd}`,
      input: { jdUtc: jd },
      expected: round(time.ttFromUtc(time.jdUtc(jd))),
    })),
    ...EPOCHS.map((jd) => ({
      id: `tdb-from-tt-${jd}`,
      input: { jdTt: jd },
      expected: round(time.tdbFromTt(time.jdTt(jd))),
    })),
    ...EPOCHS.map((jd) => ({
      id: `julian-centuries-${jd}`,
      input: { jdTdb: jd },
      expected: round(time.julianCenturiesSinceJ2000(time.jdTdb(jd))),
    })),
  ],
};

/** Kepler's equation on its own, across the eccentricity range the solar system uses. */
domains.kepler = {
  absoluteTolerance: 1e-12,
  description: "Solving M = E - e sin E, and the Standish state vectors.",
  tolerance: 1e-11,
  cases: [
    ...[0.0, 0.05, 0.2056, 0.5, 0.9].flatMap((e) =>
      [0, 0.5, 1.5, 3.0, 4.7, 6.1].map((m) => ({
        id: `eccentric-anomaly-e${e}-m${m}`,
        input: { meanAnomaly: m, eccentricity: e },
        expected: round(kepler.solveEccentricAnomaly(m, e)),
      })),
    ),
    ...planets.PLANET_IDS.flatMap((planet) =>
      EPOCHS.map((jd) => {
        const state = kepler.heliocentricState(planet, time.jdTdb(jd), planets.SHORT_SPAN);
        return {
          id: `state-${planet}-${jd}`,
          input: { planet, jdTdb: jd, model: "short-span" },
          expected: { position: vec(state.position), velocity: vec(state.velocity) },
        };
      }),
    ),
  ],
};

/** Every registry body, which is what covers the mean elements and the reference planes. */
domains.position = {
  // metres: a micrometre on positions up to 4.5e12 m
  absoluteTolerance: 1e-6,
  description: "Heliocentric position of all 32 bodies, including the moons.",
  tolerance: 1e-9,
  cases: registry.BODY_IDS.flatMap((body) =>
    EPOCHS.map((jd) => ({
      id: `${body}-${jd}`,
      input: { body, jdTdb: jd },
      expected: vec(position.heliocentricPositionOf(body, time.jdTdb(jd))),
    })),
  ),
};

/** IAU orientation, where the retrograde convention and the equatorial frame both bite. */
domains.rotation = {
  absoluteTolerance: 1e-12,
  description: "IAU pole, prime meridian, derived period and axial tilt.",
  tolerance: 1e-11,
  cases: registry.BODY_IDS.flatMap((body) => [
    {
      id: `period-${body}`,
      input: { body },
      expected: round(rotation.rotationPeriodDays(body)),
    },
    ...EPOCHS.map((jd) => {
      const o = rotation.orientationOf(body, time.jdTdb(jd));
      return {
        id: `orientation-${body}-${jd}`,
        input: { body, jdTdb: jd },
        expected: {
          pole: vec(o.poleEcliptic),
          spin: round(o.spin),
          tilt: round(o.tilt),
          obliquityToOrbitDeg: round(rotation.obliquityToOrbitDeg(body, time.jdTdb(jd))),
        },
      };
    }),
  ]),
};

/** Osculating elements, including the varpi definition that is easy to get subtly wrong. */
domains.elements = {
  // radians: Earth's inclination is 4e-7 and comes through an ill-conditioned acos
  absoluteTolerance: 1e-9,
  description: "Osculating elements from a state vector, varpi included.",
  tolerance: 1e-11,
  cases: planets.PLANET_IDS.map((planet) => {
    const state = kepler.heliocentricState(planet, time.jdTdb(2451545), planets.SHORT_SPAN);
    const e = elements.osculatingElements(units.GM_SUN, state.position, state.velocity);
    return {
      id: `elements-${planet}`,
      input: { planet, jdTdb: 2451545, gm: units.GM_SUN },
      expected: {
        semiMajorAxisM: round(e.semiMajorAxisM),
        eccentricity: round(e.eccentricity),
        inclinationRad: round(e.inclinationRad),
        longitudeOfAscendingNodeRad: round(e.longitudeOfAscendingNodeRad),
        argumentOfPericentreRad: round(e.argumentOfPericentreRad),
        longitudeOfPericentreRad: round(e.longitudeOfPericentreRad),
        projectedPericentreLongitudeRad: round(e.projectedPericentreLongitudeRad),
      },
    };
  }),
};

/** The relativistic term, closed form and acceleration. */
domains.relativity = {
  absoluteTolerance: 1e-18,
  description: "First post-Newtonian acceleration and the closed-form perihelion advance.",
  tolerance: 1e-11,
  cases: [
    // Mercury's own figures. Included because the Swift port had drifted on two of the three
    // and nothing noticed: a different eccentricity and a different period, both plausible.
    { id: "mercury-semi-major-axis", expected: relativity.MERCURY.semiMajorAxisMetres },
    { id: "mercury-eccentricity", expected: relativity.MERCURY.eccentricity },
    { id: "mercury-orbital-period-days", expected: relativity.MERCURY.orbitalPeriodDays },
    {
      id: "mercury-advance-per-orbit",
      input: {
        gm: units.GM_SUN,
        semiMajorAxisM: relativity.MERCURY.semiMajorAxisMetres,
        eccentricity: relativity.MERCURY.eccentricity,
      },
      expected: round(relativity.perihelionAdvancePerOrbit(
        units.GM_SUN, relativity.MERCURY.semiMajorAxisMetres, relativity.MERCURY.eccentricity,
      )),
    },
    ...[0.4, 1.0, 5.2].map((au) => {
      const r = { x: au * units.AU_IN_METRES, y: 0, z: 0 };
      const v = { x: 0, y: Math.sqrt(units.GM_SUN / (au * units.AU_IN_METRES)), z: 0 };
      return {
        id: `pn-acceleration-${au}au`,
        input: { gm: units.GM_SUN, position: vec(r), velocity: vec(v) },
        expected: vec(relativity.postNewtonianAcceleration(units.GM_SUN, r, v)),
      };
    }),
  ],
};

/** The N-body force law and the barycentric frame conversion, where a sign error hides. */
domains.nbody = {
  // metres and m/s, on a barycentric state
  absoluteTolerance: 1e-6,
  description: "Pairwise accelerations and the barycentric seeding.",
  tolerance: 1e-9,
  cases: [
    {
      id: "two-body-acceleration",
      input: {
        gm: [units.GM_SUN, 0],
        state: [0, 0, 0, 0, 0, 0, units.AU_IN_METRES, 0, 0, 0, 0, 0],
      },
      expected: (() => {
        const out = new Float64Array(6);
        nbody.accelerations(new Float64Array([units.GM_SUN, 0]),
          new Float64Array([0, 0, 0, 0, 0, 0, units.AU_IN_METRES, 0, 0, 0, 0, 0]), out);
        return Array.from(out).map(round);
      })(),
    },
    {
      id: "solar-system-seed-j2000",
      input: { jdTdb: 2451545, bodies: "planets" },
      expected: (() => {
        const system = nbody.solarSystemAt(time.jdTdb(2451545));
        return {
          ids: [...system.ids],
          state: Array.from(system.state).map(round),
          totalEnergy: round(nbody.totalEnergy(system)),
        };
      })(),
    },
  ],
};

/** Secular theory, including the hand-derived limit the quadrature must converge onto. */
domains.secular = {
  absoluteTolerance: 1e-18,
  description: "Orbit-averaged pericentre rate, and its small-alpha closed form.",
  tolerance: 1e-9,
  cases: [
    { au: 0.72333566, gm: 324858.59e9, id: "venus" },
    { au: 5.202887, gm: 126712764.1e9, id: "jupiter" },
    { au: 60, gm: 126712764.1e9, id: "distant" },
  ].flatMap(({ au, gm, id }) => {
    const config = {
      semiMajorAxisM: 0.38709927 * units.AU_IN_METRES,
      eccentricity: 0.20563593,
      gm: 22031.87e9,
      perturberGm: gm,
      perturberSemiMajorAxisM: au * units.AU_IN_METRES,
    };
    return [
      {
        id: `quadrature-${id}`,
        input: { ...config, samples: 600 },
        expected: round(secular.secularPericentreRate(config, 600)),
      },
      {
        id: `leading-order-${id}`,
        input: config,
        expected: round(secular.leadingOrderPericentreRate(config)),
      },
    ];
  }),
};

/**
 * Propagation, which is where an integrator's agreement is actually tested.
 *
 * The force-law cases above check one evaluation. These check thousands, compounded, with an
 * adaptive step: two implementations can agree perfectly on a single acceleration and diverge
 * over an integration if their step controllers disagree about anything. Spans are kept short
 * enough that the comparison is about the method rather than about chaos.
 */
domains.propagate = {
  absoluteTolerance: 1e-3,
  description: "Integrated trajectories: two-body and relativistic.",
  tolerance: 1e-7,
  cases: (() => {
    const circular = (auRadius) => {
      const r = auRadius * units.AU_IN_METRES;
      return {
        position: { x: r, y: 0, z: 0 },
        velocity: { x: 0, y: Math.sqrt(units.GM_SUN / r), z: 0 },
      };
    };
    const out = [];

    // A closed orbit: the exactly solvable reference. After one period it must return.
    for (const auRadius of [0.39, 1.0, 5.2]) {
      const initial = circular(auRadius);
      const r = auRadius * units.AU_IN_METRES;
      const period = 2 * Math.PI * Math.sqrt(r ** 3 / units.GM_SUN);
      const result = propagate.propagate({
        model: propagate.twoBodyModel(),
        initial,
        durationSeconds: period,
        limits: { tolerance: 1e-12, minStepSeconds: 1, maxStepSeconds: 86_400 * 5, maxSteps: 2_000_000 },
      });
      const final = result.samples[result.samples.length - 1];
      out.push({
        id: `two-body-one-period-${auRadius}au`,
        input: { radiusAu: auRadius, durationSeconds: period, tolerance: 1e-12 },
        /**
         * Scaled to the orbit, because the interesting component is pure round-off.
         *
         * A closed orbit returns to x = r and y = 0, so the y the integrator actually reaches
         * is not a physical quantity at all: it is the accumulated error, about 1.5 metres out
         * of 1.5e11. Two integrators in two languages take different step sequences and will
         * never agree on it to the domain's 1e-3 metres, and demanding that they do gates on
         * the noise rather than on the physics. One part in 1e9 of the orbit radius says what
         * is actually being claimed, which is that both close the orbit equally well.
         */
        absoluteTolerance: r * 1e-9,
        expected: { position: vec(final.position), velocity: vec(final.velocity) },
      });
    }

    // Mercury with the relativistic term on, which is the demonstration's own path.
    {
      const a = relativity.MERCURY.semiMajorAxisMetres;
      const e = relativity.MERCURY.eccentricity;
      const period = 2 * Math.PI * Math.sqrt(a ** 3 / units.GM_SUN);
      const initial = {
        position: { x: a * (1 - e), y: 0, z: 0 },
        velocity: { x: 0, y: Math.sqrt((units.GM_SUN * (1 + e)) / (a * (1 - e))), z: 0 },
      };
      for (const relativistic of [false, true]) {
        const result = propagate.propagate({
          model: { centralGm: units.GM_SUN, perturbers: [], relativistic },
          initial,
          durationSeconds: 20 * period,
          limits: { tolerance: 1e-13, minStepSeconds: 1, maxStepSeconds: 3_600, maxSteps: 2_000_000 },
        });
        const final = result.samples[result.samples.length - 1];
        out.push({
          id: `mercury-20-orbits-${relativistic ? "relativistic" : "newtonian"}`,
          input: { relativistic, orbits: 20, tolerance: 1e-13 },
          // As above. The quantity this case exists to check is the pericentre longitude,
          // which is well conditioned and keeps the domain's own tolerance.
          absoluteTolerance: a * 1e-9,
          expected: {
            position: vec(final.position),
            velocity: vec(final.velocity),
            // The quantity the demonstration actually measures.
            pericentreLongitude: round(
              elements.osculatingElements(units.GM_SUN, final.position, final.velocity)
                .longitudeOfPericentreRad,
            ),
          },
        });
      }
    }

    return out;
  })(),
};

/**
 * The Sun's whole life, and what it does to the habitable zone.
 *
 * Gated because the two clients draw the same timeline and must agree about where on it a
 * planet stops being habitable. A closed-form luminosity, a geometric interpolation between
 * published waypoints and an inverted relation for the crossing are each easy to port with a
 * sign or an exponent out of place, and each wrong version still produces a smooth curve that
 * looks entirely reasonable on a slider.
 */
domains["deep-time"] = {
  absoluteTolerance: 1e-9,
  description: "Solar evolution, the habitable zone through time, and engulfment.",
  tolerance: 1e-9,
  cases: (() => {
    const out = [];
    const ages = [0, 1, 2.5, 4.57, 6, 8, 10, 10.5, 11.6, 12.167, 12.5, 13];
    for (const ageGyr of ages) {
      const state = deepTime.solarStateAt(ageGyr);
      const zone = deepTime.habitableZoneAt(ageGyr);
      out.push({
        id: `state-${ageGyr}`,
        input: { ageGyr },
        expected: {
          phase: state.phase,
          luminosity: round(state.luminosity),
          radius: round(state.radius),
          mass: round(state.mass),
          effectiveTemperatureK: round(state.effectiveTemperatureK),
          confidence: state.confidence,
          innerAu: round(zone.innerAu),
          outerAu: round(zone.outerAu),
          engulfed: ["mercury", "venus", "embary", "mars"]
            .filter((id) => deepTime.engulfedAt(id, ageGyr)),
        },
      });
    }
    for (const id of ["mercury", "venus", "embary", "mars", "jupiter"]) {
      const crossing = deepTime.runawayGreenhouseCrossing(id);
      out.push({
        id: `crossing-${id}`,
        input: { body: id },
        expected: {
          kind: crossing.kind,
          fromNowGyr: crossing.kind === "crosses" ? round(crossing.fromNowGyr) : null,
        },
      });
    }
    return out;
  })(),
};

/**
 * The time at each body's own Greenwich.
 *
 * Gated hard because a sub-solar longitude is four chances to be off by a sign or a quarter
 * turn, in the ecliptic-to-equatorial rotation, the node's right ascension, the sense of W and
 * the retrograde flip, and every one of them yields a clock that looks entirely plausible. Two
 * clients disagreeing here would show different times of day on the same planet at the same
 * instant, with nothing on either screen to suggest which was lying.
 *
 * Epochs are spread across a year so a body is caught at several points in its own day and its
 * own season rather than at one convenient phase.
 */
domains["solar-time"] = {
  absoluteTolerance: 1e-7,
  description: "Sub-solar point and the apparent solar clock at the IAU prime meridian.",
  tolerance: 1e-9,
  cases: (() => {
    const out = [];
    const epochs = [2_451_545, 2_451_636.5, 2_451_728, 2_451_819.5, 2_460_800.25];
    /**
     * The Sun is included on purpose, and skipping it is what let a crash through.
     *
     * There is no sub-solar point on the Sun, so the clock is null there. Generating cases for
     * every body except the awkward one meant the awkward one was the only untested path, and
     * it was the one that trapped on the phone. The expectation here is the null.
     */
    for (const id of registry.BODY_IDS) {
      for (const jd of epochs) {
        const epoch = time.jdTdb(jd);
        const clock = solarTime.solarClock(id, epoch);
        if (clock === null) {
          out.push({ id: `${id}-${jd}`, input: { body: id, epoch: jd }, expected: null });
          continue;
        }
        out.push({
          id: `${id}-${jd}`,
          input: { body: id, epoch: jd },
          expected: {
            longitudeDeg: round(clock.subSolar.longitudeDeg),
            latitudeDeg: round(clock.subSolar.latitudeDeg),
            hours: round(clock.hours),
            formatted: clock.formatted,
            dayNumber: clock.dayNumber,
            hourInEarthSeconds: round(clock.hourInEarthSeconds),
            sunRisesInTheWest: clock.sunRisesInTheWest,
            localTime: solarTime.localTimeLabel(id, epoch),
            // Explicit zones, never the generating machine's own, or the expectations would
            // change with whoever last ran the generator.
            localTimeNewYork: solarTime.localTimeLabel(id, epoch, {
              offsetMinutes: -300, label: "EST",
            }),
            localTimeIndia: solarTime.localTimeLabel(id, epoch, {
              offsetMinutes: 330, label: "+05:30",
            }),
          },
        });
      }
    }
    return out;
  })(),
};

/**
 * Going to a date, and what the tables can honestly say there.
 *
 * Gated because both halves are easy to get subtly wrong in a way nothing catches. The
 * seconds-or-milliseconds guess is a magnitude test that must agree, or a timestamp pasted
 * into one client lands centuries from where it lands in the other. And the standing is the
 * sentence printed next to the planets at that date, so a client that silently promotes an
 * extrapolation to a fitted answer is the exact dishonesty the note exists to prevent.
 */
domains.when = {
  absoluteTolerance: 1e-6,
  description: "Unix timestamps to epochs, and which fitted table answers there.",
  tolerance: 1e-12,
  cases: (() => {
    const out = [];
    const stamps = [
      ["epoch", 0], ["one-second", 1], ["negative", -1_000_000_000],
      ["apollo-11", -14_182_916], ["now-ish", 1_700_000_000],
      ["eclipse-2024", 1_712_600_220], ["as-milliseconds", 1_700_000_000_000],
      ["year-3001", 32_535_885_600],
    ];
    for (const [id, value] of stamps) {
      const epoch = when.epochFromUnixTimestamp(value);
      out.push({
        id: `stamp-${id}`,
        input: { value },
        expected: {
          epoch: round(epoch),
          unixSeconds: round(when.unixSecondsFromEpoch(epoch)),
        },
      });
    }
    // One epoch per band, including both sides of each boundary.
    for (const year of [-4000, -3000, 1066, 1799, 1800, 2000, 2050, 2051, 2999, 3000, 4000]) {
      const epoch = time.jdTdb(2_451_545.0 + (year - 2000) * 365.25);
      const standing = when.ephemerisStandingAt(epoch);
      out.push({
        id: `standing-${year}`,
        input: { epoch },
        expected: { model: standing.model, inside: standing.inside, year: standing.year,
          note: standing.note },
      });
    }
    return out;
  })(),
};

/**
 * How long a day, a month and a year are here.
 *
 * The numbers are derived from two measured constants and one formula, so an error in either
 * client is a silent wrong answer rather than a crash. The headline is gated as an exact
 * string because it is the part a child actually reads, and two clients telling them
 * different things about the same planet is worse than either saying nothing.
 */
domains["time-sense"] = {
  absoluteTolerance: 1e-9,
  description: "Solar day, spin, year and the sentence that explains them.",
  tolerance: 1e-12,
  cases: registry.BODY_IDS.map((id) => {
    const t = timeSense.timeSense(id);
    return {
      id,
      input: { body: id },
      expected: {
        siderealSpinDays: round(t.siderealSpinDays),
        solarDayDays: round(t.solarDayDays),
        yearDays: round(t.yearDays),
        solarDaysPerYear: round(t.solarDaysPerYear),
        spinsPerYear: round(t.spinsPerYear),
        tidallyLocked: t.tidallyLocked,
        monthDays: t.monthDays === null ? null : round(t.monthDays),
        synodicMonthDays: t.synodicMonthDays === null ? null : round(t.synodicMonthDays),
        headline: timeSense.timeHeadline(id),
        // The line under a body's name in the scene. Gated for the same reason as the
        // headline: it is read, and it must say the same thing on both.
        badge: timeSense.timeBadge(id),
        badgeShort: timeSense.timeBadgeShort(id),
      },
    };
  }),
};

/**
 * What a mark on an orbit is worth, which both clients must agree on to the second.
 *
 * Gated rather than trusted because the rule is a ladder with a budget, and two
 * implementations of "the finest round interval that still fits" can disagree at every rung
 * boundary without either looking wrong. A mark meaning two days on one client and one day on
 * the other is a quiet lie about the thing the marks exist to show.
 *
 * Periods span Phobos at 7.65 hours to Neptune at 165 years, so the cases cover every rung the
 * ladder can reach for a real body.
 */
domains["orbit-time"] = {
  absoluteTolerance: 1e-6,
  description: "Mark interval and mark epochs along an orbit.",
  tolerance: 1e-12,
  cases: (() => {
    const out = [];
    const periods = [
      ["phobos", 0.31891], ["io", 1.769138], ["triton", 5.876854],
      ["moon", 27.321582], ["mercury", 87.9691], ["iapetus", 79.3215],
      ["earth", 365.256], ["mars", 686.98], ["jupiter", 4332.589],
      ["neptune", 60190], ["absurd", 400000],
    ];
    for (const [id, periodDays] of periods) {
      const interval = orbitTime.markIntervalFor(periodDays);
      out.push({
        id: `interval-${id}`,
        input: { periodDays },
        expected: {
          seconds: round(interval.seconds),
          label: interval.label,
          marksPerOrbit: round(interval.marksPerOrbit),
        },
      });
    }
    // The epochs themselves, because the interval being right does not make the placement
    // right: an off-by-one in the loop bound puts the last mark on top of the first.
    for (const [id, periodDays] of [["moon", 27.321582], ["earth", 365.256], ["io", 1.769138]]) {
      const now = time.jdTdb(time.J2000_JD);
      const { marks } = orbitTime.orbitTimeMarks(periodDays, now);
      out.push({
        id: `marks-${id}`,
        input: { periodDays, now },
        expected: {
          count: marks.length,
          secondsFromNow: marks.map((m) => round(m.secondsFromNow)),
          lastEpoch: round(marks[marks.length - 1].epoch),
        },
      });
    }
    return out;
  })(),
};

/**
 * Label placement, including the off-screen pointers.
 *
 * Gated because the decisions are judgement calls with numbers in them, and two clients
 * making them separately is exactly how the marker threshold came to exist on the web and
 * not on the phone. The clamped cases matter most: a pointer that disagrees between clients
 * sends two viewers in different directions for the same body.
 */
domains.labels = {
  absoluteTolerance: 1e-9,
  description: "Where a body's name is drawn, and where an off-screen pointer aims.",
  tolerance: 1e-12,
  cases: (() => {
    const viewport = { viewportWidthPx: 402, viewportHeightPx: 874 };
    const base = {
      ndcX: 0, ndcY: 0, radiusPx: 4, distance: 1e9,
      behindCamera: false, relevance: "other",
    };
    const scenarios = [
      { id: "on-screen-large", inputs: [{ ...base, id: "mars", radiusPx: 300, relevance: "focus" }] },
      { id: "off-right", inputs: [{ ...base, id: "moon", ndcX: 4, relevance: "satellite-of-focus" }] },
      { id: "off-diagonal", inputs: [{ ...base, id: "io", ndcX: 6, ndcY: 3, relevance: "satellite-of-focus" }] },
      { id: "behind-camera", inputs: [{ ...base, id: "moon", ndcX: 0.5, behindCamera: true, relevance: "satellite-of-focus" }] },
      {
        id: "thinning",
        inputs: [
          { ...base, id: "io", distance: 1e9 },
          { ...base, id: "europa", distance: 2e9 },
          { ...base, id: "ganymede", distance: 3e9 },
        ],
      },
      {
        // A moon sits on its planet from the system view, and the planet must win the label.
        id: "planet-beats-its-moon",
        inputs: [
          { ...base, id: "callisto", distance: 1e9 },
          { ...base, id: "jupiter", distance: 2e9 },
        ],
      },
      {
        id: "mixed-relevance",
        inputs: [
          { ...base, id: "embary", relevance: "focus" },
          { ...base, id: "moon", ndcX: 3, relevance: "satellite-of-focus", distance: 2e9 },
          { ...base, id: "neptune", ndcX: 9, relevance: "other", distance: 3e9 },
        ],
      },
    ];
    return scenarios.map(({ id, inputs }) => ({
      id,
      input: { inputs, ...viewport },
      expected: labels.placeLabels(inputs, viewport).map((p) => ({
        id: p.id,
        x: round(p.x),
        y: round(p.y),
        clamped: p.clamped,
        bearingRadians: p.bearingRadians === null ? null : round(p.bearingRadians),
      })),
    }));
  })(),
};

/**
 * How densely a trajectory is recorded, which decides what the drawn path looks like.
 *
 * Worth its own domain because the clients disagreed here for the whole life of the feature
 * and nothing could catch it: one recorded 2000 points per run and the other 600, so the same
 * launch drew a smooth ellipse in a browser and a dodecagon on a phone. Neither number was
 * written down anywhere, so there was nothing for a conformance suite to compare. Stating the
 * cadence as cases makes a future divergence a failed build.
 */
domains["sample-cadence"] = {
  absoluteTolerance: 1e-6,
  description: "Recording interval for a propagated path, from the orbit rather than the span.",
  tolerance: 1e-12,
  cases: (() => {
    const circular = (auRadius) => {
      const r = auRadius * units.AU_IN_METRES;
      return {
        position: { x: r, y: 0, z: 0 },
        velocity: { x: 0, y: Math.sqrt(units.GM_SUN / r), z: 0 },
      };
    };
    const out = [];
    for (const auRadius of [0.39, 1, 5.2]) {
      for (const years of [2, 50, 200]) {
        const seconds = years * units.SECONDS_PER_JULIAN_YEAR;
        out.push({
          id: `interval-${auRadius}au-${years}y`,
          input: { ...circular(auRadius), durationSeconds: seconds },
          expected: round(propagate.sampleIntervalFor(units.GM_SUN, circular(auRadius), seconds)),
        });
      }
    }
    // Unbound, where there is no period to divide and the fallback applies.
    const r = units.AU_IN_METRES;
    const escape = {
      position: { x: r, y: 0, z: 0 },
      velocity: { x: 0, y: 2 * Math.sqrt(units.GM_SUN / r), z: 0 },
    };
    const seconds = 10 * units.SECONDS_PER_JULIAN_YEAR;
    out.push({
      id: "interval-escape-10y",
      input: { ...escape, durationSeconds: seconds },
      expected: round(propagate.sampleIntervalFor(units.GM_SUN, escape, seconds)),
    });
    return out;
  })(),
};

/**
 * Trajectory interpolation, which is what puts a rider on a path.
 *
 * Small and worth gating, because both clients call it every frame to place a camera and a
 * disagreement would show as an object drifting off its own drawn path rather than as an
 * error. The samples are a curved path with inconsistent endpoint velocities, so the Hermite
 * terms all contribute; a linear fallback misses by kilometres on these.
 */
domains["trajectory-interpolation"] = {
  absoluteTolerance: 1e-9,
  description: "Cubic Hermite placement of an object between integrator samples.",
  tolerance: 1e-12,
  cases: (() => {
    const samples = [
      { t: 0, position: { x: 0, y: 0, z: 0 }, velocity: { x: 1_000, y: 2_000, z: -500 } },
      { t: 3_600, position: { x: 5.1e6, y: 6.4e6, z: -1.2e6 }, velocity: { x: 1_400, y: 1_100, z: -900 } },
      { t: 7_200, position: { x: 1.1e7, y: 9.9e6, z: -4.4e6 }, velocity: { x: 1_900, y: 300, z: -1_500 } },
    ];
    const input = { samples };
    return [0, 900, 3_600, 5_400, 7_200, -500, 99_999].map((seconds) => {
      const state = propagate.trajectoryStateAt(samples, seconds);
      return {
        id: `at-${seconds}s`,
        input: { ...input, seconds },
        expected: { position: vec(state.position), velocity: vec(state.velocity) },
      };
    });
  })(),
};

/**
 * N-body evolution, and the conserved quantities that are never handed to the integrator.
 *
 * The drifts are included as cases rather than asserted loosely, so a port whose integrator
 * is subtly worse shows up as a different number rather than as a looser pass.
 */
domains["nbody-evolution"] = {
  absoluteTolerance: 1e-3,
  description: "Mutual gravity over years, with energy, momentum and angular momentum.",
  tolerance: 1e-7,
  cases: [1, 5].map((years) => {
    const system = nbody.solarSystemAt(time.jdTdb(2451545));
    const before = {
      energy: nbody.totalEnergy(system),
      angular: nbody.totalAngularMomentum(system),
    };
    nbody.advance(system, years * units.SECONDS_PER_JULIAN_YEAR, {
      tolerance: 1e-13, minStepSeconds: 60, maxStepSeconds: units.SECONDS_PER_DAY,
    });
    const after = nbody.totalEnergy(system);
    return {
      id: `advance-${years}-years`,
      input: { jdTdb: 2451545, years, tolerance: 1e-13 },
      expected: {
        state: Array.from(system.state).map(round),
        energyDrift: round(Math.abs((after - before.energy) / before.energy)),
        angularDrift: round(
          Math.hypot(
            nbody.totalAngularMomentum(system).x - before.angular.x,
            nbody.totalAngularMomentum(system).y - before.angular.y,
            nbody.totalAngularMomentum(system).z - before.angular.z,
          ) / Math.hypot(before.angular.x, before.angular.y, before.angular.z),
        ),
      },
    };
  }),
};

/** Tile selection, which decides what a viewer actually sees on a surface. */
domains.tiles = {
  absoluteTolerance: 0,
  description: "Level choice, visible cap and tile extents for a surface pyramid.",
  tolerance: 1e-12,
  cases: (() => {
    const manifest = {
      body: "moon",
      tileSize: 512,
      levels: [0, 1, 2, 3].map((level) => ({
        level,
        tilesX: 2 * 2 ** level,
        tilesY: 1 * 2 ** level,
        levelWidth: 1024 * 2 ** level,
        levelHeight: 512 * 2 ** level,
        metresPerTexel: 10660.552883490052 / 2 ** level,
      })),
      globalNormalMap: "normal-global.jpg",
      globalWidth: 8192,
      referenceRadiusM: 1737400,
      elevationRangeM: [-9106, 10747],
      source: "LRO LOLA",
    };
    const fov = (55 * Math.PI) / 180;
    const out = [];

    for (const altitude of [1e4, 1e5, 1e6, 1e7, 1e8]) {
      out.push({
        id: `metres-per-pixel-${altitude}`,
        input: { altitudeM: altitude, verticalFovRadians: fov, viewportHeightPx: 900 },
        expected: round(tiles.metresPerPixel(altitude, fov, 900)),
      });
      out.push({
        id: `level-for-${altitude}`,
        input: { altitudeM: altitude, verticalFovRadians: fov, viewportHeightPx: 900 },
        expected: tiles.levelFor(manifest, altitude, fov, 900).level,
      });
      out.push({
        id: `visible-cap-${altitude}`,
        input: { radiusM: 1737400, altitudeM: altitude },
        expected: round(tiles.visibleCapAngle(1737400, altitude)),
      });
    }

    for (const level of manifest.levels) {
      const extent = tiles.tileExtent(level, { level: level.level, x: 1, y: 0 });
      out.push({
        id: `tile-extent-level-${level.level}`,
        input: { level: level.level, tilesX: level.tilesX, tilesY: level.tilesY, x: 1, y: 0 },
        expected: {
          phiStart: round(extent.phiStart),
          phiLength: round(extent.phiLength),
          thetaStart: round(extent.thetaStart),
          thetaLength: round(extent.thetaLength),
        },
      });
    }
    return out;
  })(),
};

let total = 0;
for (const [name, domain] of Object.entries(domains)) {
  total += domain.cases.length;
  writeFileSync(
    join(OUT, `${name}.json`),
    JSON.stringify({ domain: name, ...domain }, null, 2) + "\n",
  );
  console.log(`${name.padEnd(12)} ${String(domain.cases.length).padStart(4)} cases`);
}

writeFileSync(
  join(OUT, "index.json"),
  JSON.stringify({
    note: "Generated by scripts/generate-conformance.mjs from the engine. Every client runs "
      + "these. See contracts/conformance/SKILL.md.",
    domains: Object.keys(domains),
    totalCases: total,
  }, null, 2) + "\n",
);
console.log(`\n${total} cases across ${Object.keys(domains).length} domains`);
