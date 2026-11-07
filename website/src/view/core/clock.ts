/**
 * The simulation clock, as a pure reducer plus a mutable cursor.
 *
 * React must never see the live epoch. It changes sixty times a second, and r3f's own docs are
 * explicit that calling setState inside the frame loop re-renders the whole tree at that rate.
 * So the live value lives here, the frame loop advances it by calling `tick`, and the UI
 * subscribes to a separate display value published at a human-readable rate.
 *
 * Time can run backwards and can run absurdly fast. A rate of 1e9 means one real second covers
 * about 32 years. That works because nothing here integrates: `heliocentricPosition` is a pure
 * function of an instant, so the clock can jump anywhere without a propagator's step limit
 * having an opinion about it.
 */

import { jdTdb, tdbFromUtc, jdUtcFromEpochMs, type JdTdb } from "@solar/engine/time";

export { RATE_PRESETS, type ClockRate } from "@solar/engine/rates";

export type ClockCommand =
  | { readonly kind: "pause" }
  | { readonly kind: "resume" }
  | { readonly kind: "togglePause" }
  | { readonly kind: "setRate"; readonly secondsPerSecond: number }
  | { readonly kind: "scrubTo"; readonly epoch: JdTdb }
  | { readonly kind: "resetToNow" };

export interface ClockState {
  readonly epoch: JdTdb;
  /** Simulated seconds per real second. Negative runs time backwards. */
  readonly secondsPerSecond: number;
  readonly running: boolean;
}

const SECONDS_PER_DAY = 86_400;

export function nowEpoch(): JdTdb {
  return tdbFromUtc(jdUtcFromEpochMs(Date.now()));
}

export function initialClock(): ClockState {
  // Real time, so the first thing anyone sees is the solar system as it is right now, moving
  // at the speed it actually moves. Starting at a day per second made Earth spin once a second
  // and read as a bug rather than as a fast clock.
  return { epoch: nowEpoch(), secondsPerSecond: 1, running: true };
}

export function reduceClock(state: ClockState, command: ClockCommand): ClockState {
  switch (command.kind) {
    case "pause":
      return { ...state, running: false };
    case "resume":
      return { ...state, running: true };
    case "togglePause":
      return { ...state, running: !state.running };
    case "setRate":
      return { ...state, secondsPerSecond: command.secondsPerSecond };
    case "scrubTo":
      return { ...state, epoch: command.epoch };
    case "resetToNow":
      return { ...state, epoch: nowEpoch() };
  }
}

/**
 * A paused tick returns the state unchanged, so a paused frame is a genuine no-op.
 *
 * Unbounded, and the HUD says so once the element tables stop covering the date.
 *
 * It did halt at 3000 AD, because past the fitted range the planets are drawn by extrapolating
 * a polynomial outside its fit: still smooth, still confident, and not where anything was. A
 * clock that stops is one way to be honest about that. Being told is another, and it is the
 * better one here, because a simulation that refuses to show you the far future teaches less
 * than one that shows you and says how much to trust it.
 *
 * Safe to run, which was measured rather than assumed: every body's position stays finite and
 * bounded out to year 50,000 in both directions, and every local clock and sub-solar point
 * with it. That matters because a NaN reaching the iOS client is not a wrong number, it is a
 * trap and a crash, which this project has already had once.
 */
export function tickClock(state: ClockState, realDeltaSeconds: number): ClockState {
  if (!state.running || realDeltaSeconds === 0) return state;
  const days = (realDeltaSeconds * state.secondsPerSecond) / SECONDS_PER_DAY;
  return { ...state, epoch: jdTdb(state.epoch + days) };
}
