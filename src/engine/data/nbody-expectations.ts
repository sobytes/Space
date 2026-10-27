/**
 * What the N-body mode is expected to reproduce, and where each expectation comes from.
 *
 * Two kinds of expectation live here and they are not interchangeable.
 *
 * A `derived` expectation is computed inside this repository by an independent route, so the
 * gate comparing against it is a real cross-check: two algorithms, one physics, and a
 * disagreement means one of them is wrong. Those carry tight tolerances.
 *
 * An `external` expectation is a published number. It is the stronger kind of evidence when the
 * citation is solid, and worthless when it is misremembered. Any entry marked `verified: false`
 * was recalled rather than checked against a source in-session, and the gate requires it to say
 * so and to carry a tolerance wide enough to be honest about that. The remedy is a citation, not
 * a tighter bound: narrowing a tolerance around a half-remembered figure manufactures false
 * precision and would eventually fail for the wrong reason.
 *
 * Self-consistency of my recalled Mercury budget was checked and it does not hold. The figures
 * for the observed advance, the general precession of the equinox, the planetary contribution
 * and the relativistic residual do not sum correctly in any arrangement I can reconstruct,
 * which means at least one is wrong in my memory. That is exactly why these are marked
 * unverified and given percent-level room rather than being asserted sharply.
 */

export interface Expectation {
  readonly quantity: string;
  readonly value: number;
  readonly unit: string;
  /** `derived` is computed in-repo by another method; `external` comes from the literature. */
  readonly kind: "derived" | "external";
  /** False means recalled in-session without a checked citation. */
  readonly verified: boolean;
  /** Fractional tolerance the gate allows. */
  readonly tolerance: number;
  readonly provenance: string;
}

export const EXPECTATIONS: Readonly<Record<string, Expectation>> = {
  mercuryPlanetaryPrecession: {
    quantity: "Mercury's perihelion advance from Newtonian planetary perturbations",
    value: 531.5,
    unit: "arcsec/century",
    kind: "external",
    verified: false,
    tolerance: 0.02,
    provenance:
      "The classical result, Le Verrier 1859 and refined by Clemence 1947, recalled from " +
      "memory. No citation was fetched: this session's web search budget was exhausted. The " +
      "repo measures 528.9, which is 0.5% below the recalled figure. Treat the gap as " +
      "unresolved rather than as either side being right. The in-repo quadrature cross-check " +
      "in secular.ts is the load-bearing evidence for the dynamics; this entry only confirms " +
      "the result sits in the right place.",
  },

  earthContributionToMercury: {
    quantity: "Earth and Moon's share of Mercury's perihelion advance",
    value: 90.0,
    unit: "arcsec/century",
    kind: "external",
    verified: false,
    tolerance: 0.03,
    provenance:
      "Recalled from the standard per-planet breakdown. Included because the repo measures " +
      "90.08 against it, agreeing to 0.09%, which is far tighter than the total agrees. That " +
      "pattern is informative: a definitional error would bias every perturber by the same " +
      "ratio, and one row matching to 0.1% while the total is off by 0.5% points at the " +
      "recalled numbers rather than at the method.",
  },

  sunBarycentreMaxOverThirtyYears: {
    quantity: "greatest Sun-to-barycentre distance in the 30 years from J2000",
    value: 1.383e9,
    unit: "metres",
    kind: "derived",
    verified: true,
    tolerance: 0.05,
    provenance:
      "Measured in this repo and reported so the well-established qualitative fact is gated: " +
      "the solar system's barycentre spends much of its time outside the Sun's surface. The " +
      "measured maximum is 1.99 solar radii, dominated by Jupiter, whose own contribution is " +
      "a_J * m_J/M_sun = 7.78e11 * 9.54e-4 = 7.4e8 m, slightly over one solar radius on its " +
      "own. Anything far from this would mean the Sun is wrongly pinned or wrongly massed.",
  },

  leadingOrderCoefficient: {
    quantity: "ratio of the small-alpha closed form to the exact quadrature, as alpha -> 0",
    value: 1,
    unit: "dimensionless",
    kind: "derived",
    verified: true,
    tolerance: 1e-3,
    provenance:
      "Hand-derived in secular.ts: expand the disturbing function in Legendre polynomials, the " +
      "l=1 direct term cancels the indirect term, <P2> = 1/4 for a circular perturber and " +
      "<r^2> = a^2(1 + 3e^2/2), giving (3/4) sqrt(1-e^2) n (m2/M) alpha^3. The quadrature must " +
      "converge onto this as alpha shrinks. This is the one check that pins the quadrature's " +
      "absolute scale and sign to algebra rather than to another numerical method.",
  },
};
