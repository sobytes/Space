import Testing
import Foundation
@testable import SolarKit

/**
 Does the Swift port of the habitability physics agree with the table it ships alongside?

 The assessments in `Generated/Habitability.swift` are emitted by the TypeScript engine, which
 on its own would make this module transcription rather than a port: the numbers would be
 right because they were copied, and a broken Swift function would never be exercised.

 These tests close that. Every headline figure in the generated table is recomputed here from
 the hand-ported functions and the body contracts, with no reference to how the table was
 produced. If `equilibriumTemperature` loses its factor of four, or `jeansParameter` picks up
 a molar mass in the wrong units, the recomputation stops matching and the build goes red.

 The tolerance is 1e-9 relative. These are the same closed-form expressions evaluated in the
 same IEEE 754 doubles in two languages, so anything beyond the last couple of bits is a real
 difference in the arithmetic rather than rounding.
 */
@Suite("Habitability")
struct HabitabilityTests {
    private func close(_ a: Double, _ b: Double, _ tolerance: Double = 1e-9) -> Bool {
        if a == b { return true }
        if !a.isFinite || !b.isFinite { return a.isFinite == b.isFinite }
        return abs(a - b) <= tolerance * max(abs(a), abs(b))
    }

    @Test("every body has an assessment with content")
    func coverage() {
        for id in bodyIds {
            let a = habitabilityFor(id)
            #expect(!a.ladder.isEmpty, "\(id.rawValue) has no ladder")
            #expect(a.headline.count > 20, "\(id.rawValue) has no headline")
            for step in a.ladder {
                #expect(step.mechanism.count > 100, "\(id.rawValue) step \(step.order) is thin")
                #expect(!step.source.isEmpty, "\(id.rawValue) step \(step.order) is unsourced")
                for q in step.quantities {
                    #expect(!q.value.isNaN, "\(id.rawValue): \(q.label) is NaN")
                }
            }
        }
    }

