/**
 * Ascent to orbit: what a rocket can actually lift, and why.
 *
 * The model is the staged rocket equation with a loss budget and the Earth-rotation bonus.
 * That is deliberately not a trajectory integration. A real ascent profile depends on the
 * steering program, the throttle schedule and the heating constraint that triggers fairing
 * jettison, none of which any manufacturer publishes. Integrating a trajectory whose steering
 * law we invented would look more rigorous while being less defensible, so this computes the
 * budget from published masses and compares it against published payloads.
 *
 * Two corrections to figures that circulate widely and do not survive contact with vendor data.
 *
 * The commonly repeated "gravity loss is 1000 to 1500 m/s" traces to no primary source. Closing
 * the Atlas V 401 budget from ULA's own masses needs 2.0 to 3.0 km/s of total losses, which
 * matches the 2.2 km/s gravity figure in Karabeyoglu's Stanford lecture, the only properly
 * sourced number available.
 *
 * And "9300 to 9700 m/s to LEO" is the bottom edge, not the centre. Reaching 9408 m/s requires
 * assuming the first stage runs at sea-level specific impulse for its entire burn, which is
 * unphysical. A realistic Atlas V 401 ideal delta-v is 9.7 to 10.2 km/s.
 */

import {
  ASCENT_LOSSES,
  EARTH_EQUATORIAL_RADIUS_M,
  EARTH_GM,
  EARTH_ROTATION_RATE_RAD_S,
  STANDARD_GRAVITY,
  LAUNCH_SITES,
  type LaunchSite,
} from "./reference-data";
import { effectiveIsp, type Vehicle } from "./vehicles";



export interface AscentTarget {
  readonly altitudeKm: number;
  readonly inclinationDeg: number;
  readonly site: LaunchSite;
}

export interface AscentBudget {
  readonly circularSpeedMS: number;
  /** Energy to lift from the surface to the target altitude, expressed as delta-v. */
  readonly potentialMS: number;
  readonly gravityLossMS: number;
  readonly dragLossMS: number;
  /** Signed. Negative for a retrograde or sun-synchronous azimuth, which costs rather than pays. */
  readonly earthRotationMS: number;
  readonly requiredMS: number;
}

export interface AscentResult {
  readonly vehicle: string;
  readonly budget: AscentBudget;
  readonly deliveredMS: number;
  readonly payloadKg: number;
  readonly marginMS: number;
  readonly launchTWR: number;
  readonly perStage: readonly { readonly name: string; readonly deltaVMS: number }[];
}

export function circularSpeed(altitudeKm: number): number {
  return Math.sqrt(EARTH_GM / (EARTH_EQUATORIAL_RADIUS_M + altitudeKm * 1000));
}

/**
 * The speed a launch site is already moving at, projected onto the launch azimuth.
 *
 *   dV_rot = (R + h) * omega * cos(latitude) * sin(azimuth)
 *
 * and the azimuth that reaches a given inclination follows from cos(i) = cos(lat) * sin(az).
 * The sign matters and is the commonest implementation error in this whole area: a
 * sun-synchronous launch from Vandenberg flies retrograde, so the bonus is negative and the
 * rocket must cancel part of Earth's rotation rather than borrow it.
 */
export function earthRotationBonus(site: LaunchSite, inclinationDeg: number): number {
  const latitude = (site.latitudeDeg * Math.PI) / 180;
  const inclination = (inclinationDeg * Math.PI) / 180;

  // An inclination below the site's latitude is unreachable with a direct ascent.
  const sinAzimuth = Math.cos(inclination) / Math.cos(latitude);
  if (Math.abs(sinAzimuth) > 1) {
    throw new Error(
      `inclination ${inclinationDeg} degrees is not reachable directly from latitude ${site.latitudeDeg}`,
    );
  }

  return EARTH_EQUATORIAL_RADIUS_M * EARTH_ROTATION_RATE_RAD_S * Math.cos(latitude) * sinAzimuth;
}

/** Azimuth that reaches the inclination, degrees clockwise from north. */
export function azimuthFor(site: LaunchSite, inclinationDeg: number): number {
  const latitude = (site.latitudeDeg * Math.PI) / 180;
  const inclination = (inclinationDeg * Math.PI) / 180;
  return (Math.asin(Math.cos(inclination) / Math.cos(latitude)) * 180) / Math.PI;
}

/**
 * What reaching the orbit costs, as a delta-v budget.
 *
 * The orbital part is a Hohmann transfer from the surface: accelerate to the transfer orbit's
 * perigee speed, coast to apogee at the target altitude, then circularise. The first version
 * added circular speed at the target to a separate potential term, which made a 2,000 km orbit
 * come out cheaper than a 200 km one, because circular speed falls with altitude faster than
 * that potential term rose. A gate caught it. The correct form has both halves of the transfer.
 */
