import { describe, expect, it } from "vitest";
import {
  clampToSupported, epochFromIsoUtc, epochFromUnixTimestamp, ephemerisStandingAt,
  SUPPORTED_YEARS, unixSecondsFromEpoch,
} from "./when";
import { jdTdb, julianYearForModelSelection } from "./time";

describe("a unix timestamp into an epoch", () => {
  /**
   * The Unix epoch's Julian date is a published constant, 2440587.5, and that is what makes
   * this a real check rather than a round trip through my own arithmetic.
   */
  it("puts the Unix epoch at JD 2440587.5, within the TDB offset", () => {
    const epoch = epochFromUnixTimestamp(0);
    // TDB minus UTC in 1970 is under a minute, so a day is far too coarse to hide an error.
    expect(epoch).toBeCloseTo(2_440_587.5, 3);
  });

  it("reads seconds and milliseconds as the same instant", () => {
    const seconds = 1_700_000_000;
    expect(epochFromUnixTimestamp(seconds)).toBeCloseTo(
      epochFromUnixTimestamp(seconds * 1000),
      9,
    );
  });

  it("round-trips a timestamp through the epoch and back", () => {
    for (const seconds of [0, 1, 1_000_000_000, 1_700_000_000, -1_000_000_000]) {
      expect(unixSecondsFromEpoch(epochFromUnixTimestamp(seconds))).toBeCloseTo(seconds, 3);
    }
  });

  it("agrees with the ISO form of the same instant", () => {
    // 2024-04-08, the North American total solar eclipse.
    const iso = epochFromIsoUtc("2024-04-08T18:17:00Z");
    expect(iso).not.toBeNull();
    expect(epochFromUnixTimestamp(Date.parse("2024-04-08T18:17:00Z") / 1000)).toBeCloseTo(
      iso!,
      9,
    );
  });

  it("rejects something that is not a date rather than inventing one", () => {
    expect(epochFromIsoUtc("the day before yesterday")).toBeNull();
  });
});

describe("how much to trust the answer at that date", () => {
  const at = (year: number) => jdTdb(2_451_545.0 + (year - 2000) * 365.25);

  it.each([1800, 1969, 2000, 2026, 2050])("calls %s the short-span table", (year) => {
    const standing = ephemerisStandingAt(at(year));
    expect(standing.model).toBe("short-span");
    expect(standing.inside).toBe(true);
  });

  it.each([-3000, -44, 1066, 1799, 2051, 2999])("calls %s the long-span table", (year) => {
    const standing = ephemerisStandingAt(at(year));
    expect(standing.model).toBe("long-span");
    expect(standing.inside).toBe(true);
  });

  it.each([-5000, 4000, 9999])("admits %s is outside anything fitted", (year) => {
    const standing = ephemerisStandingAt(at(year));
    expect(standing.inside).toBe(false);
    expect(standing.note).toContain("not where they were");
  });

  it("never returns a note a client cannot print", () => {
    for (const year of [-4000, -3000, 1500, 2026, 2500, 3500]) {
      expect(ephemerisStandingAt(at(year)).note.length).toBeGreaterThan(40);
    }
  });
});

describe("clamping to what the tables cover", () => {
  it("leaves a date inside the range alone", () => {
    const epoch = jdTdb(2_451_545.0);
    expect(clampToSupported(epoch)).toBe(epoch);
  });

  it.each([-99_999, 99_999])("pulls year %s back inside", (year) => {
    const clamped = clampToSupported(jdTdb(2_451_545.0 + (year - 2000) * 365.25));
    const resulting = julianYearForModelSelection(clamped);
    expect(resulting).toBeGreaterThanOrEqual(SUPPORTED_YEARS.from);
    expect(resulting).toBeLessThanOrEqual(SUPPORTED_YEARS.to);
  });
});
