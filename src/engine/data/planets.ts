/**
 * Keplerian elements for approximate positions of the major planets.
 *
 * Source: https://ssd.jpl.nasa.gov/planets/approx_pos.html (E.M. Standish and J.G. Williams,
 * 1992, reformatted by JPL/Caltech). Referenced to the mean ecliptic and equinox of J2000.
 *
 * The rows below are kept in JPL's own print order and precision so a reviewer can diff them
 * against that page line by line. They are parsed into the named domain type once, at the
 * bottom of this file, rather than being hand-expanded into named fields eight times over.
 *
 * JPL removed Pluto from this page when it was reclassified, so Pluto is not here. It needs
 * its own source.
 *
 * `quotedError` is JPL's own published accuracy table, not a tolerance we chose. The
 * ephemeris gate asserts against these numbers, so the test says "inside what JPL promises"
 * rather than "inside a number that made the test pass".
 */

import { arcsec, au, deg, type Arcseconds, type Au, type Degrees } from "../units";

export type PlanetId =
  | "mercury" | "venus" | "embary" | "mars"
  | "jupiter" | "saturn" | "uranus" | "neptune";

export const PLANET_IDS: readonly PlanetId[] = [
  "mercury", "venus", "embary", "mars", "jupiter", "saturn", "uranus", "neptune",
];

/** a(au) e I(deg) L(deg) longPeri(deg) longNode(deg), exactly JPL's column order. */
type ElementRow = readonly [number, number, number, number, number, number];

export interface ElementSet {
  readonly semiMajorAxisAu: Au;
  readonly eccentricity: number;
  readonly inclinationDeg: Degrees;
  readonly meanLongitudeDeg: Degrees;
  readonly longitudeOfPerihelionDeg: Degrees;
  readonly longitudeOfAscendingNodeDeg: Degrees;
}

/**
 * Jupiter through Neptune need extra terms in the long-span model, applied to the mean
 * anomaly as M = L - longPeri + b*T^2 + c*cos(f*T) + s*sin(f*T). Absent for the inner
 * planets and absent from the short-span model entirely, which is why it is optional.
 */
export interface LongPeriodTerms {
  readonly b: number;
  readonly c: number;
  readonly s: number;
  readonly f: number;
}

export interface PlanetElements {
  readonly atJ2000: ElementSet;
  readonly ratePerCentury: ElementSet;
  readonly longPeriodTerms?: LongPeriodTerms;
}

/** JPL's published nominal error, heliocentric. The gate's tolerance comes from here. */
export interface QuotedError {
  readonly longitude: Arcseconds;
  readonly latitude: Arcseconds;
  readonly distanceKm: number;
}

export interface EphemerisModel {
  readonly id: "short-span" | "long-span";
  readonly validFromYear: number;
  readonly validToYear: number;
  readonly elements: Readonly<Record<PlanetId, PlanetElements>>;
  readonly quotedError: Readonly<Record<PlanetId, QuotedError>>;
}

function toElementSet(row: ElementRow): ElementSet {
  return {
    semiMajorAxisAu: au(row[0]),
    eccentricity: row[1],
    inclinationDeg: deg(row[2]),
    meanLongitudeDeg: deg(row[3]),
    longitudeOfPerihelionDeg: deg(row[4]),
    longitudeOfAscendingNodeDeg: deg(row[5]),
  };
}

function toModel(
  id: EphemerisModel["id"],
  validFromYear: number,
  validToYear: number,
  rows: Readonly<Record<PlanetId, readonly [ElementRow, ElementRow]>>,
  extra: Partial<Record<PlanetId, LongPeriodTerms>>,
  errors: Readonly<Record<PlanetId, readonly [number, number, number]>>,
): EphemerisModel {
  const elements = {} as Record<PlanetId, PlanetElements>;
  const quotedError = {} as Record<PlanetId, QuotedError>;
  for (const planet of PLANET_IDS) {
    const [atEpoch, rate] = rows[planet];
    elements[planet] = {
      atJ2000: toElementSet(atEpoch),
      ratePerCentury: toElementSet(rate),
      ...(extra[planet] ? { longPeriodTerms: extra[planet] } : {}),
    };
    const [lon, lat, distThousandKm] = errors[planet];
    quotedError[planet] = {
      longitude: arcsec(lon),
      latitude: arcsec(lat),
      distanceKm: distThousandKm * 1000,
    };
  }
  return { id, validFromYear, validToYear, elements, quotedError };
}

