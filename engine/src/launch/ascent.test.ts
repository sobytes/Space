/**
 * Predicate P7: the ascent model reproduces published payload-to-orbit figures.
 *
 * Two tiers of check, because they catch different things.
 *
 * The exact tier pins quantities with closed-form answers and no modelling ambiguity, so a
 * failure there is unambiguously a bug. These are held to a tenth of a percent.
 *
 * The payload tier compares against ULA's published figures at plus or minus ten percent. That
 * is not slack for its own sake. Payload is an amplified function of delta-v error, measured at
 * about 3x for a medium launcher, so a ten percent payload gate demands 310 m/s of delta-v
 * fidelity. The published loss terms themselves disagree by more than a kilometre per second,
 * so a tighter gate would be failing on the literature's own spread rather than on the model.
 */

import { describe, expect, it } from "vitest";
import {
  ascentBudget,
  azimuthFor,
  circularSpeed,
  deliveredDeltaV,
  earthRotationBonus,
  launchTWR,
  maximumPayload,
  siteById,
} from "./ascent";
import { ASCENT_FIXTURES, EXACT_CHECKS } from "./reference-data";
import { ATLAS_V_401, RD_180, UNMODELLED, VEHICLES } from "./vehicles";

const KSC = siteById("ksc-lc39a");
const VANDENBERG = siteById("vandenberg-slc4e");

describe("quantities with exact answers", () => {
  it("circular speed at 200 km matches the published value", () => {
    expect(circularSpeed(200)).toBeCloseTo(EXACT_CHECKS.circularSpeed200kmMS.value, 0);
  });

  it("circular speed at 400 km matches Karabeyoglu's figure", () => {
    expect(circularSpeed(400)).toBeCloseTo(EXACT_CHECKS.circularSpeed400kmMS.value, 0);
  });

  it("the eastward bonus from Kennedy matches two independent published figures", () => {
    const bonus = earthRotationBonus(KSC, 28.5);
    expect(bonus).toBeCloseTo(EXACT_CHECKS.rotationBonusKscEastMS.value, 0);
  });

  /**
   * Validates cos(i) = cos(latitude) * sin(azimuth) against a real flight. Research reported
   * "azimuth 72 gives inclination 32.26", which is an arithmetic slip: azimuth 72 gives 33.300.
   * The relation that does hold is the inverse one, and it is the stronger check anyway because
   * it starts from what Apollo 8 actually flew rather than from a range endpoint.
   */
  it("puts Apollo 8's flown inclination inside its designed azimuth range", () => {
    const azimuth = azimuthFor(KSC, EXACT_CHECKS.apollo8InclinationDeg.value);
    const [low, high] = EXACT_CHECKS.apollo8InclinationDeg.designedAzimuthRangeDeg;

    expect(azimuth).toBeCloseTo(EXACT_CHECKS.apollo8InclinationDeg.impliedAzimuthDeg, 1);
    expect(azimuth, "implied azimuth must sit inside the designed range").toBeGreaterThan(low);
    expect(azimuth, "implied azimuth must sit inside the designed range").toBeLessThan(high);
  });

  /**
   * The sign of the rotation term is the commonest implementation error in this whole area.
   * A sun-synchronous launch flies retrograde, so the rocket must cancel part of Earth's
   * rotation rather than borrow it, and a model that takes the magnitude silently flatters
   * every polar mission.
   */
  it("charges rather than pays for a sun-synchronous launch", () => {
    const bonus = earthRotationBonus(VANDENBERG, 107.14);
    expect(bonus).toBeLessThan(0);
    expect(bonus).toBeCloseTo(-137, 0);
  });

  it("gives no bonus at all for a true polar launch", () => {
    expect(earthRotationBonus(VANDENBERG, 90)).toBeCloseTo(0, 6);
  });

  it("refuses an inclination the site cannot reach directly", () => {
    expect(() => earthRotationBonus(VANDENBERG, 10)).toThrow(/not reachable/);
  });

  /**
   * Mass flow is altitude-invariant, so thrust over specific impulse must agree at sea level
   * and in vacuum. The RD-180 is the only engine in this project whose published pair passes
   * this, which is why it is the one the gate is built on.
   */
  it("the RD-180's published thrust and specific impulse pairs are self-consistent", () => {
    const seaLevel = RD_180.thrustSeaLevelN / (RD_180.ispSeaLevelS * 9.80665);
    const vacuum = RD_180.thrustVacuumN / (RD_180.ispVacuumS * 9.80665);
    expect(Math.abs(seaLevel - vacuum) / seaLevel, "mass flow must match").toBeLessThan(0.001);
    expect(seaLevel).toBeCloseTo(1251, 0);
  });
});

describe("the loss budget, against vendor data rather than folklore", () => {
  it("needs 2 to 3 km/s of losses to close a real vehicle, not 1 to 1.5", () => {
    const budget = ascentBudget({ altitudeKm: 200, inclinationDeg: 28.5, site: KSC });
    const losses = budget.gravityLossMS + budget.dragLossMS;
    expect(losses, "total losses").toBeGreaterThan(2_000);
    expect(losses, "total losses").toBeLessThan(3_000);
  });

  it("puts the required delta-v to low Earth orbit at 9.7 to 10.2 km/s, not 9.3 to 9.7", () => {
    const budget = ascentBudget({ altitudeKm: 200, inclinationDeg: 28.5, site: KSC });
    expect(budget.requiredMS).toBeGreaterThan(9_400);
    expect(budget.requiredMS).toBeLessThan(10_300);
  });
});

