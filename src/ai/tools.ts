/**
 * The tools Claude is allowed to use, and the rule that keeps the whole thing honest.
 *
 * Claude never supplies a number. Every tool here is a thin wrapper over a function in
 * `src/engine`, each of which is gated against a published external value. The model decides
 * what to compute and explains what came back; the engine decides what the answer is.
 *
 * This is not a stylistic preference. Ask a language model to integrate an orbit and it returns
 * a fluent, confident, wrong figure, and the failure is invisible because a wrong orbit renders
 * exactly like a right one. A tool surface is the only way to get the conversational interface
 * without inheriting that.
 *
 * `tools.test.ts` enforces it: every tool must name the engine function it calls, that function
 * must exist, and no tool may return a literal the engine did not produce.
 */

import { BODY_CONTRACTS, BODY_IDS, type BodyId } from "@/engine/bodies/registry";
import { heliocentricPositionOf } from "@/engine/bodies/position";
import { obliquityToOrbitDeg, orientationOf, rotationPeriodDays } from "@/engine/rotation";
import { DEMONSTRATIONS, demonstrationById } from "@/engine/demonstrations/registry";
import { DEFAULT_LAUNCH, impactEnergy, runAsteroid } from "@/engine/scenarios/asteroid";
import { ACCURACY } from "@/engine/data/ephemeris-accuracy";
import { SHORT_SPAN } from "@/engine/data/planets";
import { jdTdb, jdUtcFromEpochMs, tdbFromUtc, type JdTdb } from "@/engine/time";
import { AU_IN_METRES, SPEED_OF_LIGHT_M_S } from "@/engine/units";
import { length, sub } from "@/engine/vec";
import { azimuthFor, maximumPayload, siteById } from "@/engine/launch/ascent";
import { VEHICLES } from "@/engine/launch/vehicles";
import { LAUNCH_SITES } from "@/engine/launch/reference-data";

export interface ToolDefinition {
  readonly name: string;
  readonly description: string;
  readonly input_schema: {
    readonly type: "object";
    readonly properties: Record<string, unknown>;
    readonly required?: readonly string[];
    readonly additionalProperties: false;
  };
  /** The engine function this tool exists to call. Checked by the gate. */
  readonly backedBy: string;
  readonly run: (input: Record<string, unknown>) => unknown;
}

function epochFrom(input: Record<string, unknown>): JdTdb {
  const iso = typeof input.when === "string" ? input.when : null;
  if (!iso) return tdbFromUtc(jdUtcFromEpochMs(Date.now()));
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) throw new Error(`"${iso}" is not a date I can parse`);
  return tdbFromUtc(jdUtcFromEpochMs(ms));
}

function asBodyId(value: unknown): BodyId {
  if (typeof value !== "string" || !(BODY_IDS as readonly string[]).includes(value)) {
    throw new Error(`"${String(value)}" is not a body. Known bodies: ${BODY_IDS.join(", ")}`);
  }
  return value as BodyId;
}

const BODY_ENUM = { type: "string", enum: [...BODY_IDS] };

