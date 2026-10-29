import Foundation

/**
 Approximate planetary positions from the JPL Standish Keplerian element tables.

 Algorithm: https://ssd.jpl.nasa.gov/planets/approx_pos.html. Elements drift linearly with
 time, the mean anomaly is solved for the eccentric anomaly, and the orbital-plane coordinates
 are rotated into the J2000 ecliptic by argument of perihelion, inclination and longitude of
 ascending node, in that order.

 Everything returned is heliocentric, metres and metres per second, mean ecliptic and equinox
 of J2000.

 Velocity is the exact analytic derivative of the position function, including the drift of
 every element and of the long-period terms, not a finite difference. That matters for the
 N-body seeding, where a finite-difference velocity error becomes a position error growing
 linearly in time. The gate pins it against a central difference of the same position function.

 This is a hand-port of `engine/src/kepler.ts`. The tables it reads are generated from the same
 source, and `KeplerTests` runs it against the same JPL Horizons fixtures to the same
 tolerances, which is what catches the port drifting. See `contracts/ephemeris-accuracy`.
 */

public enum KeplerError: Error, CustomStringConvertible {
    case didNotConverge(meanAnomaly: Double, eccentricity: Double)

    public var description: String {
        switch self {
        case let .didNotConverge(m, e):
            return "Kepler's equation did not converge (M=\(m), e=\(e))"
        }
    }
}

private let eccentricAnomalyTolerance = 1e-13
private let eccentricAnomalyMaxIterations = 40

/// Solves `M = E - e sin E` for E. Throws rather than returning a half-solved value.
public func solveEccentricAnomaly(meanAnomaly: Double, eccentricity: Double) throws -> Double {
    var e = meanAnomaly + eccentricity * sin(meanAnomaly)
    for _ in 0 ..< eccentricAnomalyMaxIterations {
        let residual = e - eccentricity * sin(e) - meanAnomaly
        let step = residual / (1 - eccentricity * cos(e))
        e -= step
        if abs(step) < eccentricAnomalyTolerance { return e }
    }
    throw KeplerError.didNotConverge(meanAnomaly: meanAnomaly, eccentricity: eccentricity)
}

/// Elements evaluated at an epoch, with each one's rate carried alongside it.
private struct Evaluated {
    let semiMajorAxisM: Double
    let semiMajorAxisMPerCentury: Double
    let eccentricity: Double
    let eccentricityPerCentury: Double
    let inclinationRad: Double
    let inclinationRadPerCentury: Double
    let argumentOfPerihelionRad: Double
    let argumentOfPerihelionRadPerCentury: Double
    let ascendingNodeRad: Double
    let ascendingNodeRadPerCentury: Double
    let meanAnomalyRad: Double
    let meanAnomalyRadPerCentury: Double
}

private func evaluate(_ elements: PlanetElements, centuries t: Double) -> Evaluated {
    let at = elements.atJ2000
    let rate = elements.ratePerCentury

    let semiMajorAxisAu = at.semiMajorAxisAu + rate.semiMajorAxisAu * t
    let inclinationDeg = at.inclinationDeg + rate.inclinationDeg * t
    let meanLongitudeDeg = at.meanLongitudeDeg + rate.meanLongitudeDeg * t
    let longitudeOfPerihelionDeg = at.longitudeOfPerihelionDeg + rate.longitudeOfPerihelionDeg * t
    let ascendingNodeDeg = at.longitudeOfAscendingNodeDeg + rate.longitudeOfAscendingNodeDeg * t

    var meanAnomalyDeg = meanLongitudeDeg - longitudeOfPerihelionDeg
    var meanAnomalyRateDeg = rate.meanLongitudeDeg - rate.longitudeOfPerihelionDeg

    if let extra = elements.longPeriodTerms {
        let phase = toRadians(deg(extra.f * t))
        let phaseRate = toRadians(deg(extra.f))
        meanAnomalyDeg += extra.b * t * t + extra.c * cos(phase) + extra.s * sin(phase)
        meanAnomalyRateDeg += 2 * extra.b * t
            - extra.c * sin(phase) * phaseRate
            + extra.s * cos(phase) * phaseRate
    }

    return Evaluated(
        semiMajorAxisM: toMetres(au(semiMajorAxisAu)),
        semiMajorAxisMPerCentury: toMetres(au(rate.semiMajorAxisAu)),
        eccentricity: at.eccentricity + rate.eccentricity * t,
        eccentricityPerCentury: rate.eccentricity,
        inclinationRad: toRadians(deg(inclinationDeg)),
        inclinationRadPerCentury: toRadians(deg(rate.inclinationDeg)),
        argumentOfPerihelionRad: toRadians(deg(longitudeOfPerihelionDeg - ascendingNodeDeg)),
        argumentOfPerihelionRadPerCentury: toRadians(
            deg(rate.longitudeOfPerihelionDeg - rate.longitudeOfAscendingNodeDeg)
        ),
        ascendingNodeRad: toRadians(deg(ascendingNodeDeg)),
        ascendingNodeRadPerCentury: toRadians(deg(rate.longitudeOfAscendingNodeDeg)),
        meanAnomalyRad: normaliseAngleSigned(toRadians(deg(meanAnomalyDeg))),
        meanAnomalyRadPerCentury: toRadians(deg(meanAnomalyRateDeg))
    )
}

