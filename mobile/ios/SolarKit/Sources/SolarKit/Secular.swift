import Foundation

/**
 Secular perturbation theory: the long-term drift of an orbit's shape, without integrating it.

 A port of `engine/src/secular.ts`. It exists to be a second opinion: `NBody.swift` evolves
 Cartesian state vectors step by step, this evaluates the same physics by orbit-averaging the
 disturbing function and applying Lagrange's planetary equation. Two independent algorithms
 agreeing is evidence; one algorithm agreeing with itself is not.

 The derivation, from `contracts/physics-and-mathematics`:

     R = G m2 [ 1/|r1 - r2|  -  (r1 . r2)/r2^3 ]
     dvarpi/dt = sqrt(1 - e^2) / (n a^2 e) * d<R>/de

 Differentiating under the integral rather than differencing <R> matters: a central difference
 in e would need the quadrature accurate to roughly 1e-8 of its own value, while the gradient
 form needs only the usual quadrature accuracy. At fixed mean anomaly Kepler's equation gives
 dE/de = sin E / (1 - e cos E), and the rest is the chain rule.

 `leadingOrderPericentreRate` is the hand-derived small-alpha limit. It is only valid for
 small alpha, which is what makes it a good check: the quadrature must converge onto it as
 alpha shrinks, and that pins the quadrature's scale and sign to algebra rather than to
 another numerical method.
 */

public struct SecularConfiguration: Sendable {
    /// Semi-major axis of the perturbed body, metres.
    public let semiMajorAxisM: Double
    public let eccentricity: Double
    /// Gravitational parameter of the perturbed body. Enters only through the mean motion.
    public let gm: Double
    public let perturberGm: Double
    /// The perturber's semi-major axis. Treated as a circular coplanar orbit.
    public let perturberSemiMajorAxisM: Double

    public init(
        semiMajorAxisM: Double,
        eccentricity: Double,
        gm: Double,
        perturberGm: Double,
        perturberSemiMajorAxisM: Double
    ) {
        self.semiMajorAxisM = semiMajorAxisM
        self.eccentricity = eccentricity
        self.gm = gm
        self.perturberGm = perturberGm
        self.perturberSemiMajorAxisM = perturberSemiMajorAxisM
    }
}

private func solveE(_ meanAnomaly: Double, _ e: Double) -> Double {
    var anomaly = meanAnomaly
    for _ in 0 ..< 60 {
        let step = (anomaly - e * sin(anomaly) - meanAnomaly) / (1 - e * cos(anomaly))
        anomaly -= step
        if abs(step) < 1e-15 { break }
    }
    return anomaly
}

/**
 Secular rate of the longitude of pericentre, radians per second, from an exterior perturber
 on a circular coplanar orbit. Positive is prograde.

 `samples` sets the quadrature resolution in each of the two mean anomalies, so the cost is
 quadratic in it. The integrand is smooth only while the orbits do not cross, which is the
 only regime this is valid in; a crossing orbit has no secular theory of this form.
 */
public func secularPericentreRate(
    _ config: SecularConfiguration, _ samples: Int = 1_200
) -> Double {
    let a1 = config.semiMajorAxisM
    let e1 = config.eccentricity
    let a2 = config.perturberSemiMajorAxisM
    precondition(a1 > 0 && a2 > 0, "both semi-major axes must be positive")
    precondition(e1 > 0 && e1 < 1, "eccentricity must be in (0, 1); the rate divides by e")
    precondition(
        a1 * (1 + e1) < a2,
        "orbits cross, and the orbit-averaged disturbing function is not defined there"
    )

    let mu = Constants.gmSun + config.gm
    let meanMotion = (mu / (a1 * a1 * a1)).squareRoot()
    let root = (1 - e1 * e1).squareRoot()
    var sum = 0.0

    for i in 0 ..< samples {
        let meanAnomaly = 2 * Double.pi * (Double(i) + 0.5) / Double(samples)
        let anomaly = solveE(meanAnomaly, e1)
        let cosE = cos(anomaly)
        let sinE = sin(anomaly)

        let r1 = Vec3(a1 * (cosE - e1), a1 * root * sinE, 0)
        // Derivative of the position with respect to e at fixed mean anomaly.
        let dEde = sinE / (1 - e1 * cosE)
        let dr1 = Vec3(
            a1 * (-sinE * dEde - 1),
            a1 * ((-e1 / root) * sinE + root * cosE * dEde),
            0
        )

        for j in 0 ..< samples {
            let theta = 2 * Double.pi * (Double(j) + 0.5) / Double(samples)
            let r2 = Vec3(a2 * cos(theta), a2 * sin(theta), 0)
            let d = r2 - r1
            let dl = d.length
            let gradient = d / (dl * dl * dl) - r2 / (a2 * a2 * a2)
            sum += gradient.dot(dr1)
        }
    }

    let dRde = config.perturberGm * sum / Double(samples * samples)
    return (root / (meanMotion * a1 * a1 * e1)) * dRde
}

/// The small-alpha closed form, radians per second. Derived in this file's header.
public func leadingOrderPericentreRate(_ config: SecularConfiguration) -> Double {
    let a1 = config.semiMajorAxisM
    let e1 = config.eccentricity
    let meanMotion = ((Constants.gmSun + config.gm) / (a1 * a1 * a1)).squareRoot()
    let alpha = a1 / config.perturberSemiMajorAxisM
    return 0.75 * (1 - e1 * e1).squareRoot() * meanMotion
        * (config.perturberGm / Constants.gmSun) * alpha * alpha * alpha
}
