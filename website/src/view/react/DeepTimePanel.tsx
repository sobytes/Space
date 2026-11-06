"use client";

import { useEffect, useMemo, useState } from "react";
import {
  DEEP_TIME_EVENTS, MAIN_SEQUENCE_END_GYR, RED_GIANT_TIP_GYR, SOLAR_AGE_NOW_GYR,
  engulfedAt, habitableZoneAt, insideHabitableZoneAt, runawayGreenhouseCrossing, solarStateAt,
} from "@solar/engine/deep-time";
import { BODY_CONTRACTS, type BodyId } from "@solar/engine/bodies/registry";
import { heliocentricDistanceM } from "@solar/engine/habitability";
import { AU_IN_METRES } from "@solar/engine/units";

/** The four that the Sun's evolution actually decides the fate of. */
const INNER: readonly BodyId[] = ["mercury", "venus", "embary", "mars"];

const PHASE_LABEL: Record<string, string> = {
  "main-sequence": "Main sequence",
  subgiant: "Subgiant",
  "red-giant": "Red giant",
  "helium-burning": "Burning helium",
  "white-dwarf": "White dwarf",
};

function formatAge(ageGyr: number): string {
  const fromNow = ageGyr - SOLAR_AGE_NOW_GYR;
  if (Math.abs(fromNow) < 0.005) return "today";
  const magnitude = Math.abs(fromNow);
  const amount = magnitude < 1 ? `${(magnitude * 1000).toFixed(0)} million` : `${magnitude.toFixed(2)} billion`;
  return fromNow < 0 ? `${amount} years ago` : `in ${amount} years`;
}

/**
 * The Sun's life, and what it does to everything orbiting it.
 *
 * A separate mode because it is a separate scale. The rest of this app runs on element tables
 * fitted for a few thousand years either side of now, where a planet's position means
 * something; here positions are irrelevant and the star is the variable. Driving this from the
 * ordinary clock would mean extrapolating those tables ten billion years, which is the one
 * thing `when.ts` refuses to do quietly.
 *
 * The point it exists to make is that the Sun is not a fixed lamp. It has brightened by about
 * forty per cent since Earth formed and has not stopped, so the habitable zone is sweeping
 * outwards, and Earth's deadline is set by that rather than by anything Earth does.
 */
