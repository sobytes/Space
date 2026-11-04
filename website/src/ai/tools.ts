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

import { BODY_CONTRACTS, BODY_IDS, type BodyId } from "@solar/engine/bodies/registry";
import { heliocentricPositionOf } from "@solar/engine/bodies/position";
import { obliquityToOrbitDeg, orientationOf, rotationPeriodDays } from "@solar/engine/rotation";
import { DEMONSTRATIONS, demonstrationById } from "@solar/engine/demonstrations/registry";
import { ACCURACY } from "@solar/engine/data/ephemeris-accuracy";
import { SHORT_SPAN, type PlanetId } from "@solar/engine/data/planets";
import { PHYSICAL } from "@solar/engine/data/physical";
import { apsidalPrecession, influenceOf } from "@solar/engine/nbody";
import { jdUtcFromEpochMs, tdbFromUtc, type JdTdb } from "@solar/engine/time";
import {
  AU_IN_METRES,
  GM_SUN,
  SECONDS_PER_DAY,
  SECONDS_PER_JULIAN_YEAR,
  SPEED_OF_LIGHT_M_S,
} from "@solar/engine/units";
import { length, sub } from "@solar/engine/vec";

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
    name: "gravitational_influence",
    description:
      "How far one body's gravity moves every other body over a span of years. Measured " +
      "differentially: the solar system is integrated twice from identical initial conditions, " +
      "once with that body's mass and once with it zeroed, and the separation between the two " +
      "runs is the answer. No ephemeris fit error enters, because both runs carry the same one. " +
      "Use this for questions about whether and how much the planets pull each other.",
    input_schema: {
      type: "object",
      properties: {
        body: { ...BODY_ENUM, description: "Whose mass to test. Must be the Sun or a planet." },
        years: { type: "number", description: "Span to integrate. 10 to 100 is the useful range." },
        when: { type: "string", description: "ISO date to start from. Defaults to now." },
      },
      required: ["body", "years"],
      additionalProperties: false,
    },
    backedBy: "influenceOf",
    run: (input) => {
      const years = Number(input.years);
      if (!Number.isFinite(years) || years <= 0 || years > 500) {
        throw new Error("years must be between 0 and 500; beyond that the integration drifts");
      }
      const body = asBodyId(input.body);
      const displacements = influenceOf(
        epochFrom(input),
        body,
        years * SECONDS_PER_JULIAN_YEAR,
        [],
        { tolerance: 1e-13, minStepSeconds: 60, maxStepSeconds: 5 * SECONDS_PER_DAY },
      );
      return {
        massRemoved: BODY_CONTRACTS[body].displayName,
        years,
        method:
          "two integrations from identical initial conditions, differing only in whether this " +
          "body has mass; positions compared relative to the Sun",
        displacements: displacements
          .filter((entry) => entry.id !== "sun")
          .map((entry) => ({
            body: BODY_CONTRACTS[entry.id as BodyId]?.displayName ?? entry.id,
            displacementKm: entry.metres / 1000,
          }))
          .sort((a, b) => b.displacementKm - a.displacementKm),
      };
    },
  },
  {
    name: "apsidal_precession",
    description:
      "The rate a body's perihelion drifts under the pull of the other planets, in arcsec per " +
      "century, measured by integrating mutual gravity and fitting the trend. Newtonian only: " +
      "for Mercury this returns the planetary contribution, and the relativistic 43 arcsec per " +
      "century is a separate term from run_demonstration's mercury-precession.",
    input_schema: {
      type: "object",
      properties: {
        body: { ...BODY_ENUM, description: "Must be a planet." },
        years: { type: "number", description: "Fit span. 300 is a good default." },
        perturber: {
          ...BODY_ENUM,
          description: "Optional. Restrict to this one perturber to see its share alone.",
        },
      },
      required: ["body"],
      additionalProperties: false,
    },
    backedBy: "apsidalPrecession",
    run: (input) => {
      const body = asBodyId(input.body);
      const years = typeof input.years === "number" ? input.years : 300;
      if (years < 50 || years > 1000) throw new Error("the fit span must be 50 to 1000 years");
      const perturber = input.perturber === undefined ? null : asBodyId(input.perturber);
      const planets = perturber
        ? ([body, perturber].filter((id, i, all) => all.indexOf(id) === i) as PlanetId[])
        : undefined;

      const result = apsidalPrecession({
        body,
        epoch: epochFrom(input),
        spanYears: years,
        planets,
        limits: { tolerance: 1e-13, minStepSeconds: 60, maxStepSeconds: SECONDS_PER_DAY },
      });
      return {
        body: BODY_CONTRACTS[body].displayName,
        perturber: perturber ? BODY_CONTRACTS[perturber].displayName : "all eight planets",
        fitSpanYears: years,
        perihelionAdvanceArcsecPerCentury: result.pericentreArcsecPerCentury,
        nodeRegressionArcsecPerCentury: result.nodeArcsecPerCentury,
        note:
          "Newtonian only. The advance is of varpi = Omega + omega, measured in the body's own " +
          "orbital plane, which is the convention published figures use.",
        energyDriftOverRun: result.energyDrift,
      };
    },
  },
  {
    name: "add_hypothetical_planet",
    description:
      "Puts a planet that does not exist into the solar system and reports what it does to the " +
      "real ones: how far each is displaced, and how Mercury's perihelion advance changes. The " +
      "new body is placed on a circular orbit and pulls on everything, so this answers 'what " +
      "would happen if' rather than describing it.",
    input_schema: {
      type: "object",
      properties: {
        semiMajorAxisAu: { type: "number", description: "Orbit radius in au, 0.1 to 100." },
        massEarths: { type: "number", description: "Mass in Earth masses. Jupiter is 317.8." },
        years: { type: "number", description: "Span to integrate. Defaults to 10." },
      },
      required: ["semiMajorAxisAu", "massEarths"],
      additionalProperties: false,
    },
    backedBy: "influenceOf, apsidalPrecession",
    run: (input) => {
      const au = Number(input.semiMajorAxisAu);
      const massEarths = Number(input.massEarths);
      const years = typeof input.years === "number" ? input.years : 10;
      if (!(au >= 0.1 && au <= 100)) throw new Error("place it between 0.1 and 100 au");
      if (!(massEarths > 0 && massEarths <= 5000)) {
        throw new Error("mass must be above zero and at most 5000 Earth masses");
      }
      if (!(years > 0 && years <= 200)) throw new Error("integrate between 0 and 200 years");

      const gm = massEarths * PHYSICAL.embary.gm;
      const radius = au * AU_IN_METRES;
      const intruder = {
        id: "intruder",
        gm,
        position: { x: radius, y: 0, z: 0 },
        velocity: { x: 0, y: Math.sqrt((GM_SUN + gm) / radius), z: 0 },
      };
      const limits = { tolerance: 1e-13, minStepSeconds: 60, maxStepSeconds: 5 * SECONDS_PER_DAY };

      const displacements = influenceOf(
        epochFrom(input),
        "intruder",
        years * SECONDS_PER_JULIAN_YEAR,
        [intruder],
        limits,
      );
      const before = apsidalPrecession({
        body: "mercury",
        epoch: epochFrom(input),
        spanYears: 300,
        limits: { tolerance: 1e-13, minStepSeconds: 60, maxStepSeconds: SECONDS_PER_DAY },
      });
      const after = apsidalPrecession({
        body: "mercury",
        epoch: epochFrom(input),
        spanYears: 300,
        extra: [intruder],
        limits: { tolerance: 1e-13, minStepSeconds: 60, maxStepSeconds: SECONDS_PER_DAY },
      });

      return {
        added: { semiMajorAxisAu: au, massEarths, gm },
        years,
        displacements: displacements
          .filter((entry) => entry.id !== "sun")
          .map((entry) => ({
            body: BODY_CONTRACTS[entry.id as BodyId]?.displayName ?? entry.id,
            displacementKm: entry.metres / 1000,
          }))
          .sort((a, b) => b.displacementKm - a.displacementKm),
        mercuryPerihelionArcsecPerCentury: {
          without: before.pericentreArcsecPerCentury,
          with: after.pericentreArcsecPerCentury,
          change: after.pericentreArcsecPerCentury - before.pericentreArcsecPerCentury,
        },
        caveat:
          "The new body is placed on a circular orbit in the ecliptic at the start epoch, with " +
          "no attempt to find a stable configuration. A large mass close to an existing planet " +
          "will disrupt it, and the displacement figures then describe a wrecked orbit rather " +
          "than a perturbed one.",
      };
    },
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
