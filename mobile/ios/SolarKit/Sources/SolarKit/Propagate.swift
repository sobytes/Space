import Foundation

/**
 Adaptive Dormand-Prince 5(4) for a test body under a central mass, perturbers and relativity.

 A port of `engine/src/propagate.ts`. See `contracts/physics-and-mathematics` section 8 for
 the method and what it is not: Dormand-Prince is explicit and not symplectic, so energy
 drifts secularly rather than oscillating. At these tolerances that drift is far below the
 ephemeris error, which makes it the right tool here and the wrong one for a megayear study.
 */

/// A massive body the test particle feels. Position is a function of time so the perturber
/// moves, which is the difference between a real perturbation and a static one.
public struct Perturber: Sendable {
    public let id: String
    public let gm: Double
    public let radiusM: Double
    public let positionAt: @Sendable (Double) -> Vec3

    public init(
        id: String, gm: Double, radiusM: Double,
        positionAt: @escaping @Sendable (Double) -> Vec3
    ) {
        self.id = id
        self.gm = gm
        self.radiusM = radiusM
        self.positionAt = positionAt
    }
}

public struct ForceModel: Sendable {
    public let centralGm: Double
    public let perturbers: [Perturber]
    public let relativistic: Bool

    public init(centralGm: Double = Constants.gmSun, perturbers: [Perturber] = [], relativistic: Bool = false) {
        self.centralGm = centralGm
        self.perturbers = perturbers
        self.relativistic = relativistic
    }
}

public struct PropagationLimits: Sendable {
    public let tolerance: Double
    public let minStepSeconds: Double
    public let maxStepSeconds: Double
    public let maxSteps: Int

    public init(
        tolerance: Double = 1e-10,
        minStepSeconds: Double = 1,
        maxStepSeconds: Double = 86_400 * 5,
        maxSteps: Int = 2_000_000
    ) {
        self.tolerance = tolerance
        self.minStepSeconds = minStepSeconds
        self.maxStepSeconds = maxStepSeconds
        self.maxSteps = maxSteps
    }
}

public enum Fate: Sendable, Equatable {
    case propagating
    case impact(body: String, atSeconds: Double)
    case escaped(atSeconds: Double, eccentricity: Double)
    case stepLimit(atSeconds: Double)
}

public struct TrajectorySample: Sendable {
    public let t: Double
    public let position: Vec3
    public let velocity: Vec3
}

public struct CloseApproach: Sendable {
    public let body: String
    public let atSeconds: Double
    public let distanceM: Double
    public let relativeSpeedMS: Double
}

public struct PropagationResult: Sendable {
    public let samples: [TrajectorySample]
    public let closeApproaches: [CloseApproach]
    public let fate: Fate
    public let steps: Int
    public let rejectedSteps: Int
}

/**
 Acceleration: the central mass, optional relativity, and each perturber's direct and
 indirect terms.

 The indirect term is not optional. The frame is centred on the Sun, and a perturber pulls
 the Sun as well as the body; omitting it leaves the central body treated as fixed, which it
 is not, and the error is first order in the perturber's mass. It is a classic quiet mistake:
 nothing errors, a spurious secular drift just appears.
 */
private func acceleration(
    _ model: ForceModel, position: Vec3, velocity: Vec3, t: Double
) -> Vec3 {
    let r2 = position.lengthSquared
    let r = r2.squareRoot()
    var a = position * (-model.centralGm / (r2 * r))

    if model.relativistic {
        a = a + postNewtonianAcceleration(gm: model.centralGm, position: position, velocity: velocity)
    }

    for perturber in model.perturbers {
        let p = perturber.positionAt(t)

        let d = p - position
        let d2 = d.lengthSquared
        let direct = perturber.gm / (d2 * d2.squareRoot())

        let s2 = p.lengthSquared
        let indirect = perturber.gm / (s2 * s2.squareRoot())

        a = a + d * direct - p * indirect
    }
    return a
}

