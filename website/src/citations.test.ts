import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { assessHabitability } from "@solar/engine/habitability";
import { ENVIRONMENT } from "@solar/engine/data/habitability-environment";
import { BODY_IDS } from "@solar/engine/bodies/registry";

/**
 * Is every citation the product shows accounted for?
 *
 * The habitability panel makes about a hundred sourced claims, and the whole premise of this
 * project is that a number with no provenance is a guess with a decimal point. That cuts both
 * ways: a citation nobody has checked is a guess with a journal name on it.
 *
 * Checking them turned out to be worth it. Thirty-six were resolved through Crossref and one
 * was wrong: Juno's magnetic field model was cited as Connerney et al. 2018, Nature 356, and
 * volume 356 of Nature is from 1992. It is Geophysical Research Letters 45, 2590.
 *
 * So this gate requires every author-and-year in the corpus to appear in the registry, either
 * with a DOI that was machine-checked or with a stated reason there is none. Books, JBIS
 * papers and NASA technical reports genuinely have no DOI, and saying so is honest; saying
 * nothing, or inventing a DOI, is not. `scripts/verify-citations.mjs` re-resolves the DOIs.
 */
const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const REGISTRY = JSON.parse(
  readFileSync(join(ROOT, "contracts/habitability/citations.json"), "utf8"),
) as { verified: Record<string, string>; noDoi: Record<string, string> };

/** Every distinct source string the panel can show, from the engine rather than the source. */
function citationCorpus(): string[] {
  const all = new Set<string>();
  /**
   * The source files too, not only the runtime strings.
   *
   * What a reader sees is the runtime strings, but the module's own commentary cites papers
   * as well, and a number justified in a comment by a paper that does not exist is wrong in
   * exactly the way this gate is for. Kopparapu's habitable-zone bounds are the clear case:
   * the panel says "inside the conservative habitable zone" and names nobody, and the only
   * place that claim is sourced is a comment.
   */
  for (const file of ["engine/src/habitability.ts", "engine/src/data/habitability-environment.ts"]) {
    all.add(readFileSync(join(ROOT, file), "utf8"));
  }
  for (const id of BODY_IDS) {
    for (const step of assessHabitability(id).ladder) all.add(step.source);
  }
  for (const env of Object.values(ENVIRONMENT)) {
    if (!env) continue;
    for (const value of [
      env.bondAlbedoSource,
      env.exobaseSource,
      env.doseSource,
      env.momentSource,
      env.magneticSource,
      env.lossSource,
      env.oneBarLevel?.source,
    ]) {
      if (typeof value === "string") all.add(value);
    }
  }
  return [...all];
}

/**
 * Pull the first author's surname and the year out of a free-text citation.
 *
 * The first author identifies the work, and getting it wrong is exactly the error this gate
 * exists to catch, so the whole author list has to be consumed. A simpler pattern allowing
 * one "& Surname" captured the middle name of "Bahcall, Pinsonneault & Basu 2001" and filed
 * the paper under the wrong person, which would have let a genuinely misattributed citation
 * pass while looking thorough.
 *
 * Over-matching is the safe direction otherwise: a false positive costs one line in the
 * registry, and a false negative lets an unchecked citation through.
 */
const SURNAME = "[A-Z][A-Za-zÀ-ɏ'’-]+";
const CITATION = new RegExp(
  `\\b(${SURNAME})((?:,\\s+${SURNAME}|\\s+(?:&|and)\\s+${SURNAME})*)`
    + `(?:\\s+et al\\.)?,?\\s+(1[89]\\d\\d|20\\d\\d)\\b`,
  "g",
);

function tokensIn(text: string): string[] {
  return [...text.matchAll(CITATION)].map((m) => `${m[1]} ${m[3]}`);
}

describe("citations", () => {
  it("finds a corpus to check, so an empty one cannot pass", () => {
    const corpus = citationCorpus();
    expect(corpus.length).toBeGreaterThan(50);
    expect(corpus.flatMap(tokensIn).length).toBeGreaterThan(80);
  });

  it("registers every citation, as verified or as explicitly unverifiable", () => {
    const known = new Set([
      ...Object.keys(REGISTRY.verified),
      ...Object.keys(REGISTRY.noDoi),
      // The registry keys these by surname and year; a few sources name a model or a report
      // rather than an author, and those are listed under a stable stand-in.
      "NASA 0",
    ]);
    const missing = new Set<string>();
    for (const source of citationCorpus()) {
      for (const token of tokensIn(source)) {
        if (!known.has(token)) missing.add(`${token}  (in: ${source.slice(0, 70)})`);
      }
    }
    expect(
      [...missing],
      "these citations are shown to users and are in no registry, so nothing records "
        + "whether anyone has checked them",
    ).toEqual([]);
  });

  it("does not claim to have verified something the panel never cites", () => {
    const cited = new Set(citationCorpus().flatMap(tokensIn));
    const stale = Object.keys(REGISTRY.verified).filter((key) => !cited.has(key));
    expect(stale, "the registry verifies citations that no longer appear anywhere").toEqual([]);
  });

  it("gives every unverified citation a reason rather than a shrug", () => {
    for (const [key, reason] of Object.entries(REGISTRY.noDoi)) {
      expect(reason.length, `${key} has no explanation for why it is unverified`).toBeGreaterThan(20);
    }
  });

  it("registers a plausible DOI for everything it claims to have verified", () => {
    for (const [key, doi] of Object.entries(REGISTRY.verified)) {
      expect(doi, `${key} has a malformed DOI`).toMatch(/^10\.\d{4,9}\/\S+$/);
    }
  });
});