/// A vector and its time derivative, carried together so one rotation turns both.
private struct Moving {
    let value: Vec3
    let rate: Vec3
}

/**
 Rotates a moving vector about `axis` by an angle that is itself changing, applying the product
 rule `d/dT (R v) = R dv/dT + (dangle/dT) (axis x R v)`.
 */
private func rotateMoving(
    _ moving: Moving,
    by radians: Double,
    rate radiansRate: Double,
    about axis: Vec3,
    _ rotate: (Vec3, Double) -> Vec3
) -> Moving {
    let value = rotate(moving.value, radians)
    return Moving(
        value: value,
        rate: rotate(moving.rate, radians) + axis.cross(value) * radiansRate
    )
}

private let xAxis = Vec3(1, 0, 0)
private let zAxis = Vec3(0, 0, 1)

private func state(from el: Evaluated) throws -> StateVector {
    let anomaly = try solveEccentricAnomaly(
        meanAnomaly: el.meanAnomalyRad, eccentricity: el.eccentricity
    )
    let cosE = cos(anomaly)
    let sinE = sin(anomaly)

    let minorFactor = (1 - el.eccentricity * el.eccentricity).squareRoot()
    let semiMinorAxis = el.semiMajorAxisM * minorFactor

    let anomalyRate = (el.meanAnomalyRadPerCentury + sinE * el.eccentricityPerCentury)
        / (1 - el.eccentricity * cosE)
    let semiMinorAxisRate = el.semiMajorAxisMPerCentury * minorFactor
        - (el.semiMajorAxisM * el.eccentricity * el.eccentricityPerCentury) / minorFactor

    let inPlane = Moving(
        value: Vec3(el.semiMajorAxisM * (cosE - el.eccentricity), semiMinorAxis * sinE, 0),
        rate: Vec3(
            el.semiMajorAxisMPerCentury * (cosE - el.eccentricity)
                + el.semiMajorAxisM * (-sinE * anomalyRate - el.eccentricityPerCentury),
            semiMinorAxisRate * sinE + semiMinorAxis * cosE * anomalyRate,
            0
        )
    )

    let perihelion = rotateMoving(
        inPlane,
        by: el.argumentOfPerihelionRad,
        rate: el.argumentOfPerihelionRadPerCentury,
        about: zAxis
    ) { $0.rotatedAboutZ($1) }

    let inclined = rotateMoving(
        perihelion,
        by: el.inclinationRad,
        rate: el.inclinationRadPerCentury,
        about: xAxis
    ) { $0.rotatedAboutX($1) }

    let ecliptic = rotateMoving(
        inclined,
        by: el.ascendingNodeRad,
        rate: el.ascendingNodeRadPerCentury,
        about: zAxis
    ) { $0.rotatedAboutZ($1) }

    return StateVector(
        position: ecliptic.value,
        velocity: ecliptic.rate / Constants.secondsPerJulianCentury
    )
}

/**
 Heliocentric position and velocity, metres and metres per second, J2000 ecliptic.

 Without an explicit `model` the table is chosen by the year, so a caller needing one table
 across a span that crosses 1800 or 2050 must pass it: the two disagree at the seam.
 */
public func heliocentricState(
    _ planet: Planet,
    at jd: JdTdb,
    model: EphemerisModel? = nil
) throws -> StateVector {
    let resolved = model ?? modelForYear(julianYearForModelSelection(jd))
    guard let elements = resolved.elements[planet] else {
        fatalError("\(resolved.id) has no elements for \(planet.rawValue)")
    }
    return try state(from: evaluate(elements, centuries: julianCenturiesSinceJ2000(jd)))
}

public func heliocentricPosition(
    _ planet: Planet,
    at jd: JdTdb,
    model: EphemerisModel? = nil
) throws -> Vec3 {
    try heliocentricState(planet, at: jd, model: model).position
}
