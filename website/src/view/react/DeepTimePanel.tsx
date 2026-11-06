"use client";

import { useEffect, useMemo, useState } from "react";
import { useViewport } from "./ViewportContext";
import {
  DEEP_TIME_EVENTS, MAIN_SEQUENCE_END_GYR, RED_GIANT_TIP_GYR, SOLAR_AGE_NOW_GYR,
  bodyFateAt, engulfedAt, habitableZoneAt, orbitalPeriodAt, runawayGreenhouseCrossing,
  semiMajorAxisAt, solarStateAt,
} from "@solar/engine/deep-time";
import { BODY_CONTRACTS, type BodyId } from "@solar/engine/bodies/registry";
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
/** The widest the slice shows, in au. Past this a body is drawn pinned to the right edge. */
const SLICE_AU = 3;

function SolarSlice({ ageGyr }: { ageGyr: number }) {
  const sun = solarStateAt(ageGyr);
  const zone = habitableZoneAt(ageGyr);
  const photosphereAu = (696_340_000 * sun.radius) / AU_IN_METRES;

  const width = 620;
  const height = 92;
  const x = (au: number) => Math.min(au, SLICE_AU) / SLICE_AU * width;
  const axis = height - 26;

  const zoneLeft = x(zone.innerAu);
  const zoneRight = x(zone.outerAu);

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="w-full" role="img"
      aria-label="The inner solar system to scale at this age">
      {/* The habitable zone, behind everything, clipped at the edge of the slice. */}
      {zone.innerAu < SLICE_AU ? (
        <rect x={zoneLeft} y={axis - 20} width={Math.max(2, zoneRight - zoneLeft)} height={40}
          fill="rgb(16 185 129 / 0.16)" />
      ) : null}

      <line x1={0} y1={axis} x2={width} y2={axis} stroke="rgb(255 255 255 / 0.15)" />

      {/* The Sun, drawn at its real radius on the same scale as the orbits. */}
      <rect x={0} y={axis - 14} width={Math.max(3, x(photosphereAu))} height={28} rx={3}
        fill="rgb(251 191 36 / 0.85)" />

      {INNER.map((id) => {
        const au = semiMajorAxisAt(id, ageGyr);
        const gone = engulfedAt(id, ageGyr);
        const at = x(au);
        return (
          <g key={id}>
            <circle cx={at} cy={axis} r={4}
              fill={gone ? "rgb(244 63 94 / 0.55)" : "rgb(228 228 231)"} />
            <text x={at} y={axis - 20} textAnchor="middle" fontSize={9}
              fill={gone ? "rgb(253 164 175)" : "rgb(161 161 170)"}>
              {BODY_CONTRACTS[id].displayName}
            </text>
            <text x={at} y={axis + 26} textAnchor="middle" fontSize={8} fill="rgb(113 113 122)">
              {au.toFixed(2)}
            </text>
          </g>
        );
      })}

      <text x={width} y={12} textAnchor="end" fontSize={9} fill="rgb(113 113 122)">
        {zone.innerAu >= SLICE_AU
          ? `habitable zone now ${zone.innerAu.toFixed(0)} to ${zone.outerAu.toFixed(0)} au, off this scale`
          : `0 to ${SLICE_AU} au`}
      </text>
    </svg>
  );
}

export function DeepTimePanel({ onClose }: { onClose: () => void }) {
  const [ageGyr, setAgeGyr] = useState(SOLAR_AGE_NOW_GYR);
  const viewport = useViewport();

  /**
   * The scene behind this panel is drawn at the chosen age for as long as it is open.
   *
   * Cleared on the way out rather than left set, so closing the panel puts the solar system
   * back where it is rather than leaving it stranded in the year ten billion.
   */
  useEffect(() => {
    viewport.setDeepTime(ageGyr);
    return () => viewport.setDeepTime(null);
  }, [viewport, ageGyr]);

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
    // Anchored left and not a full-screen modal, because the scene behind it is now the
    // other half of the panel: the Sun swells, the orbits widen and planets vanish as the
    // slider moves, and a dialog over the middle of the screen would hide exactly that.
    <div className="pointer-events-none absolute inset-0 z-20 flex items-start p-4">
      <div className="pointer-events-auto max-h-full w-[28rem] max-w-[calc(100vw-2rem)] overflow-y-auto rounded-xl border border-white/10 bg-black/85 p-5 backdrop-blur-md">
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

        {/*
          A slice of the inner solar system, to scale, at this age.

          A horizontal slice rather than concentric rings, because the thing to watch is a
          distance changing and rings hide that: every orbit expands by the same factor under
          mass loss, so on rings the picture merely zooms, while on a ruler you can see the
          Sun's edge cross each planet in turn.

          Three au wide and fixed. That holds the photosphere at its largest, 1.19 au, and Mars
          at 2.28, which is the whole of the action. The habitable zone runs to 85 au by then
          and simply leaves, which is said in words rather than squeezed onto the scale.
        */}
        <div className="mt-6">
          <SolarSlice ageGyr={ageGyr} />
        </div>

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
            const fate = bodyFateAt(id, ageGyr);
            const label = {
              engulfed: "inside the Sun",
              "habitable-zone": "in the habitable zone",
              "too-hot": "too hot, inside the zone's inner edge",
              "too-cold": "too cold, beyond the outer edge",
            }[fate];
            return (
              <div key={id} className="flex items-center justify-between rounded-md bg-white/5 px-2.5 py-1.5 text-[12px]">
                <span className="text-zinc-300">{BODY_CONTRACTS[id].displayName}</span>
                <span className="flex items-center gap-3">
                  <span className="text-zinc-600 tabular-nums">
                    {semiMajorAxisAt(id, ageGyr).toFixed(2)} au &middot;{" "}
                    {orbitalPeriodAt(id, ageGyr).toFixed(2)} yr
                  </span>
                  <span className={fate === "engulfed" ? "text-rose-300" : fate === "habitable-zone" ? "text-emerald-300" : "text-zinc-500"}>
                    {label}
                  </span>
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
