/**
 * The body contracts. One entry per celestial body, each carrying its own physics.
 *
 * Rotational elements follow the IAU Working Group on Cartographic Coordinates and Rotational
 * Elements, as encoded in NASA NAIF's pck00011.tpc (the 2015 report):
 * https://naif.jpl.nasa.gov/pub/naif/generic_kernels/pck/pck00011.tpc
 *
 * Physical parameters come from https://ssd.jpl.nasa.gov/planets/phys_par.html and the NASA
 * Planetary Fact Sheet at https://nssdc.gsfc.nasa.gov/planetary/factsheet/. Where those two
 * disagree, JPL wins because it tracks the DE440 ephemeris while the fact sheet is a
 * hand-maintained snapshot, and the disagreement is recorded in `knownDiscrepancies` instead
 * of being quietly resolved.
 */

import type { BodyContract, BodyId } from "./contract";

const KM = 1000;
const KM3_TO_M3 = 1e9;

const IAU_SOURCE = "IAU WGCCRE 2015 report via NASA NAIF pck00011.tpc";
const FACT_SHEET = "https://nssdc.gsfc.nasa.gov/planetary/factsheet/";

export const BODY_CONTRACTS: Readonly<Record<BodyId, BodyContract>> = {
  sun: {
    id: "sun",
    displayName: "The Sun",
    kind: "star",
    parent: null,
    ephemeris: {
      kind: "fixed-at-barycentre",
      note:
        "Held at the origin. The Sun does wobble about the solar system barycentre by roughly " +
        "one solar radius, mostly from Jupiter, but the Standish element tables are already " +
        "heliocentric, so placing the Sun anywhere else would double-count that motion.",
    },
    rotation: {
      poleRaDeg: 286.13,
      poleRaRateDegPerCentury: 0,
      poleDecDeg: 63.87,
      poleDecRateDegPerCentury: 0,
      primeMeridianDeg: 84.176,
      rotationRateDegPerDay: 14.18440,
      system: "surface",
      source: IAU_SOURCE,
    },
    gm: 1.327_124_400_41e20,
    equatorialRadiusM: 695_700 * KM,
    polarRadiusM: 695_700 * KM,
    siderealRotationDays: 25.38,
    obliquityToOrbitDeg: 7.25,
    geometricAlbedo: 0,
    meanTemperatureK: 5772,
    confirmedMoons: 0,
    atmosphere: null,
    appearance: { albedoTextureId: "sun", tint: "#ffd27a", emissive: true },
    education: {
      oneLine: "99.86% of the solar system's mass, fusing 600 million tonnes of hydrogen a second.",
      whyItMatters:
        "Every orbit in this simulation is a response to the Sun's gravity, and every number on " +
        "the irradiance panel is a response to its luminosity. It is the one body whose " +
        "properties set the scale of everything else.",
      facts: [
        "Rotation is differential: about 25 days at the equator and 35 near the poles, because it has no solid surface to enforce one rate.",
        "Light leaving the core takes tens of thousands of years to escape, then 8 minutes 19 seconds to reach Earth.",
        "The 7.25 degree tilt of its spin axis to the ecliptic is still not fully explained.",
      ],
    },
    knownDiscrepancies: [],
  },

  mercury: {
    id: "mercury",
    displayName: "Mercury",
    kind: "planet",
    parent: "sun",
    ephemeris: { kind: "standish-elements", planet: "mercury" },
    rotation: {
      poleRaDeg: 281.0103,
      poleRaRateDegPerCentury: -0.0328,
      poleDecDeg: 61.4155,
      poleDecRateDegPerCentury: -0.0049,
      primeMeridianDeg: 329.5988,
      rotationRateDegPerDay: 6.1385108,
      system: "surface",
      source: IAU_SOURCE,
    },
    gm: 22_031.87 * KM3_TO_M3,
    equatorialRadiusM: 2_440.53 * KM,
    polarRadiusM: 2_438.26 * KM,
    siderealRotationDays: 58.6462,
    obliquityToOrbitDeg: 0.034,
    geometricAlbedo: 0.106,
    meanTemperatureK: 440,
    confirmedMoons: 0,
    atmosphere: null,
    appearance: { albedoTextureId: "mercury", tint: "#8c8c8c", emissive: false },
    education: {
      oneLine: "Locked in a 3:2 spin-orbit resonance, so its day is two of its years long.",
      whyItMatters:
        "Mercury is where Newton's gravity visibly fails. Its perihelion advances 43 arcseconds " +
        "per century more than Newtonian mechanics allows, and explaining that was general " +
        "relativity's first success.",
      facts: [
        "It rotates three times for every two orbits, so a solar day on Mercury lasts 176 Earth days.",
        "Surface temperature swings from about 100 K at night to 700 K at noon, the largest range of any planet.",
        "Its 43 arcseconds per century of anomalous precession was blamed on an undiscovered planet, Vulcan, for fifty years.",
      ],
    },
    knownDiscrepancies: [],
  },

  venus: {
    id: "venus",
    displayName: "Venus",
    kind: "planet",
    parent: "sun",
    ephemeris: { kind: "standish-elements", planet: "venus" },
    rotation: {
      poleRaDeg: 272.76,
      poleRaRateDegPerCentury: 0,
      poleDecDeg: 67.16,
      poleDecRateDegPerCentury: 0,
      primeMeridianDeg: 160.20,
      rotationRateDegPerDay: -1.4813688,
      system: "surface",
      source: IAU_SOURCE,
    },
    gm: 324_858.59 * KM3_TO_M3,
    equatorialRadiusM: 6_051.8 * KM,
    polarRadiusM: 6_051.8 * KM,
    siderealRotationDays: -243.018,
    obliquityToOrbitDeg: 177.4,
    geometricAlbedo: 0.65,
    meanTemperatureK: 737,
    confirmedMoons: 0,
    atmosphere: {
      surfacePressurePa: 9_200_000,
      scaleHeightM: 15_900,
      composition: { CO2: 0.965, N2: 0.035 },
      source: FACT_SHEET,
    },
    appearance: {
      albedoTextureId: "venus-surface",
      cloudTextureId: "venus-clouds",
      tint: "#e8cda2",
      emissive: false,
    },
    education: {
      oneLine: "Spins backwards, once every 243 days, under 92 atmospheres of carbon dioxide.",
      whyItMatters:
        "Venus receives roughly twice Earth's sunlight but sits at 737 K, far hotter than that " +
        "alone explains. It is the clearest demonstration in the solar system that atmosphere, " +
        "not distance, decides a planet's temperature.",
      facts: [
        "Its day is longer than its year: 243 days to rotate, 225 to orbit.",
        "The retrograde spin means the Sun rises in the west, every 117 Earth days.",
        "Surface pressure matches about 900 m deep in Earth's ocean.",
      ],
    },
    knownDiscrepancies: [],
  },

  embary: {
    id: "embary",
    displayName: "Earth",
    kind: "planet",
    parent: "sun",
    ephemeris: { kind: "standish-elements", planet: "embary" },
    rotation: {
      poleRaDeg: 0.0,
      poleRaRateDegPerCentury: -0.641,
      poleDecDeg: 90.0,
      poleDecRateDegPerCentury: -0.557,
      primeMeridianDeg: 190.147,
      rotationRateDegPerDay: 360.9856235,
      system: "surface",
      source: IAU_SOURCE,
    },
    gm: (398_600.44 + 4_902.8) * KM3_TO_M3,
    equatorialRadiusM: 6_378.137 * KM,
    polarRadiusM: 6_356.752 * KM,
    siderealRotationDays: 0.997270,
    obliquityToOrbitDeg: 23.44,
    geometricAlbedo: 0.367,
    meanTemperatureK: 288,
    confirmedMoons: 1,
    atmosphere: {
      surfacePressurePa: 101_325,
      scaleHeightM: 8_500,
      composition: { N2: 0.7808, O2: 0.2095, Ar: 0.0093, CO2: 0.0004 },
      source: FACT_SHEET,
    },
    appearance: {
      albedoTextureId: "earth-day",
      nightTextureId: "earth-night",
      cloudTextureId: "earth-clouds",
      tint: "#4a7fb5",
      emissive: false,
    },
    education: {
      oneLine: "A sidereal day is 23h 56m 4s, not 24 hours, because the planet also moves along its orbit.",
      whyItMatters:
        "Earth's 23.44 degree tilt, not its distance, is what makes seasons. The orbit is nearly " +
        "circular, and Earth is in fact closest to the Sun in January.",
      facts: [
        "The gm here is Earth plus Moon, because the matching element set describes the Earth-Moon barycentre rather than Earth itself.",
        "Earth is an oblate spheroid: 21 km wider across the equator than pole to pole.",
        "A sidereal day is 3 minutes 56 seconds shorter than a solar day.",
      ],
    },
    knownDiscrepancies: [],
  },

  mars: {
    id: "mars",
    displayName: "Mars",
    kind: "planet",
    parent: "sun",
    ephemeris: { kind: "standish-elements", planet: "mars" },
    rotation: {
      poleRaDeg: 317.269202,
      poleRaRateDegPerCentury: -0.10927547,
      poleDecDeg: 54.432516,
      poleDecRateDegPerCentury: -0.05827105,
      primeMeridianDeg: 176.049863,
      rotationRateDegPerDay: 350.891982443297,
      system: "surface",
      source: IAU_SOURCE,
    },
    gm: 42_828.38 * KM3_TO_M3,
    equatorialRadiusM: 3_396.19 * KM,
    polarRadiusM: 3_376.20 * KM,
    siderealRotationDays: 1.025957,
    obliquityToOrbitDeg: 25.19,
    geometricAlbedo: 0.150,
    meanTemperatureK: 208,
    confirmedMoons: 2,
    atmosphere: {
      surfacePressurePa: 636,
      scaleHeightM: 11_100,
      composition: { CO2: 0.9532, N2: 0.027, Ar: 0.016, O2: 0.0013, CO: 0.0008 },
      source: FACT_SHEET,
    },
    appearance: { albedoTextureId: "mars", tint: "#c1552d", emissive: false },
    education: {
      oneLine: "Carries Olympus Mons, 22 km tall, on a planet with 38% of Earth's surface gravity.",
      whyItMatters:
        "Mars broke the circle. Kepler could not fit its orbit to a circle and was left with an " +
        "8 arcminute residual he refused to dismiss, which is how the ellipse was found.",
      facts: [
        "The 2015 IAU report moved Mars's pole declination from 52.887 to 54.433 degrees, a real model change from better data, not added precision.",
        "Its orbital eccentricity of 0.093 is what made the 8 arcminute residual large enough for Kepler to notice.",
        "A Martian day is 24h 37m, so mission teams on Mars time drift out of sync with Earth by about 40 minutes a day.",
      ],
    },
    knownDiscrepancies: [],
  },

  jupiter: {
    id: "jupiter",
    displayName: "Jupiter",
    kind: "planet",
    parent: "sun",
    ephemeris: { kind: "standish-elements", planet: "jupiter" },
    rotation: {
      poleRaDeg: 268.056595,
      poleRaRateDegPerCentury: -0.006499,
      poleDecDeg: 64.495303,
      poleDecRateDegPerCentury: 0.002413,
      primeMeridianDeg: 284.95,
      rotationRateDegPerDay: 870.5360000,
      system: "System III (magnetic)",
      source: IAU_SOURCE,
    },
    gm: 126_712_764.1 * KM3_TO_M3,
    equatorialRadiusM: 71_492 * KM,
    polarRadiusM: 66_854 * KM,
    siderealRotationDays: 0.413540,
    obliquityToOrbitDeg: 3.13,
    geometricAlbedo: 0.52,
    meanTemperatureK: 163,
    confirmedMoons: 95,
    atmosphere: {
      surfacePressurePa: null,
      scaleHeightM: 27_000,
      composition: { H2: 0.898, He: 0.102 },
      source: FACT_SHEET,
    },
    appearance: { albedoTextureId: "jupiter", tint: "#d8a67b", emissive: false },
    education: {
      oneLine: "Massive enough that the Sun's wobble around their shared barycentre is measurable.",
      whyItMatters:
        "Jupiter is the only planet this app can weigh from Kepler's third law alone, because it " +
        "is the only one whose pull on the Sun exceeds the error in the mean elements.",
      facts: [
        "It rotates in under 10 hours, which flattens it visibly: 6% wider at the equator.",
        "The quoted rotation rate is System III, the magnetic field's period, because a gas giant has no solid surface to time.",
        "Io, Europa and Ganymede are locked in a 1:2:4 Laplace resonance, the cleanest resonance in the solar system.",
      ],
    },
    knownDiscrepancies: [],
  },

  saturn: {
    id: "saturn",
    displayName: "Saturn",
    kind: "planet",
    parent: "sun",
    ephemeris: { kind: "standish-elements", planet: "saturn" },
    rotation: {
      poleRaDeg: 40.589,
      poleRaRateDegPerCentury: -0.036,
      poleDecDeg: 83.537,
      poleDecRateDegPerCentury: -0.004,
      primeMeridianDeg: 38.90,
      rotationRateDegPerDay: 810.7939024,
      system: "System III (magnetic)",
      source: IAU_SOURCE,
    },
    gm: 37_940_584.84 * KM3_TO_M3,
    equatorialRadiusM: 60_268 * KM,
    polarRadiusM: 54_364 * KM,
    siderealRotationDays: 0.444010,
    obliquityToOrbitDeg: 26.73,
    geometricAlbedo: 0.47,
    meanTemperatureK: 133,
    confirmedMoons: 274,
    atmosphere: {
      surfacePressurePa: null,
      scaleHeightM: 59_500,
      composition: { H2: 0.963, He: 0.0325 },
      source: FACT_SHEET,
    },
    appearance: {
      albedoTextureId: "saturn",
      tint: "#e3c88f",
      emissive: false,
      ringSystem: {
        innerRadiusM: 74_658 * KM,
        outerRadiusM: 136_775 * KM,
        textureId: "saturn-ring",
        opacity: 0.92,
        source: "C ring inner edge to A ring outer edge, NASA Saturn ring fact sheet",
      },
    },
    education: {
      oneLine: "Rings 280,000 km across and often under 20 metres thick.",
      whyItMatters:
        "Saturn is the most flattened planet in the solar system, 10% wider than it is tall, " +
        "which is rotation and low density made visible rather than described.",
      facts: [
        "Mean density is about 0.69 g/cm3, less than water, so it is the only planet that would float.",
        "The rings sit inside the Roche limit, which is why they are rings and not a moon.",
        "The 2023 IAU announcement of roughly 128 new irregular moons is why the count here is 274 while JPL's own secure-orbit list shows 146.",
      ],
    },
    knownDiscrepancies: [
      {
        field: "confirmedMoons",
        summary: "The moon count depends on whether a secure orbit solution is required.",
        preferred: "274, per the NASA fact sheet of 18 March 2025, counting the 2023 IAU batch.",
        rejected: "146, per https://ssd.jpl.nasa.gov/sats/elem/, which lists only moons with published secure orbits.",
      },
    ],
  },

  uranus: {
    id: "uranus",
    displayName: "Uranus",
    kind: "planet",
    parent: "sun",
    ephemeris: { kind: "standish-elements", planet: "uranus" },
    rotation: {
      poleRaDeg: 257.311,
      poleRaRateDegPerCentury: 0,
      poleDecDeg: -15.175,
      poleDecRateDegPerCentury: 0,
      primeMeridianDeg: 203.81,
      rotationRateDegPerDay: -501.1600928,
      system: "System III (magnetic)",
      source: IAU_SOURCE,
    },
    gm: 5_794_556.40 * KM3_TO_M3,
    equatorialRadiusM: 25_559 * KM,
    polarRadiusM: 24_973 * KM,
    siderealRotationDays: -0.718330,
    obliquityToOrbitDeg: 97.77,
    geometricAlbedo: 0.51,
    meanTemperatureK: 78,
    confirmedMoons: 28,
    atmosphere: {
      surfacePressurePa: null,
      scaleHeightM: 27_700,
      composition: { H2: 0.825, He: 0.152, CH4: 0.023 },
      source: FACT_SHEET,
    },
    appearance: { albedoTextureId: "uranus", tint: "#9fd3dd", emissive: false },
    education: {
      oneLine: "Tipped 98 degrees, so it orbits on its side with 42-year polar days.",
      whyItMatters:
        "The extreme tilt is the strongest surviving evidence of a giant impact in the outer " +
        "solar system, and it makes Uranus the clearest case that a planet's spin axis is " +
        "history, not design.",
      facts: [
        "Because the tilt exceeds 90 degrees, its rotation counts as retrograde, which is why the IAU rate is negative.",
        "Each pole gets 42 years of continuous sunlight followed by 42 years of darkness.",
        "Discovered in 1781 by William Herschel, the first planet found with a telescope.",
      ],
    },
    knownDiscrepancies: [],
  },

  neptune: {
    id: "neptune",
    displayName: "Neptune",
    kind: "planet",
    parent: "sun",
    ephemeris: { kind: "standish-elements", planet: "neptune" },
    rotation: {
      poleRaDeg: 299.36,
      poleRaRateDegPerCentury: 0,
      poleDecDeg: 43.46,
      poleDecRateDegPerCentury: 0,
      primeMeridianDeg: 249.978,
      rotationRateDegPerDay: 541.1397757,
      system: "System III (magnetic)",
      source: IAU_SOURCE,
    },
    gm: 6_836_527.10 * KM3_TO_M3,
    equatorialRadiusM: 24_764 * KM,
    polarRadiusM: 24_341 * KM,
    siderealRotationDays: 0.671250,
    obliquityToOrbitDeg: 28.32,
    geometricAlbedo: 0.41,
    meanTemperatureK: 73,
    confirmedMoons: 16,
    atmosphere: {
      surfacePressurePa: null,
      scaleHeightM: 19_700,
      composition: { H2: 0.80, He: 0.19, CH4: 0.015 },
      source: FACT_SHEET,
    },
    appearance: { albedoTextureId: "neptune", tint: "#3f5ef0", emissive: false },
    education: {
      oneLine: "Found by mathematics before anyone looked: predicted from Uranus's orbital residuals.",
      whyItMatters:
        "Neptune is the triumph of perturbation theory. Le Verrier and Adams computed where an " +
        "unseen planet had to be from the way Uranus was failing to follow its predicted path, " +
        "and Galle found it within a degree of the prediction.",
      facts: [
        "Sunlight there is about a thousandth of Earth's, which is why outer-system missions carry nuclear power rather than panels.",
        "Winds reach 2,100 km/h, the fastest in the solar system, on the coldest major planet.",
        "It has completed only about one orbit since its discovery in 1846.",
      ],
    },
    knownDiscrepancies: [
      {
        field: "siderealRotationDays",
        summary:
          "The IAU rotation rate and the NASA fact sheet disagree by about 0.9%, because the " +
          "fact sheet still carries the pre-2015 value.",
        preferred:
          "The 2015 IAU rate of 541.1397757 deg/day, giving 15.967 h, per pck00011.tpc.",
        rejected:
          "16.11 h from the NASA fact sheet, which corresponds to the superseded 2009 IAU rate of 536.3128492 deg/day.",
      },
    ],
  },

  moon: {
    id: "moon",
    displayName: "The Moon",
    kind: "moon",
    parent: "embary",
    ephemeris: {
      kind: "mean-elements-about-parent",
      semiMajorAxisM: 384_400 * KM,
      eccentricity: 0.0554,
      inclinationDeg: 5.16,
      periodDays: 27.321582,
      referencePlane: "ecliptic",
      source: "https://ssd.jpl.nasa.gov/sats/elem/",
    },
    rotation: {
      poleRaDeg: 269.9949,
      poleRaRateDegPerCentury: 0.0031,
      poleDecDeg: 66.5392,
      poleDecRateDegPerCentury: 0.0130,
      primeMeridianDeg: 38.3213,
      rotationRateDegPerDay: 13.17635815,
      system: "surface",
      source: IAU_SOURCE,
    },
    gm: 4_902.800 * KM3_TO_M3,
    equatorialRadiusM: 1_738.1 * KM,
    polarRadiusM: 1_736.0 * KM,
    siderealRotationDays: 27.321582,
    obliquityToOrbitDeg: 6.68,
    geometricAlbedo: 0.12,
    meanTemperatureK: 250,
    confirmedMoons: 0,
    atmosphere: null,
    appearance: { albedoTextureId: "moon", tint: "#b8b2a8", emissive: false },
    education: {
      oneLine: "Tidally locked, so its rotation period exactly equals its orbital period.",
      whyItMatters:
        "The Moon is the test case for tidal locking, and the reason you can only ever see one " +
        "face. It is also where real elevation data makes craters visible: the surface relief " +
        "here is built from the LRO LOLA elevation model at 64 pixels per degree, which is " +
        "about 474 m per sample at the equator.",
      facts: [
        "Its 27.321582 day rotation and orbit are equal by construction of tidal locking, and this contract asserts they match.",
        "Libration means about 59% of the surface is visible from Earth over time, not 50%.",
        "It recedes from Earth by about 3.8 cm a year, measured by laser ranging off the Apollo retroreflectors.",
      ],
    },
    knownDiscrepancies: [],
  },

  phobos: {
    id: "phobos",
    displayName: "Phobos",
    kind: "moon",
    parent: "mars",
    ephemeris: {
      kind: "mean-elements-about-parent",
      semiMajorAxisM: 9375 * KM,
      eccentricity: 0.0151,
      inclinationDeg: 1.093,
      // Derived from the IAU prime-meridian rate rather than quoted separately. A tidally
      // locked moon turns once per orbit by definition, so 360/W1 is its orbital period,
      // and every one of these agrees with the published semi-major axis through Kepler's
      // third law to better than 0.2%.
      periodDays: 0.3189101,
      referencePlane: "parent-equator",
      source: "https://ssd.jpl.nasa.gov/sats/elem/ for the elements; period from the IAU rate",
    },
    rotation: {
      poleRaDeg: 317.6707,
      poleRaRateDegPerCentury: -0.1084,
      poleDecDeg: 52.8863,
      poleDecRateDegPerCentury: -0.0613,
      primeMeridianDeg: 35.1877,
      rotationRateDegPerDay: 1128.84475928,
      system: "surface",
      source: IAU_SOURCE,
    },
    gm: 0.0007087 * KM3_TO_M3,
    equatorialRadiusM: 11.08 * KM,
    polarRadiusM: 11.08 * KM,
    siderealRotationDays: 0.3189101,
    obliquityToOrbitDeg: 0,
    geometricAlbedo: 0.071,
    meanTemperatureK: 233,
    confirmedMoons: 0,
    atmosphere: null,
    appearance: { tint: "#8a7f74", emissive: false },
    education: {
      oneLine: "Orbits Mars faster than Mars rotates, so it rises in the west twice a day.",
      whyItMatters:
        "Phobos is spiralling inward by about 2 cm a year and will break up or hit Mars within roughly 50 million years, which makes it the clearest case in the solar system of a moon on borrowed time.",
      facts: [
        "Its orbital period of 7h 39m is shorter than a Martian day, so it crosses the sky backwards.",
        "It orbits about 6,000 km above the surface, closer to its planet than any other moon in the solar system.",
        "Rendered as a sphere at its 11.08 km mean radius. It is genuinely 13 by 11.4 by 9.1 km and not well described by a spheroid.",
      ],
    },
    knownDiscrepancies: [],
  },
  deimos: {
    id: "deimos",
    displayName: "Deimos",
    kind: "moon",
    parent: "mars",
    ephemeris: {
      kind: "mean-elements-about-parent",
      semiMajorAxisM: 23457 * KM,
      eccentricity: 0.00033,
      inclinationDeg: 1.788,
      // Derived from the IAU prime-meridian rate rather than quoted separately. A tidally
      // locked moon turns once per orbit by definition, so 360/W1 is its orbital period,
      // and every one of these agrees with the published semi-major axis through Kepler's
      // third law to better than 0.2%.
      periodDays: 1.26244079,
      referencePlane: "parent-equator",
      source: "https://ssd.jpl.nasa.gov/sats/elem/ for the elements; period from the IAU rate",
    },
    rotation: {
      poleRaDeg: 316.6571,
      poleRaRateDegPerCentury: -0.1052,
      poleDecDeg: 53.5099,
      poleDecRateDegPerCentury: -0.0598,
      primeMeridianDeg: 79.3993,
      rotationRateDegPerDay: 285.16188899,
      system: "surface",
      source: IAU_SOURCE,
    },
    gm: 9.62e-05 * KM3_TO_M3,
    equatorialRadiusM: 6.2 * KM,
    polarRadiusM: 6.2 * KM,
    siderealRotationDays: 1.26244079,
    obliquityToOrbitDeg: 0,
    geometricAlbedo: 0.068,
    meanTemperatureK: 233,
    confirmedMoons: 0,
    atmosphere: null,
    appearance: { tint: "#938b7f", emissive: false },
    education: {
      oneLine: "So small and distant that from the Martian surface it looks like a bright star.",
      whyItMatters:
        "Deimos is drifting away from Mars while Phobos falls in, so the two moons of one planet are heading to opposite fates, which is tidal evolution made visible in a single system.",
      facts: [
        "Its 1.26 day orbit is just longer than a Martian day, so it takes about 2.7 days to cross the sky.",
        "Its surface gravity is roughly 0.003 m/s2, so a brisk jump would reach escape velocity.",
        "Rendered as a sphere at its 6.2 km mean radius; the real body is 15 by 12.2 by 10.4 km.",
      ],
    },
    knownDiscrepancies: [],
  },
  io: {
    id: "io",
    displayName: "Io",
    kind: "moon",
    parent: "jupiter",
    ephemeris: {
      kind: "mean-elements-about-parent",
      semiMajorAxisM: 421800 * KM,
      eccentricity: 0.0041,
      inclinationDeg: 0.036,
      // Derived from the IAU prime-meridian rate rather than quoted separately. A tidally
      // locked moon turns once per orbit by definition, so 360/W1 is its orbital period,
      // and every one of these agrees with the published semi-major axis through Kepler's
      // third law to better than 0.2%.
      periodDays: 1.7691378,
      referencePlane: "parent-equator",
      source: "https://ssd.jpl.nasa.gov/sats/elem/ for the elements; period from the IAU rate",
    },
    rotation: {
      poleRaDeg: 268.05,
      poleRaRateDegPerCentury: -0.009,
      poleDecDeg: 64.5,
      poleDecRateDegPerCentury: 0.003,
      primeMeridianDeg: 200.39,
      rotationRateDegPerDay: 203.4889538,
      system: "surface",
      source: IAU_SOURCE,
    },
    gm: 5959.91547 * KM3_TO_M3,
    equatorialRadiusM: 1821.49 * KM,
    polarRadiusM: 1821.49 * KM,
    siderealRotationDays: 1.7691378,
    obliquityToOrbitDeg: 0,
    geometricAlbedo: 0.63,
    meanTemperatureK: 110,
    confirmedMoons: 0,
    atmosphere: null,
    appearance: { tint: "#e8d16a", emissive: false },
    education: {
      oneLine: "The most volcanically active body in the solar system, resurfaced faster than craters can form.",
      whyItMatters:
        "Io is squeezed by Jupiter's tides and held eccentric by its 1:2:4 resonance with Europa and Ganymede, and that tidal heating drives hundreds of active volcanoes. It is the proof that orbital dynamics can melt a world.",
      facts: [
        "Its orbit is kept eccentric by the Laplace resonance, which is what stops the tidal heating switching off.",
        "Plumes reach 500 km above the surface, high enough to feed a torus of sulphur around Jupiter.",
        "It has essentially no impact craters, because volcanism buries them faster than they accumulate.",
      ],
    },
    knownDiscrepancies: [],
  },
  europa: {
    id: "europa",
    displayName: "Europa",
    kind: "moon",
    parent: "jupiter",
    ephemeris: {
      kind: "mean-elements-about-parent",
      semiMajorAxisM: 671100 * KM,
      eccentricity: 0.0094,
      inclinationDeg: 0.466,
      // Derived from the IAU prime-meridian rate rather than quoted separately. A tidally
      // locked moon turns once per orbit by definition, so 360/W1 is its orbital period,
      // and every one of these agrees with the published semi-major axis through Kepler's
      // third law to better than 0.2%.
      periodDays: 3.55118108,
      referencePlane: "parent-equator",
      source: "https://ssd.jpl.nasa.gov/sats/elem/ for the elements; period from the IAU rate",
    },
    rotation: {
      poleRaDeg: 268.08,
      poleRaRateDegPerCentury: -0.009,
      poleDecDeg: 64.51,
      poleDecRateDegPerCentury: 0.003,
      primeMeridianDeg: 36.022,
      rotationRateDegPerDay: 101.3747235,
      system: "surface",
      source: IAU_SOURCE,
    },
    gm: 3202.7121 * KM3_TO_M3,
    equatorialRadiusM: 1560.8 * KM,
    polarRadiusM: 1560.8 * KM,
    siderealRotationDays: 3.55118108,
    obliquityToOrbitDeg: 0,
    geometricAlbedo: 0.67,
    meanTemperatureK: 102,
    confirmedMoons: 0,
    atmosphere: null,
    appearance: { tint: "#d8cbb0", emissive: false },
    education: {
      oneLine: "A cracked ice shell over an ocean holding more liquid water than every ocean on Earth.",
      whyItMatters:
        "Europa is the strongest candidate for life beyond Earth that we can actually reach. The same tidal heating that melts Io keeps Europa's subsurface ocean liquid under a shell only tens of kilometres thick.",
      facts: [
        "Its geometric albedo of 0.67 makes it one of the most reflective large bodies in the solar system, because the surface is young water ice.",
        "The crack patterns across the ice only make sense if the shell is decoupled from the interior by liquid.",
        "It sits in the middle of the Laplace resonance, orbiting exactly twice for every Ganymede orbit.",
      ],
    },
    knownDiscrepancies: [],
  },
  ganymede: {
    id: "ganymede",
    displayName: "Ganymede",
    kind: "moon",
    parent: "jupiter",
    ephemeris: {
      kind: "mean-elements-about-parent",
      semiMajorAxisM: 1070400 * KM,
      eccentricity: 0.0013,
      inclinationDeg: 0.177,
      // Derived from the IAU prime-meridian rate rather than quoted separately. A tidally
      // locked moon turns once per orbit by definition, so 360/W1 is its orbital period,
      // and every one of these agrees with the published semi-major axis through Kepler's
      // third law to better than 0.2%.
      periodDays: 7.15455312,
      referencePlane: "parent-equator",
      source: "https://ssd.jpl.nasa.gov/sats/elem/ for the elements; period from the IAU rate",
    },
    rotation: {
      poleRaDeg: 268.2,
      poleRaRateDegPerCentury: -0.009,
      poleDecDeg: 64.57,
      poleDecRateDegPerCentury: 0.003,
      primeMeridianDeg: 44.064,
      rotationRateDegPerDay: 50.3176081,
      system: "surface",
      source: IAU_SOURCE,
    },
    gm: 9887.83275 * KM3_TO_M3,
    equatorialRadiusM: 2631.2 * KM,
    polarRadiusM: 2631.2 * KM,
    siderealRotationDays: 7.15455312,
    obliquityToOrbitDeg: 0,
    geometricAlbedo: 0.43,
    meanTemperatureK: 110,
    confirmedMoons: 0,
    atmosphere: null,
    appearance: { tint: "#9e9384", emissive: false },
    education: {
      oneLine: "Larger than Mercury, and the only moon with a magnetic field of its own.",
      whyItMatters:
        "Ganymede is the largest moon in the solar system and generates its own magnetosphere from a liquid iron core, which no other moon does. It would comfortably be called a planet if it orbited the Sun instead.",
      facts: [
        "At 2,631 km radius it is larger than Mercury, though only about half its mass.",
        "Its intrinsic magnetic field carves a magnetosphere inside Jupiter's own, the only known magnetosphere within a magnetosphere.",
        "It completes exactly one orbit for every two of Europa's and four of Io's, the outer link of the Laplace resonance.",
      ],
    },
    knownDiscrepancies: [],
  },
  callisto: {
    id: "callisto",
    displayName: "Callisto",
    kind: "moon",
    parent: "jupiter",
    ephemeris: {
      kind: "mean-elements-about-parent",
      semiMajorAxisM: 1882700 * KM,
      eccentricity: 0.0074,
      inclinationDeg: 0.192,
      // Derived from the IAU prime-meridian rate rather than quoted separately. A tidally
      // locked moon turns once per orbit by definition, so 360/W1 is its orbital period,
      // and every one of these agrees with the published semi-major axis through Kepler's
      // third law to better than 0.2%.
      periodDays: 16.68901797,
      referencePlane: "parent-equator",
      source: "https://ssd.jpl.nasa.gov/sats/elem/ for the elements; period from the IAU rate",
    },
    rotation: {
      poleRaDeg: 268.72,
      poleRaRateDegPerCentury: -0.009,
      poleDecDeg: 64.83,
      poleDecRateDegPerCentury: 0.003,
      primeMeridianDeg: 259.51,
      rotationRateDegPerDay: 21.5710715,
      system: "surface",
      source: IAU_SOURCE,
    },
    gm: 7179.2834 * KM3_TO_M3,
    equatorialRadiusM: 2410.3 * KM,
    polarRadiusM: 2410.3 * KM,
    siderealRotationDays: 16.68901797,
    obliquityToOrbitDeg: 0,
    geometricAlbedo: 0.22,
    meanTemperatureK: 134,
    confirmedMoons: 0,
    atmosphere: null,
    appearance: { tint: "#6e665c", emissive: false },
    education: {
      oneLine: "The most heavily cratered surface known, essentially unchanged for four billion years.",
      whyItMatters:
        "Callisto sits outside the Laplace resonance, so it was never tidally heated and never resurfaced. It is the control case: what a Galilean moon looks like when orbital dynamics leave it alone.",
      facts: [
        "Its surface is saturated with craters, meaning new impacts can only erase old ones rather than add to the count.",
        "It orbits far enough out to sit outside Jupiter's worst radiation belts, which is why it keeps appearing in crewed mission studies.",
        "Being outside the resonance is exactly why it is geologically dead while Io is the most active body in the solar system.",
      ],
    },
    knownDiscrepancies: [],
  },
  enceladus: {
    id: "enceladus",
    displayName: "Enceladus",
    kind: "moon",
    parent: "saturn",
    ephemeris: {
      kind: "mean-elements-about-parent",
      semiMajorAxisM: 238400 * KM,
      eccentricity: 0.0047,
      inclinationDeg: 0.009,
      // Derived from the IAU prime-meridian rate rather than quoted separately. A tidally
      // locked moon turns once per orbit by definition, so 360/W1 is its orbital period,
      // and every one of these agrees with the published semi-major axis through Kepler's
      // third law to better than 0.2%.
      periodDays: 1.37021808,
      referencePlane: "parent-equator",
      source: "https://ssd.jpl.nasa.gov/sats/elem/ for the elements; period from the IAU rate",
    },
    rotation: {
      poleRaDeg: 40.66,
      poleRaRateDegPerCentury: -0.036,
      poleDecDeg: 83.52,
      poleDecRateDegPerCentury: -0.004,
      primeMeridianDeg: 6.32,
      rotationRateDegPerDay: 262.7318996,
      system: "surface",
      source: IAU_SOURCE,
    },
    gm: 7.21037 * KM3_TO_M3,
    equatorialRadiusM: 252.1 * KM,
    polarRadiusM: 252.1 * KM,
    siderealRotationDays: 1.37021808,
    obliquityToOrbitDeg: 0,
    geometricAlbedo: 0.99,
    meanTemperatureK: 75,
    confirmedMoons: 0,
    atmosphere: null,
    appearance: { tint: "#f2f4f5", emissive: false },
    education: {
      oneLine: "Vents its subsurface ocean into space, and those plumes build one of Saturn's rings.",
      whyItMatters:
        "Enceladus is the only place where a subsurface ocean samples itself for us. Cassini flew through the plumes and found salts and organic molecules, so a spacecraft can taste an alien ocean without ever landing.",
      facts: [
        "Its geometric albedo near 0.99 makes it the most reflective body in the solar system, because the plumes constantly resurface it with fresh ice.",
        "The plumes from its south polar tiger stripes supply Saturn's E ring.",
        "It is only 252 km in radius, small enough that nobody expected it to be geologically active at all.",
      ],
    },
    knownDiscrepancies: [],
  },
  titan: {
    id: "titan",
    displayName: "Titan",
    kind: "moon",
    parent: "saturn",
    ephemeris: {
      kind: "mean-elements-about-parent",
      semiMajorAxisM: 1221900 * KM,
      eccentricity: 0.0288,
      inclinationDeg: 0.28,
      // Derived from the IAU prime-meridian rate rather than quoted separately. A tidally
      // locked moon turns once per orbit by definition, so 360/W1 is its orbital period,
      // and every one of these agrees with the published semi-major axis through Kepler's
      // third law to better than 0.2%.
      periodDays: 15.94544758,
      referencePlane: "parent-equator",
      source: "https://ssd.jpl.nasa.gov/sats/elem/ for the elements; period from the IAU rate",
    },
    rotation: {
      poleRaDeg: 39.4827,
      poleRaRateDegPerCentury: 0.0,
      poleDecDeg: 83.4279,
      poleDecRateDegPerCentury: 0.0,
      primeMeridianDeg: 186.5855,
      rotationRateDegPerDay: 22.5769768,
      system: "surface",
      source: IAU_SOURCE,
    },
    gm: 8978.1371 * KM3_TO_M3,
    equatorialRadiusM: 2574.76 * KM,
    polarRadiusM: 2574.76 * KM,
    siderealRotationDays: 15.94544758,
    obliquityToOrbitDeg: 0,
    geometricAlbedo: 0.22,
    meanTemperatureK: 94,
    confirmedMoons: 0,
    atmosphere: {
      surfacePressurePa: 146_700,
      scaleHeightM: 21_000,
      composition: { N2: 0.95, CH4: 0.049, H2: 0.001 },
      source: FACT_SHEET,
    },
    appearance: { tint: "#d9a95c", emissive: false },
    education: {
      oneLine: "The only moon with a substantial atmosphere, and the only other place with liquid on its surface.",
      whyItMatters:
        "Titan has rivers, lakes and seas, and rain that falls and carves channels. They are made of methane rather than water, which makes it the closest thing to an Earth-like weather cycle anywhere else in the solar system.",
      facts: [
        "Surface pressure is about 1.45 times Earth's, under an atmosphere 95% nitrogen.",
        "Its lakes of liquid methane and ethane were mapped by Cassini radar; Ligeia Mare alone is larger than Lake Superior.",
        "The thick haze meant nobody saw the surface until Huygens landed in 2005.",
      ],
    },
    knownDiscrepancies: [],
  },
  triton: {
    id: "triton",
    displayName: "Triton",
    kind: "moon",
    parent: "neptune",
    ephemeris: {
      kind: "mean-elements-about-parent",
      semiMajorAxisM: 354800 * KM,
      eccentricity: 1.6e-05,
      inclinationDeg: 156.865,
      // Derived from the IAU prime-meridian rate rather than quoted separately. A tidally
      // locked moon turns once per orbit by definition, so 360/W1 is its orbital period,
      // and every one of these agrees with the published semi-major axis through Kepler's
      // third law to better than 0.2%.
      periodDays: -5.87685408,
      referencePlane: "parent-equator",
      source: "https://ssd.jpl.nasa.gov/sats/elem/ for the elements; period from the IAU rate",
    },
    rotation: {
      poleRaDeg: 299.36,
      poleRaRateDegPerCentury: 0.0,
      poleDecDeg: 41.17,
      poleDecRateDegPerCentury: 0.0,
      primeMeridianDeg: 296.53,
      rotationRateDegPerDay: -61.2572637,
      system: "surface",
      source: IAU_SOURCE,
    },
    gm: 1428.49546 * KM3_TO_M3,
    equatorialRadiusM: 1352.6 * KM,
    polarRadiusM: 1352.6 * KM,
    siderealRotationDays: -5.87685408,
    obliquityToOrbitDeg: 0,
    geometricAlbedo: 0.76,
    meanTemperatureK: 38,
    confirmedMoons: 0,
    atmosphere: {
      surfacePressurePa: 1.4,
      scaleHeightM: 8_000,
      composition: { N2: 0.999, CH4: 0.001 },
      source: FACT_SHEET,
    },
    appearance: { tint: "#c9c3bd", emissive: false },
    education: {
      oneLine: "Orbits Neptune backwards, which means it was captured rather than formed there.",
      whyItMatters:
        "Triton is a Kuiper belt object Neptune caught. Its retrograde orbit cannot arise from a disc, so it is direct evidence that the outer solar system rearranged itself, and it is slowly spiralling in to be torn apart.",
      facts: [
        "Its 157 degree inclination makes the orbit retrograde, which no large moon formed in place can be.",
        "At 38 K it is one of the coldest measured surfaces in the solar system, cold enough for nitrogen frost.",
        "Voyager 2 photographed active nitrogen geysers there in 1989, on a world nobody expected to be active.",
      ],
    },
    knownDiscrepancies: [],
  },
};

export const BODY_IDS = Object.keys(BODY_CONTRACTS) as readonly BodyId[];

export function contractFor(id: BodyId): BodyContract {
  return BODY_CONTRACTS[id];
}

export function childrenOf(id: BodyId): readonly BodyId[] {
  return BODY_IDS.filter((candidate) => BODY_CONTRACTS[candidate].parent === id);
}

export type { BodyContract, BodyId } from "./contract";
