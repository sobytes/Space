import Foundation

/**
 What would it take to make this body habitable?

 The physics is ported from `engine/src/habitability.ts` and the content is generated from it,
 which is a deliberate split rather than an inconsistency.

 The functions below are a hand port, and they are the ones the gates check: an energy balance,
 a hydrostatic column, a Jeans parameter, an occultation area, a moment of inertia. Each is
 short, each is checkable against a published number, and `HabitabilityTests` checks every one
 of them against the generated table, so a divergence between the Swift arithmetic and the
 TypeScript arithmetic fails the build rather than appearing as a different number on a phone.

 The prose and the assembled assessments are generated instead, in `Generated/Habitability.swift`.
 There are several thousand words of sourced explanation per strategy, and transcribing that by
 hand would be several thousand chances to drop a clause or a citation, with nothing to catch
 it: wrong prose compiles perfectly. Generating it means the two clients are reading the same
 sentences by construction, exactly as they already read the same Standish tables.
 */

// MARK: - Constants

public enum Habitability {
    /// Stefan-Boltzmann, W m^-2 K^-4. CODATA 2018, exact by the SI redefinition.
    public static let stefanBoltzmann = 5.670_374_419e-8
    /// Solar luminosity, W. IAU 2015 Resolution B3 nominal value.
    public static let solarLuminosityW = 3.828e26
    /// Boltzmann, J/K. Exact by the 2019 SI redefinition.
    public static let boltzmann = 1.380_649e-23
    /// Avogadro, mol^-1. Exact by the 2019 SI redefinition.
    public static let avogadro = 6.022_140_76e23
    /// Molar gas constant, J mol^-1 K^-1. Exact.
    public static let molarGasConstant = 8.314_462_618
    /// Newtonian constant, m^3 kg^-1 s^-2. CODATA 2018; the least precise constant here.
    public static let gravitationalConstant = 6.674_30e-11

    public static let targetSurfaceTemperatureK = 288.0
    public static let targetSurfacePressurePa = 101_325.0
    public static let targetOxygenPartialPressurePa = 21_200.0
    public static let earthBackgroundDoseSvPerYear = 0.0024
    public static let occupationalDoseLimitSvPerYear = 0.02
    public static let earthSurfaceGravityMS2 = 9.806_65
    /// Mean molar mass of dry Earth air, g/mol. The reference for every buoyancy figure.
    public static let earthAirMolarMass = 28.9647
}

/// Molar masses, g/mol, for the gases that decide whether an atmosphere stays put.
public let molarMassGPerMol: [String: Double] = [
    "H2": 2.016, "He": 4.003, "CH4": 16.043, "H2O": 18.015,
    "N2": 28.014, "O2": 31.998, "Ar": 39.948, "CO2": 44.010,
]

// MARK: - Physics

/// Total solar irradiance at a distance, W/m^2. Inverse square from the IAU luminosity.
public func solarConstantAt(_ distanceM: Double) -> Double {
    Habitability.solarLuminosityW / (4 * Double.pi * distanceM * distanceM)
}

/**
 Equilibrium temperature: what the body would sit at with no atmosphere, K.

 Absorbed power over the cross-section pi R squared balanced against emission from the whole
 sphere, so the factor of four appears and the radius cancels. The gap between this and the
 measured surface temperature is the greenhouse effect: 33 K on Earth, 510 K on Venus.

 Takes the Bond albedo, not the geometric albedo the body contracts carry. Venus is geometric
 0.65 and Bond 0.77, and using the wrong one puts it 14 K out.
 */
public func equilibriumTemperature(solarConstantWPerM2: Double, bondAlbedo: Double) -> Double {
    pow((solarConstantWPerM2 * (1 - bondAlbedo)) / (4 * Habitability.stefanBoltzmann), 0.25)
}

public func surfaceGravity(gm: Double, radiusM: Double) -> Double {
    gm / (radiusM * radiusM)
}

public func escapeVelocity(gm: Double, radiusM: Double) -> Double {
    ((2 * gm) / radiusM).squareRoot()
}

/**
 Jeans escape parameter: gravitational binding energy over thermal energy at the exobase.

 lambda = GMm / (kTr). Above about 30 a gas is held for the age of the solar system; below
 about 6 the atmosphere is in hydrodynamic blowoff. Earth sits at 195 for nitrogen and 14 for
 hydrogen, which is the whole reason it has an ocean and no hydrogen envelope.
 */
