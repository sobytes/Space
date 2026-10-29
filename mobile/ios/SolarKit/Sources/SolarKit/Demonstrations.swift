import Foundation

/**
 Demonstrations: physical claims the app can be caught being wrong about.

 A port of `engine/src/demonstrations/`. Each names a published value and a source, and the
 gate asserts every one. That is what separates this from an animation: an animation shows
 you an orbit, a demonstration shows you a number that could have disagreed with a textbook
 and did not.

 The registry is the single list and the gate derives from it, so adding one adds its gate.
 */

public struct PublishedValue: Sendable {
    public let value: Double
    public let unit: String
    /// Fractional tolerance the measurement must land inside.
    public let tolerance: Double
    public let source: String
}

public struct ResultRow: Sendable {
    public let label: String
    public let value: String
}

public struct DemonstrationResult: Sendable {
    /// The single number compared against the published value.
    public let measured: Double
    /// What the same measurement gives with the effect under test switched off.
    public let control: (label: String, value: Double)?
    public let rows: [ResultRow]
    /// Anything the measurement genuinely cannot resolve. Shown, not hidden.
    public let caveats: [String]
}

public struct Demonstration: Sendable {
    public let id: String
    public let title: String
    /// The question a visitor actually has, in their words.
    public let question: String
    public let attribution: String
    public let history: String
    public let published: PublishedValue
    public let run: @Sendable () -> DemonstrationResult
}

// MARK: - Mercury's perihelion

private let mercuryPrecession = Demonstration(
    id: "mercury-precession",
    title: "Mercury's perihelion advances faster than Newton allows",
    question: "How do we know general relativity is right?",
    attribution: "Einstein, 1915",
    history: """
        Le Verrier found in 1859 that Mercury's perihelion advanced faster than the other \
        planets could explain. The gap stood open for 56 years, through a search for a planet \
        called Vulcan that was never there, until general relativity produced exactly the \
        missing amount from a theory built for other reasons.
        """,
    published: PublishedValue(
        value: 42.98,
        unit: "arcsec/century",
        tolerance: 0.01,
        source: "Einstein 1915; the residual after the Newtonian planetary contribution"
    ),
    run: {
        let a = Mercury.semiMajorAxisM
        let e = Mercury.eccentricity
        let mu = Constants.gmSun
        let period = 2 * Double.pi * (pow(a, 3) / mu).squareRoot()
        let rp = a * (1 - e)
        let vp = (mu * (1 + e) / (a * (1 - e))).squareRoot()
        let initial = StateVector(position: Vec3(rp, 0, 0), velocity: Vec3(0, vp, 0))

        func advancePerOrbit(_ relativistic: Bool) -> Double {
            let orbits = 60.0
            let result = propagate(PropagateOptions(
                model: ForceModel(centralGm: mu, relativistic: relativistic),
                initial: initial,
                durationSeconds: orbits * period,
                limits: PropagationLimits(tolerance: 1e-13, maxStepSeconds: 3_600)
            ))
            let final = result.samples.last!
            let e0 = eccentricityVector(gm: mu, position: initial.position, velocity: initial.velocity)
            let e1 = eccentricityVector(gm: mu, position: final.position, velocity: final.velocity)
            return normaliseAngleSigned(atan2(e1.y, e1.x) - atan2(e0.y, e0.x)) / orbits
        }

        let newtonian = advancePerOrbit(false)
        let relativistic = advancePerOrbit(true)
        let perCentury = Constants.daysPerJulianCentury / Mercury.orbitalPeriodDays
        let measured = (relativistic - newtonian) * perCentury * Constants.arcsecPerRadian
        let closedForm = perihelionAdvanceArcsecPerCentury(
            gm: mu, semiMajorAxisM: a, eccentricity: e, orbitalPeriodDays: Mercury.orbitalPeriodDays
        )

        return DemonstrationResult(
            measured: measured,
            control: ("Newtonian gravity alone", newtonian * perCentury * Constants.arcsecPerRadian),
            rows: [
                ResultRow(label: "Measured by integration",
                          value: String(format: "%.4f arcsec/century", measured)),
                ResultRow(label: "Closed form 6 pi GM / c^2 a (1-e^2)",
                          value: String(format: "%.4f arcsec/century", closedForm)),
                ResultRow(label: "Newtonian control",
                          value: String(format: "%.4f arcsec/century",
                                        newtonian * perCentury * Constants.arcsecPerRadian)),
            ],
            caveats: [
                "This is the relativistic term alone. The other planets add about 530 "
                    + "arcsec/century on top, by Newtonian gravity.",
            ]
        )
    }
)

// MARK: - Kepler's third law

