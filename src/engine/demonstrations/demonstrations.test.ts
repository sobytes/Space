/**
 * One gate over every demonstration.
 *
 * Each entry in the registry declares a published value, the source it came from, and the
 * tolerance it must land inside. This test runs them all and compares. A demonstration that
 * cannot survive this is not a demonstration, it is an animation.
 */

import { describe, expect, it } from "vitest";
import { DEMONSTRATIONS } from "./registry";

describe("physical demonstrations against published values", () => {
  it.each(DEMONSTRATIONS.map((d) => [d.id, d] as const))(
    "%s reproduces its published value",
    (_id, demonstration) => {
      const result = demonstration.run();
      const { value: published, tolerance, unit, source } = demonstration.published;

      const error = Math.abs(result.measured - published);
      const fractionalError = published === 0 ? error : error / Math.abs(published);

      console.log(`\n${demonstration.title}`);
      console.log(`  ${demonstration.attribution}`);
      for (const row of result.rows) console.log(`    ${row.label}: ${row.value}`);
      if (result.control) {
        console.log(`    control (${result.control.label}): ${result.control.value.toFixed(6)}`);
      }
      console.log(
        `    measured ${result.measured} ${unit} vs published ${published} ` +
          `(error ${(fractionalError * 100).toFixed(6)}%, allowed ${(tolerance * 100).toFixed(4)}%)`,
      );
      console.log(`    source: ${source}`);
      for (const caveat of result.caveats ?? []) console.log(`    caveat: ${caveat}`);

      expect(fractionalError).toBeLessThanOrEqual(tolerance);
    },
  );

  it("every demonstration cites a source and declares a tolerance", () => {
    for (const d of DEMONSTRATIONS) {
      expect(d.published.source.length, `${d.id} must cite a source`).toBeGreaterThan(10);
      expect(d.published.tolerance, `${d.id} must declare a finite tolerance`).toBeGreaterThan(0);
      expect(d.published.tolerance, `${d.id} tolerance is too loose to mean anything`).toBeLessThan(0.1);
    }
  });
});
