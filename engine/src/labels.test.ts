import { describe, expect, it } from "vitest";
import { placeLabels, type LabelInput } from "./labels";

const VIEWPORT = { viewportWidthPx: 400, viewportHeightPx: 800 };

function input(partial: Partial<LabelInput> & { id: LabelInput["id"] }): LabelInput {
  return {
    ndcX: 0,
    ndcY: 0,
    radiusPx: 4,
    distance: 1e9,
    behindCamera: false,
    relevance: "other",
    ...partial,
  };
}

describe("placing labels", () => {
  it("puts an on-screen label beside its body, not on top of it", () => {
    const [label] = placeLabels([input({ id: "mars", radiusPx: 30 })], VIEWPORT);
    expect(label.clamped).toBe(false);
    expect(label.bearingRadians).toBeNull();
    // Offset from the centre of a 400x800 viewport, clear of a 30 pixel disc.
    expect(Math.hypot(label.x - 200, label.y - 400)).toBeGreaterThan(20);
  });

  /**
   * The case the feature exists for.
   *
   * Focused on Earth at six radii, the Moon is sixty radii away and off screen entirely. The
   * sphere cannot help, the marker cannot help, and dropping the label leaves the viewer with
   * nothing. Clamping it to the edge nearest the Moon, with a bearing, turns "it is missing"
   * into "it is that way".
   */
  it("clamps an off-screen body to the edge it lies beyond, with a bearing", () => {
    const [label] = placeLabels(
      [input({ id: "moon", ndcX: 4, ndcY: 0, relevance: "satellite-of-focus" })],
      VIEWPORT,
    );
    expect(label.clamped).toBe(true);
    expect(label.x).toBeGreaterThan(300);
    expect(label.y).toBeCloseTo(400, 0);
    // Due right in screen space, where y runs downwards.
    expect(label.bearingRadians).toBeCloseTo(0, 6);
  });

  /**
   * Clamping along the line of sight, not per axis.
   *
   * Clamping each axis independently drags a label into a corner and leaves it pointing at
   * nothing. A body up and to the right by unequal amounts must stay on that diagonal.
   */
  it("keeps a clamped label on the line towards the body", () => {
    const [label] = placeLabels(
      [input({ id: "io", ndcX: 6, ndcY: 3, relevance: "satellite-of-focus" })],
      VIEWPORT,
    );
    /**
     * The expected bearing is in pixels, not in normalised device coordinates, and on a tall
     * viewport those are not the same direction.
     *
     * The body sits at +6, +3 in NDC, twice as far right as up. The viewport is 400 by 800,
     * so that becomes 1200 pixels right and 1200 up: equal, because the vertical axis is
     * twice as long. What a viewer follows is the pixel direction, so that is what the
     * pointer has to match, and asserting the NDC ratio here would have demanded the wrong
     * answer on every phone-shaped screen.
     */
    const dx = label.x - 200;
    const dy = label.y - 400;
    expect(dx / -dy).toBeCloseTo(1, 2);

    // Square viewport, where the two conventions agree and the 2:1 is visible directly.
    const [square] = placeLabels(
      [input({ id: "io", ndcX: 6, ndcY: 3, relevance: "satellite-of-focus" })],
      { viewportWidthPx: 800, viewportHeightPx: 800 },
    );
    expect((square.x - 400) / -(square.y - 400)).toBeCloseTo(2, 2);
  });

  /**
   * A body behind the camera projects to a mirrored point.
   *
   * The perspective divide by a negative depth flips it through the origin, so something
   * directly behind appears dead ahead. The pointer must send you the way you would turn.
   */
  it("points backwards for a body behind the camera", () => {
    const [label] = placeLabels(
      [input({ id: "moon", ndcX: 0.5, ndcY: 0, behindCamera: true, relevance: "satellite-of-focus" })],
      VIEWPORT,
    );
    expect(label.clamped).toBe(true);
    expect(label.x).toBeLessThan(200);
  });

  it("labels the focus and its satellites but not everything else off screen", () => {
    const placed = placeLabels(
      [
        input({ id: "embary", relevance: "focus" }),
        input({ id: "moon", ndcX: 3, relevance: "satellite-of-focus", distance: 2e9 }),
        input({ id: "neptune", ndcX: 9, relevance: "other", distance: 3e9 }),
      ],
      VIEWPORT,
    );
    const ids = placed.map((p) => p.id);
    expect(ids).toContain("embary");
    expect(ids).toContain("moon");
    expect(ids).not.toContain("neptune");
  });

  /**
   * Overlapping labels identify nothing, which is the failure mode of labelling everything.
   *
   * The nearer body wins, because that is the one in front on screen.
   */
  it("thins labels that would sit on top of each other, keeping the nearest", () => {
    const placed = placeLabels(
      [
        input({ id: "io", distance: 1e9 }),
        input({ id: "europa", distance: 2e9 }),
        input({ id: "ganymede", distance: 3e9 }),
      ],
      VIEWPORT,
    );
    expect(placed).toHaveLength(1);
    expect(placed[0].id).toBe("io");
  });

  /**
   * A planet beats its own moon for the label.
   *
   * From the system view a moon sits at its planet's position to within a pixel, so the two
   * always collide and the tie-break decides which name appears. On distance alone the moon
   * frequently won, and the solar system came out labelled Callisto, Iapetus and Oberon with
   * Jupiter, Saturn and Uranus unnamed: correct about where things are, useless as a map.
   *
   * The moon is deliberately given the nearer distance here, so the test fails if the
   * ordering falls back to distance.
   */
  it("labels the planet rather than its moon when they coincide", () => {
    const placed = placeLabels(
      [
        input({ id: "callisto", distance: 1e9 }),
        input({ id: "jupiter", distance: 2e9 }),
      ],
      VIEWPORT,
    );
    expect(placed.map((p) => p.id)).toEqual(["jupiter"]);
  });

  it("still prefers the focused body and its satellites over any planet", () => {
    const placed = placeLabels(
      [
        input({ id: "jupiter", distance: 1e9 }),
        input({ id: "embary", relevance: "focus", distance: 9e9 }),
      ],
      VIEWPORT,
    );
    expect(placed.map((p) => p.id)).toEqual(["embary"]);
  });

  it("keeps every label inside the viewport", () => {
    const placed = placeLabels(
      [
        input({ id: "moon", ndcX: 50, ndcY: 50, relevance: "satellite-of-focus" }),
        input({ id: "phobos", ndcX: -50, ndcY: -50, relevance: "satellite-of-focus", distance: 2e9 }),
      ],
      VIEWPORT,
    );
    expect(placed.length).toBeGreaterThan(0);
    for (const label of placed) {
      expect(label.x).toBeGreaterThanOrEqual(0);
      expect(label.x).toBeLessThanOrEqual(400);
      expect(label.y).toBeGreaterThanOrEqual(0);
      expect(label.y).toBeLessThanOrEqual(800);
    }
  });

  it("caps how many it draws", () => {
    const many = Array.from({ length: 40 }, (_, i) =>
      input({
        id: "mars",
        ndcX: (i % 8) / 4 - 1,
        ndcY: Math.floor(i / 8) / 4 - 1,
        distance: i * 1e8,
      }),
    );
    expect(placeLabels(many, { ...VIEWPORT, maximumLabels: 5 }).length).toBeLessThanOrEqual(5);
  });
});
