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

import { jdTdb, tdbFromUtc, jdUtcFromEpochMs, type JdTdb } from "@/engine/time";

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
  return { epoch: nowEpoch(), secondsPerSecond: 86_400, running: true };
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

/** A paused tick returns the state unchanged, so a paused frame is a genuine no-op. */
export function tickClock(state: ClockState, realDeltaSeconds: number): ClockState {
  if (!state.running || realDeltaSeconds === 0) return state;
  const days = (realDeltaSeconds * state.secondsPerSecond) / SECONDS_PER_DAY;
  return { ...state, epoch: jdTdb(state.epoch + days) };
}

/** Preset rates the UI offers, from real time up to a century a second. */
export const RATE_PRESETS: readonly { readonly label: string; readonly secondsPerSecond: number }[] = [
  { label: "real time", secondsPerSecond: 1 },
  { label: "1 min/s", secondsPerSecond: 60 },
  { label: "1 hour/s", secondsPerSecond: 3_600 },
  { label: "1 day/s", secondsPerSecond: 86_400 },
  { label: "1 week/s", secondsPerSecond: 604_800 },
  { label: "1 month/s", secondsPerSecond: 2_629_800 },
  { label: "1 year/s", secondsPerSecond: 31_557_600 },
  { label: "10 years/s", secondsPerSecond: 315_576_000 },
  { label: "1 century/s", secondsPerSecond: 3_155_760_000 },
];