/** Table 1. Valid 1800 AD to 2050 AD. */
export const SHORT_SPAN: EphemerisModel = toModel(
  "short-span",
  1800,
  2050,
  {
    mercury: [
      [0.38709927, 0.20563593, 7.00497902, 252.25032350, 77.45779628, 48.33076593],
      [0.00000037, 0.00001906, -0.00594749, 149472.67411175, 0.16047689, -0.12534081],
    ],
    venus: [
      [0.72333566, 0.00677672, 3.39467605, 181.97909950, 131.60246718, 76.67984255],
      [0.00000390, -0.00004107, -0.00078890, 58517.81538729, 0.00268329, -0.27769418],
    ],
    embary: [
      [1.00000261, 0.01671123, -0.00001531, 100.46457166, 102.93768193, 0.0],
      [0.00000562, -0.00004392, -0.01294668, 35999.37244981, 0.32327364, 0.0],
    ],
    mars: [
      [1.52371034, 0.09339410, 1.84969142, -4.55343205, -23.94362959, 49.55953891],
      [0.00001847, 0.00007882, -0.00813131, 19140.30268499, 0.44441088, -0.29257343],
    ],
    jupiter: [
      [5.20288700, 0.04838624, 1.30439695, 34.39644051, 14.72847983, 100.47390909],
      [-0.00011607, -0.00013253, -0.00183714, 3034.74612775, 0.21252668, 0.20469106],
    ],
    saturn: [
      [9.53667594, 0.05386179, 2.48599187, 49.95424423, 92.59887831, 113.66242448],
      [-0.00125060, -0.00050991, 0.00193609, 1222.49362201, -0.41897216, -0.28867794],
    ],
    uranus: [
      [19.18916464, 0.04725744, 0.77263783, 313.23810451, 170.95427630, 74.01692503],
      [-0.00196176, -0.00004397, -0.00242939, 428.48202785, 0.40805281, 0.04240589],
    ],
    neptune: [
      [30.06992276, 0.00859048, 1.77004347, -55.12002969, 44.96476227, 131.78422574],
      [0.00026291, 0.00005105, 0.00035372, 218.45945325, -0.32241464, -0.00508664],
    ],
  },
  {},
  {
    mercury: [15, 1, 1],
    venus: [20, 1, 4],
    embary: [20, 8, 6],
    mars: [40, 2, 25],
    jupiter: [400, 10, 600],
    saturn: [600, 25, 1500],
    uranus: [50, 2, 1000],
    neptune: [10, 1, 200],
  },
);

/** Table 2a and 2b. Valid 3000 BC to 3000 AD, with wider quoted errors. */
export const LONG_SPAN: EphemerisModel = toModel(
  "long-span",
  -3000,
  3000,
  {
    mercury: [
      [0.38709843, 0.20563661, 7.00559432, 252.25166724, 77.45771895, 48.33961819],
      [0.00000000, 0.00002123, -0.00590158, 149472.67486623, 0.15940013, -0.12214182],
    ],
    venus: [
      [0.72332102, 0.00676399, 3.39777545, 181.97970850, 131.76755713, 76.67261496],
      [-0.00000026, -0.00005107, 0.00043494, 58517.81560260, 0.05679648, -0.27274174],
    ],
    embary: [
      [1.00000018, 0.01673163, -0.00054346, 100.46691572, 102.93005885, -5.11260389],
      [-0.00000003, -0.00003661, -0.01337178, 35999.37306329, 0.31795260, -0.24123856],
    ],
    mars: [
      [1.52371243, 0.09336511, 1.85181869, -4.56813164, -23.91744784, 49.71320984],
      [0.00000097, 0.00009149, -0.00724757, 19140.29934243, 0.45223625, -0.26852431],
    ],
    jupiter: [
      [5.20248019, 0.04853590, 1.29861416, 34.33479152, 14.27495244, 100.29282654],
      [-0.00002864, 0.00018026, -0.00322699, 3034.90371757, 0.18199196, 0.13024619],
    ],
    saturn: [
      [9.54149883, 0.05550825, 2.49424102, 50.07571329, 92.86136063, 113.63998702],
      [-0.00003065, -0.00032044, 0.00451969, 1222.11494724, 0.54179478, -0.25015002],
    ],
    uranus: [
      [19.18797948, 0.04685740, 0.77298127, 314.20276625, 172.43404441, 73.96250215],
      [-0.00020455, -0.00001550, -0.00180155, 428.49512595, 0.09266985, 0.05739699],
    ],
    neptune: [
      [30.06952752, 0.00895439, 1.77005520, 304.22289287, 46.68158724, 131.78635853],
      [0.00006447, 0.00000818, 0.00022400, 218.46515314, 0.01009938, -0.00606302],
    ],
  },
  {
    jupiter: { b: -0.00012452, c: 0.06064060, s: -0.35635438, f: 38.35125000 },
    saturn: { b: 0.00025899, c: -0.13434469, s: 0.87320147, f: 38.35125000 },
    uranus: { b: 0.00058331, c: -0.97731848, s: 0.17689245, f: 7.67025000 },
    neptune: { b: -0.00041348, c: 0.68346318, s: -0.10162547, f: 7.67025000 },
  },
  {
    mercury: [20, 15, 1],
    venus: [40, 30, 8],
    embary: [40, 15, 15],
    mars: [100, 40, 30],
    jupiter: [600, 100, 1000],
    saturn: [1000, 100, 4000],
    uranus: [2000, 30, 8000],
    neptune: [400, 15, 4000],
  },
);

/** Picks the model whose published validity window actually covers the year. */
export function modelForYear(year: number): EphemerisModel {
  return year >= SHORT_SPAN.validFromYear && year <= SHORT_SPAN.validToYear
    ? SHORT_SPAN
    : LONG_SPAN;
}
