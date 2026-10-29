import XCTest
@testable import SolarKit

/**
 The Swift side of the cross-platform conformance suite.

 `contracts/conformance/` holds one set of cases, generated from the engine, that every client
 runs. This executes the identical files the website's `conformance.test.ts` executes.

 (Written without a glob on purpose: Swift block comments nest, so a `/` followed by a `*` in
 a doc comment opens a second comment that the closing delimiter then consumes, leaving the
 outer one unterminated. The error points at the end of the file, not at the text.)

 That is the whole point. Before this there were two test suites and one of them wrote a
 snapshot the other checked, which caught drift in exactly what it covered and nothing else:
 every new function needed a bespoke artifact, two runners, and a format agreed between them.
 Here a domain is a list of cases, and a port either reproduces them or does not.

 It has already earned its place. Generating the suite found that this port's Mercury carried
 a different eccentricity and a different orbital period from the engine's, both plausible
 figures, neither flagged by anything.
 */
final class ConformanceTests: XCTestCase {

    static func suiteDirectory() -> URL {
        URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent()  // SolarKitTests
            .deletingLastPathComponent()  // Tests
            .deletingLastPathComponent()  // SolarKit
            .deletingLastPathComponent()  // ios
            .deletingLastPathComponent()  // mobile
            .deletingLastPathComponent()  // repository root
            .appendingPathComponent("contracts/conformance")
    }

    struct Domain: Decodable {
        let domain: String
        let description: String
        /// Relative tolerance, for quantities of ordinary magnitude.
        let tolerance: Double
        /// Absolute floor, for quantities near zero where a relative test means nothing.
        let absoluteTolerance: Double
        let cases: [Case]
    }

    struct Case: Decodable {
        let id: String
        let input: [String: JSON]?
        let expected: JSON
    }

    /// Just enough JSON to read a case. `Decodable` with `Any` is not a thing in Swift.
    enum JSON: Decodable {
        case number(Double)
        case string(String)
        case bool(Bool)
        case array([JSON])
        case object([String: JSON])
        case null

        init(from decoder: Decoder) throws {
            let container = try decoder.singleValueContainer()
            if container.decodeNil() { self = .null; return }
            if let v = try? container.decode(Double.self) { self = .number(v); return }
            if let v = try? container.decode(Bool.self) { self = .bool(v); return }
            if let v = try? container.decode(String.self) { self = .string(v); return }
            if let v = try? container.decode([JSON].self) { self = .array(v); return }
            self = .object(try container.decode([String: JSON].self))
        }

        var double: Double? { if case let .number(v) = self { return v }; return nil }
        var text: String? { if case let .string(v) = self { return v }; return nil }
        var list: [JSON]? { if case let .array(v) = self { return v }; return nil }
        var fields: [String: JSON]? { if case let .object(v) = self { return v }; return nil }
    }

    // MARK: - Running a case

    private func number(_ input: [String: JSON]?, _ key: String) -> Double {
        input?[key]?.double ?? .nan
    }
    private func text(_ input: [String: JSON]?, _ key: String) -> String {
        input?[key]?.text ?? ""
    }
    private func vector(_ input: [String: JSON]?, _ key: String) -> Vec3 {
        guard let f = input?[key]?.fields else { return .zero }
        return Vec3(f["x"]?.double ?? 0, f["y"]?.double ?? 0, f["z"]?.double ?? 0)
    }
    private func doubles(_ input: [String: JSON]?, _ key: String) -> [Double] {
        (input?[key]?.list ?? []).compactMap(\.double)
    }

