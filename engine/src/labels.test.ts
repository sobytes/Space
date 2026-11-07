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
    // The plate width is given here rather than taken from the default, so the arithmetic
    // below says where the edge should land instead of restating a constant.
    const [label] = placeLabels(
      [input({ id: "moon", ndcX: 4, ndcY: 0, relevance: "satellite-of-focus" })],
      { ...VIEWPORT, detailWidthPx: 124 },
    );
    expect(label.clamped).toBe(true);
    expect(label.y).toBeCloseTo(400, 0);
    // Due right in screen space, where y runs downwards.
    expect(label.bearingRadians).toBeCloseTo(0, 6);
    /**
     * As far right as a plate that size can go, which is not as far as the anchor used to go.
     *
     * The anchor was held 44 points from the edge and the plate drawn centred on it, so a
     * two-line pointer 124 points wide hung 18 points off the screen and its date was sliced
     * down the middle. Jupiter's pointer in the system view was doing exactly that. The plate
     * is what has to stay inside, so its right edge lands on the inset and its centre sits
     * half a plate further in.
     */
    expect(label.detail).toBe(true);
    expect(label.x + 124 / 2).toBeCloseTo(400 - 44, 6);
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


  /**
   * The system view, as reported: "the labels are still nowhere near the planets, look at Mars".
   *
   * Four inner planets inside a hundred points of the Sun, with Jupiter and Neptune off
   * screen. Every label is the same width as a date, and a single circular keep-out radius
   * around the anchor meant the Sun's label suppressed Mercury, Venus and Earth outright and
   * took Mars with it on most frames. What was left on screen was three edge pointers aimed
   * at bodies that were not on it, which is exactly the sentence the report used.
   *
   * Everything visible gets named. That is the whole requirement.
   */
  it("names every visible planet in a crowded system view", () => {
    /**
     * The Sun is the focus in the system view, which makes every planet a satellite of it.
     * That is what puts the off-screen giants on the screen as edge pointers at all, and it
     * is why the on-screen tie-break has to exist: without it Jupiter's pointer and Mars's
     * label are the same rank, and whichever is nearer the camera takes the space.
     */
    const place = (id: LabelInput["id"], ndcX: number, ndcY: number, extra?: Partial<LabelInput>) =>
      input({ id, ndcX, ndcY, radiusPx: 4, relevance: "satellite-of-focus", ...extra });
    const placed = placeLabels(
      [
        place("sun", 0.0, -0.05, { relevance: "focus", radiusPx: 20 }),
        place("mercury", -0.05, 0.03, { distance: 1e11 }),
        place("venus", 0.12, 0.01, { distance: 2e11 }),
        place("embary", 0.3, 0.05, { distance: 3e11 }),
        place("mars", -0.23, 0.1, { distance: 4e11 }),
        place("jupiter", -1.42, 0.17, { distance: 8e11 }),
        place("neptune", 4.0, 0.1, { distance: 4e12 }),
      ],
      VIEWPORT,
    );
    const ids = placed.map((p) => p.id);
    for (const visible of ["sun", "mercury", "venus", "embary", "mars"]) {
      expect(ids).toContain(visible);
    }
  });

  /**
   * A label loses its second line before it loses its place.
   *
   * The second line is the body's own date, three times the width of its name, and five of
   * them will not fit across the inner system at any arrangement. Dropping the line keeps the
   * name, and a name is what says which planet that is.
   */
  it("drops the detail line rather than the label when space runs out", () => {
    const placed = placeLabels(
      [
        input({ id: "sun", ndcX: 0, ndcY: 0, relevance: "focus", radiusPx: 20 }),
        input({ id: "mercury", ndcX: -0.06, ndcY: 0.02, distance: 1e11 }),
        input({ id: "venus", ndcX: 0.1, ndcY: 0.0, distance: 2e11 }),
      ],
      VIEWPORT,
    );
    expect(placed).toHaveLength(3);
    expect(placed.some((p) => !p.detail)).toBe(true);
  });

  /**
   * Plates, not anchors.
   *
   * Two labels 70 points apart passed the old separation test and still overlapped, because
   * the test was a circle around a point and the thing drawn is a box several times wider
   * than it is tall. Overlapping dates on neighbouring planets read as the time belonging to
   * the wrong one, which is what was reported about the system view.
   */
  it("never overlaps two plates", () => {
    const placed = placeLabels(
      [
        input({ id: "sun", ndcX: 0, ndcY: 0, relevance: "focus", radiusPx: 20 }),
        input({ id: "mercury", ndcX: -0.04, ndcY: 0.02, distance: 1e11 }),
        input({ id: "venus", ndcX: 0.1, ndcY: 0.0, distance: 2e11 }),
        input({ id: "embary", ndcX: 0.26, ndcY: 0.04, distance: 3e11 }),
        input({ id: "mars", ndcX: -0.2, ndcY: 0.08, distance: 4e11 }),
      ],
      VIEWPORT,
    );
    for (let i = 0; i < placed.length; i += 1) {
      for (let j = i + 1; j < placed.length; j += 1) {
        const a = placed[i];
        const b = placed[j];
        const heightA = a.detail ? 36 : 21;
        const heightB = b.detail ? 36 : 21;
        const apart = Math.abs(a.x - b.x) * 2 >= 36 || Math.abs(a.y - b.y) * 2 >= heightA + heightB;
        expect(apart).toBe(true);
      }
    }
  });

  /**
   * The plate stays on the screen, all of it.
   *
   * A clamped pointer used to put its anchor on the inset and let the plate hang off the
   * side, so the two-line pointer for Jupiter in the system view had its date cut in half by
   * the left edge of the phone.
   */
  it("keeps the whole plate inside the viewport, not just its anchor", () => {
    const placed = placeLabels(
      [
        input({ id: "moon", ndcX: 9, ndcY: 0.4, relevance: "satellite-of-focus" }),
        input({ id: "jupiter", ndcX: -9, ndcY: -0.4, relevance: "satellite-of-focus", distance: 2e9 }),
      ],
      VIEWPORT,
    );
    expect(placed).toHaveLength(2);
    for (const label of placed) {
      const halfWidth = (label.detail ? 124 : 60) / 2;
      expect(label.x - halfWidth).toBeGreaterThanOrEqual(0);
      expect(label.x + halfWidth).toBeLessThanOrEqual(400);
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
