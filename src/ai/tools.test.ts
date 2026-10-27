/**
 * Predicate P11: the AI never supplies a number.
 *
 * The architecture rests on this. Claude decides what to compute and explains the result; the
 * engine decides what the result is. That is only true if every tool is a genuine wrapper over
 * a verified engine function, so this gate checks it mechanically rather than trusting a
 * comment or a system prompt.
 *
 * Each tool's output is compared against calling the engine directly. If a tool ever returned a
 * convenient literal instead of computing, these comparisons break.
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { SYSTEM_PROMPT, TOOLS, TOOL_BY_NAME } from "./tools";
import { BODY_CONTRACTS, BODY_IDS } from "@/engine/bodies/registry";
import { heliocentricPositionOf } from "@/engine/bodies/position";
import { rotationPeriodDays } from "@/engine/rotation";
import { demonstrationById } from "@/engine/demonstrations/registry";
import { impactEnergy } from "@/engine/scenarios/asteroid";
import { jdUtcFromEpochMs, tdbFromUtc } from "@/engine/time";
import { AU_IN_METRES } from "@/engine/units";
import { length } from "@/engine/vec";

const WHEN = "2026-01-01T00:00:00Z";
const EPOCH = tdbFromUtc(jdUtcFromEpochMs(Date.parse(WHEN)));

describe("every tool is a real wrapper over the engine", () => {
  it.each(TOOLS.map((t) => [t.name, t] as const))("%s declares what backs it", (_name, tool) => {
    expect(tool.backedBy.length, `${tool.name} must name the engine function it calls`)
      .toBeGreaterThan(3);
    expect(tool.description.length, `${tool.name} needs a usable description`).toBeGreaterThan(60);
    expect(tool.input_schema.additionalProperties).toBe(false);
  });

  it("names only engine functions that actually exist", () => {
    const engineSource = [
      "src/engine/bodies/position.ts",
      "src/engine/bodies/registry.ts",
      "src/engine/rotation.ts",
      "src/engine/demonstrations/registry.ts",
      "src/engine/scenarios/asteroid.ts",
    ]
      .map((path) => readFileSync(path, "utf8"))
      .join("\n");

    for (const tool of TOOLS) {
      for (const symbol of tool.backedBy.split(",").map((s) => s.trim().replace(/\(\).*$/, ""))) {
        const bare = symbol.replace(/\.run$/, "");
        expect(
          engineSource.includes(bare),
          `${tool.name} claims to be backed by ${bare}, which is not in the engine`,
        ).toBe(true);
      }
    }
  });
});

describe("tool output comes from the engine, not from a literal", () => {
  it("describe_body returns exactly what the engine computes", () => {
    for (const body of BODY_IDS) {
      const output = TOOL_BY_NAME.get("describe_body")!.run({ body, when: WHEN }) as Record<
        string,
        number
      >;

      const expectedRadiusKm = BODY_CONTRACTS[body].equatorialRadiusM / 1000;
      const expectedDistanceAu = length(heliocentricPositionOf(body, EPOCH)) / AU_IN_METRES;
      const expectedRotation = rotationPeriodDays(body);

      // Exact equality, not approximate. A wrapper that computes returns the identical double;
      // anything rounded or retyped by hand would not.
      expect(output.equatorialRadiusKm, `${body} radius`).toBe(expectedRadiusKm);
      expect(output.distanceFromSunAu, `${body} distance`).toBe(expectedDistanceAu);
      expect(output.siderealRotationDays, `${body} rotation`).toBe(expectedRotation);
    }
  });

  it("run_demonstration returns exactly what the demonstration measured", () => {
    for (const id of ["mercury-precession", "keplers-third-law", "light-travel-time"]) {
      const output = TOOL_BY_NAME.get("run_demonstration")!.run({ id }) as Record<string, number>;
      const direct = demonstrationById(id)!.run();
      expect(output.measured, `${id} measured value`).toBe(direct.measured);
    }
  });

  it("estimate_impact_energy returns exactly what the engine computes", () => {
    const output = TOOL_BY_NAME.get("estimate_impact_energy")!.run({
      diameterM: 250,
      densityKgM3: 3_000,
      speedMS: 17_000,
    }) as Record<string, number>;
    expect(output.energyJoules).toBe(impactEnergy(250, 3_000, 17_000).energyJoules);
  });

  it("launch_asteroid actually propagates rather than guessing a fate", () => {
    const output = TOOL_BY_NAME.get("launch_asteroid")!.run({
      originBody: "embary",
      speedMS: 20_000,
      headingDeg: 0,
      durationYears: 40,
      when: WHEN,
    }) as Record<string, unknown>;

    expect(output.integratorSteps as number).toBeGreaterThan(100);
    expect(output.finalEccentricity as number).toBeGreaterThan(1);
    expect(String(output.caveat)).toContain("arcseconds");
  });
});

describe("the tools refuse what they cannot answer", () => {
  it("rejects a body it does not know instead of inventing one", () => {
    expect(() => TOOL_BY_NAME.get("describe_body")!.run({ body: "vulcan" })).toThrow(/not a body/);
  });

  it("rejects an unparseable date", () => {
    expect(() =>
      TOOL_BY_NAME.get("describe_body")!.run({ body: "mars", when: "next tuesday-ish" }),
    ).toThrow(/not a date/);
  });

  it("rejects a demonstration that does not exist", () => {
    expect(() => TOOL_BY_NAME.get("run_demonstration")!.run({ id: "warp-drive" })).toThrow();
  });
});

describe("the system prompt carries the rule the architecture depends on", () => {
  it("forbids producing numbers and says why", () => {
    expect(SYSTEM_PROMPT).toMatch(/do not produce numbers/i);
    expect(SYSTEM_PROMPT).toMatch(/tool call/i);
    expect(SYSTEM_PROMPT.toLowerCase()).toContain("estimating");
  });

  it("tells the model to pass on caveats rather than smoothing them away", () => {
    expect(SYSTEM_PROMPT.toLowerCase()).toContain("caveat");
  });
});