private let dpA: [[Double]] = [
    [],
    [1.0 / 5],
    [3.0 / 40, 9.0 / 40],
    [44.0 / 45, -56.0 / 15, 32.0 / 9],
    [19372.0 / 6561, -25360.0 / 2187, 64448.0 / 6561, -212.0 / 729],
    [9017.0 / 3168, -355.0 / 33, 46732.0 / 5247, 49.0 / 176, -5103.0 / 18656],
    [35.0 / 384, 0, 500.0 / 1113, 125.0 / 192, -2187.0 / 6784, 11.0 / 84],
]
private let dpC: [Double] = [0, 1.0 / 5, 3.0 / 10, 4.0 / 5, 8.0 / 9, 1, 1]
private let dpB5: [Double] = [35.0 / 384, 0, 500.0 / 1113, 125.0 / 192, -2187.0 / 6784, 11.0 / 84, 0]
private let dpB4: [Double] = [
    5179.0 / 57600, 0, 7571.0 / 16695, 393.0 / 640, -92097.0 / 339200, 187.0 / 2100, 1.0 / 40,
]

public struct PropagateOptions: Sendable {
    public let model: ForceModel
    public let initial: StateVector
    public let durationSeconds: Double
    public let limits: PropagationLimits
    public let sampleIntervalSeconds: Double?
    public let closeApproachThresholdM: Double

    public init(
        model: ForceModel,
        initial: StateVector,
        durationSeconds: Double,
        limits: PropagationLimits = PropagationLimits(),
        sampleIntervalSeconds: Double? = nil,
        closeApproachThresholdM: Double = 1.5e10
    ) {
        self.model = model
        self.initial = initial
        self.durationSeconds = durationSeconds
        self.limits = limits
        self.sampleIntervalSeconds = sampleIntervalSeconds
        self.closeApproachThresholdM = closeApproachThresholdM
    }
}

/// A hard ceiling on recorded samples, independent of the requested cadence. `propagate` is
/// public and will honour any interval it is handed, and the sampler can now emit many points
/// per step rather than one.
private let maxRecordedSamples = 200_000

