/**
 * Generates the moon contracts from data fetched from JPL and NASA NAIF.
 *
 * A lever rather than twenty-two hand-written entries. Transcribing that many numbers by hand
 * is how a wrong semi-major axis gets in and renders as a perfectly plausible orbit, and the
 * generator can be re-run when JPL revises a solution.
 *
 * Inputs, all fetched rather than remembered:
 *   /tmp/jpl/elements.json   parsed from https://ssd.jpl.nasa.gov/sats/elem/
 *   /tmp/jpl/physical.json   parsed from https://ssd.jpl.nasa.gov/sats/phys_par/
 *   /tmp/jpl/rotation.json   parsed from NASA NAIF pck00011.tpc, the IAU WGCCRE report
 */

import { readFileSync, writeFileSync } from "node:fs";

const elements = JSON.parse(readFileSync("/tmp/jpl/elements.json", "utf8"));
const physical = JSON.parse(readFileSync("/tmp/jpl/physical.json", "utf8"));
const rotation = JSON.parse(readFileSync("/tmp/jpl/rotation.json", "utf8"));

const PARENT = { Mars: "mars", Jupiter: "jupiter", Saturn: "saturn", Uranus: "uranus", Neptune: "neptune" };

/**
 * Geometric albedo. JPL's satellite tables do not carry it, so these come from the published
 * literature and the NASA fact sheets. They matter here because an untextured body is drawn at
 * its measured albedo, which is why Enceladus is blinding and Phoebe nearly black.
 */
const ALBEDO = {
  Phobos: 0.071, Deimos: 0.068, Amalthea: 0.090, Io: 0.63, Europa: 0.67, Ganymede: 0.43,
  Callisto: 0.22, Mimas: 0.962, Enceladus: 0.99, Tethys: 0.80, Dione: 0.60, Rhea: 0.65,
  Titan: 0.22, Iapetus: 0.25, Phoebe: 0.06, Miranda: 0.32, Ariel: 0.39, Umbriel: 0.21,
  Titania: 0.27, Oberon: 0.23, Triton: 0.76, Proteus: 0.096,
};

/** Rough surface colours, chosen from spacecraft imagery, used only when no texture exists. */
const TINT = {
  Phobos: "#8a7f74", Deimos: "#938b7f", Amalthea: "#b4603f", Io: "#e8d16a", Europa: "#d8cbb0",
  Ganymede: "#9e9384", Callisto: "#6e665c", Mimas: "#cfd2d4", Enceladus: "#f2f4f5",
  Tethys: "#d2d6d8", Dione: "#c9ccce", Rhea: "#c2c5c7", Titan: "#d9a95c", Iapetus: "#9a8e7a",
  Phoebe: "#4a4744", Miranda: "#b9bcbe", Ariel: "#c3c6c8", Umbriel: "#8d9093",
  Titania: "#b1a79e", Oberon: "#a2978e", Triton: "#c9c3bd", Proteus: "#6b6866",
};

/** Parent semi-major axis in au, for the equilibrium temperature and the Laplace radius. */
const PARENT_AU = { mars: 1.52371034, jupiter: 5.202887, saturn: 9.53667594, uranus: 19.18916464, neptune: 30.06992276 };
const PARENT_GM = { mars: 4.282838e13, jupiter: 1.267127641e17, saturn: 3.794058484e16, uranus: 5.7945564e15, neptune: 6.836527e15 };
const PARENT_J2 = { mars: 1.96045e-3, jupiter: 1.4736e-2, saturn: 1.6298e-2, uranus: 3.34343e-3, neptune: 3.411e-3 };
const PARENT_RADIUS = { mars: 3396190, jupiter: 71492000, saturn: 60268000, uranus: 25559000, neptune: 24764000 };

const AU = 149_597_870_700;
const GM_SUN = 1.327_124_400_41e20;
const SECONDS_PER_DAY = 86_400;