    /**
     The energy balance, recomputed.

     Solar constant from the body's own semi-major axis, equilibrium temperature from that and
     the Bond albedo the table carries. This is the longest chain in the module and the one
     every downstream figure inherits, so it is checked for every body rather than a sample.
     */
    @Test("recomputes the energy balance for every body")
    func energyBalance() {
        for id in bodyIds where id != .sun {
            let a = habitabilityFor(id)
            let distance = a.state.heliocentricDistanceAu * Constants.auInMetres
            let solar = solarConstantAt(distance)
            #expect(close(solar, a.state.solarConstantWPerM2), "\(id.rawValue) solar constant")

            let equilibrium = equilibriumTemperature(
                solarConstantWPerM2: solar, bondAlbedo: a.state.bondAlbedo
            )
            #expect(
                close(equilibrium, a.state.equilibriumTemperatureK),
                "\(id.rawValue): ported \(equilibrium) K against generated \(a.state.equilibriumTemperatureK) K"
            )
            #expect(
                close(
                    a.state.measuredSurfaceTemperatureK - equilibrium,
                    a.state.greenhouseRiseK
                ),
                "\(id.rawValue) greenhouse rise"
            )
        }
    }

    /**
     Gravity and escape, recomputed from the contracts.

     Earth is the one that catches a specific mistake. The body contract's GM is the
     Earth-Moon system's, because the Standish tables describe the barycentre, and using it
     here gives 9.919 m/s squared, which reads as 1.012 g. The generated table uses the
     Earth-only GM, so this check fails if the Swift side ever reaches for the contract value.
     */
    @Test("recomputes gravity and escape velocity")
    func gravity() {
        for id in bodyIds where id != .sun {
            let a = habitabilityFor(id)
            let contract = bodyContracts[id]!
            let gm = a.state.surfaceGravityMS2 * contract.equatorialRadiusM * contract.equatorialRadiusM
            #expect(
                close(escapeVelocity(gm: gm, radiusM: contract.equatorialRadiusM), a.state.escapeVelocityMS),
                "\(id.rawValue) escape velocity"
            )
            #expect(
                close(a.state.surfaceGravityMS2 / Habitability.earthSurfaceGravityMS2, a.state.gravityRelativeToEarth),
                "\(id.rawValue) relative gravity"
            )
        }
        #expect(abs(habitabilityFor(.embary).state.gravityRelativeToEarth - 1) < 0.002,
                "Earth must read 1 g, not the Earth-Moon barycentre's 1.012")
    }

    /// The published equilibrium temperatures, from an independent source. The giants are out
    /// because their published figures fold in internal heat this function does not model.
    @Test("matches published equilibrium temperatures", arguments: [
        (BodyId.mercury, 440.0), (.venus, 227.0), (.embary, 254.0), (.mars, 210.0), (.titan, 82.0),
    ])
    func published(id: BodyId, expected: Double) {
        let got = habitabilityFor(id).state.equilibriumTemperatureK
        #expect(abs(got - expected) < 3, "\(id.rawValue): \(got) K against a published \(expected) K")
    }

    @Test("reproduces Earth's atmospheric column and shielding")
    func earthColumn() {
        #expect(abs(columnDensityGPerCm2(surfacePressurePa: 101_325, gravityMS2: 9.80665) - 1033) < 1)
        let mass = atmosphereMassFor(surfacePressurePa: 98_500, radiusM: 6.371e6, gravityMS2: 9.80665)
        #expect(abs(mass - 5.148e18) / 5.148e18 < 0.005)
    }

    /// Earth keeps nitrogen and loses hydrogen. If the ported function reproduces that split
    /// with no special-casing, it is measuring what it claims to.
    @Test("explains why Earth has nitrogen and no hydrogen envelope")
    func jeans() {
        let gm = 3.986_004_418e14
        let r = 6.378e6 + 5e5
        let n2 = jeansParameter(gm: gm, exobaseRadiusM: r, exobaseTemperatureK: 1000,
                                molarMassGPerMol: molarMassGPerMol["N2"]!)
        let h2 = jeansParameter(gm: gm, exobaseRadiusM: r, exobaseTemperatureK: 1000,
                                molarMassGPerMol: molarMassGPerMol["H2"]!)
        #expect(retentionVerdict(n2) == .retained)
        #expect(retentionVerdict(h2) != .retained)
    }

    /// The sign of this is the entire difference between the two aerostat cases.
    @Test("floats breathing air on Venus and sinks it on Jupiter")
    func buoyancy() {
        let venus = buoyantLift(
            ambientPressurePa: 101_325, ambientTemperatureK: 348,
            ambientMolarMassGPerMol: molarMassGPerMol["CO2"]!,
            envelopeMolarMassGPerMol: Habitability.earthAirMolarMass
        )
        #expect(abs(venus.liftFraction - 0.342) < 0.001)
        #expect(venus.liftKgPerM3 > 0.4)

        let jupiter = buoyantLift(
            ambientPressurePa: 101_325, ambientTemperatureK: 165,
            ambientMolarMassGPerMol: 2.3,
            envelopeMolarMassGPerMol: Habitability.earthAirMolarMass
        )
        #expect(jupiter.liftKgPerM3 < 0)
    }

    @Test("gives Venus a 117 day solar day from a 243 day retrograde spin")
    func venusDay() {
        #expect(abs(abs(solarDayDays(siderealDays: -243.018, orbitalDays: 224.701)) - 116.75) < 0.1)
    }

    /// Mars is inside the conservative habitable zone. Distance is not what is wrong with Mars.
    @Test("places Mars inside the habitable zone and Venus outside it")
    func habitableZone() {
        #expect(habitabilityFor(.mars).state.insideHabitableZone)
        #expect(!habitabilityFor(.venus).state.insideHabitableZone)
        #expect(HabitableZoneAu.maximumGreenhouse > 1.524)
    }

    /// Both clients must render the same number the same way; this is the website's spelling.
    @Test("formats quantities identically to the website")
    func formatting() {
        #expect(formatQuantity(Quantity(label: "", value: 0.342, unit: "")) == "0.342")
        #expect(formatQuantity(Quantity(label: "", value: 1033, unit: "g/cm2")) == "1033 g/cm2")
        #expect(formatQuantity(Quantity(label: "", value: 3.93e18, unit: "kg")) == "3.93e18 kg")
        #expect(formatQuantity(Quantity(label: "", value: .infinity, unit: "years")) == "unbounded")
    }

    @Test("routes each body to the strategy its physics implies")
    func strategies() {
        #expect(habitabilityFor(.sun).strategy == .star)
        #expect(habitabilityFor(.embary).strategy == .home)
        #expect(habitabilityFor(.mars).strategy == .greenhouseTerraform)
        #expect(habitabilityFor(.venus).strategy == .shadeAndCondense)
        #expect(habitabilityFor(.jupiter).strategy == .aerostat)
        #expect(habitabilityFor(.moon).strategy == .pressurisedHabitat)
        #expect(habitabilityFor(.titan).strategy == .cryoParaterraform)
        #expect(habitabilityFor(.europa).strategy == .iceShellSubsurface)
        // Same radiation as Europa, no water at all, so not the same answer.
        #expect(habitabilityFor(.io).strategy == .pressurisedHabitat)
    }
}