public func propagate(_ options: PropagateOptions) -> PropagationResult {
    let limits = options.limits
    let model = options.model
    let sampleInterval = options.sampleIntervalSeconds ?? options.durationSeconds / 1000

    var t = 0.0
    var position = options.initial.position
    var velocity = options.initial.velocity
    var step = min(limits.maxStepSeconds, max(limits.minStepSeconds, 3_600))

    var samples = [TrajectorySample(t: 0, position: position, velocity: velocity)]
    var nextSampleAt = sampleInterval
    var steps = 0
    var rejectedSteps = 0
    var fate: Fate = .propagating

    /// Nearest approach per perturber, so a minimum is caught rather than just a sample.
    var nearest: [String: (distance: Double, t: Double, speed: Double)] = [:]

    var k = [[Double]](repeating: [Double](repeating: 0, count: 6), count: 7)

    while t < options.durationSeconds && steps < limits.maxSteps {
        let h = min(step, options.durationSeconds - t)

        for stage in 0 ..< 7 {
            var p = position
            var v = velocity
            for j in 0 ..< stage {
                let a = dpA[stage][j]
                if a == 0 { continue }
                p = p + Vec3(k[j][0], k[j][1], k[j][2]) * (h * a)
                v = v + Vec3(k[j][3], k[j][4], k[j][5]) * (h * a)
            }
            let accel = acceleration(model, position: p, velocity: v, t: t + dpC[stage] * h)
            k[stage] = [v.x, v.y, v.z, accel.x, accel.y, accel.z]
        }

        let base = [position.x, position.y, position.z, velocity.x, velocity.y, velocity.z]
        var y5 = [Double](repeating: 0, count: 6)
        var y4 = [Double](repeating: 0, count: 6)
        for i in 0 ..< 6 {
            var s5 = 0.0
            var s4 = 0.0
            for stage in 0 ..< 7 {
                s5 += dpB5[stage] * k[stage][i]
                s4 += dpB4[stage] * k[stage][i]
            }
            y5[i] = base[i] + h * s5
            y4[i] = base[i] + h * s4
        }

        // Scaled error, position and velocity each weighted by their own magnitude so neither
        // dominates: a metre matters at Earth's radius and not at Neptune's distance.
        let positionScale = max(1, Vec3(y5[0], y5[1], y5[2]).length)
        let velocityScale = max(1, Vec3(y5[3], y5[4], y5[5]).length)
        let positionError = Vec3(y5[0] - y4[0], y5[1] - y4[1], y5[2] - y4[2]).length / positionScale
        let velocityError = Vec3(y5[3] - y4[3], y5[4] - y4[4], y5[5] - y4[5]).length / velocityScale
        let error = max(positionError, velocityError)

        if error > limits.tolerance && h > limits.minStepSeconds {
            rejectedSteps += 1
            step = max(
                limits.minStepSeconds,
                h * max(0.2, 0.9 * pow(limits.tolerance / error, 0.2))
            )
            continue
        }

        // Kept so the sampler can interpolate across the step it just took.
        let tBefore = t
        let positionBefore = position
        let velocityBefore = velocity

        position = Vec3(y5[0], y5[1], y5[2])
        velocity = Vec3(y5[3], y5[4], y5[5])
        t += h
        steps += 1

        var hit = false
        for perturber in model.perturbers {
            let separation = (position - perturber.positionAt(t)).length
            if separation > options.closeApproachThresholdM { continue }
            if nearest[perturber.id] == nil || separation < nearest[perturber.id]!.distance {
                nearest[perturber.id] = (separation, t, velocity.length)
            }
            if perturber.radiusM > 0 && separation <= perturber.radiusM {
                fate = .impact(body: perturber.id, atSeconds: t)
                hit = true
                break
            }
        }
        if hit { break }

        /**
         Every sample the step passed over, not just the last one.

         This was `if t >= nextSampleAt`, which records at most one sample per integration step
         and advances the schedule by a single interval however far the step reached, so a
         requested cadence finer than the step size was silently coarsened. Interpolating
         inside the step costs no extra force evaluations: the blend is third order in a step
         already controlled to 1e-10.
         */
        let stepStart = TrajectorySample(
            t: tBefore, position: positionBefore, velocity: velocityBefore
        )
        let stepEnd = TrajectorySample(t: t, position: position, velocity: velocity)
        while nextSampleAt <= t && samples.count < maxRecordedSamples {
            let at = hermiteBetween(stepStart, stepEnd, seconds: nextSampleAt)
            samples.append(
                TrajectorySample(t: nextSampleAt, position: at.position, velocity: at.velocity)
            )
            nextSampleAt += sampleInterval
        }

        let e = eccentricityOf(centralGm: model.centralGm, position: position, velocity: velocity)
        if e >= 1 && position.length > 5e12 {
            fate = .escaped(atSeconds: t, eccentricity: e)
            break
        }

        step = min(
            limits.maxStepSeconds,
            h * min(5, 0.9 * pow(limits.tolerance / max(error, 1e-18), 0.2))
        )
    }

    if fate == .propagating && steps >= limits.maxSteps {
        fate = .stepLimit(atSeconds: t)
    }

    let closeApproaches = nearest.map { id, best in
        CloseApproach(
            body: id, atSeconds: best.t, distanceM: best.distance, relativeSpeedMS: best.speed
        )
    }
    /**
     Record where it actually ended up, unless it ended up inside something.

     This appended unconditionally, including after an impact, which placed a sample inside
     the body that was struck. The engine did not append at all, so the two clients disagreed
     about what the last sample of a trajectory even meant.
     */
    if case .impact = fate {} else if let last = samples.last, t > last.t {
        samples.append(TrajectorySample(t: t, position: position, velocity: velocity))
    }

    return PropagationResult(
        samples: samples, closeApproaches: closeApproaches,
        fate: fate, steps: steps, rejectedSteps: rejectedSteps
    )
}

/// A two-body model with no perturbers, the exactly-solvable reference.
/**
 How often to record a sample, chosen from the orbit rather than from the span.

 A fixed number of samples across the whole run degrades badly: the resolution per orbit is
 the total divided by the number of orbits, so a path that is smooth over two years becomes a
 polygon over fifty. This client shipped 600 samples total, which is 300 points per orbit at
 two years and twelve at fifty. Twelve points draws a dodecagon, and fifty overlapping
 dodecagons is the crosshatched band that was reported from the phone.

 Tying the cadence to the orbital period fixes the resolution per orbit instead. The period
 comes from the initial state by vis-viva. An unbound orbit has no period and falls back to a
 fixed count, which is right: a hyperbolic path is one swing and accumulates no turns.

 `maxSamples` is a memory bound, not a quality target.
 */
public func sampleIntervalFor(
    gm: Double,
    initial: StateVector,
    durationSeconds: Double,
    pointsPerOrbit: Double = 180,
    maxSamples: Double = 40_000
) -> Double {
    let floor = durationSeconds / maxSamples
    let r = initial.position.length
    let v = initial.velocity.length
    let energy = (v * v) / 2 - gm / r
    guard energy < 0, r > 0 else { return Swift.max(floor, durationSeconds / 2_000) }

    let semiMajorAxis = -gm / (2 * energy)
    let period = 2 * Double.pi * (pow(semiMajorAxis, 3) / gm).squareRoot()
    return Swift.max(floor, period / pointsPerOrbit)
}

