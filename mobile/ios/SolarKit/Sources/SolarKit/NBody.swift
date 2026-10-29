import Foundation

/**
 Full mutual N-body gravity: every body pulls every other.

 There is one equation behind the whole solar system, and this is it. For bodies indexed i,
 each with gravitational parameter mu_i,

     d2 r_i / dt2  =  sum over j != i  of  mu_j (r_j - r_i) / |r_j - r_i|^3

 A port of `engine/src/nbody.ts`. See `contracts/gravity-modes` for what this mode guarantees
 and what it must admit, and `contracts/physics-and-mathematics` for the derivation.

 Barycentric, never heliocentric. A pinned Sun makes total momentum non-conserved, which
 throws away the best free check on the integrator.
 */

public let stateStride = 6

public struct MassiveBody: Sendable {
    public let id: String
    public let gm: Double
    public let position: Vec3
    public let velocity: Vec3

    public init(id: String, gm: Double, position: Vec3, velocity: Vec3) {
        self.id = id
        self.gm = gm
        self.position = position
        self.velocity = velocity
    }
}

public final class NBodySystem: @unchecked Sendable {
    public let ids: [String]
    public let gm: [Double]
    /// Position and velocity per body, barycentric, metres and m/s.
    public var state: [Double]
    public let startEpoch: JdTdb
    public var elapsed: Double = 0

    init(ids: [String], gm: [Double], state: [Double], startEpoch: JdTdb) {
        self.ids = ids
        self.gm = gm
        self.state = state
        self.startEpoch = startEpoch
    }
}

/**
 Builds a system from the analytic ephemeris at one instant.

 The frame conversion is the part that is easy to get wrong. The ephemeris is heliocentric
 and the Sun it is measured against is itself accelerating, so writing V for barycentric and
 v for heliocentric, every body gets V_i = v_i + V_sun, and demanding zero total momentum
 fixes V_sun = -(sum_i mu_i v_i) / (mu_sun + sum_i mu_i).

 The denominator is the whole system's mu, not the Sun's, and the result must be added to
 every body. Getting either half wrong leaves everything carrying the same spurious velocity:
 Jupiter alone contributes 12.5 m/s, which is 395,000 km of drift per year, and nothing errors.
 */
public func solarSystemAt(
    _ epoch: JdTdb,
    extra: [MassiveBody] = [],
    bodies include: [BodyId] = bodyIds.filter { bodyContracts[$0]!.kind == .planet }
) -> NBodySystem {
    var bodies: [MassiveBody] = [
        MassiveBody(id: "sun", gm: Constants.gmSun, position: .zero, velocity: .zero)
    ]
    for id in include where id != .sun {
        let state = heliocentricStateOf(id, at: epoch)
        bodies.append(MassiveBody(
            id: id.rawValue, gm: bodyContracts[id]!.gm,
            position: state.position, velocity: state.velocity
        ))
    }
    bodies.append(contentsOf: extra)

    var totalGm = 0.0
    var weightedPosition = Vec3.zero
    var weightedVelocity = Vec3.zero
    for body in bodies {
        totalGm += body.gm
        weightedPosition = weightedPosition + body.position * body.gm
        weightedVelocity = weightedVelocity + body.velocity * body.gm
    }
    let centre = weightedPosition / totalGm
    let sunVelocity = weightedVelocity / -totalGm

    var state = [Double](repeating: 0, count: bodies.count * stateStride)
    for (i, body) in bodies.enumerated() {
        let o = i * stateStride
        let p = body.position - centre
        let v = body.velocity + sunVelocity
        state[o] = p.x; state[o + 1] = p.y; state[o + 2] = p.z
        state[o + 3] = v.x; state[o + 4] = v.y; state[o + 5] = v.z
    }

    return NBodySystem(
        ids: bodies.map(\.id), gm: bodies.map(\.gm), state: state, startEpoch: epoch
    )
}

/**
 Mutual accelerations, accumulated pairwise.

 Each separation is evaluated once and both bodies get equal and opposite impulses, so
 Newton's third law holds to round-off rather than approximately. That is what makes momentum
 conservation a real check on the implementation rather than a restatement of it.
 */
