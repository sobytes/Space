import Foundation

/**
 The Sun's whole life, and what it does to everything orbiting it.

 Ported from `engine/src/deep-time.ts` and gated by the `deep-time` conformance domain.

 The rest of SolarKit runs on element tables fitted for a few thousand years either side of
 now. This is the other scale: billions of years, where positions stop mattering and the star
 itself is the thing that changes. The Sun was about 70 per cent as bright when Earth formed
 and has brightened ever since, so the habitable zone has been sweeping outwards for four and
 a half billion years. Earth's remaining time as a water world is set by that drift and runs
 out roughly a billion years from now, long before the Sun becomes a giant.

 Three regimes with decreasing confidence, labelled as such: a closed form on the main
 sequence, interpolation between published waypoints on the red giant branch, and an end state
 after the helium flash rather than any attempt at the phases in between.
 */

/// The Sun's present age in billions of years, from the standard solar model.
public let solarAgeNowGyr = 4.57

/// Where the main sequence ends and modelling gives way to interpolation.
public let mainSequenceEndGyr = 10.0

/// The tip of the red giant branch, from Schröder and Connon Smith 2008.
public let redGiantTipGyr = 12.167

public enum SolarPhase: String, Sendable {
    case mainSequence = "main-sequence"
    case subgiant
    case redGiant = "red-giant"
    case heliumBurning = "helium-burning"
    case whiteDwarf = "white-dwarf"
}

public enum SolarConfidence: String, Sendable {
    case modelled
    case interpolated
    case endState = "end state"
}

public struct SolarState: Sendable {
    public let ageGyr: Double
    /// Negative in the past. The number a person actually wants to read.
    public let fromNowGyr: Double
    public let phase: SolarPhase
    /// Luminosity as a multiple of today's.
    public let luminosity: Double
    /// Radius as a multiple of today's.
    public let radius: Double
    /// Mass as a fraction of today's. Only the giant phases lose any.
    public let mass: Double
    public let effectiveTemperatureK: Double
    public let confidence: SolarConfidence
}

private let solarTeffNowK = 5772.0

/// The planet whose heliocentric orbit this body shares. A moon rides its planet's.
private func planetAncestorFor(_ id: BodyId) -> BodyId? {
    var current: BodyId? = id
    while let body = current {
        if case .standishElements = bodyContracts[body]!.ephemeris { return body }
        current = bodyContracts[body]!.parent
    }
    return nil
}

/// Heliocentric semi-major axis in metres. A moon uses its planet's.
private func heliocentricDistanceMetres(_ id: BodyId) -> Double {
    guard let planet = planetAncestorFor(id),
          case let .standishElements(name) = bodyContracts[planet]!.ephemeris,
          let elements = shortSpan.elements[name] else {
        return Constants.auInMetres
    }
    return elements.atJ2000.semiMajorAxisAu * Constants.auInMetres
}

/**
 Luminosity on the main sequence, relative to today.

     L(t) / L_now = 1 / (1 + (2/5)(1 - t / t_now))

 Gough 1981. The faint young Sun problem is this one line: at t = 0 it gives 1/1.4, so the Sun
 shone at 71 per cent of today's output when Earth formed, which is not enough to keep liquid
 water on a planet with today's atmosphere. Earth had liquid water anyway.
 */
public func mainSequenceLuminosity(ageGyr: Double) -> Double {
    1 / (1 + 0.4 * (1 - ageGyr / solarAgeNowGyr))
}

private struct Waypoint {
    let ageGyr: Double
    let luminosity: Double
    let radius: Double
    let mass: Double
}

/**
 Published waypoints past the main sequence, interpolated between rather than modelled.

 Schröder and Connon Smith 2008. At the tip the Sun reaches 2730 times today's luminosity and
 256 times its radius, having shed a third of its mass, and that reaches past Venus.
 */
private let waypoints: [Waypoint] = [
    Waypoint(ageGyr: mainSequenceEndGyr,
             luminosity: mainSequenceLuminosity(ageGyr: mainSequenceEndGyr),
             radius: 1.38, mass: 1),
    Waypoint(ageGyr: 11.6, luminosity: 54, radius: 11, mass: 0.999),
    Waypoint(ageGyr: redGiantTipGyr, luminosity: 2730, radius: 256, mass: 0.668),
]

private func interpolate(_ ageGyr: Double) -> (luminosity: Double, radius: Double, mass: Double) {
    for i in 1 ..< waypoints.count {
        let a = waypoints[i - 1]
        let b = waypoints[i]
        if ageGyr <= b.ageGyr {
            let t = (ageGyr - a.ageGyr) / (b.ageGyr - a.ageGyr)
            // Geometric in luminosity and radius, which span three orders of magnitude between
            // waypoints; a straight line in those would be a straight line through nothing.
            return (
                a.luminosity * pow(b.luminosity / a.luminosity, t),
                a.radius * pow(b.radius / a.radius, t),
                a.mass + (b.mass - a.mass) * t
            )
        }
    }
    let last = waypoints[waypoints.count - 1]
    return (last.luminosity, last.radius, last.mass)
}