public func jeansParameter(
    gm: Double,
    exobaseRadiusM: Double,
    exobaseTemperatureK: Double,
    molarMassGPerMol: Double
) -> Double {
    let moleculeMassKg = (molarMassGPerMol * 1e-3) / Habitability.avogadro
    return (gm * moleculeMassKg) / (Habitability.boltzmann * exobaseTemperatureK * exobaseRadiusM)
}

public enum RetentionVerdict: String, Sendable {
    case retained
    case slowlyLost = "slowly-lost"
    case blowsOff = "blows-off"
}

public func retentionVerdict(_ lambda: Double) -> RetentionVerdict {
    if lambda >= 30 { return .retained }
    if lambda >= 6 { return .slowlyLost }
    return .blowsOff
}

/**
 Mass of gas needed to hold a given surface pressure, kg.

 Hydrostatic: the pressure at the bottom of a column is the weight of the column over its
 area. Independent of composition and of temperature, which is why it is the one terraforming
 number that cannot be argued with.
 */
public func atmosphereMassFor(
    surfacePressurePa: Double,
    radiusM: Double,
    gravityMS2: Double
) -> Double {
    (4 * Double.pi * radiusM * radiusM * surfacePressurePa) / gravityMS2
}

/// Shielding an atmosphere provides, g/cm^2. Earth's is 1033, and that rather than the
/// magnetic field is what stops most cosmic rays at the surface.
public func columnDensityGPerCm2(surfacePressurePa: Double, gravityMS2: Double) -> Double {
    (surfacePressurePa / gravityMS2) * 0.1
}

/// Area of orbiting reflector or shade needed to change a body's insolation, m^2. Negative
/// means a shade. First order: ignores the penumbra, which `fullUmbraRadius` covers.
public func collectorAreaFor(
    radiusM: Double,
    currentSolarConstant: Double,
    targetSolarConstant: Double
) -> Double {
    Double.pi * radiusM * radiusM
        * ((targetSolarConstant - currentSolarConstant) / currentSolarConstant)
}

/// Radius a shade at L1 must have to cast full shadow, m. The Sun is a disc, so the umbra
/// narrows with distance and the shade has to be larger than the planet by exactly that much.
public func fullUmbraRadius(
    bodyRadiusM: Double,
    l1DistanceM: Double,
    heliocentricDistanceM: Double
) -> Double {
    let solarRadiusM = 6.957e8
    return bodyRadiusM + l1DistanceM * (solarRadiusM / heliocentricDistanceM)
}

/// Distance from a body to its sunward L1 point, m. The usual (mu/3)^(1/3) Hill expansion.
public func l1Distance(gmBody: Double, gmSun: Double, heliocentricDistanceM: Double) -> Double {
    heliocentricDistanceM * cbrt(gmBody / (3 * gmSun))
}

/// Energy to change a body's spin to a target day length, J. Half I delta-omega-squared with
/// I = f M R squared. Venus turns backwards, so a prograde day means stopping it first.
public func spinChangeEnergy(
    massKg: Double,
    radiusM: Double,
    momentOfInertiaFactor: Double,
    currentSiderealDays: Double,
    targetSiderealDays: Double
) -> Double {
    let inertia = momentOfInertiaFactor * massKg * radiusM * radiusM
    let omegaNow = (2 * Double.pi) / (currentSiderealDays * Constants.secondsPerDay)
    let omegaTarget = (2 * Double.pi) / (targetSiderealDays * Constants.secondsPerDay)
    return 0.5 * inertia * abs(omegaTarget * omegaTarget - omegaNow * omegaNow)
}

/// Solar day from the sidereal day and the orbital period, in days. Signed, because Venus's
/// two periods nearly cancel with opposite signs and give 117 days from a 243 day spin.
public func solarDayDays(siderealDays: Double, orbitalDays: Double) -> Double {
    let inverse = 1 / siderealDays - 1 / orbitalDays
    return inverse == 0 ? .infinity : 1 / inverse
}

public struct BuoyantLift: Sendable {
    public let ambientDensityKgPerM3: Double
    public let liftFraction: Double
    public let liftKgPerM3: Double
}

/**
 Lift of one gas floating in another at the same pressure and temperature, kg/m^3.

 At matched P and T, density goes as molar mass, so the lift per unit volume is the ambient
 density times one minus the ratio of molar masses. The sign is the entire difference between
 the two aerostat cases: breathing air at 29 g/mol floats in Venus's CO2 at 44 and sinks in
 Jupiter's hydrogen at 2.3.
 */