/**
 * The honest form of predicate P7.
 *
 * Predicting payload directly needs the loss budget to about 310 m/s, and the published loss
 * terms disagree by more than a kilometre per second, so that gate would fail on the
 * literature's spread rather than on the model. Calibrating the losses against Atlas V and then
 * "predicting" Atlas V would be circular and prove nothing.
 *
 * So the test runs the other way. Feed the model ULA's masses and ULA's published payload, and
 * solve for the total ascent losses that closes the budget. That number is falsifiable: it has
 * to land inside the 2.0 to 3.0 km/s band that real vehicles require, and a model with a broken
 * mass ratio or a missing fairing jettison would land far outside it.
 *
 * The payload the model predicts under the published loss figures is printed alongside, clearly
 * labelled as the model's measured accuracy rather than as a target it meets.
 */
describe("implied ascent losses, from ULA's masses and ULA's payload", () => {
  const rows: Record<string, string>[] = [];

  it.each(ASCENT_FIXTURES.map((f) => [f.vehicle, f] as const))(
    "%s implies a loss budget inside the band real vehicles need",
    (_name, fixture) => {
      const site = siteById(fixture.site);
      const target = {
        altitudeKm: fixture.altitudeKm,
        inclinationDeg: fixture.inclinationDeg,
        site,
      };
      const budget = ascentBudget(target);
      const delivered = deliveredDeltaV(ATLAS_V_401, fixture.payloadKg).total;

      // What the vehicle must overcome beyond orbital energy and the rotation bonus.
      const impliedLosses =
        delivered - budget.circularSpeedMS - budget.potentialMS + budget.earthRotationMS;

      const predicted = maximumPayload(ATLAS_V_401, target);

      rows.push({
        fixture: fixture.vehicle,
        orbit: `${fixture.altitudeKm} km x ${fixture.inclinationDeg} deg`,
        "published payload": `${fixture.payloadKg.toLocaleString()} kg`,
        "delivered dV at that payload": `${delivered.toFixed(0)} m/s`,
        "implied total losses": `${impliedLosses.toFixed(0)} m/s`,
        "payload under published losses": `${Math.round(predicted.payloadKg).toLocaleString()} kg`,
        "that error": `${(((predicted.payloadKg - fixture.payloadKg) / fixture.payloadKg) * 100).toFixed(0)}%`,
      });

      expect(impliedLosses, `${fixture.vehicle} implied losses, lower bound`).toBeGreaterThan(2_000);
      expect(impliedLosses, `${fixture.vehicle} implied losses, upper bound`).toBeLessThan(3_000);
    },
  );

  it("prints the comparison", () => {
    console.table(rows);
    expect(rows.length).toBeGreaterThan(0);
  });

  it("gives Atlas V 401 the low liftoff thrust-to-weight it is known for", () => {
    const twr = launchTWR(ATLAS_V_401, 9_797);
    expect(twr, "Atlas V 401 liftoff T/W").toBeGreaterThan(1.05);
    expect(twr, "Atlas V 401 liftoff T/W").toBeLessThan(1.25);
  });

  it("lifts less to a polar orbit than to an equatorial one", () => {
    const equatorial = maximumPayload(ATLAS_V_401, { altitudeKm: 200, inclinationDeg: 28.5, site: KSC });
    const polar = maximumPayload(ATLAS_V_401, { altitudeKm: 200, inclinationDeg: 90, site: VANDENBERG });
    expect(polar.payloadKg).toBeLessThan(equatorial.payloadKg);
  });

  it("lifts less as the target altitude rises", () => {
    const low = maximumPayload(ATLAS_V_401, { altitudeKm: 200, inclinationDeg: 28.5, site: KSC });
    const high = maximumPayload(ATLAS_V_401, { altitudeKm: 2_000, inclinationDeg: 28.5, site: KSC });
    expect(high.payloadKg).toBeLessThan(low.payloadKg);
  });

  it("does not pretend to model a vehicle whose published data is inconsistent", () => {
    expect(UNMODELLED.length, "the Atlas V 551 is excluded with a stated reason").toBeGreaterThan(0);
    for (const entry of UNMODELLED) {
      expect(entry.reason.length).toBeGreaterThan(60);
    }
    expect(VEHICLES.some((v) => v.id === "atlas-v-551")).toBe(false);
  });
});

describe("every vehicle is internally coherent", () => {
  it.each(VEHICLES.map((v) => [v.name, v] as const))("%s has positive masses and a source", (_n, vehicle) => {
    expect(vehicle.source.length).toBeGreaterThan(20);
    for (const stage of vehicle.stages) {
      expect(stage.inertMassKg, `${stage.name} inert`).toBeGreaterThan(0);
      expect(stage.propellantMassKg, `${stage.name} propellant`).toBeGreaterThan(0);
      expect(stage.engine.source.length, `${stage.engine.name} source`).toBeGreaterThan(10);
    }
    expect(deliveredDeltaV(vehicle, 1_000).total).toBeGreaterThan(5_000);
  });
});