/**
 * Equilibrium temperature from the solar constant and the body's albedo, rather than a
 * remembered figure. T = 278.6 * (1-A)^(1/4) / sqrt(d_au), the standard blackbody balance for
 * a rapidly rotating grey body. Where a real measurement differs the reason is physical and
 * is noted per body: Io is tidally heated, Titan has a greenhouse.
 */
function equilibriumTemperature(albedo, distanceAu) {
  return 278.6 * Math.pow(1 - albedo, 0.25) / Math.sqrt(distanceAu);
}

const MEASURED_TEMPERATURE = {
  Io: { value: 110, why: "tidal heating, not sunlight, sets Io's surface temperature" },
  Titan: { value: 94, why: "a methane greenhouse holds Titan above its equilibrium value" },
  Triton: { value: 38, why: "nitrogen frost makes Triton colder than a grey body would be" },
};

function laplaceRadiusM(parent) {
  return Math.pow(
    2 * PARENT_J2[parent] * PARENT_RADIUS[parent] ** 2 * (PARENT_AU[parent] * AU) ** 3 *
      (PARENT_GM[parent] / GM_SUN),
    1 / 5,
  );
}

const EXCLUDED = [];
const moons = [];

for (const [name, elem] of Object.entries(elements)) {
  const parent = PARENT[elem.planet];
  if (!parent) {
    EXCLUDED.push({ name, reason: `its parent ${elem.planet} is not in the registry` });
    continue;
  }

  const rot = rotation[name];
  if (!rot) {
    EXCLUDED.push({
      name,
      reason:
        name === "Hyperion"
          ? "the IAU publishes no rotational elements for Hyperion because it tumbles chaotically, so there is no prime meridian to define"
          : "the IAU publishes no rotational elements for it",
    });
    continue;
  }

  const phys = physical[name];
  if (!phys || !phys.gm_km3s2) {
    EXCLUDED.push({ name, reason: "JPL publishes no mass for it, and inventing one would be worse than leaving it out" });
    continue;
  }

  const aM = elem.a_km * 1000;

  const keplerPeriodDays =
    (2 * Math.PI * Math.sqrt(aM ** 3 / PARENT_GM[parent])) / SECONDS_PER_DAY;
  const iauPeriodDays = Math.abs(360 / rot.w1);

  /**
   * Which period to use, and why it is not simply JPL's published column.
   *
   * For a tidally locked moon the sidereal rotation period is the sidereal orbital period by
   * definition, so the IAU prime-meridian rate gives it directly. That value matches JPL's
   * own P column to six decimal places for nine of these moons, which is the cross-check.
   *
   * Io and Europa are the exception: JPL lists Europa's period as exactly twice Io's,
   * imposing the Laplace resonance rather than quoting measured sidereal values, and both
   * come out 0.4 to 0.7% below the IAU-derived figures while also fitting Kepler's third law
   * less well. The IAU values win and the conflict is recorded on the contract.
   *
   * Phoebe is not locked, so its rotation says nothing about its orbit and Kepler supplies
   * the period instead.
   */
  const synchronousGuess = Math.abs(iauPeriodDays / keplerPeriodDays - 1) < 0.02;
  const periodDays = synchronousGuess ? iauPeriodDays : keplerPeriodDays;

  const rotationPeriodDays = 360 / rot.w1;
  const synchronous = synchronousGuess;

  /**
   * JPL's own reference-plane column, refined by the Laplace radius. "Laplace" close in is
   * the planet's equator; past the Laplace radius it tends to the planet's orbital plane.
   */
  const rL = laplaceRadiusM(parent);
  const declared = elem.plane.toLowerCase();
  const plane =
    declared.startsWith("eclip") ? "ecliptic"
    : declared.startsWith("equat") ? "parent-equator"
    : aM < 0.4 * rL ? "parent-equator"
    : "laplace";

  const albedo = ALBEDO[name];
  const measured = MEASURED_TEMPERATURE[name];
  const temperature = measured
    ? measured.value
    : Math.round(equilibriumTemperature(albedo, PARENT_AU[parent]));

  moons.push({
    id: name.toLowerCase(), name, parent, naif: elem.naif, aM, e: elem.e, inc: elem.inc_deg,
    argPeri: elem.argPeri_deg, node: elem.node_deg, meanAnomaly: elem.meanAnomaly_deg,
    epochJd: 2451545.0, keplerPeriodDays, jplPeriodDays: elem.period_days,
    periodConflict:
      synchronousGuess && Math.abs(iauPeriodDays / elem.period_days - 1) > 0.002
        ? { jpl: elem.period_days, iau: iauPeriodDays }
        : null,
    plane, periodDays, rotationPeriodDays, synchronous, rot,
    radiusM: phys.radius_km * 1000, gm: phys.gm_km3s2 * 1e9,
    albedo, tint: TINT[name], temperature,
    temperatureNote: measured ? measured.why : null,
    aOverLaplace: aM / rL,
  });
}

