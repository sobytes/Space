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
        /// Optional per-case override, for a case whose domain tolerance is meaningless for it.
        let absoluteTolerance: Double?
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

        /**
         Integrated trajectories, re-run rather than compared against a stored path.

         The case carries only the initial condition and the duration, so passing means this
         integrator arrived where the TypeScript one did, not that a number was copied across.
         The two-body cases close an exact orbit, so the expected endpoint is also the start.
         */
        case "propagate":
            let limits = PropagationLimits(
                tolerance: number(input, "tolerance"),
                minStepSeconds: 1,
                maxStepSeconds: c.id.hasPrefix("mercury") ? 3_600 : 86_400 * 5,
                maxSteps: 2_000_000
            )

            if c.id.hasPrefix("two-body") {
                let r = number(input, "radiusAu") * Constants.auInMetres
                let result = propagate(PropagateOptions(
                    model: twoBodyModel(),
                    initial: StateVector(
                        position: Vec3(r, 0, 0),
                        velocity: Vec3(0, (Constants.gmSun / r).squareRoot(), 0)
                    ),
                    durationSeconds: number(input, "durationSeconds"),
                    limits: limits
                ))
                let final = result.samples[result.samples.count - 1]
                return .object(["position": vec(final.position), "velocity": vec(final.velocity)])
            }

            if c.id.hasPrefix("mercury") {
                let a = Mercury.semiMajorAxisM
                let e = Mercury.eccentricity
                let period = 2 * Double.pi * (pow(a, 3) / Constants.gmSun).squareRoot()
                let result = propagate(PropagateOptions(
                    model: ForceModel(
                        centralGm: Constants.gmSun,
                        perturbers: [],
                        relativistic: c.id.hasSuffix("relativistic")
                    ),
                    initial: StateVector(
                        position: Vec3(a * (1 - e), 0, 0),
                        velocity: Vec3(0, ((Constants.gmSun * (1 + e)) / (a * (1 - e))).squareRoot(), 0)
                    ),
                    durationSeconds: number(input, "orbits") * period,
                    limits: limits
                ))
                let final = result.samples[result.samples.count - 1]
                return .object([
                    "position": vec(final.position),
                    "velocity": vec(final.velocity),
                    "pericentreLongitude": .number(osculatingElements(
                        gm: Constants.gmSun, position: final.position, velocity: final.velocity
                    ).longitudeOfPericentreRad),
                ])
            }

            XCTFail("no runner for propagate case \"\(c.id)\"")
            return .null

        /// The Sun's whole life, and what it does to the habitable zone.
        case "deep-time":
            if c.id.hasPrefix("crossing") {
                let crossing = runawayGreenhouseCrossing(BodyId(rawValue: text(input, "body"))!)
                switch crossing {
                case .alreadyInside:
                    return .object(["kind": .string("already-inside"), "fromNowGyr": .null])
                case .notBeforeTheEnd:
                    return .object(["kind": .string("not-before-the-end"), "fromNowGyr": .null])
                case let .crosses(fromNowGyr, _):
                    return .object([
                        "kind": .string("crosses"), "fromNowGyr": .number(fromNowGyr),
                    ])
                }
            }
            let age = number(input, "ageGyr")
            let state = solarStateAt(age)
            let zone = habitableZoneAt(age)
            return .object([
                "phase": .string(state.phase.rawValue),
                "luminosity": .number(state.luminosity),
                "radius": .number(state.radius),
                "mass": .number(state.mass),
                "effectiveTemperatureK": .number(state.effectiveTemperatureK),
                "confidence": .string(state.confidence.rawValue),
                "innerAu": .number(zone.innerAu),
                "outerAu": .number(zone.outerAu),
                "engulfed": .array(
                    [BodyId.mercury, .venus, .embary, .mars]
                        .filter { engulfedAt($0, ageGyr: age) }
                        .map { JSON.string($0.rawValue) }
                ),
                "fates": .object(Dictionary(uniqueKeysWithValues:
                    [BodyId.mercury, .venus, .embary, .mars].map {
                        ($0.rawValue, JSON.string(bodyFateAt($0, ageGyr: age).rawValue))
                    }
                )),
                "orbits": .object(Dictionary(uniqueKeysWithValues:
                    [BodyId.mercury, .venus, .embary, .mars, .jupiter].map {
                        ($0.rawValue, JSON.number(semiMajorAxisAt($0, ageGyr: age)))
                    }
                )),
                "periods": .object(Dictionary(uniqueKeysWithValues:
                    [BodyId.mercury, .venus, .embary, .mars, .jupiter].map {
                        ($0.rawValue, JSON.number(orbitalPeriodAt($0, ageGyr: age)))
                    }
                )),
                "temperatures": .object(Dictionary(uniqueKeysWithValues:
                    [BodyId.mercury, .venus, .embary, .mars, .jupiter].map {
                        ($0.rawValue, JSON.number(equilibriumTemperatureAt($0, ageGyr: age)))
                    }
                )),
                "photosphereAu": .number(engulfmentAt(.embary, ageGyr: age).photosphereAu),
                "earthLostToTides": .bool(engulfmentAt(.embary, ageGyr: age).lostToTides),
                "event": .string(deepTimeEventAt(age).title),
                "eventDetail": .string(deepTimeEventAt(age).detail),
            ])

        /// The time at each body's own Greenwich.
        case "solar-time":
            let clockBody = BodyId(rawValue: text(input, "body"))!
            // Null for the Sun, which has no sub-solar point and therefore no clock.
            guard let clock = solarClock(clockBody, at: JdTdb(number(input, "epoch"))) else {
                return .null
            }
            return .object([
                "longitudeDeg": .number(clock.subSolar.longitudeDeg),
                "latitudeDeg": .number(clock.subSolar.latitudeDeg),
                "hours": .number(clock.hours),
                "formatted": .string(clock.formatted),
                "dayNumber": .number(Double(clock.dayNumber)),
                "hourInEarthSeconds": .number(clock.hourInEarthSeconds),
                "sunRisesInTheWest": .bool(clock.sunRisesInTheWest),
                "localTime": localTimeLabel(clockBody, at: JdTdb(number(input, "epoch")))
                    .map { JSON.string($0) } ?? .null,
                "localTimeNewYork": localTimeLabel(
                    clockBody, at: JdTdb(number(input, "epoch")),
                    zone: EarthZone(offsetMinutes: -300, label: "EST")
                ).map { JSON.string($0) } ?? .null,
                "localTimeIndia": localTimeLabel(
                    clockBody, at: JdTdb(number(input, "epoch")),
                    zone: EarthZone(offsetMinutes: 330, label: "+05:30")
                ).map { JSON.string($0) } ?? .null,
            ])

        /// Going to a date, and what the tables can honestly say there.
        case "when":
            if c.id.hasPrefix("stamp") {
                let epoch = epochFromUnixTimestamp(number(input, "value"))
                return .object([
                    "epoch": .number(epoch.value),
                    "unixSeconds": .number(unixSecondsFromEpoch(epoch)),
                ])
            }
            let standing = ephemerisStandingAt(JdTdb(number(input, "epoch")))
            return .object([
                "model": .string(standing.model),
                "inside": .bool(standing.inside),
                "year": .number(Double(standing.year)),
                "note": .string(standing.note),
            ])

        /// How long a day, a month and a year are here, and the sentence that explains them.
        case "time-sense":
            let body = BodyId(rawValue: text(input, "body"))!
            let t = timeSense(body)
            return .object([
                "siderealSpinDays": .number(t.siderealSpinDays),
                "solarDayDays": .number(t.solarDayDays),
                "yearDays": .number(t.yearDays),
                "solarDaysPerYear": .number(t.solarDaysPerYear),
                "spinsPerYear": .number(t.spinsPerYear),
                "tidallyLocked": .bool(t.tidallyLocked),
                "monthDays": t.monthDays.map { JSON.number($0) } ?? .null,
                "synodicMonthDays": t.synodicMonthDays.map { JSON.number($0) } ?? .null,
                "headline": .string(timeHeadline(body)),
                "badge": .string(timeBadge(body)),
                "badgeShort": .string(timeBadgeShort(body)),
            ])

        /// What a mark on an orbit is worth, and where the marks go.
        case "orbit-time":
            if c.id.hasPrefix("interval") {
                let interval = markIntervalFor(periodDays: number(input, "periodDays"))
                return .object([
                    "seconds": .number(interval.seconds),
                    "label": .string(interval.label),
                    "marksPerOrbit": .number(interval.marksPerOrbit),
                ])
            }
            let timed = orbitTimeMarks(
                periodDays: number(input, "periodDays"),
                now: JdTdb(number(input, "now"))
            )
            return .object([
                "count": .number(Double(timed.marks.count)),
                "secondsFromNow": .array(timed.marks.map { .number($0.secondsFromNow) }),
                "lastEpoch": .number(timed.marks[timed.marks.count - 1].epoch.value),
            ])

        /// Where a body's name is drawn, and where an off-screen pointer aims.
        /// Sun altitude and apparent solar time at a point on a body.
        case "solar-position":
            return .object([
                "altitudeDeg": .number(solarAltitudeDeg(
                    .embary, at: JdTdb(number(input, "epoch")),
                    latitudeDeg: number(input, "latitudeDeg"),
                    longitudeDeg: number(input, "longitudeDeg")
                ) ?? .nan),
                "solarTimeHours": .number(solarTimeHoursAt(
                    .embary, at: JdTdb(number(input, "epoch")),
                    longitudeDeg: number(input, "longitudeDeg")
                ) ?? .nan),
            ])

        /// Camera distance that holds a radius on the narrow axis of a given viewport.
        case "framing":
            return .object([
                "narrowHalfAngle": .number(narrowHalfAngle(
                    verticalFovRadians: number(input, "verticalFovRadians"),
                    aspect: number(input, "aspect")
                )),
                "distanceM": .number(framingDistanceM(
                    radiusM: number(input, "radiusM"),
                    verticalFovRadians: number(input, "verticalFovRadians"),
                    aspect: number(input, "aspect"),
                    fill: number(input, "fill")
                )),
            ])

        /// Every preset the clock offers, in order, with the words used for it.
        case "clock-rates":
            let preset = ratePresets[Int(number(input, "index"))]
            return .object([
                "label": .string(preset.label),
                "secondsPerSecond": .number(preset.secondsPerSecond),
            ])

        case "labels":
            guard case let .array(rawInputs)? = input?["inputs"] else { return .null }
            let labelInputs: [LabelInput] = rawInputs.compactMap { entry in
                guard case let .object(f) = entry,
                      case let .string(id)? = f["id"],
                      let body = BodyId(rawValue: id),
                      case let .string(relevance)? = f["relevance"],
                      let kind = LabelRelevance(rawValue: relevance)
                else { return nil }
                func num(_ key: String) -> Double {
                    if case let .number(v)? = f[key] { return v }
                    return 0
                }
                var behind = false
                if case let .bool(v)? = f["behindCamera"] { behind = v }
                return LabelInput(
                    id: body, ndcX: num("ndcX"), ndcY: num("ndcY"), radiusPx: num("radiusPx"),
                    distance: num("distance"), behindCamera: behind, relevance: kind
                )
            }
            return .array(
                placeLabels(labelInputs, options: LabelOptions(
                    viewportWidthPx: number(input, "viewportWidthPx"),
                    viewportHeightPx: number(input, "viewportHeightPx")
                )).map { placement in
                    .object([
                        "id": .string(placement.id.rawValue),
                        "x": .number(placement.x),
                        "y": .number(placement.y),
                        "clamped": .bool(placement.clamped),
                        "detail": .bool(placement.detail),
                        "bearingRadians": placement.bearingRadians.map { JSON.number($0) } ?? .null,
                    ])
                }
            )

        /// Recording interval for a propagated path, from the orbit rather than the span.
        case "sample-cadence":
            return value(sampleIntervalFor(
                gm: Constants.gmSun,
                initial: StateVector(
                    position: vector(input, "position"), velocity: vector(input, "velocity")
                ),
                durationSeconds: number(input, "durationSeconds")
            ))

        /// Cubic Hermite placement of an object between integrator samples.
        case "trajectory-interpolation":
            guard case let .array(raw)? = input?["samples"] else { return .null }
            let samples: [TrajectorySample] = raw.compactMap { entry in
                guard case let .object(fields) = entry,
                      case let .number(t) = fields["t"] ?? .null
                else { return nil }
                return TrajectorySample(
                    t: t,
                    position: vector(fields, "position"),
                    velocity: vector(fields, "velocity")
                )
            }
            guard let state = trajectoryStateAt(samples, seconds: number(input, "seconds")) else {
                return .null
            }
            return .object(["position": vec(state.position), "velocity": vec(state.velocity)])

        /**
         Mutual gravity over years, with the conserved quantities alongside the state.

         The drifts are cases rather than loose assertions. A port whose integrator is subtly
         worse then shows up as a different number instead of as a pass with more slack, which
         is the failure mode every tolerance-based energy check has.
         */
        case "nbody-evolution":
            let system = solarSystemAt(JdTdb(number(input, "jdTdb")))
            let beforeEnergy = totalEnergy(system)
            let beforeAngular = totalAngularMomentum(system)
            _ = advance(
                system,
                durationSeconds: number(input, "years") * Constants.secondsPerJulianYear,
                limits: NBodyLimits(
                    tolerance: number(input, "tolerance"),
                    minStepSeconds: 60,
                    maxStepSeconds: Constants.secondsPerDay
                )
            )
            let afterAngular = totalAngularMomentum(system)
            let beforeMagnitude = beforeAngular.length
            let drift = (afterAngular - beforeAngular).length / beforeMagnitude
            return .object([
                "state": .array(system.state.map { JSON.number($0) }),
                "energyDrift": .number(abs((totalEnergy(system) - beforeEnergy) / beforeEnergy)),
                "angularDrift": .number(drift),
            ])

        /// Tile selection, which decides what a viewer actually sees on a surface.
        case "tiles":
            if c.id.hasPrefix("metres-per-pixel") {
                return value(metresPerPixel(
                    altitudeM: number(input, "altitudeM"),
                    verticalFovRadians: number(input, "verticalFovRadians"),
                    viewportHeightPx: number(input, "viewportHeightPx")
                ))
            }
            if c.id.hasPrefix("level-for") {
                return .number(Double(levelFor(
                    Self.conformanceTileManifest,
                    altitudeM: number(input, "altitudeM"),
                    verticalFovRadians: number(input, "verticalFovRadians"),
                    viewportHeightPx: number(input, "viewportHeightPx")
                ).level))
            }
            if c.id.hasPrefix("visible-cap") {
                return value(visibleCapAngle(
                    radiusM: number(input, "radiusM"), altitudeM: number(input, "altitudeM")
                ))
            }
            let levelIndex = Int(number(input, "level"))
            let extent = tileExtent(
                level: Self.conformanceTileManifest.levels[levelIndex],
                tile: TileId(level: levelIndex, x: Int(number(input, "x")), y: Int(number(input, "y")))
            )
            return .object([
                "phiStart": .number(extent.phiStart),
                "phiLength": .number(extent.phiLength),
                "thetaStart": .number(extent.thetaStart),
                "thetaLength": .number(extent.thetaLength),
            ])

        default:
            XCTFail("no runner for domain \"\(domain)\"")
            return .null
        }
    }

    /**
     The tile pyramid the `tiles` cases were generated against.

     Spelled out rather than fetched, because the cases have to be reproducible with no network
     and no asset pipeline, and because a manifest that drifted would silently change what the
     cases mean rather than fail. Mirrors the one in `scripts/generate-conformance.mjs`.
     */
    private static let conformanceTileManifest = TerrainManifest(
        body: "moon",
        tileSize: 512,
        levels: (0 ... 3).map { level in
            PyramidLevel(
                level: level,
                tilesX: 2 * (1 << level),
                tilesY: 1 * (1 << level),
                levelWidth: 1024 * (1 << level),
                levelHeight: 512 * (1 << level),
                metresPerTexel: 10_660.552_883_490_052 / Double(1 << level)
            )
        },
        globalNormalMap: "normal-global.jpg",
        globalWidth: 8192,
        referenceRadiusM: 1_737_400,
        elevationRangeM: [-9106, 10_747],
        source: "LRO LOLA"
    )

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
                    // A case may widen its own absolute term where the domain's is
                    // meaningless for it: a near-zero component of a huge vector.
                    absolute: testCase.absoluteTolerance ?? domain.absoluteTolerance,
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
