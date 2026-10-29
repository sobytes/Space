import Foundation

/**
 What it costs to reach orbit, and what a vehicle can lift there.

 A port of `engine/src/launch/ascent.ts`. The gate on this model is inverted and the reason
 matters: predicting payload directly needs the loss budget to about 310 m/s, and the
 published loss terms disagree by over a kilometre per second, so such a gate would fail on
 the literature rather than on the model. Instead the vehicle's own published masses and
 published payload are fed in and the **implied** losses are checked to land in the 2 to 3
 km/s band real vehicles need.
 */

public struct AscentTarget: Sendable {
    public let altitudeKm: Double
    public let inclinationDeg: Double
    public let site: LaunchSite

    public init(altitudeKm: Double, inclinationDeg: Double, site: LaunchSite) {
        self.altitudeKm = altitudeKm
        self.inclinationDeg = inclinationDeg
        self.site = site
    }
}

public struct AscentBudget: Sendable {
    public let circularSpeedMS: Double
    /// Energy to lift from the surface to the target altitude, expressed as delta-v.
    public let potentialMS: Double
    public let gravityLossMS: Double
    public let dragLossMS: Double
    /// Signed. Negative for a retrograde or sun-synchronous azimuth, which costs rather than pays.
    public let earthRotationMS: Double
    public let requiredMS: Double
}

public struct AscentResult: Sendable {
    public let vehicle: String
    public let budget: AscentBudget
    public let deliveredMS: Double
    public let payloadKg: Double
    public let marginMS: Double
    public let launchTWR: Double
    public let perStage: [(name: String, deltaVMS: Double)]
}

public enum AscentError: Error, CustomStringConvertible {
    case inclinationUnreachable(inclinationDeg: Double, latitudeDeg: Double)

    public var description: String {
        switch self {
        case let .inclinationUnreachable(i, lat):
            return "inclination \(i) degrees is not reachable directly from latitude \(lat)"
        }
    }
}

public func circularSpeed(altitudeKm: Double) -> Double {
    (LaunchConstants.earthGm
        / (LaunchConstants.earthEquatorialRadiusM + altitudeKm * 1_000)).squareRoot()
}

/**
 The speed a launch site is already moving at, projected onto the launch azimuth.

     dV_rot = R * omega * cos(latitude) * sin(azimuth)

 with the azimuth that reaches a given inclination following from cos(i) = cos(lat) sin(az).

 The sign matters and is the commonest implementation error in this area: a sun-synchronous
 launch from Vandenberg flies retrograde, so the bonus is negative and the rocket must cancel
 part of Earth's rotation rather than borrow it.
 */
public func earthRotationBonus(site: LaunchSite, inclinationDeg: Double) throws -> Double {
    let latitude = site.latitudeDeg * Double.pi / 180
    let inclination = inclinationDeg * Double.pi / 180

    // An inclination below the site's latitude is unreachable with a direct ascent.
    let sinAzimuth = cos(inclination) / cos(latitude)
    guard abs(sinAzimuth) <= 1 else {
        throw AscentError.inclinationUnreachable(
            inclinationDeg: inclinationDeg, latitudeDeg: site.latitudeDeg
        )
    }
    return LaunchConstants.earthEquatorialRadiusM
        * LaunchConstants.earthRotationRateRadS
        * cos(latitude) * sinAzimuth
}

/// Azimuth that reaches the inclination, degrees clockwise from north.
public func azimuthFor(site: LaunchSite, inclinationDeg: Double) -> Double {
    let latitude = site.latitudeDeg * Double.pi / 180
    let inclination = inclinationDeg * Double.pi / 180
    return asin(cos(inclination) / cos(latitude)) * 180 / Double.pi
}

/**
 What reaching the orbit costs, as a delta-v budget.

 The orbital part is a Hohmann transfer from the surface: accelerate to the transfer orbit's
 perigee speed, coast to apogee at the target altitude, then circularise. An earlier version
 added circular speed at the target to a separate potential term, which made a 2,000 km orbit
 come out cheaper than a 200 km one, because circular speed falls with altitude faster than
 that term rose. A gate caught it. The correct form has both halves of the transfer.
 */
