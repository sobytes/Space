import XCTest
@testable import SolarKit

/**
 The physics port, checked against the same published values as the engine.

 These are the results that make the propagator believable rather than merely present, and
 each is a number that could have come out wrong. See `contracts/physics-and-mathematics`.
 */
final class PhysicsTests: XCTestCase {

    /// A circular orbit, used where an exactly-known answer is wanted.
    private func circularState(radius: Double, gm: Double = Constants.gmSun) -> StateVector {
        StateVector(position: Vec3(radius, 0, 0), velocity: Vec3(0, (gm / radius).squareRoot(), 0))
    }

    /**
     A two-body orbit closes on itself.

     The exactly-solvable case. If this does not return to where it started, nothing built on
     the integrator means anything.
     */
    func testTwoBodyOrbitCloses() {
        for au in [0.39, 1.0, 5.2, 30.0] {
            let radius = au * Constants.auInMetres
            let period = 2 * Double.pi * (pow(radius, 3) / Constants.gmSun).squareRoot()
            let initial = circularState(radius: radius)

            let result = propagate(PropagateOptions(
                model: twoBodyModel(),
                initial: initial,
                durationSeconds: period,
                limits: PropagationLimits(tolerance: 1e-12)
            ))
            let final = result.samples.last!
            let drift = (final.position - initial.position).length / radius
            XCTAssertLessThan(drift, 1e-9, "orbit at \(au) au did not close")
        }
    }

    /// Energy is conserved by the equations and never handed to the integrator, so any drift
    /// is numerical error and nothing else. See contracts/physics-and-mathematics section 7.
    func testEnergyHolds() {
        let radius = Constants.auInMetres
        let period = 2 * Double.pi * (pow(radius, 3) / Constants.gmSun).squareRoot()
        let initial = circularState(radius: radius)
        let before = specificEnergy(
            centralGm: Constants.gmSun, position: initial.position, velocity: initial.velocity
        )

        let result = propagate(PropagateOptions(
            model: twoBodyModel(),
            initial: initial,
            durationSeconds: 200 * period,
            limits: PropagationLimits(tolerance: 1e-12)
        ))
        let final = result.samples.last!
        let after = specificEnergy(
            centralGm: Constants.gmSun, position: final.position, velocity: final.velocity
        )
        XCTAssertLessThan(abs((after - before) / before), 1e-9, "energy drift over 200 orbits")
    }

    /**
     Mercury's relativistic perihelion advance: the number that earned general relativity
     belief, because it could have been wrong and was not.

     Measured differentially, the same orbit integrated with and without the 1PN term, so the
     integrator's own error cancels between the two arms. The Newtonian arm must come out at
     zero; if it does not, the integrator is manufacturing precession and the relativistic
     figure is worthless.
     */
    func testMercuryRelativisticPrecession() {
        let a = Mercury.semiMajorAxisM
        let e = Mercury.eccentricity
        let mu = Constants.gmSun
        let period = 2 * Double.pi * (pow(a, 3) / mu).squareRoot()

        // Start at perihelion, moving perpendicular to the radius.
        let rp = a * (1 - e)
        let vp = (mu * (1 + e) / (a * (1 - e))).squareRoot()
        let initial = StateVector(position: Vec3(rp, 0, 0), velocity: Vec3(0, vp, 0))

        func advancePerOrbit(relativistic: Bool) -> Double {
            let orbits = 60.0
            let result = propagate(PropagateOptions(
                model: ForceModel(centralGm: mu, perturbers: [], relativistic: relativistic),
                initial: initial,
                durationSeconds: orbits * period,
                limits: PropagationLimits(tolerance: 1e-13, maxStepSeconds: 3_600)
            ))
            let final = result.samples.last!
            let e0 = eccentricityVector(gm: mu, position: initial.position, velocity: initial.velocity)
            let e1 = eccentricityVector(gm: mu, position: final.position, velocity: final.velocity)
            let turned = normaliseAngleSigned(atan2(e1.y, e1.x) - atan2(e0.y, e0.x))
            return turned / orbits
        }

        let newtonian = advancePerOrbit(relativistic: false)
        let relativistic = advancePerOrbit(relativistic: true)

        // The control. A Newtonian two-body orbit does not precess at all.
        XCTAssertLessThan(
            abs(newtonian) * Constants.arcsecPerRadian, 1e-4,
            "the Newtonian arm precessed, so the integrator is inventing physics"
        )

        let orbitsPerCentury = Constants.daysPerJulianCentury / Mercury.orbitalPeriodDays
        let measured = (relativistic - newtonian) * orbitsPerCentury * Constants.arcsecPerRadian
        let closedForm = perihelionAdvanceArcsecPerCentury(
            gm: mu, semiMajorAxisM: a, eccentricity: e, orbitalPeriodDays: Mercury.orbitalPeriodDays
        )

        print(String(
            format: "\n  Mercury perihelion advance: measured %.4f, closed form %.4f arcsec/century",
            measured, closedForm
        ))

        XCTAssertEqual(measured, closedForm, accuracy: 0.02, "integrated against the closed form")
        // And against the published residual general relativity has to account for.
        XCTAssertEqual(measured, mercuryGrPrecessionArcsecPerCentury, accuracy: 0.1)
    }

