import XCTest
@testable import SolarKit

/**
 The registry port: all 32 bodies, their positions and their orientations.

 Writes `bodies-snapshot.json`, which `website/src/swift-port.test.ts` recomputes with the
 TypeScript engine and compares. Same reasoning as the ephemeris gate: a hand-port drifts, and
 a drifted physics engine does not throw, it puts a moon somewhere plausible and wrong.

 The assertions here are the ones that can be checked without the engine, so a mistake shows
 up on this side too rather than only when the website runs.
 */
final class BodiesTests: XCTestCase {

    /// Four epochs, spread far enough apart that a pole rate or a node has to be right.
    static let epochs: [Double] = [
        2_451_545.0,  // J2000
        2_433_282.5,  // 1950-01-01
        2_460_676.5,  // 2025-01-01
        2_469_807.5,  // 2050-01-01
    ]

    static func snapshotPath() -> URL {
        URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .appendingPathComponent("bodies-snapshot.json")
    }

    func testRegistryIsComplete() {
        XCTAssertEqual(bodyIds.count, 32)
        XCTAssertEqual(Set(bodyIds).count, 32, "duplicate body id")
        for id in bodyIds {
            XCTAssertNotNil(bodyContracts[id], "\(id) missing a contract")
        }
        // Every moon has a parent, and that parent is in the registry.
        for id in bodyIds where bodyContracts[id]!.kind == .moon {
            let parent = bodyContracts[id]!.parent
            XCTAssertNotNil(parent, "\(id) is a moon with no parent")
            XCTAssertNotNil(bodyContracts[parent!], "\(id) names a parent not in the registry")
        }
    }

    func testRotationRateAgreesWithThePublishedPeriod() {
        for id in bodyIds {
            let contract = bodyContracts[id]!
            let fromIau = rotationPeriodDays(id)
            let declared = contract.knownDiscrepancies.contains { $0.field == "siderealRotationDays" }

            if declared {
                // A declared conflict must be a real one, or the declaration covers nothing.
                XCTAssertGreaterThan(
                    abs(fromIau - contract.siderealRotationDays) / abs(contract.siderealRotationDays),
                    1e-4,
                    "\(id) declares a rotation discrepancy, so there must actually be one"
                )
            } else {
                XCTAssertLessThan(
                    abs(fromIau - contract.siderealRotationDays) / abs(contract.siderealRotationDays),
                    1e-4,
                    "\(id) IAU rate disagrees with its published sidereal period"
                )
            }
            // Retrograde must be retrograde in both places.
            XCTAssertEqual(
                fromIau < 0, contract.siderealRotationDays < 0,
                "\(id) rotation sign disagrees between the IAU rate and the fact sheet"
            )
        }
    }

    /// Uranus is the one people notice. If its moons sweep through the planet, the parent
    /// equatorial transform is wrong.
    func testUranusIsOnItsSide() {
        let tilt = obliquityToOrbitDeg(.uranus, at: JdTdb(Epochs.j2000))
        XCTAssertGreaterThan(tilt, 90, "Uranus should be past 90 degrees, so retrograde")
        XCTAssertLessThan(tilt, 105)
    }

    func testMoonsOrbitAtTheirPublishedDistances() {
        let expected: [(BodyId, BodyId, Double, Double)] = [
            // moon, parent, min km, max km
            (.moon, .embary, 356_000, 407_000),
            (.io, .jupiter, 420_000, 424_000),
            (.callisto, .jupiter, 1_870_000, 1_890_000),
            (.titan, .saturn, 1_180_000, 1_260_000),
            (.phoebe, .saturn, 10_800_000, 15_100_000),
            (.triton, .neptune, 354_000, 356_000),
            (.phobos, .mars, 9_200_000 / 1_000, 9_600_000 / 1_000),
        ]
        for (moon, parent, low, high) in expected {
            let separation = (heliocentricPositionOf(moon, at: JdTdb(Epochs.j2000))
                - heliocentricPositionOf(parent, at: JdTdb(Epochs.j2000))).length / 1_000
            XCTAssertGreaterThan(separation, low, "\(moon) too close to \(parent)")
            XCTAssertLessThan(separation, high, "\(moon) too far from \(parent)")
        }
    }

    func testWritesTheSnapshotTheWebsiteChecks() throws {
        var bodies: [String: Any] = [:]

        for id in bodyIds {
            var rows: [[String: Any]] = []
            for jd in Self.epochs {
                let epoch = JdTdb(jd)
                let position = heliocentricPositionOf(id, at: epoch)
                let o = orientationOf(id, at: epoch)
                rows.append([
                    "jdTdb": jd,
                    "x": position.x, "y": position.y, "z": position.z,
                    "spin": o.spin,
                    "poleX": o.poleEcliptic.x,
                    "poleY": o.poleEcliptic.y,
                    "poleZ": o.poleEcliptic.z,
                ])
            }
            bodies[id.rawValue] = [
                "rotationPeriodDays": rotationPeriodDays(id),
                "samples": rows,
            ]
        }

        let payload: [String: Any] = [
            "note": "Written by SolarKitTests. Checked by website/src/swift-port.test.ts.",
            "bodies": bodies,
        ]
        try JSONSerialization
            .data(withJSONObject: payload, options: [.prettyPrinted, .sortedKeys])
            .write(to: Self.snapshotPath())
        print("  wrote \(Self.snapshotPath().path)")
    }
}
