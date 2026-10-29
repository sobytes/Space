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
const asteroid = await import(`${ROOT}engine/src/scenarios/asteroid.ts`);
const ascent = await import(`${ROOT}engine/src/launch/ascent.ts`);
const vehicles = await import(`${ROOT}engine/src/launch/vehicles.ts`);

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

/** Impact energies, spanning eight orders of magnitude against three real events. */
domains.asteroid = {
  absoluteTolerance: 1e-6,
  description: "Impact energy against Chelyabinsk, Tunguska and Chicxulub.",
  tolerance: 1e-11,
  cases: [
    { id: "chelyabinsk", d: 19, rho: 3300, v: 19160 },
    { id: "tunguska", d: 55, rho: 3000, v: 15000 },
    { id: "chicxulub", d: 10000, rho: 2600, v: 20000 },
  ].map(({ id, d, rho, v }) => {
    const e = asteroid.impactEnergy(d, rho, v);
    return {
      id,
      input: { diameterM: d, densityKgM3: rho, speedMS: v },
      expected: {
        massKg: round(e.massKg),
        energyJoules: round(e.energyJoules),
        energyMegatonsTnt: round(e.energyMegatonsTnt),
      },
    };
  }),
};

/** The ascent budget, where the signed rotation term is the classic error. */
domains.ascent = {
  absoluteTolerance: 1e-9,
  description: "Delta-v budget, rotation bonus and delivered payload.",
  tolerance: 1e-9,
  cases: [
    ...[["ksc-lc39a", 28.5], ["ksc-lc39a", 90], ["ksc-lc39a", 120], ["vandenberg-slc4e", 98]]
      .map(([site, inclination]) => ({
        id: `rotation-bonus-${site}-${inclination}`,
        input: { site, inclinationDeg: inclination },
        expected: round(ascent.earthRotationBonus(ascent.siteById(site), inclination)),
      })),
    ...[200, 500, 2000].map((altitudeKm) => {
      const target = { altitudeKm, inclinationDeg: 28.5, site: ascent.siteById("ksc-lc39a") };
      const budget = ascent.ascentBudget(target);
      return {
        id: `budget-${altitudeKm}km`,
        input: { altitudeKm, inclinationDeg: 28.5, site: "ksc-lc39a" },
        expected: {
          circularSpeedMS: round(budget.circularSpeedMS),
          potentialMS: round(budget.potentialMS),
          earthRotationMS: round(budget.earthRotationMS),
          requiredMS: round(budget.requiredMS),
        },
      };
    }),
    {
      id: "atlas-v-401-payload-200km-28.5deg",
      input: { vehicle: "atlas-v-401", altitudeKm: 200, inclinationDeg: 28.5, site: "ksc-lc39a" },
      expected: round(ascent.maximumPayload(vehicles.ATLAS_V_401, {
        altitudeKm: 200, inclinationDeg: 28.5, site: ascent.siteById("ksc-lc39a"),
      }).payloadKg),
    },
  ],
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