export function DeepTimePanel({ onClose }: { onClose: () => void }) {
  const [ageGyr, setAgeGyr] = useState(SOLAR_AGE_NOW_GYR);

  useEffect(() => {
    const escape = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", escape);
    return () => window.removeEventListener("keydown", escape);
  }, [onClose]);

  const sun = useMemo(() => solarStateAt(ageGyr), [ageGyr]);
  const zone = useMemo(() => habitableZoneAt(ageGyr), [ageGyr]);

  /** The most recent event at or before this age, which is what the slider is "in". */
  const current = useMemo(() => {
    let found = DEEP_TIME_EVENTS[0];
    for (const event of DEEP_TIME_EVENTS) if (event.ageGyr <= ageGyr + 1e-9) found = event;
    return found;
  }, [ageGyr]);

  return (
    <div className="pointer-events-auto absolute inset-0 z-20 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
      <div className="max-h-full w-[42rem] max-w-full overflow-y-auto rounded-xl border border-white/10 bg-black/90 p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold text-zinc-50">Deep time</h2>
            <p className="mt-1 text-sm text-amber-200/90">
              The Sun is not a fixed lamp. It shone at 71% of today&apos;s brightness when Earth
              formed and has risen ever since, so the habitable zone has been sweeping outwards
              for four and a half billion years.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 rounded-md border border-white/10 px-2.5 py-1 text-xs text-zinc-300 hover:bg-white/10"
          >
            Close
          </button>
        </div>

        <label className="mt-5 block">
          <span className="flex items-baseline justify-between text-xs text-zinc-400">
            <span>Age of the Sun</span>
            <span className="font-mono tabular-nums text-zinc-200">
              {ageGyr.toFixed(2)} billion years &middot; {formatAge(ageGyr)}
            </span>
          </span>
          <input
            type="range"
            min={0}
            max={13}
            step={0.01}
            value={ageGyr}
            onChange={(event) => setAgeGyr(Number(event.target.value))}
            className="mt-2 w-full accent-amber-400"
          />
          {/* The two moments that matter, marked where they fall on the track. */}
          <span className="relative mt-1 block h-4 text-[10px] text-zinc-500">
            {[
              { at: SOLAR_AGE_NOW_GYR, text: "now" },
              { at: MAIN_SEQUENCE_END_GYR, text: "main sequence ends" },
              { at: RED_GIANT_TIP_GYR, text: "giant" },
            ].map(({ at, text }) => (
              <span
                key={text}
                className="absolute -translate-x-1/2 whitespace-nowrap"
                style={{ left: `${(at / 13) * 100}%` }}
              >
                {text}
              </span>
            ))}
          </span>
        </label>

        <dl className="mt-6 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-[13px] tabular-nums">
          <dt className="text-zinc-500">The Sun</dt>
          <dd className="text-zinc-200">
            {PHASE_LABEL[sun.phase] ?? sun.phase}
            <span className="text-zinc-500">
              {" "}&middot;{" "}
              {sun.confidence === "modelled"
                ? "modelled"
                : sun.confidence === "interpolated"
                  ? "interpolated between published points"
                  : "end state, the phases before it are not modelled"}
            </span>
          </dd>
          <dt className="text-zinc-500">Brightness</dt>
          <dd className="text-zinc-200">
            {sun.luminosity < 10 ? `${(sun.luminosity * 100).toFixed(0)}%` : `${Math.round(sun.luminosity).toLocaleString()}x`}
            <span className="text-zinc-500"> of today&apos;s</span>
          </dd>
          <dt className="text-zinc-500">Size</dt>
          <dd className="text-zinc-200">
            {sun.radius < 10 ? `${sun.radius.toFixed(2)}x` : `${Math.round(sun.radius)}x`}
            <span className="text-zinc-500"> today&apos;s radius, {Math.round(sun.effectiveTemperatureK).toLocaleString()} K surface</span>
          </dd>
          <dt className="text-zinc-500">Habitable zone</dt>
          <dd className="text-zinc-200">
            {zone.innerAu.toFixed(2)} to {zone.outerAu.toFixed(2)} au
          </dd>
        </dl>

        <div className="mt-5 space-y-1.5">
          {INNER.map((id) => {
            const au = heliocentricDistanceM(id) / AU_IN_METRES;
            const gone = engulfedAt(id, ageGyr);
            const inside = insideHabitableZoneAt(id, ageGyr);
            return (
              <div key={id} className="flex items-center justify-between rounded-md bg-white/5 px-2.5 py-1.5 text-[12px]">
                <span className="text-zinc-300">{BODY_CONTRACTS[id].displayName}</span>
                <span className={gone ? "text-rose-300" : inside ? "text-emerald-300" : "text-zinc-500"}>
                  {gone
                    ? "inside the Sun"
                    : inside
                      ? "in the habitable zone"
                      : au < zone.innerAu
                        ? "too hot, inside the zone's inner edge"
                        : "too cold, beyond the outer edge"}
                </span>
              </div>
            );
          })}
        </div>

        <div className="mt-5 rounded-lg border border-white/10 bg-white/5 p-3">
          <h3 className="text-sm font-medium text-zinc-100">{current.title}</h3>
          <p className="mt-1 text-[12px] leading-relaxed text-zinc-400">{current.detail}</p>
          <p className="mt-1.5 text-[11px] text-zinc-600">{current.source}</p>
        </div>

        {/*
          Earth's own deadline, which is the number this panel exists for: the oceans are lost
          about a billion years from now, and the Sun has five billion years of main sequence
          left after that. Nothing Earth does causes it.
        */}
        {(() => {
          const crossing = runawayGreenhouseCrossing("embary");
          if (crossing.kind !== "crosses") return null;
          return (
            <p className="mt-4 text-[12px] leading-relaxed text-rose-200/80">
              Earth leaves the habitable zone in about{" "}
              {crossing.fromNowGyr < 1
                ? `${(crossing.fromNowGyr * 1000).toFixed(0)} million`
                : `${crossing.fromNowGyr.toFixed(1)} billion`}{" "}
              years, and the Sun stays on the main sequence for{" "}
              {(MAIN_SEQUENCE_END_GYR - SOLAR_AGE_NOW_GYR).toFixed(1)} billion years after
              that. The oceans go first and the red giant is not what takes them.
            </p>
          );
        })()}
      </div>
    </div>
  );
}