    /// Produces whatever SolarKit gives for a case, as comparable JSON.
    private func compute(domain: String, _ c: Case) throws -> JSON {
        let input = c.input

        func value(_ v: Double) -> JSON { .number(v) }
        func vec(_ v: Vec3) -> JSON {
            .object(["x": .number(v.x), "y": .number(v.y), "z": .number(v.z)])
        }

        switch domain {
        case "units":
            switch c.id {
            case "au-in-metres": return value(Constants.auInMetres)
            case "gm-sun": return value(Constants.gmSun)
            case "seconds-per-day": return value(Constants.secondsPerDay)
            case "days-per-julian-century": return value(Constants.daysPerJulianCentury)
            case "days-per-julian-year": return value(Constants.daysPerJulianYear)
            case "speed-of-light": return value(speedOfLight)
            case "km-to-metres": return value(toMetres(km(number(input, "km"))))
            case "au-to-metres": return value(toMetres(au(number(input, "au"))))
            case "degrees-to-radians": return value(toRadians(deg(number(input, "deg"))))
            default: return value(normaliseAngleSigned(number(input, "radians")))
            }

        case "time":
            if c.id.hasPrefix("tai-minus-utc") {
                return value(taiMinusUtcSeconds(JdUtc(number(input, "jdUtc"))))
            }
            if c.id.hasPrefix("tt-from-utc") {
                return value(ttFromUtc(JdUtc(number(input, "jdUtc"))).value)
            }
            if c.id.hasPrefix("tdb-from-tt") {
                return value(tdbFromTt(JdTt(number(input, "jdTt"))).value)
            }
            return value(julianCenturiesSinceJ2000(JdTdb(number(input, "jdTdb"))))

        case "kepler":
            if c.id.hasPrefix("eccentric-anomaly") {
                return value(try solveEccentricAnomaly(
                    meanAnomaly: number(input, "meanAnomaly"),
                    eccentricity: number(input, "eccentricity")
                ))
            }
            let planet = Planet(rawValue: text(input, "planet"))!
            let state = try heliocentricState(
                planet, at: JdTdb(number(input, "jdTdb")), model: shortSpan
            )
            return .object(["position": vec(state.position), "velocity": vec(state.velocity)])

        case "position":
            let body = BodyId(rawValue: text(input, "body"))!
            return vec(heliocentricPositionOf(body, at: JdTdb(number(input, "jdTdb"))))

        case "rotation":
            let body = BodyId(rawValue: text(input, "body"))!
            if c.id.hasPrefix("period") { return value(rotationPeriodDays(body)) }
            let epoch = JdTdb(number(input, "jdTdb"))
            let o = orientationOf(body, at: epoch)
            return .object([
                "pole": vec(o.poleEcliptic),
                "spin": .number(o.spin),
                "tilt": .number(o.tilt),
                "obliquityToOrbitDeg": .number(obliquityToOrbitDeg(body, at: epoch)),
            ])

        case "elements":
            let planet = Planet(rawValue: text(input, "planet"))!
            let state = try heliocentricState(
                planet, at: JdTdb(number(input, "jdTdb")), model: shortSpan
            )
            let e = osculatingElements(
                gm: number(input, "gm"), position: state.position, velocity: state.velocity
            )
            return .object([
                "semiMajorAxisM": .number(e.semiMajorAxisM),
                "eccentricity": .number(e.eccentricity),
                "inclinationRad": .number(e.inclinationRad),
                "longitudeOfAscendingNodeRad": .number(e.longitudeOfAscendingNodeRad),
                "argumentOfPericentreRad": .number(e.argumentOfPericentreRad),
                "longitudeOfPericentreRad": .number(e.longitudeOfPericentreRad),
                "projectedPericentreLongitudeRad": .number(e.projectedPericentreLongitudeRad),
            ])

        case "relativity":
            switch c.id {
            case "mercury-semi-major-axis": return value(Mercury.semiMajorAxisM)
            case "mercury-eccentricity": return value(Mercury.eccentricity)
            case "mercury-orbital-period-days": return value(Mercury.orbitalPeriodDays)
            case "mercury-advance-per-orbit":
                return value(perihelionAdvancePerOrbit(
                    gm: number(input, "gm"),
                    semiMajorAxisM: number(input, "semiMajorAxisM"),
                    eccentricity: number(input, "eccentricity")
                ))
            default:
                return vec(postNewtonianAcceleration(
                    gm: number(input, "gm"),
                    position: vector(input, "position"),
                    velocity: vector(input, "velocity")
                ))
            }

        case "nbody":
            if c.id == "two-body-acceleration" {
                let gm = doubles(input, "gm")
                let state = doubles(input, "state")
                var out = [Double](repeating: 0, count: 6)
                accelerations(gm: gm, state: state, into: &out)
                return .array(out.map { .number($0) })
            }
            let system = solarSystemAt(JdTdb(number(input, "jdTdb")))
            return .object([
                "ids": .array(system.ids.map { .string($0) }),
                "state": .array(system.state.map { .number($0) }),
                "totalEnergy": .number(totalEnergy(system)),
            ])

        case "secular":
            let config = SecularConfiguration(
                semiMajorAxisM: number(input, "semiMajorAxisM"),
                eccentricity: number(input, "eccentricity"),
                gm: number(input, "gm"),
                perturberGm: number(input, "perturberGm"),
                perturberSemiMajorAxisM: number(input, "perturberSemiMajorAxisM")
            )
            return value(c.id.hasPrefix("quadrature")
                ? secularPericentreRate(config, Int(number(input, "samples")))
                : leadingOrderPericentreRate(config))

        case "asteroid":
            let e = impactEnergy(
                diameterM: number(input, "diameterM"),
                densityKgM3: number(input, "densityKgM3"),
                speedMS: number(input, "speedMS")
            )
            return .object([
                "massKg": .number(e.massKg),
                "energyJoules": .number(e.energyJoules),
                "energyMegatonsTnt": .number(e.energyMegatonsTnt),
            ])

        case "ascent":
            let site = launchSite(id: text(input, "site"))!
            if c.id.hasPrefix("rotation-bonus") {
                return value(try earthRotationBonus(
                    site: site, inclinationDeg: number(input, "inclinationDeg")
                ))
            }
            let target = AscentTarget(
                altitudeKm: number(input, "altitudeKm"),
                inclinationDeg: number(input, "inclinationDeg"),
                site: site
            )
            if c.id.hasPrefix("budget") {
                let b = try ascentBudget(target)
                return .object([
                    "circularSpeedMS": .number(b.circularSpeedMS),
                    "potentialMS": .number(b.potentialMS),
                    "earthRotationMS": .number(b.earthRotationMS),
                    "requiredMS": .number(b.requiredMS),
                ])
            }
            return value(try maximumPayload(vehicle(id: text(input, "vehicle"))!, target: target).payloadKg)

        default:
            XCTFail("no runner for domain \"\(domain)\"")
            return .null
        }
    }

