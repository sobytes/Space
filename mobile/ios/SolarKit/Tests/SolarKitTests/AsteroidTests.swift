import XCTest
@testable import SolarKit

/**
 Impact energies against three real events, and a trajectory that actually feels the planets.

 The same fixtures the engine uses. An impact energy is easy to get plausibly wrong by a
 factor of a thousand, and these three span eight orders of magnitude, so they pin the
 arithmetic rather than just exercising it.
 */
final class AsteroidTests: XCTestCase {

    func testImpactEnergyAgainstRealEvents() {
        // name, diameter m, density kg/m3, speed m/s, low Mt, high Mt
        let events: [(String, Double, Double, Double, Double, Double)] = [
            ("Chelyabinsk 2013", 19, 3_300, 19_160, 0.4, 0.8),
            ("Tunguska 1908", 55, 3_000, 15_000, 3, 15),
            ("Chicxulub", 10_000, 2_600, 20_000, 1e7, 2e8),
        ]

        for (name, diameter, density, speed, low, high) in events {
            let estimate = impactEnergy(
                diameterM: diameter, densityKgM3: density, speedMS: speed
            )
            print("  \(name): \(String(format: "%.3g", estimate.energyMegatonsTnt)) Mt")
            XCTAssertGreaterThan(estimate.energyMegatonsTnt, low, "\(name) too low")
            XCTAssertLessThan(estimate.energyMegatonsTnt, high, "\(name) too high")
            XCTAssertFalse(estimate.comparison.isEmpty)
        }
    }

    /// The release state must carry the origin body's own motion, or "drop it near Mars"
    /// behaves like a stone appearing at rest in Mars's orbit rather than like Mars.
    func testReleaseInheritsTheCarriersMotion() {
        let launch = AsteroidLaunch(originBody: .mars, altitudeM: 1e8, speedMS: 0)
        let state = initialStateFor(launch)
        // Mars moves at about 24 km/s. With zero relative speed the asteroid must match it.
        XCTAssertGreaterThan(state.velocity.length, 20_000)
        XCTAssertLessThan(state.velocity.length, 28_000)
    }

    /// The perturber list is built from the registry, which is what makes masses matter.
    /// Everything except the Sun, which is the frame's origin and already the central mass:
    /// including it double-counts its pull and divides the indirect term by zero.
    func testEveryRegistryBodyExceptTheSunPerturbs() {
        let perturbers = perturbersFrom(startEpoch: JdTdb(Epochs.j2000))
        XCTAssertEqual(perturbers.count, bodyIds.count - 1, "every body but the Sun")
        XCTAssertFalse(perturbers.contains { $0.id == "sun" })
        XCTAssertTrue(perturbers.contains { $0.id == "jupiter" })
        XCTAssertTrue(perturbers.contains { $0.id == "titan" })

        // Atmospheric entry counts as arrival, so Earth's capture radius is widened by 100 km.
        let earth = perturbers.first { $0.id == "embary" }!
        XCTAssertEqual(
            earth.radiusM, bodyContracts[.embary]!.equatorialRadiusM + 100_000, accuracy: 1
        )
    }

    func testAnAsteroidRunsAndReportsAnOutcome() {
        let outcome = runAsteroid(AsteroidLaunch(durationYears: 5))
        XCTAssertFalse(outcome.summary.isEmpty)
        XCTAssertGreaterThan(outcome.result.samples.count, 10)
        XCTAssertGreaterThan(outcome.result.steps, 10)
        print("  default launch: \(outcome.summary)")
    }
}