public func accelerations(gm: [Double], state: [Double], into out: inout [Double]) {
    let count = gm.count
    for i in 0 ..< out.count { out[i] = 0 }

    for i in 0 ..< count {
        let oi = i * stateStride
        for j in (i + 1) ..< count {
            let oj = j * stateStride
            let dx = state[oj] - state[oi]
            let dy = state[oj + 1] - state[oi + 1]
            let dz = state[oj + 2] - state[oi + 2]

            let r2 = dx * dx + dy * dy + dz * dz
            let invR3 = 1 / (r2 * r2.squareRoot())

            let ai = gm[j] * invR3
            let aj = gm[i] * invR3

            out[i * 3] += dx * ai
            out[i * 3 + 1] += dy * ai
            out[i * 3 + 2] += dz * ai
            out[j * 3] -= dx * aj
            out[j * 3 + 1] -= dy * aj
            out[j * 3 + 2] -= dz * aj
        }
    }
}

public struct NBodyLimits: Sendable {
    public let tolerance: Double
    public let minStepSeconds: Double
    public let maxStepSeconds: Double

    public init(
        tolerance: Double = 1e-12,
        minStepSeconds: Double = 60,
        maxStepSeconds: Double = 86_400 * 10
    ) {
        self.tolerance = tolerance
        self.minStepSeconds = minStepSeconds
        self.maxStepSeconds = maxStepSeconds
    }
}

private let nbA: [[Double]] = [
    [],
    [1.0 / 5],
    [3.0 / 40, 9.0 / 40],
    [44.0 / 45, -56.0 / 15, 32.0 / 9],
    [19372.0 / 6561, -25360.0 / 2187, 64448.0 / 6561, -212.0 / 729],
    [9017.0 / 3168, -355.0 / 33, 46732.0 / 5247, 49.0 / 176, -5103.0 / 18656],
    [35.0 / 384, 0, 500.0 / 1113, 125.0 / 192, -2187.0 / 6784, 11.0 / 84],
]
private let nbB5: [Double] = [35.0 / 384, 0, 500.0 / 1113, 125.0 / 192, -2187.0 / 6784, 11.0 / 84, 0]
private let nbB4: [Double] = [
    5179.0 / 57600, 0, 7571.0 / 16695, 393.0 / 640, -92097.0 / 339200, 187.0 / 2100, 1.0 / 40,
]

/**
 Integrates by `durationSeconds`, which may be negative.

 Newton's equations are time-reversible, so a signed step is valid and is what the reverse
 control runs on. The controller works in magnitude with the direction carried separately,
 since comparing a negative step against a minimum rejects every reverse step immediately.

 `maxSteps` bounds the work: a frame at a high time rate can ask for more simulated time than
 it can afford, and the honest response is to do what fits and report the shortfall.
 */