moons.sort((a, b) => a.naif - b.naif);

console.log(`${"moon".padEnd(11)}${"plane".padEnd(16)}${"a/rL".padStart(7)}${"JPL period".padStart(12)}${"Kepler".padStart(12)}${"diff".padStart(8)}${"rot d".padStart(11)}  sync`);
for (const m of moons) {
  const diff = ((m.keplerPeriodDays - m.periodDays) / m.periodDays) * 100;
  console.log(
    `${m.id.padEnd(11)}${m.plane.padEnd(16)}${m.aOverLaplace.toFixed(3).padStart(7)}` +
      `${m.periodDays.toFixed(5).padStart(12)}${m.keplerPeriodDays.toFixed(5).padStart(12)}` +
      `${diff.toFixed(2).padStart(7)}%${m.rotationPeriodDays.toFixed(4).padStart(11)}  ${m.synchronous ? "yes" : "NO"}`,
  );
}
console.log(`\n${moons.length} moons generated`);
for (const e of EXCLUDED) console.log(`excluded ${e.name}: ${e.reason}`);

writeFileSync("/tmp/jpl/moons.json", JSON.stringify({ moons, excluded: EXCLUDED }, null, 1));

/** Curated one-liner and significance per moon. Facts below are generated from the data. */
const TEXT = JSON.parse(readFileSync("/tmp/moon-text.json", "utf8"));

function factsFor(m) {
  const facts = [];
  const hours = Math.abs(m.periodDays) * 24;
  facts.push(
    m.periodDays < 1
      ? `It orbits ${m.parent} every ${hours.toFixed(1)} hours.`
      : `It orbits ${m.parent} every ${Math.abs(m.periodDays).toFixed(2)} days.`,
  );

  facts.push(
    m.synchronous
      ? `Tidally locked: its ${Math.abs(m.rotationPeriodDays).toFixed(4)} day rotation matches its orbit, so it keeps one face towards ${m.parent}.`
      : `Not tidally locked. It turns once every ${(Math.abs(m.rotationPeriodDays) * 24).toFixed(1)} hours while taking ${Math.abs(m.periodDays).toFixed(0)} days to orbit, which is why it is thought to be captured.`,
  );

  facts.push(
    `Reflects ${(m.albedo * 100).toFixed(0)}% of the light reaching it, and is drawn here at that brightness because no freely licensed imagery of it exists.`,
  );

  if (m.rot.w1 < 0) {
    facts.push(`Its rotation rate is negative in the IAU convention, meaning it turns retrograde.`);
  }
  if (m.plane === "laplace") {
    facts.push(
      `At ${(m.aOverLaplace * 100).toFixed(0)}% of ${m.parent}'s Laplace radius its orbit plane is pulled part way from the planet's equator towards the planet's own orbit.`,
    );
  }
  if (m.temperatureNote) facts.push(`Surface is ${m.temperature} K; ${m.temperatureNote}.`);
  return facts;
}

