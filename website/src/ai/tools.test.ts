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

import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { SYSTEM_PROMPT, TOOLS, TOOL_BY_NAME } from "./tools";
import { BODY_CONTRACTS, BODY_IDS } from "@solar/engine/bodies/registry";
import { heliocentricPositionOf } from "@solar/engine/bodies/position";
import { rotationPeriodDays } from "@solar/engine/rotation";
import { demonstrationById } from "@solar/engine/demonstrations/registry";
import { impactEnergy } from "@solar/engine/scenarios/asteroid";
import { apsidalPrecession, influenceOf } from "@solar/engine/nbody";
import { SECONDS_PER_DAY, SECONDS_PER_JULIAN_YEAR } from "@solar/engine/units";
import { jdUtcFromEpochMs, tdbFromUtc } from "@solar/engine/time";
import { AU_IN_METRES } from "@solar/engine/units";
import { length } from "@solar/engine/vec";

/** Every non-test file under `root`, concatenated. */
function collectEngineSource(root: string): string {
  const parts: string[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = `${root}/${entry.name}`;
    if (entry.isDirectory()) {
      parts.push(collectEngineSource(path));
    } else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")) {
      parts.push(readFileSync(path, "utf8"));
    }
  }
  return parts.join("\n");
}

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
    /**
     * The whole engine, found by walking the tree rather than from a list.
     *
     * A hardcoded list of engine files went stale the first time a tool was backed by a new
     * module: the gate failed claiming the function did not exist when it plainly did, which
     * is the worst kind of failure because the obvious fix is to widen the list and the real
     * fix is to stop keeping one.
     *
     * The root is resolved from this file rather than from the working directory, which is
     * what broke when the engine became its own package. The count assertion below means a
     * wrong root fails loudly instead of matching nothing and passing.
     */
    const engineSource = collectEngineSource(
      fileURLToPath(new URL("../../../engine/src", import.meta.url)),
    );

    expect(engineSource.length, "walked the engine and found nothing").toBeGreaterThan(50_000);

    for (const tool of TOOLS) {
      for (const symbol of tool.backedBy.split(",").map((s) => s.trim().replace(/\(\).*$/, ""))) {
        const bare = symbol.replace(/\.run$/, "");
        expect(
          engineSource.includes(`export function ${bare}`) ||
            engineSource.includes(`export const ${bare}`) ||
            engineSource.includes(`export interface ${bare}`),
          `${tool.name} claims to be backed by ${bare}, which the engine does not export`,
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

describe("the n-body tools measure rather than describe", () => {
  const YEARS = 10;

  it("gravitational_influence returns exactly what the engine integrated", () => {
    const output = TOOL_BY_NAME.get("gravitational_influence")!.run({
      body: "jupiter",
      years: YEARS,
      when: WHEN,
    }) as { displacements: { body: string; displacementKm: number }[] };

    const direct = influenceOf(EPOCH, "jupiter", YEARS * SECONDS_PER_JULIAN_YEAR, [], {
      tolerance: 1e-13,
      minStepSeconds: 60,
      maxStepSeconds: 5 * SECONDS_PER_DAY,
    });

    // Exact equality, not approximate. The integration is deterministic, so anything the tool
    // rounds, caches or recomputes differently would show up here.
    for (const entry of output.displacements) {
      const match = direct.find(
        (d) => BODY_CONTRACTS[d.id as keyof typeof BODY_CONTRACTS]?.displayName === entry.body,
      );
      expect(match, entry.body).toBeDefined();
      expect(entry.displacementKm).toBe(match!.metres / 1000);
    }
    /**
     * Which giant is displaced most depends strongly on the start epoch, and not weakly:
     * Jupiter's 10-year displacement of Saturn is 19,502 Mm from J2000 and 1,746 Mm from 2026,
     * an eleven-fold swing. That is the Jupiter-Saturn great inequality, whose period is about
     * 900 years, so the differential response depends on where in that cycle the two runs
     * start. Asserting a fixed ranking would pin an accident of the epoch. What is invariant is
     * that the giants move far more than the terrestrials, which is what mass and proximity
     * require.
     */
    const byName = new Map(output.displacements.map((d) => [d.body, d.displacementKm]));
    const giants = ["Saturn", "Uranus", "Neptune"].map((n) => byName.get(n)!);
    const terrestrials = ["Mercury", "Venus", "Mars"].map((n) => byName.get(n)!);
    expect(Math.min(...giants)).toBeGreaterThan(Math.max(...terrestrials));
    expect(["Saturn", "Uranus", "Neptune"]).toContain(output.displacements[0].body);
  });

  it("apsidal_precession returns exactly what the engine fitted", () => {
    const output = TOOL_BY_NAME.get("apsidal_precession")!.run({
      body: "mercury",
      years: 60,
      perturber: "embary",
      when: WHEN,
    }) as { perihelionAdvanceArcsecPerCentury: number };

    const direct = apsidalPrecession({
      body: "mercury",
      epoch: EPOCH,
      spanYears: 60,
      planets: ["mercury", "embary"],
      limits: { tolerance: 1e-13, minStepSeconds: 60, maxStepSeconds: SECONDS_PER_DAY },
    });
    expect(output.perihelionAdvanceArcsecPerCentury).toBe(direct.pericentreArcsecPerCentury);
  }, 60_000);

  it("add_hypothetical_planet reports a real perturbation and keeps its arithmetic consistent", () => {
    const output = TOOL_BY_NAME.get("add_hypothetical_planet")!.run({
      semiMajorAxisAu: 3,
      massEarths: 317.8,
      years: YEARS,
      when: WHEN,
    }) as {
      displacements: { body: string; displacementKm: number }[];
      mercuryPerihelionArcsecPerCentury: { without: number; with: number; change: number };
      caveat: string;
    };

    const mercury = output.mercuryPerihelionArcsecPerCentury;
    expect(mercury.change).toBe(mercury.with - mercury.without);
    // A Jupiter at 3 au roughly triples Mercury's perihelion advance.
    expect(mercury.change).toBeGreaterThan(100);
    // Every real planet is moved, and the list is sorted worst first.
    expect(output.displacements.length).toBeGreaterThanOrEqual(8);
    for (const entry of output.displacements) expect(entry.displacementKm).toBeGreaterThan(0);
    for (let i = 1; i < output.displacements.length; i++) {
      expect(output.displacements[i - 1].displacementKm).toBeGreaterThanOrEqual(
        output.displacements[i].displacementKm,
      );
    }
    expect(output.caveat.length).toBeGreaterThan(80);
  }, 60_000);

  it("refuses placements and masses it cannot integrate meaningfully", () => {
    const tool = TOOL_BY_NAME.get("add_hypothetical_planet")!;
    expect(() => tool.run({ semiMajorAxisAu: 0.01, massEarths: 1 })).toThrow(/between 0.1 and 100/);
    expect(() => tool.run({ semiMajorAxisAu: 3, massEarths: 0 })).toThrow(/above zero/);
    expect(() => TOOL_BY_NAME.get("gravitational_influence")!.run({ body: "jupiter", years: 900 }))
      .toThrow(/between 0 and 500/);
    expect(() => TOOL_BY_NAME.get("apsidal_precession")!.run({ body: "mercury", years: 10 }))
      .toThrow(/50 to 1000/);
  });
});