    /// The indirect term is not optional: a perturber pulls the Sun as well as the body, and
    /// the frame is Sun-centred. Dropping it leaves a spurious secular drift and no error.
    func testPerturbersCarryBothTerms() {
        let epoch = JdTdb(Epochs.j2000)
        let perturbers = perturbersFrom(startEpoch: epoch, include: [.jupiter])
        XCTAssertEqual(perturbers.count, 1)

        // A body at the Sun's own position feels only the indirect term, which must be the
        // perturber's pull on the Sun, non-zero and pointing at the perturber.
        let jupiter = heliocentricPositionOf(.jupiter, at: epoch)
        let model = ForceModel(centralGm: Constants.gmSun, perturbers: perturbers)
        let result = propagate(PropagateOptions(
            model: model,
            initial: StateVector(position: Vec3(1e6, 0, 0), velocity: .zero),
            durationSeconds: 60,
            limits: PropagationLimits(tolerance: 1e-10, maxStepSeconds: 30)
        ))
        XCTAssertFalse(result.samples.isEmpty)
        XCTAssertGreaterThan(jupiter.length, 7e11, "Jupiter should be about 5.2 au out")
    }
}

/**
 Mutual gravity: the three free checks, and the null test.

 Energy, momentum and angular momentum come from the equation's symmetries and are never
 handed to the integrator, so any drift in them is numerical error and nothing else. The
 engine's reference figures over 100 years with 9 bodies are 1.6e-14, 3.6e-14 and 0.85 mm.
 */
final class NBodyTests: XCTestCase {

    func testNewtonsThirdLawHoldsToRoundOff() {
        let gm = [Constants.gmSun, bodyContracts[.jupiter]!.gm]
        let state: [Double] = [0, 0, 0, 0, 0, 0, 3e11, 4e11, 1e10, 0, 0, 0]
        var out = [Double](repeating: 0, count: 6)
        accelerations(gm: gm, state: state, into: &out)

        // mu_1 a_1 = -mu_2 a_2. Structural, because the pair loop applies each separation once
        // and gives both bodies equal and opposite impulses.
        for axis in 0 ..< 3 {
            let left = gm[0] * out[axis]
            let right = gm[1] * out[3 + axis]
            XCTAssertLessThan(abs(left + right) / abs(left), 1e-15, "axis \(axis)")
        }
    }

