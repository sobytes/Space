import Foundation

/**
 A three-vector in float64.

 Deliberately not SIMD3<Float>, and deliberately not generic over the scalar. Neptune sits at
 4.5e12 m and a float32 step at that distance is about 500 km, so single precision anywhere in
 the physics quantises positions into visible jitter. The renderer converts to float32 exactly
 once, camera-relative, where the numbers are small; see `contracts/floating-origin`.
 */
public struct Vec3: Equatable, Sendable {
    public var x: Double
    public var y: Double
    public var z: Double

    public init(_ x: Double, _ y: Double, _ z: Double) {
        self.x = x
        self.y = y
        self.z = z
    }

    public static let zero = Vec3(0, 0, 0)

    public var lengthSquared: Double { x * x + y * y + z * z }
    public var length: Double { lengthSquared.squareRoot() }

    public var normalised: Vec3 {
        let l = length
        return l == 0 ? .zero : self / l
    }

    public static func + (a: Vec3, b: Vec3) -> Vec3 { Vec3(a.x + b.x, a.y + b.y, a.z + b.z) }
    public static func - (a: Vec3, b: Vec3) -> Vec3 { Vec3(a.x - b.x, a.y - b.y, a.z - b.z) }
    public static func * (a: Vec3, s: Double) -> Vec3 { Vec3(a.x * s, a.y * s, a.z * s) }
    public static func / (a: Vec3, s: Double) -> Vec3 { Vec3(a.x / s, a.y / s, a.z / s) }
    public static prefix func - (a: Vec3) -> Vec3 { Vec3(-a.x, -a.y, -a.z) }

    public func dot(_ b: Vec3) -> Double { x * b.x + y * b.y + z * b.z }

    public func cross(_ b: Vec3) -> Vec3 {
        Vec3(y * b.z - z * b.y, z * b.x - x * b.z, x * b.y - y * b.x)
    }

    public func distance(to b: Vec3) -> Double { (self - b).length }

    public func rotatedAboutX(_ radians: Double) -> Vec3 {
        let c = cos(radians), s = sin(radians)
        return Vec3(x, c * y - s * z, s * y + c * z)
    }

    public func rotatedAboutZ(_ radians: Double) -> Vec3 {
        let c = cos(radians), s = sin(radians)
        return Vec3(c * x - s * y, s * x + c * y, z)
    }
}

/// Position and velocity together, metres and metres per second.
public struct StateVector: Sendable {
    public let position: Vec3
    public let velocity: Vec3
    public init(position: Vec3, velocity: Vec3) {
        self.position = position
        self.velocity = velocity
    }
}
