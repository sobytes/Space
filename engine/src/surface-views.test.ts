import { describe, expect, it } from "vitest";
import { surfaceViewFor, worldsPhotographedFromTheirSurface } from "./surface-views";
import { SURFACE_IMAGERY } from "./data/surface-imagery";
import { BODY_IDS } from "./bodies/registry";

/**
 * The surface photographs, and the promise that they are photographs.
 *
 * The feature's one constraint is that nothing is generated. `scripts/verify-imagery.mjs`
 * enforces that against NASA itself and needs the network; this is the offline half, which
 * makes sure every image is traceable enough to be checked at all. An entry with no mission,
 * no instrument and no date cannot be verified by anyone, which is the state a plausible
 * fake would be in.
 */
describe("surface photographs", () => {
  it("gives every curated image a mission, an instrument, a date and a credit", () => {
    for (const [body, entry] of Object.entries(SURFACE_IMAGERY)) {
      for (const image of entry?.images ?? []) {
        expect(image.mission.length, `${body}/${image.nasaId} has no mission`).toBeGreaterThan(3);
        expect(image.instrument.length, `${body}/${image.nasaId} has no instrument`).toBeGreaterThan(3);
        expect(image.captured, `${body}/${image.nasaId} has no capture date`).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        expect(image.credit.length, `${body}/${image.nasaId} has no credit`).toBeGreaterThan(10);
        expect(
          image.whatYouAreSeeing.length,
          `${body}/${image.nasaId} does not say what it shows`,
        ).toBeGreaterThan(60);
      }
    }
  });

  /**
   * Served over https, from NASA, with a resolved filename.
   *
   * The size suffix is not predictable per asset: some have `~large`, some only `~orig`, and
   * guessing returns 403. Baking the resolved URL is what makes the images load, so a URL
   * that has drifted back to a guessable-looking pattern is worth catching.
   */
  it("points every image at a resolved NASA asset over https", () => {
    for (const entry of Object.values(SURFACE_IMAGERY)) {
      for (const image of entry?.images ?? []) {
        expect(image.url, image.nasaId).toMatch(/^https:\/\/images-assets\.nasa\.gov\/image\//);
        expect(image.url, image.nasaId).toContain(image.nasaId);
      }
    }
  });

  /**
   * Five worlds, and the list is the fact.
   *
   * Earth, the Moon, Mars, Venus and Titan are the only surfaces ever photographed from the
   * ground, in seventy years of spaceflight. If this number ever grows, something remarkable
   * has happened and the test should be updated deliberately rather than drift.
   */
  it("claims only the worlds that have actually been photographed from their surface", () => {
    expect(worldsPhotographedFromTheirSurface().sort()).toEqual(
      ["embary", "mars", "moon", "titan", "venus"].sort(),
    );
  });

  /**
   * Venus must not contradict itself.
   *
   * It has been photographed from its surface four times and none of those images can be
   * shown here, which are different facts. The first version collapsed them: zero images fell
   * through to the generic absence statement, which announced that nothing had ever
   * photographed Venus from the ground, directly above a caveat explaining that Venera did.
   */
  it("separates whether a world was photographed from whether we can show it", () => {
    const venus = surfaceViewFor("venus");
    expect(venus.images).toHaveLength(0);
    expect(venus.statement).not.toMatch(/nothing has ever photographed/i);
    expect(venus.caveat).toMatch(/Venera/);
  });

  /**
   * An image this project will not host must still be reachable.
   *
   * Venus is the only case, and dropping it silently would have been the easy option. NASA's
   * own archive heads that section "the following images were provided to NSSDCA by what is
   * now the Russian Space Agency and are not necessarily in the public domain", so linking is
   * the most this project can honestly do, and doing less would hide four of the five
   * surfaces humanity has photographed.
   */
  it("links out where it will not host, rather than dropping the world", () => {
    const venus = surfaceViewFor("venus");
    expect(venus.images).toHaveLength(0);
    expect(venus.seeAlso?.url, "Venus has no link to the images it declines to host")
      .toMatch(/^https:\/\/nssdc\.gsfc\.nasa\.gov\//);
    expect(venus.caveat).toMatch(/not necessarily in the public domain/);
  });

  it("explains the absence for every body with no photographs", () => {
    for (const id of BODY_IDS) {
      const view = surfaceViewFor(id);
      if (view.images.length > 0) continue;
      expect(view.statement.length, `${id} has no explanation for having no photographs`)
        .toBeGreaterThan(80);
    }
  });

  it("says a gas giant has no surface rather than that nobody has visited", () => {
    expect(surfaceViewFor("jupiter").statement).toMatch(/no surface/i);
    expect(surfaceViewFor("sun").statement).toMatch(/no surface/i);
    expect(surfaceViewFor("europa").statement).toMatch(/nothing has ever landed/i);
  });
});