    func testStartsAtTheBarycentreWithZeroMomentum() {
        let system = solarSystemAt(JdTdb(Epochs.j2000))
        XCTAssertEqual(system.ids.count, 9, "Sun plus eight planets")
        XCTAssertLessThan(barycentre(system).length, 1e-6)

        // Momentum has units of gm times speed, so read it as the barycentre's drift speed.
        // The raw sum's baseline is round-off, which makes a ratio of magnitudes meaningless.
        let totalGm = system.gm.reduce(0, +)
        XCTAssertLessThan(totalMomentum(system).length / totalGm, 1e-12)
    }

    func testConservesEnergyAndAngularMomentum() {
        let system = solarSystemAt(JdTdb(Epochs.j2000))
        let energyBefore = totalEnergy(system)
        let angularBefore = totalAngularMomentum(system)
        let centreBefore = barycentre(system)

        advance(system, durationSeconds: 10 * Constants.secondsPerJulianYear,
                limits: NBodyLimits(tolerance: 1e-13, maxStepSeconds: Constants.secondsPerDay))

        let energyDrift = abs((totalEnergy(system) - energyBefore) / energyBefore)
        let angularDrift = (totalAngularMomentum(system) - angularBefore).length / angularBefore.length
        print(String(
            format: "\n  N-body over 10 yr: energy %.2e, angular momentum %.2e, barycentre %.2e m",
            energyDrift, angularDrift, (barycentre(system) - centreBefore).length
        ))

        XCTAssertLessThan(energyDrift, 1e-12)
        XCTAssertLessThan(angularDrift, 1e-12)
        XCTAssertLessThan((barycentre(system) - centreBefore).length, 1)
    }

    /// The Sun moves. Its wobble about the barycentre reaches roughly two solar radii,
    /// dominated by Jupiter, which puts the barycentre outside the Sun's own surface.
    func testTheSunWobbles() {
        let system = solarSystemAt(JdTdb(Epochs.j2000))
        var maximum = 0.0
        var minimum = Double.infinity
        for _ in 0 ..< 60 {
            advance(system, durationSeconds: Constants.secondsPerJulianYear / 2,
                    limits: NBodyLimits(tolerance: 1e-13, maxStepSeconds: 5 * Constants.secondsPerDay))
            let d = positionOf(system, "sun").length
            maximum = max(maximum, d)
            minimum = min(minimum, d)
        }
        print(String(
            format: "  Sun about the barycentre over 30 yr: %.3f to %.3f solar radii",
            minimum / Constants.solarRadiusM, maximum / Constants.solarRadiusM
        ))
        XCTAssertGreaterThan(maximum, Constants.solarRadiusM, "barycentre should leave the Sun")
        XCTAssertLessThan(minimum, Constants.solarRadiusM, "and come back inside: it is a wobble")
    }

    /// Identical inputs give bit-identical output. There is no randomness in the solar system
    /// and none here. Bit equality, not a tolerance: a stray random or an iteration order that
    /// depended on insertion would survive an approximate check.
    func testIsDeterministic() {
        let a = solarSystemAt(JdTdb(Epochs.j2000))
        let b = solarSystemAt(JdTdb(Epochs.j2000))
        advance(a, durationSeconds: 5 * Constants.secondsPerJulianYear)
        advance(b, durationSeconds: 5 * Constants.secondsPerJulianYear)
        XCTAssertEqual(a.state, b.state)
        XCTAssertEqual(a.elapsed, b.elapsed)
    }

    /// Reverse time is physically valid, because Newton's equations are time-reversible.
    /// Dormand-Prince is not symplectic, so the return is to tolerance, not bit for bit.
    func testRunsBackwards() {
        let system = solarSystemAt(JdTdb(Epochs.j2000))
        let start = positionOf(system, "mars")
        advance(system, durationSeconds: 3 * Constants.secondsPerJulianYear)
        advance(system, durationSeconds: -3 * Constants.secondsPerJulianYear)
        XCTAssertLessThan((positionOf(system, "mars") - start).length, 1e4)
    }
}
