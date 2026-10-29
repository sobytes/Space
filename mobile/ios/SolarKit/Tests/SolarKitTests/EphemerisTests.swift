import XCTest
@testable import SolarKit

/**
 The port's load-bearing gate: SolarKit against the same JPL Horizons fixtures as the
 TypeScript engine, to the same tolerances.

 This is the whole reason a hand-port is allowed to exist. Swift cannot import the engine, so
 the only thing standing between this and silent drift is running both against the same
 external truth and demanding the same answer. Checking the Swift against the TypeScript would
 be weaker: two implementations of the same mistake agree perfectly.

 The fixtures are located from `#filePath`, not from the working directory, because
 `swift test` and Xcode run from different places.
 */
final class EphemerisTests: XCTestCase {

    struct Sample {
        let epoch: String
        let jdTdb: JdTdb
        let position: Vec3
        let velocity: Vec3
    }

    static func fixturesDirectory() -> URL {
        // Six, not five: the first strips the filename, then one per directory up to the
        // repository root. Getting this wrong resolves to a path that does not exist, which
        // fails loudly. A path that existed but held the wrong fixtures would not.
        URL(fileURLToPath: #filePath)
            .deletingLastPathComponent()  // .../Tests/SolarKitTests
            .deletingLastPathComponent()  // .../Tests
            .deletingLastPathComponent()  // .../SolarKit
            .deletingLastPathComponent()  // .../ios
            .deletingLastPathComponent()  // .../mobile
            .deletingLastPathComponent()  // repository root
            .appendingPathComponent("engine/fixtures/horizons")
    }

    static func load(_ planet: Planet) throws -> [Sample] {
        let url = fixturesDirectory().appendingPathComponent("\(planet.rawValue).json")
        let data = try Data(contentsOf: url)
        let root = try JSONSerialization.jsonObject(with: data) as! [String: Any]

        // The fixtures are heliocentric by construction; re-check rather than assume, because
        // a barycentric fixture would shift every residual by the Sun's offset and still look
        // like a plausible set of numbers.
        XCTAssertEqual(root["centre"] as? String, "Sun (500@10)", "\(planet) fixture centre")
        XCTAssertEqual(root["body"] as? String, planet.rawValue)

        let rows = root["samples"] as! [[String: Any]]
        return rows.map { row in
            let p = row["positionKm"] as! [Double]
            let v = row["velocityKmS"] as! [Double]
            return Sample(
                epoch: row["epoch"] as! String,
                jdTdb: JdTdb(row["jdTdb"] as! Double),
                // Fixtures are km and km/s; the engine is metres and metres per second.
                position: Vec3(toMetres(km(p[0])), toMetres(km(p[1])), toMetres(km(p[2]))),
                velocity: Vec3(toMetres(km(v[0])), toMetres(km(v[1])), toMetres(km(v[2])))
            )
        }
    }

    private func eclipticLongitude(_ v: Vec3) -> Double { atan2(v.y, v.x) }
    private func eclipticLatitude(_ v: Vec3) -> Double { asin(v.z / v.length) }

    /**
     Writes the residuals the TypeScript gate checks this port against.

     The file is committed. `website`'s `swift-port.test.ts` recomputes the same quantities in
     TypeScript and asserts they match what is recorded here, so a change to the engine that is
     not carried into the Swift turns the normal test run red rather than being discovered when
     a planet is in the wrong place on a phone. To update it, run `swift test`.
     */
    static func residualsPath() -> URL {
        URL(fileURLToPath: #filePath)
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .appendingPathComponent("residuals.json")
    }

    func testEveryPlanetStaysInsideItsDeclaredEnvelope() throws {
        var summary: [String] = []
        var recorded: [String: [[String: Any]]] = [:]

        for planet in Planet.allCases {
            let samples = try Self.load(planet)
            XCTAssertEqual(samples.count, 8, "\(planet) fixture count")

            let allowed = shortSpan.quotedError[planet]!
            let envelope = accuracyEnvelopes[planet]!

            var longitudes: [Double] = []
            var latitudes: [Double] = []
            var distances: [Double] = []
            var rows: [[String: Any]] = []

            for sample in samples {
                let computed = try heliocentricState(planet, at: sample.jdTdb, model: shortSpan)
                longitudes.append(
                    abs(normaliseAngleSigned(
                        eclipticLongitude(computed.position) - eclipticLongitude(sample.position)
                    )) * Constants.arcsecPerRadian
                )
                latitudes.append(
                    abs(eclipticLatitude(computed.position) - eclipticLatitude(sample.position))
                        * Constants.arcsecPerRadian
                )
                distances.append(
                    abs(toKilometres(computed.position.length) - toKilometres(sample.position.length))
                )
                rows.append([
                    "epoch": sample.epoch,
                    "jdTdb": sample.jdTdb.value,
                    "longitudeArcsec": longitudes.last!,
                    "latitudeArcsec": latitudes.last!,
                    "distanceKm": distances.last!,
                ])
            }
            recorded[planet.rawValue] = rows

            func rms(_ values: [Double]) -> Double {
                (values.reduce(0) { $0 + $1 * $1 } / Double(values.count)).squareRoot()
            }

            let channels: [(String, [Double], Double)] = [
                ("longitude", longitudes, allowed.longitudeArcsec),
                ("latitude", latitudes, allowed.latitudeArcsec),
                ("distance", distances, allowed.distanceKm),
            ]

            for (name, values, nominal) in channels {
                XCTAssertLessThanOrEqual(
                    rms(values) / nominal, envelope.rmsFactor,
                    "\(planet) \(name) RMS over JPL nominal"
                )
                XCTAssertLessThanOrEqual(
                    values.max()! / nominal, envelope.maxFactor,
                    "\(planet) \(name) worst epoch over JPL nominal"
                )
            }

            summary.append(String(
                format: "%-8@ lon %6.2f\"  lat %6.2f\"  dist %8.0f km   (worst of 8 epochs)",
                planet.rawValue as NSString,
                longitudes.max()!, latitudes.max()!, distances.max()!
            ))
        }

        print("\nSolarKit against JPL Horizons:")
        summary.forEach { print("  \($0)") }

        let payload: [String: Any] = [
            "note": "Written by SolarKitTests. Checked by website/src/swift-port.test.ts.",
            "model": shortSpan.id,
            "bodies": recorded,
        ]
        let data = try JSONSerialization.data(
            withJSONObject: payload, options: [.prettyPrinted, .sortedKeys]
        )
        try data.write(to: Self.residualsPath())
        print("  wrote \(Self.residualsPath().path)")
    }

    /**
     The analytic velocity against a central difference of the same position function.

     At 0.01 d the truncation error is near 1e-7 relative for Mercury, the fastest body here,
     so 1e-6 pins the hand-derived derivatives without pinning round-off. `shortSpan` is passed
     explicitly because the 2050 fixture sits on the window's edge and a default-model step
     past it lands in the long-span table.
     */
    func testAnalyticVelocityMatchesACentralDifference() throws {
        let stepDays = 0.01
        for planet in Planet.allCases {
            for sample in try Self.load(planet) {
                let before = try heliocentricPosition(
                    planet, at: JdTdb(sample.jdTdb.value - stepDays), model: shortSpan
                )
                let after = try heliocentricPosition(
                    planet, at: JdTdb(sample.jdTdb.value + stepDays), model: shortSpan
                )
                let seconds = 2 * stepDays * Constants.secondsPerDay
                let numerical = (after - before) / seconds
                let analytic = try heliocentricState(planet, at: sample.jdTdb, model: shortSpan).velocity
                let relative = (analytic - numerical).length / numerical.length
                XCTAssertLessThan(
                    relative, 1e-6,
                    "\(planet) at \(sample.epoch) velocity derivative"
                )
            }
        }
    }

    func testSelectsTheShortSpanModelAtEveryFixtureEpoch() throws {
        for planet in Planet.allCases {
            for sample in try Self.load(planet) {
                XCTAssertEqual(
                    modelForYear(julianYearForModelSelection(sample.jdTdb)).id,
                    "short-span",
                    "\(planet) at \(sample.epoch)"
                )
            }
        }
    }
}

private extension URL {
    init(fileURLToPath path: String) { self.init(fileURLWithPath: path) }
}
