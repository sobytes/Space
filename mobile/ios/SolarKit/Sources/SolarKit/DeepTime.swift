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
    bodyFateAt(body, ageGyr: ageGyr) == .habitableZone
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

/**
 Where a body orbits at a given age, in au, after the Sun has shed mass.

 The Sun's mass falls rather than rises, and this is the part of its evolution that reaches the
 planets mechanically rather than through light. Fusion alone converts four million tonnes a
 second, which over the whole main sequence is a hundredth of a per cent and moves nothing. The
 giant phases are different: by the red giant tip the Sun has lost a third of itself to its own
 wind.

 For mass loss slow compared with an orbit, angular momentum is conserved while the central
 mass drops, giving the adiabatic result a × M = constant. Losing a third of the Sun pushes
 every orbit out by half: Earth's 1 au becomes 1.50 au.
 */
public func semiMajorAxisAt(_ body: BodyId, ageGyr: Double) -> Double {
    let nowAu = heliocentricDistanceMetres(body) / Constants.auInMetres
    return nowAu / solarStateAt(ageGyr).mass
}

/**
 The body's year at that age, in Earth years as they are now.

 Kepler's third law with both terms moving: P² ∝ a³ / M and a ∝ 1/M, so P ∝ M^-2. Losing a
 third of the Sun stretches Earth's year by 2.24, not by a half.
 */
public func orbitalPeriodAt(_ body: BodyId, ageGyr: Double) -> Double {
    let nowAu = heliocentricDistanceMetres(body) / Constants.auInMetres
    return pow(nowAu, 1.5) / pow(solarStateAt(ageGyr).mass, 2)
}

/**
 Equilibrium temperature at that age, kelvin, with both the light and the orbit moving.

 Uses the Bond albedo, the fraction of all incident power reflected, and not the geometric
 albedo, which is only how bright the disc looks at full phase. Earth's are 0.306 and 0.367, a
 7 K difference in the answer.
 */
public func equilibriumTemperatureAt(_ body: BodyId, ageGyr: Double) -> Double {
    let state = solarStateAt(ageGyr)
    let au = semiMajorAxisAt(body, ageGyr: ageGyr)
    // The Bond albedo comes off the habitability assessment, which is generated from the same
    // sourced table the website reads, so the two cannot quote different albedos.
    let bondAlbedo = habitabilityFor(body).state.bondAlbedo
    let solarConstant = solarConstantAt(au * Constants.auInMetres) * state.luminosity
    return equilibriumTemperature(solarConstantWPerM2: solarConstant, bondAlbedo: bondAlbedo)
}

public struct Engulfment: Sendable {
    /// The Sun's photosphere, in au.
    public let photosphereAu: Double
    /// The body's orbit at that age, already widened by the Sun's mass loss.
    public let orbitAu: Double
    /// The mechanical answer: is the orbit inside the star.
    public let insidePhotosphere: Bool
    /**
     The published answer, which differs for Earth.

     Schröder 2008 is explicit that orbit expansion nearly saves Earth and does not: tidal
     interaction with the giant's envelope drains the orbit faster than mass loss widens it.
     Carried on citation rather than computed, because a tidal model is a paper of its own and
     inventing one to reach a known answer would be the worst of both.
     */
    public let lostToTides: Bool
}

/// Bodies the published model loses to tidal drag despite their orbits having widened.
private let lostToTides: Set<BodyId> = [.embary]

public func engulfmentAt(_ body: BodyId, ageGyr: Double) -> Engulfment {
    let photosphereAu = bodyContracts[.sun]!.equatorialRadiusM * solarStateAt(ageGyr).radius
        / Constants.auInMetres
    let orbitAu = semiMajorAxisAt(body, ageGyr: ageGyr)
    let inside = photosphereAu >= orbitAu
    return Engulfment(
        photosphereAu: photosphereAu,
        orbitAu: orbitAu,
        insidePhotosphere: inside,
        lostToTides: !inside && lostToTides.contains(body) && ageGyr >= redGiantTipGyr - 0.3
    )
}

/// Whether a body is gone: swallowed outright, or dragged in by tides.
public func engulfedAt(_ body: BodyId, ageGyr: Double) -> Bool {
    let e = engulfmentAt(body, ageGyr: ageGyr)
    return e.insidePhotosphere || e.lostToTides
}