    // MARK: - Comparing

    /**
     `|a - b| <= relative * |expected| + absolute`.

     The absolute term is not slack. It is what makes the test meaningful near zero, where a
     relative error of one part in 1e11 can be a last-bit difference amplified by an
     ill-conditioned function: Earth's inclination is 4e-7 radians and comes through an acos
     of something within 1e-13 of one.
     */
    private func check(
        _ actual: JSON, _ expected: JSON,
        tolerance: Double, absolute: Double, where path: String
    ) {
        switch expected {
        case let .number(want):
            guard let got = actual.double else {
                XCTFail("\(path): expected a number, got \(actual)")
                return
            }
            let allowed = tolerance * abs(want) + absolute
            XCTAssertLessThanOrEqual(
                abs(got - want), allowed,
                "\(path): expected \(want), got \(got) (allowed \(allowed))"
            )
        case let .string(want):
            XCTAssertEqual(actual.text, want, path)
        case let .array(want):
            guard let got = actual.list else {
                XCTFail("\(path): expected an array")
                return
            }
            XCTAssertEqual(got.count, want.count, "\(path) length")
            for (i, value) in want.enumerated() where i < got.count {
                check(
                    got[i], value, tolerance: tolerance, absolute: absolute,
                    where: "\(path)[\(i)]"
                )
            }
        case let .object(want):
            guard let got = actual.fields else {
                XCTFail("\(path): expected an object")
                return
            }
            for (key, value) in want {
                guard let field = got[key] else {
                    XCTFail("\(path).\(key) missing")
                    continue
                }
                check(
                    field, value, tolerance: tolerance, absolute: absolute,
                    where: "\(path).\(key)"
                )
            }
        case .bool, .null:
            break
        }
    }

    // MARK: - The suite

    func testReproducesEveryConformanceCase() throws {
        struct Index: Decodable { let domains: [String]; let totalCases: Int }
        let indexData = try Data(
            contentsOf: Self.suiteDirectory().appendingPathComponent("index.json")
        )
        let index = try JSONDecoder().decode(Index.self, from: indexData)
        XCTAssertGreaterThan(index.totalCases, 400, "the suite looks truncated")

        var ran = 0
        for name in index.domains {
            let data = try Data(
                contentsOf: Self.suiteDirectory().appendingPathComponent("\(name).json")
            )
            let domain = try JSONDecoder().decode(Domain.self, from: data)
            for testCase in domain.cases {
                let produced = try compute(domain: name, testCase)
                check(
                    produced, testCase.expected,
                    tolerance: domain.tolerance,
                    absolute: domain.absoluteTolerance,
                    where: "\(name)/\(testCase.id)"
                )
                ran += 1
            }
            print("  \(name.padding(toLength: 12, withPad: " ", startingAt: 0)) "
                  + "\(domain.cases.count) cases")
        }

        // A runner that silently skipped a domain would otherwise pass.
        XCTAssertEqual(ran, index.totalCases, "did not run every case in the suite")
        print("  ran \(ran) conformance cases")
    }
}