export const TOOLS: readonly ToolDefinition[] = [
  {
    name: "describe_body",
    description:
      "Physical and orbital facts for one body, computed for a given instant. Returns distance " +
      "from the Sun and from Earth, light travel time, rotation period, axial tilt, atmosphere " +
      "and the stated accuracy of the position. Use this for any question about a body rather " +
      "than answering from memory.",
    input_schema: {
      type: "object",
      properties: {
        body: BODY_ENUM,
        when: { type: "string", description: "ISO 8601 instant. Defaults to now." },
      },
      required: ["body"],
      additionalProperties: false,
    },
    backedBy: "heliocentricPositionOf, orientationOf, rotationPeriodDays, obliquityToOrbitDeg",
    run: (input) => {
      const body = asBodyId(input.body);
      const epoch = epochFrom(input);
      const contract = BODY_CONTRACTS[body];
      const self = heliocentricPositionOf(body, epoch);
      const earth = heliocentricPositionOf("embary", epoch);
      const fromEarth = length(sub(self, earth));

      const accuracy =
        contract.ephemeris.kind === "standish-elements"
          ? SHORT_SPAN.quotedError[contract.ephemeris.planet].longitude *
            ACCURACY[contract.ephemeris.planet].rmsFactor
          : null;

      return {
        name: contract.displayName,
        distanceFromSunAu: length(self) / AU_IN_METRES,
        distanceFromEarthAu: fromEarth / AU_IN_METRES,
        lightTravelFromEarthSeconds: fromEarth / SPEED_OF_LIGHT_M_S,
        equatorialRadiusKm: contract.equatorialRadiusM / 1000,
        siderealRotationDays: rotationPeriodDays(body),
        axialTiltDegrees: obliquityToOrbitDeg(body, epoch),
        primeMeridianDegrees: (orientationOf(body, epoch).spin * 180) / Math.PI,
        meanTemperatureK: contract.meanTemperatureK,
        confirmedMoons: contract.confirmedMoons,
        atmosphere: contract.atmosphere?.composition ?? null,
        positionAccuracyArcsec: accuracy,
        knownDiscrepancies: contract.knownDiscrepancies,
        sources: "JPL Standish element tables; IAU WGCCRE rotational elements",
      };
    },
  },
  {
    name: "compare_bodies",
    description:
      "Compares two bodies on size, mass, distance, rotation and temperature at a given instant, " +
      "including the separation between them right now.",
    input_schema: {
      type: "object",
      properties: { a: BODY_ENUM, b: BODY_ENUM, when: { type: "string" } },
      required: ["a", "b"],
      additionalProperties: false,
    },
    backedBy: "heliocentricPositionOf, rotationPeriodDays",
    run: (input) => {
      const a = asBodyId(input.a);
      const b = asBodyId(input.b);
      const epoch = epochFrom(input);
      const pa = heliocentricPositionOf(a, epoch);
      const pb = heliocentricPositionOf(b, epoch);
      const separation = length(sub(pa, pb));

      const summarise = (id: BodyId) => ({
        name: BODY_CONTRACTS[id].displayName,
        equatorialRadiusKm: BODY_CONTRACTS[id].equatorialRadiusM / 1000,
        gm: BODY_CONTRACTS[id].gm,
        siderealRotationDays: rotationPeriodDays(id),
        meanTemperatureK: BODY_CONTRACTS[id].meanTemperatureK,
      });

      return {
        a: summarise(a),
        b: summarise(b),
        separationAu: separation / AU_IN_METRES,
        lightTravelSeconds: separation / SPEED_OF_LIGHT_M_S,
        radiusRatio:
          BODY_CONTRACTS[a].equatorialRadiusM / BODY_CONTRACTS[b].equatorialRadiusM,
        massRatio: BODY_CONTRACTS[a].gm / BODY_CONTRACTS[b].gm,
      };
    },
  },
  {
    name: "list_demonstrations",
    description:
      "Lists the physical demonstrations the simulation can run and verify. Each one reproduces " +
      "a published value. Use this when asked what the app can show or prove.",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
    backedBy: "DEMONSTRATIONS",
    run: () =>
      DEMONSTRATIONS.map((d) => ({
        id: d.id,
        title: d.title,
        question: d.question,
        attribution: d.attribution,
        publishedValue: d.published.value,
        unit: d.published.unit,
        source: d.published.source,
      })),
  },
  {
    name: "run_demonstration",
    description:
      "Runs one demonstration and returns its measured result next to the published value it is " +
      "checked against. This is how to answer 'can you prove it' questions.",
    input_schema: {
      type: "object",
      properties: { id: { type: "string", enum: DEMONSTRATIONS.map((d) => d.id) } },
      required: ["id"],
      additionalProperties: false,
    },
    backedBy: "demonstrationById().run",
    run: (input) => {
      const demonstration = demonstrationById(String(input.id));
      if (!demonstration) throw new Error(`no demonstration called "${String(input.id)}"`);
      const result = demonstration.run();
      return {
        title: demonstration.title,
        history: demonstration.history,
        measured: result.measured,
        published: demonstration.published.value,
        unit: demonstration.published.unit,
        source: demonstration.published.source,
        relativeError:
          Math.abs(result.measured - demonstration.published.value) /
          Math.abs(demonstration.published.value),
        rows: result.rows,
        control: result.control ?? null,
        caveats: result.caveats ?? [],
      };
    },
  },
  {
    name: "launch_asteroid",
    description:
      "Propagates an asteroid under the Sun and every planet, and reports where it ends up: " +
      "impact, escape, or a stable orbit, with close approaches and impact energy. Use this " +
      "whenever asked what would happen if something were thrown through the solar system. " +
      "Never estimate an outcome yourself; run it.",
    input_schema: {
      type: "object",
      properties: {
        originBody: BODY_ENUM,
        speedMS: { type: "number", description: "Speed relative to the origin body, m/s." },
        headingDeg: { type: "number", description: "0 is along the body's orbital motion." },
        inclinationDeg: { type: "number" },
        diameterM: { type: "number" },
        durationYears: { type: "number" },
        when: { type: "string" },
      },
      required: ["originBody", "speedMS"],
      additionalProperties: false,
    },
    backedBy: "runAsteroid",
    run: (input) => {
      const outcome = runAsteroid({
        ...DEFAULT_LAUNCH,
        originBody: asBodyId(input.originBody),
        speedMS: Number(input.speedMS),
        headingDeg: typeof input.headingDeg === "number" ? input.headingDeg : 0,
        inclinationDeg: typeof input.inclinationDeg === "number" ? input.inclinationDeg : 0,
        diameterM: typeof input.diameterM === "number" ? input.diameterM : 300,
        durationYears:
          typeof input.durationYears === "number" ? Math.min(200, input.durationYears) : 50,
        startEpoch: epochFrom(input),
      });

      return {
        summary: outcome.summary,
        fate: outcome.result.fate,
        finalEccentricity: outcome.finalEccentricity,
        finalSemiMajorAxisAu: outcome.finalSemiMajorAxisAu,
        impact: outcome.impact,
        closeApproaches: outcome.result.closeApproaches.map((a) => ({
          body: a.body,
          distanceAu: a.distanceM / AU_IN_METRES,
          atYears: a.atSeconds / (86_400 * 365.25),
        })),
        integratorSteps: outcome.result.steps,
        caveat:
          "Perturbing planet positions come from the Standish tables, whose error reaches about " +
          "20 arcseconds for Earth, roughly 14,000 km at one au. Fate is reliable; a flyby " +
          "distance to the kilometre is not.",
      };
    },
  },
  {
    name: "compute_launch",
    description:
      "Works out what a launch vehicle can lift to a given orbit from a given site, and the " +
      "full delta-v budget behind it: orbital speed, the climb, gravity and drag losses, and " +
      "the Earth-rotation bonus, which is negative for a retrograde or sun-synchronous launch. " +
      "Use this for any question about rockets, payload to orbit, or launch azimuth.",
    input_schema: {
      type: "object",
      properties: {
        vehicle: { type: "string", enum: VEHICLES.map((v) => v.id) },
        site: { type: "string", enum: LAUNCH_SITES.map((s) => s.id) },
        altitudeKm: { type: "number" },
        inclinationDeg: { type: "number" },
      },
      required: ["altitudeKm", "inclinationDeg"],
      additionalProperties: false,
    },
    backedBy: "maximumPayload, ascentBudget, earthRotationBonus, azimuthFor",
    run: (input) => {
      const vehicle =
        VEHICLES.find((v) => v.id === input.vehicle) ?? VEHICLES[0];
      const site = siteById(typeof input.site === "string" ? input.site : "ksc-lc39a");
      const target = {
        altitudeKm: Number(input.altitudeKm),
        inclinationDeg: Number(input.inclinationDeg),
        site,
      };

      const result = maximumPayload(vehicle, target);
      return {
        vehicle: result.vehicle,
        site: site.name,
        orbit: `${target.altitudeKm} km circular at ${target.inclinationDeg} degrees`,
        launchAzimuthDeg: azimuthFor(site, target.inclinationDeg),
        payloadKg: result.payloadKg,
        liftoffThrustToWeight: result.launchTWR,
        budget: result.budget,
        perStageDeltaV: result.perStage,
        caveat:
          "The budget uses published loss figures, and the published loss terms disagree by " +
          "more than a kilometre per second between sources. Fed this vehicle's real masses " +
          "and its published payload the model implies 2,654 m/s of losses, inside the 2 to 3 " +
          "km/s band real vehicles need, but the payload it predicts under the published " +
          "figures runs about 14% high. Only the Atlas V 401 is modelled; the 551 is excluded " +
          "because its booster's published thrust, specific impulse, burn time and gross mass " +
          "are mutually inconsistent.",
      };
    },
  },
  {
    name: "estimate_impact_energy",
    description:
      "Kinetic energy of an impactor in megatons of TNT, with a comparison to a real event. " +
      "Gated against Chelyabinsk, Tunguska and Chicxulub.",
    input_schema: {
      type: "object",
      properties: {
        diameterM: { type: "number" },
        densityKgM3: { type: "number", description: "3000 for stone, 8000 for iron." },
        speedMS: { type: "number" },
      },
      required: ["diameterM", "speedMS"],
      additionalProperties: false,
    },
    backedBy: "impactEnergy",
    run: (input) =>
      impactEnergy(
        Number(input.diameterM),
        typeof input.densityKgM3 === "number" ? input.densityKgM3 : 3_000,
        Number(input.speedMS),
      ),
  },
];

export const TOOL_BY_NAME: ReadonlyMap<string, ToolDefinition> = new Map(
  TOOLS.map((tool) => [tool.name, tool]),
);

export const SYSTEM_PROMPT = `You are the guide to a solar system simulator whose numbers all come from JPL and IAU data, with every figure gated against a published value.

The single rule you must never break: you do not produce numbers. Every quantity you state must come back from a tool call in this turn. If a tool cannot answer, say so plainly rather than estimating. A plausible wrong figure is worse here than no figure, because the user cannot tell the difference and the whole project's credibility rests on this.

So: call a tool, then explain what it returned. Never reverse that order, and never fill a gap from memory, including for things you are confident about such as a planet's radius.

When a tool reports a caveat or a known discrepancy between sources, pass it on. The app's posture is that a number without its error bar is a guess wearing a lab coat.

Write plainly and concretely. Short sentences. No bullet lists unless the user asks for one. You are talking to someone curious and intelligent who does not want to be condescended to, and who would rather hear "the Standish tables cannot resolve that" than a confident fabrication.`;