/**
 What the Sun's evolution does to a body at a given age.

 Shared rather than decided in each client, because it is a judgement with thresholds in it and
 two clients making it separately is how one ends up calling Mars habitable while the other
 calls it frozen at the same instant. The words each client prints are its own; which of the
 four states it is in, is not.
 */
public enum BodyFate: String, Sendable {
    case engulfed
    case habitableZone = "habitable-zone"
    case tooHot = "too-hot"
    case tooCold = "too-cold"
}

public func bodyFateAt(_ body: BodyId, ageGyr: Double) -> BodyFate {
    if engulfedAt(body, ageGyr: ageGyr) { return .engulfed }
    // The orbit it is on at that age, not the one it is on now.
    let au = semiMajorAxisAt(body, ageGyr: ageGyr)
    let zone = habitableZoneAt(ageGyr)
    if au < zone.innerAu { return .tooHot }
    if au > zone.outerAu { return .tooCold }
    return .habitableZone
}

public struct DeepTimeEvent: Sendable, Identifiable {
    public let ageGyr: Double
    public let title: String
    public let detail: String
    public let source: String
    public var id: String { title }
}

/**
 The dated events worth marking, each with where the date comes from.

 Ported from `engine/src/deep-time.ts` and gated word for word, because this is the text a
 person actually reads and two clients telling them different things about the end of the world
 is worse than either staying quiet. Deliberately short: a timeline of thirteen billion years
 can carry a hundred captions and say less than six.
 */
public let deepTimeEvents: [DeepTimeEvent] = [
    DeepTimeEvent(
        ageGyr: 0,
        title: "The Sun forms, at 71 per cent of today's brightness",
        detail: "Faint enough that Earth should have been frozen solid for its first two billion years. "
            + "It was not: there is liquid water in the rock record from 4.4 billion years ago. "
            + "Reconciling the two is the faint young Sun problem and it is still open.",
        source: "Gough 1981"
    ),
    DeepTimeEvent(
        ageGyr: solarAgeNowGyr,
        title: "Now",
        detail: "The Sun has brightened by about 40 per cent since it formed and is still rising.",
        source: "Bahcall 2001"
    ),
    DeepTimeEvent(
        ageGyr: solarAgeNowGyr + 1.0,
        title: "Earth leaves the habitable zone",
        detail: "The inner edge sweeps past 1 au and Earth goes into a moist greenhouse: water reaches "
            + "the stratosphere, is broken up by ultraviolet and the hydrogen escapes. The oceans "
            + "are lost long before the Sun becomes a giant, and nothing about the planet causes it.",
        source: "Caldeira 1992"
    ),
    DeepTimeEvent(
        ageGyr: mainSequenceEndGyr,
        title: "The main sequence ends",
        detail: "Hydrogen in the core runs out after about ten billion years. The Sun leaves the main "
            + "sequence and starts to swell, and the modelling here stops and the interpolation "
            + "between published points begins.",
        source: "Schröder 2008"
    ),
    DeepTimeEvent(
        ageGyr: redGiantTipGyr,
        title: "The red giant tip: 256 times its radius, 2730 times its light",
        detail: "The photosphere reaches past Venus. Mercury and Venus are destroyed. Earth's orbit is "
            + "lifted outwards by the Sun's mass loss and that still does not save it: tidal drag on "
            + "the giant pulls the planet in faster than the orbit widens.",
        source: "Schröder 2008"
    ),
    DeepTimeEvent(
        ageGyr: 12.4,
        title: "A white dwarf, half a Sun in an Earth-sized sphere",
        detail: "The envelope is thrown off and what is left is the burnt-out core, about 0.54 solar "
            + "masses, cooling for the rest of time. Whatever is left of the outer planets orbits it "
            + "in the dark.",
        source: "Schröder 2008"
    ),
]

/// The most recent event at or before this age, which is what a slider is "in".
public func deepTimeEventAt(_ ageGyr: Double) -> DeepTimeEvent {
    var found = deepTimeEvents[0]
    for event in deepTimeEvents where event.ageGyr <= ageGyr + 1e-9 { found = event }
    return found
}