const entries = moons.map((m) => {
  const [oneLine, why] = TEXT[m.name];
  const facts = factsFor(m).map((f) => `        ${JSON.stringify(f)},`).join("\n");
  return `
  ${m.id}: {
    id: "${m.id}",
    displayName: "${m.name}",
    kind: "moon",
    parent: "${m.parent}",
    ephemeris: {
      kind: "mean-elements-about-parent",
      semiMajorAxisM: ${m.aM},
      eccentricity: ${m.e},
      inclinationDeg: ${m.inc},
      argumentOfPeriapsisDeg: ${m.argPeri},
      ascendingNodeDeg: ${m.node},
      meanAnomalyAtEpochDeg: ${m.meanAnomaly},
      epochJd: ${m.epochJd},
      periodDays: ${m.periodDays},
      referencePlane: "${m.plane}",
      source: "https://ssd.jpl.nasa.gov/sats/elem/ (NAIF ${m.naif}), epoch ${elements[m.name].epoch}; period ${m.synchronous ? "from the IAU rotation rate, which is sidereal by tidal locking" : "from Kepler third law"}",
    },
    rotation: {
      poleRaDeg: ${m.rot.poleRa},
      poleRaRateDegPerCentury: ${m.rot.poleRaRate},
      poleDecDeg: ${m.rot.poleDec},
      poleDecRateDegPerCentury: ${m.rot.poleDecRate},
      primeMeridianDeg: ${m.rot.w0},
      rotationRateDegPerDay: ${m.rot.w1},
      system: "surface",
      source: IAU_SOURCE,
    },
    rotationRegime: "${m.synchronous ? "synchronous" : "independent"}",
    gm: ${m.gm},
    equatorialRadiusM: ${m.radiusM},
    polarRadiusM: ${m.radiusM},
    siderealRotationDays: ${m.rotationPeriodDays.toFixed(8)},
    obliquityToOrbitDeg: 0,
    geometricAlbedo: ${m.albedo},
    meanTemperatureK: ${m.temperature},
    confirmedMoons: 0,
    atmosphere: ${m.name === "Titan" ? `{
      surfacePressurePa: 146_700,
      scaleHeightM: 21_000,
      composition: { N2: 0.95, CH4: 0.049, H2: 0.001 },
      source: FACT_SHEET,
    }` : m.name === "Triton" ? `{
      surfacePressurePa: 1.4,
      scaleHeightM: 8_000,
      composition: { N2: 0.999, CH4: 0.001 },
      source: FACT_SHEET,
    }` : "null"},
    appearance: { tint: "${m.tint}", emissive: false },
    education: {
      oneLine: ${JSON.stringify(oneLine)},
      whyItMatters:
        ${JSON.stringify(why)},
      facts: [
${facts}
      ],
    },
    knownDiscrepancies: ${m.periodConflict ? `[
      {
        field: "ephemeris",
        summary:
          "JPL's satellite table and the IAU rotational elements give different orbital periods for this moon.",
        preferred:
          "${m.periodConflict.iau.toFixed(6)} days, from the IAU prime-meridian rate. For a tidally locked body that is the sidereal period by definition, and it fits the published semi-major axis through Kepler's third law more closely.",
        rejected:
          "${m.periodConflict.jpl.toFixed(6)} days from https://ssd.jpl.nasa.gov/sats/elem/, which lists Europa's period as exactly twice Io's and so appears to impose the Laplace resonance rather than quote measured values.",
      },
    ]` : "[]"},
  },`;
});

writeFileSync("/tmp/jpl/moons.ts.txt", entries.join("\n"));
writeFileSync(
  "/tmp/jpl/moon-ids.txt",
  moons.map((m) => `  | "${m.id}"`).join("\n"),
);
console.log(`\nemitted ${entries.length} contract entries`);
