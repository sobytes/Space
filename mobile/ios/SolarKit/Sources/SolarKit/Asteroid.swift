import Foundation

/**
 Launch an asteroid and propagate it under the real gravity of every body in the registry.

 A port of `engine/src/scenarios/asteroid.ts`. This is the mode that makes masses matter even
 on rails: the perturber list is built from the body registry, so every planet pulls the
 trajectory whether or not the planets themselves are integrated mutually.
 */

public struct AsteroidLaunch: Sendable {
    /// Where the body starts, as an offset from this body's centre.
    public var originBody: BodyId
    /// Distance above the origin body's surface at release, metres.
    public var altitudeM: Double
    /// Speed relative to the origin body, m/s.
    public var speedMS: Double
    /// Direction in the ecliptic plane, degrees. Zero points along the body's orbital motion.
    public var headingDeg: Double
    /// Out-of-plane angle, degrees.
    public var inclinationDeg: Double
    public var startEpoch: JdTdb
    public var durationYears: Double
    /// Diameter, metres. Used only for the impact energy estimate.
    public var diameterM: Double
    /// Bulk density, kg/m^3. 3000 is typical for a stony asteroid, 8000 for iron.
    public var densityKgM3: Double

    public init(
        originBody: BodyId = .mars,
        altitudeM: Double = 5e9,
        speedMS: Double = 6_000,
        headingDeg: Double = 180,
        inclinationDeg: Double = 0,
        startEpoch: JdTdb = JdTdb(Epochs.j2000),
        durationYears: Double = 50,
        diameterM: Double = 300,
        densityKgM3: Double = 3_000
    ) {
        self.originBody = originBody
        self.altitudeM = altitudeM
        self.speedMS = speedMS
        self.headingDeg = headingDeg
        self.inclinationDeg = inclinationDeg
        self.startEpoch = startEpoch
        self.durationYears = durationYears
        self.diameterM = diameterM
        self.densityKgM3 = densityKgM3
    }
}

public func asteroidForceModel(startEpoch: JdTdb) -> ForceModel {
    ForceModel(
        centralGm: Constants.gmSun,
        perturbers: perturbersFrom(startEpoch: startEpoch),
        relativistic: false
    )
}

/**
 The release state.

 The origin body's own motion comes from a short central difference of its position. Using
 the body's real velocity rather than zero is what makes "drop it near Mars" behave like Mars
 rather than like a stone appearing at rest in Mars's orbit.
 */
public func initialStateFor(_ launch: AsteroidLaunch) -> StateVector {
    let origin = heliocentricPositionOf(launch.originBody, at: launch.startEpoch)

    let dt = 60.0
    let ahead = heliocentricPositionOf(
        launch.originBody, at: JdTdb(launch.startEpoch.value + dt / Constants.secondsPerDay)
    )
    let behind = heliocentricPositionOf(
        launch.originBody, at: JdTdb(launch.startEpoch.value - dt / Constants.secondsPerDay)
    )
    let carrier = (ahead - behind) / (2 * dt)

    let alongTrack = carrier.normalised
    let outward = origin.normalised
    let normal = outward.cross(alongTrack).normalised

    let heading = launch.headingDeg * Double.pi / 180
    let climb = launch.inclinationDeg * Double.pi / 180

    let direction = (alongTrack * (cos(heading) * cos(climb))
        + outward * (sin(heading) * cos(climb))
        + normal * sin(climb)).normalised

    let releaseRadius = bodyContracts[launch.originBody]!.equatorialRadiusM + launch.altitudeM
    return StateVector(
        position: origin + outward * releaseRadius,
        velocity: carrier + direction * launch.speedMS
    )
}

public struct ImpactEstimate: Sendable {
    public let massKg: Double
    public let speedMS: Double
    public let energyJoules: Double
    public let energyMegatonsTnt: Double
    public let comparison: String
}

private let joulesPerTonneTnt = 4.184e9

/// Kinetic energy in megatons, with a comparison to a real event so the number means something.
public func impactEnergy(
    diameterM: Double, densityKgM3: Double, speedMS: Double
) -> ImpactEstimate {
    let radius = diameterM / 2
    let massKg = (4.0 / 3.0) * Double.pi * pow(radius, 3) * densityKgM3
    let energyJoules = 0.5 * massKg * speedMS * speedMS
    let megatons = energyJoules / (joulesPerTonneTnt * 1e6)

    let comparison: String
    if megatons < 0.02 {
        comparison = "below the Chelyabinsk airburst of 2013, about 0.5 Mt"
    } else if megatons < 5 {
        comparison = "the scale of the 1908 Tunguska airburst, usually put at 3 to 15 Mt"
    } else if megatons < 1e5 {
        comparison = "larger than any weapon ever detonated, the 50 Mt Tsar Bomba"
    } else {
        comparison = "the scale of the Chicxulub impact, around 100 million Mt"
    }

    return ImpactEstimate(
        massKg: massKg, speedMS: speedMS, energyJoules: energyJoules,
        energyMegatonsTnt: megatons, comparison: comparison
    )
}

public struct AsteroidOutcome: Sendable {
    public let result: PropagationResult
    public let impact: ImpactEstimate?
    public let summary: String
}

public func runAsteroid(_ launch: AsteroidLaunch) -> AsteroidOutcome {
    let initial = initialStateFor(launch)
    let result = propagate(PropagateOptions(
        model: asteroidForceModel(startEpoch: launch.startEpoch),
        initial: initial,
        durationSeconds: launch.durationYears * Constants.secondsPerJulianYear,
        limits: PropagationLimits(tolerance: 1e-9, maxStepSeconds: 5 * Constants.secondsPerDay),
        sampleIntervalSeconds: launch.durationYears * Constants.secondsPerJulianYear / 600
    ))

    var impact: ImpactEstimate?
    var summary: String

    switch result.fate {
    case let .impact(body, atSeconds):
        let name = BodyId(rawValue: body).flatMap { bodyContracts[$0]?.displayName } ?? body
        let speed = result.samples.last.map(\.velocity.length) ?? launch.speedMS
        impact = impactEnergy(
            diameterM: launch.diameterM, densityKgM3: launch.densityKgM3, speedMS: speed
        )
        summary = "Hit \(name) after "
            + String(format: "%.2f years", atSeconds / Constants.secondsPerJulianYear)
    case let .escaped(atSeconds, eccentricity):
        summary = "Left the solar system after "
            + String(format: "%.1f years", atSeconds / Constants.secondsPerJulianYear)
            + String(format: ", eccentricity %.3f", eccentricity)
    case let .stepLimit(atSeconds):
        summary = "Ran out of integration budget after "
            + String(format: "%.1f years", atSeconds / Constants.secondsPerJulianYear)
    case .propagating:
        let final = result.samples.last!
        let elements = osculatingElements(
            gm: Constants.gmSun, position: final.position, velocity: final.velocity
        )
        summary = "Still in orbit after "
            + String(format: "%.0f years", launch.durationYears)
            + String(format: ", a = %.2f au, e = %.3f",
                     elements.semiMajorAxisM / Constants.auInMetres, elements.eccentricity)
    }

    return AsteroidOutcome(result: result, impact: impact, summary: summary)
}