public func ascentBudget(_ target: AscentTarget) throws -> AscentBudget {
    let r0 = LaunchConstants.earthEquatorialRadiusM
    let r = r0 + target.altitudeKm * 1_000
    let transferSemiMajor = (r0 + r) / 2

    let perigeeSpeed = (LaunchConstants.earthGm * (2 / r0 - 1 / transferSemiMajor)).squareRoot()
    let apogeeSpeed = (LaunchConstants.earthGm * (2 / r - 1 / transferSemiMajor)).squareRoot()
    let circular = (LaunchConstants.earthGm / r).squareRoot()

    // Everything above orbital speed at the target: the climb plus the circularisation burn.
    let potential = perigeeSpeed + (circular - apogeeSpeed) - circular
    let rotation = try earthRotationBonus(site: target.site, inclinationDeg: target.inclinationDeg)

    return AscentBudget(
        circularSpeedMS: circular,
        potentialMS: potential,
        gravityLossMS: LaunchConstants.gravityLossMS,
        dragLossMS: LaunchConstants.dragLossMS,
        earthRotationMS: rotation,
        requiredMS: circular + potential
            + LaunchConstants.gravityLossMS + LaunchConstants.dragLossMS - rotation
    )
}

/// Specific impulse weighted by how much of the burn happens near vacuum.
public func effectiveIsp(_ stage: Stage) -> Double {
    stage.ispVacuumWeighted
}

extension Stage {
    var ispVacuumWeighted: Double {
        engine.ispSeaLevelS * (1 - vacuumFraction) + engine.ispVacuumS * vacuumFraction
    }
}

/**
 Delta-v a vehicle delivers carrying a given payload.

 Fairing jettison is modelled rather than ignored. Carrying Atlas V's 2,305 kg fairing through
 the whole Centaur burn instead of dropping it costs about 474 m/s of upper-stage delta-v,
 which is 5% of the budget and roughly 15% of payload: larger than the gate's whole tolerance,
 so leaving it out would be the single biggest error in the model.
 */
public func deliveredDeltaV(
    _ vehicle: Vehicle, payloadKg: Double
) -> (total: Double, perStage: [(name: String, deltaVMS: Double)]) {
    var perStage: [(name: String, deltaVMS: Double)] = []
    var total = 0.0

    func upperMass(above index: Int) -> Double {
        vehicle.stages.dropFirst(index + 1)
            .reduce(0) { $0 + $1.inertMassKg + $1.propellantMassKg }
    }

    for (index, stage) in vehicle.stages.enumerated() {
        let isFirst = index == 0
        let carriesFairing = vehicle.fairingJettisoned ? isFirst : true
        let fairing = carriesFairing ? vehicle.fairingMassKg : 0

        let above = upperMass(above: index) + payloadKg + fairing
        let wet = stage.inertMassKg + stage.propellantMassKg + above
        let dry = stage.inertMassKg + above

        let deltaV = effectiveIsp(stage) * LaunchConstants.standardGravity * log(wet / dry)
        perStage.append((stage.name, deltaV))
        total += deltaV
    }
    return (total, perStage)
}

public func launchTWR(_ vehicle: Vehicle, payloadKg: Double) -> Double {
    let grossMass = vehicle.stages.reduce(0) { $0 + $1.inertMassKg + $1.propellantMassKg }
        + payloadKg + vehicle.fairingMassKg
    let thrust = vehicle.stages[0].engine.thrustSeaLevelN * Double(vehicle.stages[0].engineCount)
    return thrust / (grossMass * LaunchConstants.standardGravity)
}

/// Largest payload whose delivered delta-v still meets the budget, by bisection.
public func maximumPayload(_ vehicle: Vehicle, target: AscentTarget) throws -> AscentResult {
    let budget = try ascentBudget(target)

    var low = 0.0
    var high = 100_000.0
    for _ in 0 ..< 80 {
        let mid = (low + high) / 2
        if deliveredDeltaV(vehicle, payloadKg: mid).total >= budget.requiredMS {
            low = mid
        } else {
            high = mid
        }
    }

    let payloadKg = low
    let delivered = deliveredDeltaV(vehicle, payloadKg: payloadKg)
    return AscentResult(
        vehicle: vehicle.name,
        budget: budget,
        deliveredMS: delivered.total,
        payloadKg: payloadKg,
        marginMS: delivered.total - budget.requiredMS,
        launchTWR: launchTWR(vehicle, payloadKg: payloadKg),
        perStage: delivered.perStage
    )
}

public func launchSite(id: String) -> LaunchSite? { launchSites.first { $0.id == id } }
public func vehicle(id: String) -> Vehicle? { vehicles.first { $0.id == id } }
