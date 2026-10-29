import Foundation

/**
 Heliocentric position for any body in the registry, resolved through its contract.

 One function so no caller branches on body kind. A port of `engine/src/bodies/position.ts`;
 see `contracts/satellite-reference-planes` for why the plane a moon's elements are quoted in
 is not a detail.
 */

/**
 A moon's position relative to its primary, from JPL's mean elements.

 The full element set, not a simplification. Using only a, e and i and inventing a node leaves
 the orbit's orientation within its plane arbitrary. That looks fine for a near-circular
 equatorial moon and is badly wrong for Triton, whose 157 degree inclination then gets added
 to Neptune's tilt rather than combined with its real node.

 These are mean elements at one epoch, so they give the orbit a moon follows on average rather
 than the perturbed path it follows this week. For Earth's Moon that is good to roughly a
 degree: fine for showing it going round, nowhere near enough for an eclipse.
 */
private func meanElementsPosition(_ source: MeanElements, at epoch: JdTdb) -> Vec3 {
    let daysSinceEpoch = epoch.value - source.epochJd
    let meanAnomaly = normaliseAngle(
        toRadians(deg(source.meanAnomalyAtEpochDeg))
            + 2 * Double.pi * daysSinceEpoch / source.periodDays
    )

    let e = source.eccentricity
    var eccentric = meanAnomaly
    for _ in 0 ..< 16 {
        let delta = (eccentric - e * sin(eccentric) - meanAnomaly) / (1 - e * cos(eccentric))
        eccentric -= delta
        if abs(delta) < 1e-13 { break }
    }

    let a = source.semiMajorAxisM
    let inPlane = Vec3(
        a * (cos(eccentric) - e),
        a * (1 - e * e).squareRoot() * sin(eccentric),
        0
    )

    // Argument of periapsis, then inclination, then node. The same sequence Kepler.swift uses
    // for the planets, so the two paths cannot drift apart in convention.
    return inPlane
        .rotatedAboutZ(toRadians(deg(source.argumentOfPeriapsisDeg)))
        .rotatedAboutX(toRadians(deg(source.inclinationDeg)))
        .rotatedAboutZ(toRadians(deg(source.ascendingNodeDeg)))
}

/**
 Rotates an orbit expressed in a planet's equatorial plane into the J2000 ecliptic.

 Not a detail. Most regular satellites orbit in their parent's equator, and for Jupiter that
 is nearly the ecliptic so the difference hides. For Uranus, tilted 98 degrees, it is the
 difference between moons circling the planet and moons sweeping through it.
 */
private func intoParentEquator(_ local: Vec3, parent: BodyId, at epoch: JdTdb) -> Vec3 {
    let pole = orientationOf(parent, at: epoch).poleEcliptic
    let tilt = acos(min(1, max(-1, pole.z)))
    let azimuth = atan2(pole.y, pole.x)
    return local.rotatedAboutX(tilt).rotatedAboutZ(azimuth)
}

public func heliocentricPositionOf(_ body: BodyId, at epoch: JdTdb) -> Vec3 {
    let contract = bodyContracts[body]!

    switch contract.ephemeris {
    case .fixedAtBarycentre:
        return .zero

    case let .standishElements(planet):
        return (try? heliocentricPosition(planet, at: epoch)) ?? .zero

    case let .meanElementsAboutParent(source):
        let local = meanElementsPosition(source, at: epoch)
        guard let parent = contract.parent else { return local }

        /**
         Three reference planes, because JPL quotes satellite elements in three.

         Close satellites sit in their planet's equator. Distant ones are pulled towards the
         planet's own orbital plane by the Sun, and the Laplace surface is the transition.
         Treating everything as equatorial puts Iapetus and Phoebe visibly wrong.
         */
        let oriented: Vec3
        switch source.referencePlane {
        case .parentEquator:
            oriented = intoParentEquator(local, parent: parent, at: epoch)
        case .laplace:
            oriented = intoPlane(
                local,
                pole: laplacePlaneFor(
                    planet: parent, semiMajorAxisM: source.semiMajorAxisM, at: epoch
                ).pole
            )
        case .ecliptic:
            oriented = local
        }

        return heliocentricPositionOf(parent, at: epoch) + oriented
    }
}

/**
 Heliocentric position and velocity for any registry body.

 A planet uses the exact analytic derivative from `Kepler.swift`. A moon is central-differenced
 over one twenty-thousandth of its own period, because differentiating the chain of plane
 rotations by hand would be a second implementation to keep in step with the first. That keeps
 truncation near 1e-8 relative for Phobos, the fastest body here, while leaving roughly nine
 significant digits in the difference itself.
 */
public func heliocentricStateOf(_ body: BodyId, at epoch: JdTdb) -> StateVector {
    let contract = bodyContracts[body]!

    switch contract.ephemeris {
    case .fixedAtBarycentre:
        return StateVector(position: .zero, velocity: .zero)

    case let .standishElements(planet):
        return (try? heliocentricState(planet, at: epoch))
            ?? StateVector(position: .zero, velocity: .zero)

    case let .meanElementsAboutParent(source):
        let half = source.periodDays / 20_000
        let before = heliocentricPositionOf(body, at: JdTdb(epoch.value - half))
        let after = heliocentricPositionOf(body, at: JdTdb(epoch.value + half))
        return StateVector(
            position: heliocentricPositionOf(body, at: epoch),
            velocity: (after - before) / (2 * half * Constants.secondsPerDay)
        )
    }
}