public func buoyantLift(
    ambientPressurePa: Double,
    ambientTemperatureK: Double,
    ambientMolarMassGPerMol: Double,
    envelopeMolarMassGPerMol: Double
) -> BuoyantLift {
    let density = (ambientPressurePa * (ambientMolarMassGPerMol / 1000))
        / (Habitability.molarGasConstant * ambientTemperatureK)
    let fraction = 1 - envelopeMolarMassGPerMol / ambientMolarMassGPerMol
    return BuoyantLift(
        ambientDensityKgPerM3: density,
        liftFraction: fraction,
        liftKgPerM3: density * fraction
    )
}

/// The conservative habitable zone for the Sun, in au. Kopparapu et al. 2013, ApJ 765, 131.
/// Mars at 1.524 au is inside the outer edge, which is the result worth stating plainly.
public enum HabitableZoneAu {
    public static let recentVenus = 1 / 1.776.squareRoot()
    public static let runawayGreenhouse = 1 / 1.107.squareRoot()
    public static let moistGreenhouse = 1 / 1.038.squareRoot()
    public static let maximumGreenhouse = 1 / 0.356.squareRoot()
    public static let earlyMars = 1 / 0.32.squareRoot()
}

// MARK: - Shapes

public struct Quantity: Sendable {
    public let label: String
    public let value: Double
    public let unit: String
    public let note: String?

    public init(label: String, value: Double, unit: String, note: String? = nil) {
        self.label = label
        self.value = value
        self.unit = unit
        self.note = note
    }
}

public enum Severity: String, Sendable {
    case fatal, severe, manageable, none
}

public struct Barrier: Sendable {
    public let id: String
    public let title: String
    public let severity: Severity
    public let statement: String
    public let quantities: [Quantity]

    public init(id: String, title: String, severity: Severity, statement: String, quantities: [Quantity]) {
        self.id = id
        self.title = title
        self.severity = severity
        self.statement = statement
        self.quantities = quantities
    }
}

public enum Maturity: String, Sendable {
    case demonstrated
    case engineeringExtrapolation = "engineering-extrapolation"
    case speculative
}

public struct TerraformStep: Sendable {
    public let order: Int
    public let title: String
    public let mechanism: String
    public let quantities: [Quantity]
    public let timescale: String
    public let maturity: Maturity
    public let source: String

    public init(
        order: Int, title: String, mechanism: String, quantities: [Quantity],
        timescale: String, maturity: Maturity, source: String
    ) {
        self.order = order
        self.title = title
        self.mechanism = mechanism
        self.quantities = quantities
        self.timescale = timescale
        self.maturity = maturity
        self.source = source
    }
}

public enum HabitabilityStrategy: String, Sendable {
    case star
    case home
    case greenhouseTerraform = "greenhouse-terraform"
    case shadeAndCondense = "shade-and-condense"
    case aerostat
    case pressurisedHabitat = "pressurised-habitat"
    case iceShellSubsurface = "ice-shell-subsurface"
    case cryoParaterraform = "cryo-paraterraform"

    /// What the approach is called on screen. Kept with the case rather than in the view, so
    /// both platforms name the same strategy the same way.
    public var label: String {
        switch self {
        case .star: return "Not a place, a power source"
        case .home: return "Home"
        case .greenhouseTerraform: return "Warm it and thicken it"
        case .shadeAndCondense: return "Shade it and let it condense"
        case .aerostat: return "Float in it"
        case .pressurisedHabitat: return "Seal a volume and bury it"
        case .iceShellSubsurface: return "Go under the ice"
        case .cryoParaterraform: return "Warm a world that already has air"
        }
    }
}

public struct HabitabilityState: Sendable {
    public let heliocentricDistanceAu: Double
    public let solarConstantWPerM2: Double
    public let solarConstantRelativeToEarth: Double
    public let bondAlbedo: Double
    public let equilibriumTemperatureK: Double
    public let measuredSurfaceTemperatureK: Double
    public let greenhouseRiseK: Double
    /// The greenhouse comparison as a sentence. The signed number alone misleads:
    /// Mars's is minus two kelvin, which renders as "colder than sunlight allows"
    /// and sounds like a broken energy balance rather than a negligible greenhouse.
    public let greenhouseSummary: String
    public let surfaceGravityMS2: Double
    public let gravityRelativeToEarth: Double
    public let escapeVelocityMS: Double
    public let surfacePressurePa: Double
    public let surfaceDoseSvPerYear: Double?
    public let doseRelativeToEarth: Double?
    public let solarDayDays: Double
    public let hasIntrinsicMagneticField: Bool
    public let hasSolidSurface: Bool
    public let insideHabitableZone: Bool