private let keplersThirdLaw = Demonstration(
    id: "keplers-third-law",
    title: "Every planet's period squared is its distance cubed",
    question: "Why do the outer planets take so much longer?",
    attribution: "Kepler, 1619",
    history: """
        Kepler found the relation in Harmonices Mundi after a decade on Tycho Brahe's \
        observations. It is not a fitted curve: it falls straight out of Newton's gravity as \
        n^2 a^3 = GM, which is why the same constant works for every planet.
        """,
    published: PublishedValue(
        value: 1.0,
        unit: "ratio of T^2 to a^3, normalised",
        tolerance: 0.01,
        source: "Kepler 1619; n^2 a^3 = GM from Newton"
    ),
    run: {
        var rows: [ResultRow] = []
        var worst = 0.0
        for planet in Planet.allCases {
            guard let elements = shortSpan.elements[planet] else { continue }
            let a = toMetres(au(elements.atJ2000.semiMajorAxisAu))
            let periodDays = 360 / elements.ratePerCentury.meanLongitudeDeg
                * Constants.daysPerJulianCentury
            let periodSeconds = periodDays * Constants.secondsPerDay
            // n^2 a^3 / GM should be one for every planet.
            let n = 2 * Double.pi / periodSeconds
            let ratio = n * n * a * a * a / Constants.gmSun
            worst = max(worst, abs(ratio - 1))
            rows.append(ResultRow(
                label: bodyContracts[bodyId(for: planet)]!.displayName,
                value: String(format: "%.4f", ratio)
            ))
        }
        return DemonstrationResult(
            measured: 1 + worst,
            control: nil,
            rows: rows,
            caveats: [
                "The ratio uses the Sun's mass alone. Including each planet's own mass would "
                    + "shift it by up to 1e-3 for Jupiter, which is the size of the residual "
                    + "you can see.",
            ]
        )
    }
)

// MARK: - Light travel time

private let lightTravelTime = Demonstration(
    id: "light-travel-time",
    title: "Sunlight takes eight minutes to reach us",
    question: "How long does light take to get here?",
    attribution: "Romer, 1676",
    history: """
        Romer timed the eclipses of Io and found them early when Earth was near Jupiter and \
        late when it was far, which only makes sense if light takes time to cross the gap. It \
        was the first measurement of the speed of light, from a moon of another planet.
        """,
    published: PublishedValue(
        value: 499.0,
        unit: "seconds at one au",
        tolerance: 0.01,
        source: "IAU 2012: the au is 149,597,870,700 m and c is 299,792,458 m/s, both exact"
    ),
    run: {
        let seconds = Constants.auInMetres / speedOfLight
        var rows: [ResultRow] = []
        for planet in Planet.allCases {
            let d = heliocentricPositionOf(bodyId(for: planet), at: JdTdb(Epochs.j2000)).length
            let t = d / speedOfLight
            rows.append(ResultRow(
                label: bodyContracts[bodyId(for: planet)]!.displayName,
                value: t < 3_600
                    ? String(format: "%.1f min", t / 60)
                    : String(format: "%.2f h", t / 3_600)
            ))
        }
        return DemonstrationResult(
            measured: seconds,
            control: nil,
            rows: [ResultRow(label: "One astronomical unit",
                             value: String(format: "%.2f s", seconds))] + rows,
            caveats: ["Distances are for J2000. They change as the planets move."]
        )
    }
)

// MARK: - Solar irradiance

private let solarIrradiance = Demonstration(
    id: "solar-irradiance",
    title: "Sunlight falls off as the square of distance",
    question: "Why is Pluto so cold?",
    attribution: "Inverse square law",
    history: """
        The Sun radiates about 3.828e26 watts in every direction, so the power crossing a \
        square metre falls as 1 over distance squared. That single fact sets the temperature \
        of every world, and it is why Neptune receives about a thousandth of what Earth does.
        """,
    published: PublishedValue(
        value: 1361.0,
        unit: "W/m^2 at one au",
        tolerance: 0.01,
        source: "The solar constant, CODATA and satellite radiometry"
    ),
    run: {
        let luminosity = 3.828e26
        func irradiance(_ metres: Double) -> Double {
            luminosity / (4 * Double.pi * metres * metres)
        }
        var rows: [ResultRow] = []
        for planet in Planet.allCases {
            let d = heliocentricPositionOf(bodyId(for: planet), at: JdTdb(Epochs.j2000)).length
            rows.append(ResultRow(
                label: bodyContracts[bodyId(for: planet)]!.displayName,
                value: String(format: "%.1f W/m^2", irradiance(d))
            ))
        }
        return DemonstrationResult(
            measured: irradiance(Constants.auInMetres),
            control: nil,
            rows: rows,
            caveats: [
                "Irradiance at the top of the atmosphere, not at the ground, and ignoring "
                    + "the eccentricity of each orbit.",
            ]
        )
    }
)

/// The one list. Any UI and the gate both read from here, so there is no second list to drift.
public let demonstrations: [Demonstration] = [
    mercuryPrecession, keplersThirdLaw, lightTravelTime, solarIrradiance,
]

public func demonstration(id: String) -> Demonstration? {
    demonstrations.first { $0.id == id }
}