/// What the Sun is doing at a given age.
public func solarStateAt(_ ageGyr: Double) -> SolarState {
    let fromNowGyr = ageGyr - solarAgeNowGyr

    if ageGyr <= mainSequenceEndGyr {
        let luminosity = mainSequenceLuminosity(ageGyr: ageGyr)
        let radius = luminosity.squareRoot()
        return SolarState(
            ageGyr: ageGyr, fromNowGyr: fromNowGyr, phase: .mainSequence,
            luminosity: luminosity, radius: radius, mass: 1,
            // L = 4 pi R^2 sigma T^4, so holding R to sqrt(L) holds T fixed by construction.
            effectiveTemperatureK: solarTeffNowK * pow(luminosity / (radius * radius), 0.25),
            confidence: .modelled
        )
    }

    if ageGyr <= redGiantTipGyr {
        let w = interpolate(ageGyr)
        return SolarState(
            ageGyr: ageGyr, fromNowGyr: fromNowGyr,
            phase: ageGyr < 11.0 ? .subgiant : .redGiant,
            luminosity: w.luminosity, radius: w.radius, mass: w.mass,
            effectiveTemperatureK: solarTeffNowK * pow(w.luminosity / (w.radius * w.radius), 0.25),
            confidence: .interpolated
        )
    }

    // Helium burning, the asymptotic branch and the planetary nebula all happen here and none
    // is modelled. A white dwarf is reported as a destination rather than a trajectory.
    return SolarState(
        ageGyr: ageGyr, fromNowGyr: fromNowGyr,
        phase: ageGyr < 12.4 ? .heliumBurning : .whiteDwarf,
        luminosity: ageGyr < 12.4 ? 50 : 0.001,
        radius: ageGyr < 12.4 ? 10 : 0.0084,
        mass: 0.54,
        effectiveTemperatureK: ageGyr < 12.4 ? 4500 : 25_000,
        confidence: .endState
    )
}

public struct HabitableZoneSpan: Sendable {
    public let innerAu: Double
    public let outerAu: Double
}

/**
 Where the habitable zone sits at a given age.

 The edges are flux thresholds, so they scale with the square root of luminosity and nothing
 else. The constants are the Kopparapu limits the habitability panel already uses, so the zone
 drawn here and the verdict printed there cannot drift apart.
 */
public func habitableZoneAt(_ ageGyr: Double) -> HabitableZoneSpan {
    let scale = solarStateAt(ageGyr).luminosity.squareRoot()
    return HabitableZoneSpan(
        innerAu: HabitableZoneAu.runawayGreenhouse * scale,
        outerAu: HabitableZoneAu.maximumGreenhouse * scale
    )
}

public func insideHabitableZoneAt(_ body: BodyId, ageGyr: Double) -> Bool {
    let au = heliocentricDistanceMetres(body) / Constants.auInMetres
    let zone = habitableZoneAt(ageGyr)
    return au >= zone.innerAu && au <= zone.outerAu
}

/**
 What the inner edge does to a body, and when.

 Three outcomes rather than a number and a nil, because nil was doing two jobs. Mercury is
 already inside the edge; Mars is outside it and the Sun runs out of main sequence before the
 edge arrives. Those are opposite facts.
 */
public enum HabitableZoneCrossing: Sendable {
    case alreadyInside
    case notBeforeTheEnd(luminosityNeeded: Double)
    case crosses(fromNowGyr: Double, ageGyr: Double)
}

public func runawayGreenhouseCrossing(_ body: BodyId) -> HabitableZoneCrossing {
    let au = heliocentricDistanceMetres(body) / Constants.auInMetres
    let luminosityNeeded = pow(au / HabitableZoneAu.runawayGreenhouse, 2)
    if luminosityNeeded <= 1 { return .alreadyInside }

    // Invert L = 1 / (1 + 0.4(1 - t/t_now)) for t.
    let ageGyr = solarAgeNowGyr * (1 - (1 / luminosityNeeded - 1) / 0.4)
    if ageGyr > mainSequenceEndGyr { return .notBeforeTheEnd(luminosityNeeded: luminosityNeeded) }
    return .crosses(fromNowGyr: ageGyr - solarAgeNowGyr, ageGyr: ageGyr)
}

/// Whether the Sun's photosphere reaches a body's present orbit at that age.
public func engulfedAt(_ body: BodyId, ageGyr: Double) -> Bool {
    let au = heliocentricDistanceMetres(body) / Constants.auInMetres
    let solarRadiusAu = bodyContracts[.sun]!.equatorialRadiusM * solarStateAt(ageGyr).radius
        / Constants.auInMetres
    return solarRadiusAu >= au
}