export function ascentBudget(target: AscentTarget): AscentBudget {
  const r0 = EARTH_EQUATORIAL_RADIUS_M;
  const r = r0 + target.altitudeKm * 1000;
  const transferSemiMajor = (r0 + r) / 2;

  const perigeeSpeed = Math.sqrt(EARTH_GM * (2 / r0 - 1 / transferSemiMajor));
  const apogeeSpeed = Math.sqrt(EARTH_GM * (2 / r - 1 / transferSemiMajor));
  const circularSpeedMS = Math.sqrt(EARTH_GM / r);

  // Everything above orbital speed at the target: the climb plus the circularisation burn.
  const potentialMS = perigeeSpeed + (circularSpeedMS - apogeeSpeed) - circularSpeedMS;

  const gravityLossMS = ASCENT_LOSSES.gravityLossMS.value;
  const dragLossMS = ASCENT_LOSSES.dragLossMS.value;
  const earthRotationMS = earthRotationBonus(target.site, target.inclinationDeg);

  return {
    circularSpeedMS,
    potentialMS,
    gravityLossMS,
    dragLossMS,
    earthRotationMS,
    requiredMS: circularSpeedMS + potentialMS + gravityLossMS + dragLossMS - earthRotationMS,
  };
}

/**
 * Delta-v a vehicle delivers carrying a given payload.
 *
 * Solid boosters are treated as augmenting the first stage rather than as a separate stage,
 * because they burn alongside it and drop before it does. Their gross mass is carried by the
 * first stage's mass ratio and their impulse is added at their own specific impulse.
 *
 * Fairing jettison is modelled rather than ignored. Carrying Atlas V's 2,305 kg fairing
 * through the whole Centaur burn instead of dropping it costs about 474 m/s of upper-stage
 * delta-v, which is 5% of the budget and roughly 15% of payload. That is larger than the gate's
 * entire tolerance, so leaving it out would be the single biggest error in the model.
 */
export function deliveredDeltaV(
  vehicle: Vehicle,
  payloadKg: number,
): { total: number; perStage: { name: string; deltaVMS: number }[] } {
  const perStage: { name: string; deltaVMS: number }[] = [];

  // Everything above a given stage, which that stage has to accelerate.
  const upperMass = (fromIndex: number) =>
    vehicle.stages
      .slice(fromIndex + 1)
      .reduce((sum, s) => sum + s.inertMassKg + s.propellantMassKg, 0);

  let total = 0;

  vehicle.stages.forEach((stage, index) => {
    const isFirst = index === 0;
    const carriesFairing = vehicle.fairingJettisoned ? isFirst : true;
    const fairing = carriesFairing ? vehicle.fairingMassKg : 0;

    const above = upperMass(index) + payloadKg + fairing;
    const wet = stage.inertMassKg + stage.propellantMassKg + above;
    const dry = stage.inertMassKg + above;

    const isp = effectiveIsp(stage);
    const deltaV = isp * STANDARD_GRAVITY * Math.log(wet / dry);

    perStage.push({ name: stage.name, deltaVMS: deltaV });
    total += deltaV;
  });

  return { total, perStage };
}

export function launchTWR(vehicle: Vehicle, payloadKg: number): number {
  const solids = vehicle.solidBoosters;
  const grossMass =
    vehicle.stages.reduce((sum, s) => sum + s.inertMassKg + s.propellantMassKg, 0) +
    payloadKg +
    vehicle.fairingMassKg +
    (solids ? solids.booster.grossMassKg * solids.count : 0);

  const thrust =
    vehicle.stages[0].engine.thrustSeaLevelN * vehicle.stages[0].engineCount +
    (solids ? solids.booster.thrustVacuumN * solids.count : 0);

  return thrust / (grossMass * STANDARD_GRAVITY);
}

/** Largest payload whose delivered delta-v still meets the budget, by bisection. */
export function maximumPayload(vehicle: Vehicle, target: AscentTarget): AscentResult {
  const budget = ascentBudget(target);

  let low = 0;
  let high = 100_000;
  for (let i = 0; i < 80; i++) {
    const mid = (low + high) / 2;
    if (deliveredDeltaV(vehicle, mid).total >= budget.requiredMS) low = mid;
    else high = mid;
  }

  const payloadKg = low;
  const { total, perStage } = deliveredDeltaV(vehicle, payloadKg);

  return {
    vehicle: vehicle.name,
    budget,
    deliveredMS: total,
    payloadKg,
    marginMS: total - budget.requiredMS,
    launchTWR: launchTWR(vehicle, payloadKg),
    perStage,
  };
}

export function siteById(id: string): LaunchSite {
  const site = LAUNCH_SITES.find((s) => s.id === id);
  if (!site) throw new Error(`no launch site called "${id}"`);
  return site;
}