public func twoBodyModel(centralGm: Double = Constants.gmSun) -> ForceModel {
    ForceModel(centralGm: centralGm, perturbers: [], relativistic: false)
}

/// Atmospheric entry counts as arrival, so Earth's capture radius includes it.
private let entryInterfaceM: Double = 100_000

/**
 Every registry body as a perturber, positioned from the ephemeris as the integration runs.

 This is what makes masses matter: a body added to the registry perturbs every trajectory,
 whether or not the planets themselves are being integrated mutually.

 The Sun is excluded, and not as a minor detail. It is the frame's origin and already the
 central mass, so including it both double-counts its pull and divides the indirect term by
 its own distance of zero. The result is NaN propagating silently through the trajectory
 until something downstream trips on an undefined orbital plane, which is how this was found.
 */
public func perturbersFrom(startEpoch: JdTdb, include: [BodyId] = bodyIds) -> [Perturber] {
    include.compactMap { id in
        guard id != .sun else { return nil }
        let contract = bodyContracts[id]!
        guard contract.gm > 0 else { return nil }
        return Perturber(
            id: id.rawValue,
            gm: contract.gm,
            radiusM: contract.equatorialRadiusM + (id == .embary ? entryInterfaceM : 0),
            positionAt: { seconds in
                heliocentricPositionOf(id, at: JdTdb(startEpoch.value + seconds / Constants.secondsPerDay))
            }
        )
    }
}

/**
 Where a propagated object is at an arbitrary moment, interpolated between samples.

 Cubic Hermite rather than linear, because the integrator hands back velocity alongside
 position and discarding it shows an object that visibly corners at every sample. During a
 close approach, which is exactly where someone is watching, the samples are far apart
 relative to how fast the direction is changing and a linear path cuts the corner by thousands
 of kilometres.

 Ported from `engine/src/propagate.ts` and gated by the conformance suite, so the rider on a
 phone is in the same place as the rider in a browser.
 */
public func trajectoryStateAt(_ samples: [TrajectorySample], seconds: Double) -> StateVector? {
    guard let first = samples.first, let last = samples.last else { return nil }
    if samples.count == 1 || seconds <= first.t {
        return StateVector(position: first.position, velocity: first.velocity)
    }
    if seconds >= last.t {
        return StateVector(position: last.position, velocity: last.velocity)
    }

    // Binary search: a two-century run holds thousands of samples and this runs per frame.
    var low = 0
    var high = samples.count - 1
    while high - low > 1 {
        let mid = (low + high) / 2
        if samples[mid].t <= seconds { low = mid } else { high = mid }
    }

    return hermiteBetween(samples[low], samples[high], seconds: seconds)
}

/**
 Cubic Hermite between two states, used both to look a trajectory up and to record it.

 Shared on purpose. The sampler needs it because the integrator's steps are not the cadence a
 drawn path wants, and the lookup needs it for the same reason one step later. Two
 implementations of the same blend would be two chances for the path on screen to disagree
 with the object riding it.
 */
public func hermiteBetween(
    _ a: TrajectorySample, _ b: TrajectorySample, seconds: Double
) -> StateVector {
    let h = b.t - a.t
    guard h > 0 else { return StateVector(position: a.position, velocity: a.velocity) }

    let u = (seconds - a.t) / h
    let u2 = u * u
    let u3 = u2 * u
    let h00 = 2 * u3 - 3 * u2 + 1
    let h10 = u3 - 2 * u2 + u
    let h01 = -2 * u3 + 3 * u2
    let h11 = u3 - u2
    // Derivative of the same polynomial, so the velocity reported is the one the drawn path
    // actually has rather than a separately interpolated quantity that disagrees with it.
    let d00 = (6 * u2 - 6 * u) / h
    let d10 = 3 * u2 - 4 * u + 1
    let d01 = (-6 * u2 + 6 * u) / h
    let d11 = 3 * u2 - 2 * u

    let position = a.position * h00 + a.velocity * (h10 * h) + b.position * h01 + b.velocity * (h11 * h)
    let velocity = a.position * d00 + a.velocity * d10 + b.position * d01 + b.velocity * d11
    return StateVector(position: position, velocity: velocity)
}