@discardableResult
public func advance(
    _ system: NBodySystem,
    durationSeconds: Double,
    limits: NBodyLimits = NBodyLimits(),
    maxSteps: Int = .max
) -> (steps: Int, remainingSeconds: Double) {
    precondition(durationSeconds.isFinite, "advance needs a finite duration")
    if durationSeconds == 0 { return (0, 0) }

    let count = gmCount(system)
    let n = count * stateStride
    let direction: Double = durationSeconds < 0 ? -1 : 1
    var remaining = abs(durationSeconds)
    var step = min(limits.maxStepSeconds, 86_400)
    var steps = 0

    var k = [[Double]](repeating: [Double](repeating: 0, count: n), count: 7)
    var tmp = [Double](repeating: 0, count: n)
    var accel = [Double](repeating: 0, count: count * 3)
    var y5 = [Double](repeating: 0, count: n)
    var y4 = [Double](repeating: 0, count: n)

    while remaining > 0 && steps < maxSteps {
        var magnitude = min(step, remaining)

        stepLoop: while true {
            let h = direction * magnitude

            for stage in 0 ..< 7 {
                for i in 0 ..< n {
                    var v = system.state[i]
                    for j in 0 ..< stage {
                        let a = nbA[stage][j]
                        if a != 0 { v += h * a * k[j][i] }
                    }
                    tmp[i] = v
                }
                accelerations(gm: system.gm, state: tmp, into: &accel)
                for b in 0 ..< count {
                    let o = b * stateStride
                    k[stage][o] = tmp[o + 3]
                    k[stage][o + 1] = tmp[o + 4]
                    k[stage][o + 2] = tmp[o + 5]
                    k[stage][o + 3] = accel[b * 3]
                    k[stage][o + 4] = accel[b * 3 + 1]
                    k[stage][o + 5] = accel[b * 3 + 2]
                }
            }

            var error = 0.0
            for i in 0 ..< n {
                var s5 = 0.0
                var s4 = 0.0
                for stage in 0 ..< 7 {
                    s5 += nbB5[stage] * k[stage][i]
                    s4 += nbB4[stage] * k[stage][i]
                }
                y5[i] = system.state[i] + h * s5
                y4[i] = system.state[i] + h * s4
                error = max(error, abs(y5[i] - y4[i]) / max(1, abs(y5[i])))
            }

            if error > limits.tolerance && magnitude > limits.minStepSeconds {
                magnitude = max(
                    limits.minStepSeconds,
                    magnitude * max(0.2, 0.9 * pow(limits.tolerance / error, 0.2))
                )
                continue stepLoop
            }

            system.state = y5
            system.elapsed += h
            remaining -= magnitude
            steps += 1
            step = min(
                limits.maxStepSeconds,
                magnitude * min(5, 0.9 * pow(limits.tolerance / max(error, 1e-18), 0.2))
            )
            break stepLoop
        }
    }
    return (steps, direction * max(0, remaining))
}

private func gmCount(_ system: NBodySystem) -> Int { system.gm.count }

public func positionOf(_ system: NBodySystem, _ id: String) -> Vec3 {
    guard let i = system.ids.firstIndex(of: id) else { return .zero }
    let o = i * stateStride
    return Vec3(system.state[o], system.state[o + 1], system.state[o + 2])
}

public func velocityOf(_ system: NBodySystem, _ id: String) -> Vec3 {
    guard let i = system.ids.firstIndex(of: id) else { return .zero }
    let o = i * stateStride
    return Vec3(system.state[o + 3], system.state[o + 4], system.state[o + 5])
}

/// Total energy. Never handed to the integrator, so any drift is numerical error.
public func totalEnergy(_ system: NBodySystem) -> Double {
    var kinetic = 0.0
    var potential = 0.0
    let count = system.gm.count
    for i in 0 ..< count {
        let o = i * stateStride
        let v2 = system.state[o + 3] * system.state[o + 3]
            + system.state[o + 4] * system.state[o + 4]
            + system.state[o + 5] * system.state[o + 5]
        kinetic += 0.5 * system.gm[i] * v2
        for j in (i + 1) ..< count {
            let oj = j * stateStride
            let r = Vec3(
                system.state[oj] - system.state[o],
                system.state[oj + 1] - system.state[o + 1],
                system.state[oj + 2] - system.state[o + 2]
            ).length
            potential -= system.gm[i] * system.gm[j] / r
        }
    }
    return kinetic + potential
}

public func totalMomentum(_ system: NBodySystem) -> Vec3 {
    var p = Vec3.zero
    for i in 0 ..< system.gm.count {
        let o = i * stateStride
        p = p + Vec3(system.state[o + 3], system.state[o + 4], system.state[o + 5]) * system.gm[i]
    }
    return p
}

public func totalAngularMomentum(_ system: NBodySystem) -> Vec3 {
    var l = Vec3.zero
    for i in 0 ..< system.gm.count {
        let o = i * stateStride
        let r = Vec3(system.state[o], system.state[o + 1], system.state[o + 2])
        let v = Vec3(system.state[o + 3], system.state[o + 4], system.state[o + 5])
        l = l + r.cross(v) * system.gm[i]
    }
    return l
}

public func barycentre(_ system: NBodySystem) -> Vec3 {
    var total = 0.0
    var c = Vec3.zero
    for i in 0 ..< system.gm.count {
        let o = i * stateStride
        total += system.gm[i]
        c = c + Vec3(system.state[o], system.state[o + 1], system.state[o + 2]) * system.gm[i]
    }
    return c / total
}
