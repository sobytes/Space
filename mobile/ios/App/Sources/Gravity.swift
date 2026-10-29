import Foundation
import Observation
import SolarKit

/**
 The two gravity modes, and an honest readout of what the chosen one is doing.

 Both are correct about different things and neither supersedes the other, so this does not
 present one as an upgrade. On rails, positions come from the Standish fits: accurate over the
 span they were made for, exactly reversible, and completely deaf to any mass you add. Under
 mutual gravity every body pulls every other, which is the complete physics and also the one
 that accumulates error, falls behind a fast clock, and has to restart if you scrub far enough.

 See `contracts/gravity-modes`. The three things a client must admit are all surfaced here:
 lag, re-seeding, and energy drift.
 */
@MainActor
@Observable
final class Gravity {
    enum Mode: String { case analytic, mutual }

    private(set) var mode: Mode = .analytic
    private(set) var lagDays: Double = 0
    private(set) var energyDrift: Double = 0
    private(set) var integratedDays: Double = 0
    private(set) var bodyCount: Int = 0

    private var system: NBodySystem?
    private var seedEnergy: Double = 0
    private var seedEpoch: Double = 0

    /// A gap larger than this is re-seeded rather than integrated. Ten years.
    private let reseedThresholdDays: Double = 3_652.5
    /// Bounds the per-frame cost. A frame that cannot finish reports lag rather than lying.
    private let stepBudget = 400

    /// Which bodies the integration carries. Planets only by default: a single global step is
    /// set by the fastest body, and Phobos at 7.65 hours drags it from hours to about a minute.
    private(set) var includeMoons = false

    func setMode(_ mode: Mode, at epoch: JdTdb, includeMoons: Bool? = nil) {
        if let includeMoons { self.includeMoons = includeMoons }
        self.mode = mode
        if mode == .analytic {
            system = nil
            lagDays = 0
            energyDrift = 0
            integratedDays = 0
            bodyCount = 0
        } else {
            seed(at: epoch)
        }
    }

    private func seed(at epoch: JdTdb) {
        // Seeded from the analytic ephemeris at the current moment, so switching changes
        // nothing visible at first and everything after. Any divergence from here is the
        // mutual perturbation, which is the thing worth watching.
        let include = includeMoons
            ? bodyIds.filter { $0 != .sun }
            : bodyIds.filter { bodyContracts[$0]!.kind == .planet }
        let built = solarSystemAt(epoch, extra: [], bodies: include)
        system = built
        seedEnergy = totalEnergy(built)
        seedEpoch = epoch.value
        bodyCount = built.ids.count
        lagDays = 0
        integratedDays = 0
        energyDrift = 0
    }

    /// Integrates toward `target`, within the step budget. Returns nothing: read the state.
    func seek(to target: JdTdb) {
        guard mode == .mutual, let system else { return }
        let current = system.startEpoch.value + system.elapsed / Constants.secondsPerDay
        let deltaDays = target.value - current

        if abs(deltaDays) > reseedThresholdDays {
            seed(at: target)
            return
        }

        let result = advance(
            system,
            durationSeconds: deltaDays * Constants.secondsPerDay,
            limits: NBodyLimits(tolerance: 1e-12, maxStepSeconds: 5 * Constants.secondsPerDay),
            maxSteps: stepBudget
        )
        let reached = system.startEpoch.value + system.elapsed / Constants.secondsPerDay
        lagDays = target.value - reached
        integratedDays = reached - seedEpoch
        energyDrift = seedEnergy == 0 ? 0 : abs((totalEnergy(system) - seedEnergy) / seedEnergy)
    }

    /// Heliocentric position under mutual gravity, or nil if this body is not integrated.
    func heliocentricPosition(of id: BodyId) -> Vec3? {
        guard mode == .mutual, let system,
              system.ids.contains(id.rawValue) else { return nil }
        return positionOf(system, id.rawValue) - positionOf(system, "sun")
    }
}