    public init(
        heliocentricDistanceAu: Double, solarConstantWPerM2: Double,
        solarConstantRelativeToEarth: Double, bondAlbedo: Double,
        equilibriumTemperatureK: Double, measuredSurfaceTemperatureK: Double,
        greenhouseRiseK: Double, greenhouseSummary: String,
        surfaceGravityMS2: Double, gravityRelativeToEarth: Double,
        escapeVelocityMS: Double, surfacePressurePa: Double, surfaceDoseSvPerYear: Double?,
        doseRelativeToEarth: Double?, solarDayDays: Double, hasIntrinsicMagneticField: Bool,
        hasSolidSurface: Bool, insideHabitableZone: Bool
    ) {
        self.heliocentricDistanceAu = heliocentricDistanceAu
        self.solarConstantWPerM2 = solarConstantWPerM2
        self.solarConstantRelativeToEarth = solarConstantRelativeToEarth
        self.bondAlbedo = bondAlbedo
        self.equilibriumTemperatureK = equilibriumTemperatureK
        self.measuredSurfaceTemperatureK = measuredSurfaceTemperatureK
        self.greenhouseRiseK = greenhouseRiseK
        self.greenhouseSummary = greenhouseSummary
        self.surfaceGravityMS2 = surfaceGravityMS2
        self.gravityRelativeToEarth = gravityRelativeToEarth
        self.escapeVelocityMS = escapeVelocityMS
        self.surfacePressurePa = surfacePressurePa
        self.surfaceDoseSvPerYear = surfaceDoseSvPerYear
        self.doseRelativeToEarth = doseRelativeToEarth
        self.solarDayDays = solarDayDays
        self.hasIntrinsicMagneticField = hasIntrinsicMagneticField
        self.hasSolidSurface = hasSolidSurface
        self.insideHabitableZone = insideHabitableZone
    }
}

public struct HabitabilityAssessment: Sendable {
    public let body: BodyId
    public let displayName: String
    public let strategy: HabitabilityStrategy
    public let headline: String
    public let state: HabitabilityState
    public let barriers: [Barrier]
    public let ladder: [TerraformStep]
    public let caveats: [String]

    public init(
        body: BodyId, displayName: String, strategy: HabitabilityStrategy, headline: String,
        state: HabitabilityState, barriers: [Barrier], ladder: [TerraformStep], caveats: [String]
    ) {
        self.body = body
        self.displayName = displayName
        self.strategy = strategy
        self.headline = headline
        self.state = state
        self.barriers = barriers
        self.ladder = ladder
        self.caveats = caveats
    }
}

public func habitabilityFor(_ id: BodyId) -> HabitabilityAssessment {
    habitabilityAssessments[id]!
}

/**
 One formatter, shared with the website, because the panels must not disagree about what a
 number says.

 These quantities span 0.17 to 1e25, and leaving each client to pick a presentation produced
 "4.80e20 kg" on one and a twenty-one digit integer on the other for the same field, which
 reads as two different measurements. Anything a person can hold in their head gets digits,
 anything else gets an exponent, and the crossover is fixed rather than per call.
 */
public func formatQuantity(_ q: Quantity) -> String {
    guard q.value.isFinite else { return "unbounded" }
    let magnitude = abs(q.value)
    var text: String
    if magnitude == 0 {
        text = "0"
    } else if magnitude >= 1e6 || magnitude < 1e-3 {
        let exponent = Int(floor(log10(magnitude)))
        let mantissa = q.value / pow(10, Double(exponent))
        text = String(format: "%.2fe%d", mantissa, exponent)
    } else if magnitude >= 100 {
        text = String(format: "%.0f", q.value)
    } else if magnitude >= 1 {
        text = String(format: "%.2f", q.value)
    } else {
        /**
         Three significant figures below one, not three decimal places.

         Earth's radiation card read "0.002 Sv/yr" directly under prose saying "2.40e-3 Sv
         per year": one number, rounded to one significant figure in one place and three in
         the other, which reads as two different measurements.
         */
        let digits = Swift.max(0, 2 - Int(floor(log10(magnitude))))
        text = String(format: "%.\(digits)f", q.value)
        // Trailing zeros carry no information at this precision and make the column ragged.
        while text.contains("."), text.hasSuffix("0") { text.removeLast() }
        if text.hasSuffix(".") { text.removeLast() }
    }
    return q.unit.isEmpty ? text : "\(text) \(q.unit)"
}
