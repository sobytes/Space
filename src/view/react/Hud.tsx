"use client";

import { useMemo } from "react";
import { BODY_CONTRACTS, BODY_IDS } from "@/engine/bodies/registry";
import { obliquityToOrbitDeg, rotationPeriodDays } from "@/engine/rotation";
import { ACCURACY } from "@/engine/data/ephemeris-accuracy";
import { SHORT_SPAN } from "@/engine/data/planets";
import { epochMsFromJdUtc, utcFromTdb, type JdTdb } from "@/engine/time";
import { AU_IN_METRES, SPEED_OF_LIGHT_M_S } from "@/engine/units";
import { heliocentricPositionOf } from "@/engine/bodies/position";
import { length, sub } from "@/engine/vec";
import { RATE_PRESETS } from "../core/clock";
import type { ViewportSnapshot } from "../core/viewport";
import { useViewport, useViewportValue } from "./ViewportContext";

/** Hoisted so `useSyncExternalStore` is not handed a new selector identity every render. */
const selectEpoch = (s: ViewportSnapshot) => s.epoch;
const selectRate = (s: ViewportSnapshot) => s.secondsPerSecond;
const selectRunning = (s: ViewportSnapshot) => s.running;
const selectFocus = (s: ViewportSnapshot) => s.focus;
const selectAltitude = (s: ViewportSnapshot) => s.distanceToFocus;

function formatEpoch(epoch: JdTdb): string {
  const ms = epochMsFromJdUtc(utcFromTdb(epoch));
  if (!Number.isFinite(ms)) return "out of range";
  return new Date(ms).toISOString().replace("T", " ").slice(0, 19) + " UTC";
}

function formatDistance(metres: number): string {
  if (metres < 1_000) return `${metres.toFixed(0)} m`;
  if (metres < 1e9) return `${(metres / 1000).toLocaleString(undefined, { maximumFractionDigits: 0 })} km`;
  return `${(metres / AU_IN_METRES).toFixed(3)} au`;
}

function formatLightTime(metres: number): string {
  const seconds = metres / SPEED_OF_LIGHT_M_S;
  if (seconds < 60) return `${seconds.toFixed(1)} s`;
  if (seconds < 3_600) return `${Math.floor(seconds / 60)} m ${(seconds % 60).toFixed(0)} s`;
  return `${Math.floor(seconds / 3_600)} h ${Math.floor((seconds % 3_600) / 60)} m`;
}

function formatRate(secondsPerSecond: number): string {
  const match = RATE_PRESETS.find((p) => p.secondsPerSecond === Math.abs(secondsPerSecond));
  const label = match ? match.label : `${Math.abs(secondsPerSecond).toExponential(1)} s/s`;
  return secondsPerSecond < 0 ? `${label}, reversed` : label;
}

/** Every number on screen carries where it came from. That is the point of the panel. */
function Provenance({ children }: { children: React.ReactNode }) {
  return <p className="mt-2 text-[11px] leading-relaxed text-zinc-500">{children}</p>;
}

/**
 * Surface relief comes from an elevation model with a finite sample spacing, so there is an
 * altitude below which the screen out-resolves the data and the ground goes smooth. Saying so
 * is better than letting someone conclude the Moon is flat.
 */
const SURFACE_DATA = {
  moon: {
    metresPerSample: 474,
    smoothBelowKm: 1_000,
    source: "LRO LOLA at 64 pixels per degree",
    finer: "the 8.49 GB LOLA 118 m model",
  },
} as const;

function BodyPanel({ epoch }: { epoch: JdTdb }) {
  const focus = useViewportValue(selectFocus);
  const altitudeM = useViewportValue(selectAltitude);
  const contract = BODY_CONTRACTS[focus];

  const derived = useMemo(() => {
    const self = heliocentricPositionOf(focus, epoch);
    const earth = heliocentricPositionOf("embary", epoch);
    return {
      fromSun: length(self),
      fromEarth: length(sub(self, earth)),
      obliquity: obliquityToOrbitDeg(focus, epoch),
      rotationDays: rotationPeriodDays(focus),
    };
  }, [focus, epoch]);

  const accuracy =
    contract.ephemeris.kind === "standish-elements"
      ? {
          arcsec:
            SHORT_SPAN.quotedError[contract.ephemeris.planet].longitude *
            ACCURACY[contract.ephemeris.planet].rmsFactor,
          widened: ACCURACY[contract.ephemeris.planet].rmsFactor > 1,
        }
      : null;

  return (
    <aside className="pointer-events-auto w-[22rem] max-w-[calc(100vw-2rem)] rounded-xl border border-white/10 bg-black/70 p-4 backdrop-blur-md">
      <h2 className="text-lg font-semibold tracking-tight text-zinc-50">{contract.displayName}</h2>
      <p className="mt-1 text-sm leading-snug text-amber-200/90">{contract.education.oneLine}</p>

      <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-[13px] tabular-nums">
        <dt className="text-zinc-500">From the Sun</dt>
        <dd className="text-zinc-200">{formatDistance(derived.fromSun)}</dd>
        <dt className="text-zinc-500">From Earth</dt>
        <dd className="text-zinc-200">
          {formatDistance(derived.fromEarth)}{" "}
          <span className="text-zinc-500">({formatLightTime(derived.fromEarth)} of light)</span>
        </dd>
        <dt className="text-zinc-500">Equatorial radius</dt>
        <dd className="text-zinc-200">{(contract.equatorialRadiusM / 1000).toLocaleString()} km</dd>
        <dt className="text-zinc-500">Rotation</dt>
        <dd className="text-zinc-200">
          {Math.abs(derived.rotationDays) < 1
            ? `${(Math.abs(derived.rotationDays) * 24).toFixed(2)} h`
            : `${Math.abs(derived.rotationDays).toFixed(4)} d`}
          {derived.rotationDays < 0 ? <span className="text-sky-300"> retrograde</span> : null}
        </dd>
        <dt className="text-zinc-500">Axial tilt</dt>
        <dd className="text-zinc-200">{derived.obliquity.toFixed(2)}&deg;</dd>
        <dt className="text-zinc-500">Mean temperature</dt>
        <dd className="text-zinc-200">
          {contract.meanTemperatureK} K{" "}
          <span className="text-zinc-500">({(contract.meanTemperatureK - 273.15).toFixed(0)} &deg;C)</span>
        </dd>
        {contract.confirmedMoons > 0 ? (
          <>
            <dt className="text-zinc-500">Confirmed moons</dt>
            <dd className="text-zinc-200">{contract.confirmedMoons}</dd>
          </>
        ) : null}
        {contract.atmosphere ? (
          <>
            <dt className="text-zinc-500">Atmosphere</dt>
            <dd className="text-zinc-200">
              {Object.entries(contract.atmosphere.composition)
                .map(([gas, fraction]) => `${gas} ${(fraction * 100).toFixed(1)}%`)
                .join(", ")}
            </dd>
          </>
        ) : null}
      </dl>

      <p className="mt-4 text-[13px] leading-relaxed text-zinc-300">{contract.education.whyItMatters}</p>

      <ul className="mt-3 space-y-1.5 text-[12px] leading-relaxed text-zinc-400">
        {contract.education.facts.map((fact) => (
          <li key={fact} className="before:mr-2 before:text-zinc-600 before:content-['—']">
            {fact}
          </li>
        ))}
      </ul>

      {contract.knownDiscrepancies.length > 0 ? (
        <div className="mt-4 rounded-lg border border-amber-500/20 bg-amber-500/5 p-3">
          <p className="text-[11px] font-medium uppercase tracking-wide text-amber-300/80">
            Sources disagree
          </p>
          {contract.knownDiscrepancies.map((d) => (
            <div key={d.field} className="mt-1.5 text-[11px] leading-relaxed text-amber-100/70">
              <p>{d.summary}</p>
              <p className="mt-1 text-amber-200/60">Using: {d.preferred}</p>
            </div>
          ))}
        </div>
      ) : null}

      {focus in SURFACE_DATA && altitudeM < SURFACE_DATA.moon.smoothBelowKm * 1000 ? (
        <p className="mt-3 rounded-lg border border-sky-500/20 bg-sky-500/5 p-2.5 text-[11px] leading-relaxed text-sky-200/70">
          Below about {SURFACE_DATA.moon.smoothBelowKm.toLocaleString()} km the screen resolves
          finer than the elevation data, so the ground smooths out. That is{" "}
          {SURFACE_DATA.moon.source} running out at {SURFACE_DATA.moon.metresPerSample} m per
          sample, not a flat Moon. Craters read best between about 1,000 and 5,000 km. Closer
          detail would need {SURFACE_DATA.moon.finer}.
        </p>
      ) : null}

      <Provenance>
        Position computed from the JPL Standish element tables, rotation from the IAU WGCCRE
        report.
        {accuracy
          ? ` Heliocentric longitude is good to about ${accuracy.arcsec.toFixed(0)} arcseconds${accuracy.widened ? ", wider than JPL's nominal for this body and declared in the source" : ""}.`
          : " Moon position is from mean elements, good to roughly a degree, not an eclipse-grade theory."}
      </Provenance>
    </aside>
  );
}

function TimeBar() {
  const viewport = useViewport();
  const epoch = useViewportValue(selectEpoch);
  const rate = useViewportValue(selectRate);
  const running = useViewportValue(selectRunning);

  const presetIndex = Math.max(
    0,
    RATE_PRESETS.findIndex((p) => p.secondsPerSecond === Math.abs(rate)),
  );

  return (
    <div className="pointer-events-auto flex flex-wrap items-center gap-3 rounded-xl border border-white/10 bg-black/70 px-4 py-3 backdrop-blur-md">
      <time className="font-mono text-sm tabular-nums text-zinc-100">{formatEpoch(epoch)}</time>

      <div className="flex items-center gap-1.5">
        <button
          type="button"
          onClick={() => viewport.send({ kind: "togglePause" })}
          className="rounded-md border border-white/10 px-2.5 py-1 text-xs text-zinc-200 transition hover:bg-white/10"
        >
          {running ? "Pause" : "Play"}
        </button>
        <button
          type="button"
          onClick={() => viewport.send({ kind: "setRate", secondsPerSecond: -rate })}
          className="rounded-md border border-white/10 px-2.5 py-1 text-xs text-zinc-200 transition hover:bg-white/10"
        >
          Reverse
        </button>
        <button
          type="button"
          onClick={() => viewport.send({ kind: "resetToNow" })}
          className="rounded-md border border-white/10 px-2.5 py-1 text-xs text-zinc-200 transition hover:bg-white/10"
        >
          Now
        </button>
      </div>

      <label className="flex items-center gap-2 text-xs text-zinc-400">
        <input
          type="range"
          min={0}
          max={RATE_PRESETS.length - 1}
          step={1}
          value={presetIndex}
          onChange={(event) =>
            viewport.send({
              kind: "setRate",
              secondsPerSecond:
                Math.sign(rate || 1) * RATE_PRESETS[Number(event.target.value)].secondsPerSecond,
            })
          }
          className="w-40 accent-amber-400"
        />
        <span className="w-28 tabular-nums text-zinc-300">{formatRate(rate)}</span>
      </label>
    </div>
  );
}

function BodyList() {
  const viewport = useViewport();
  const focus = useViewportValue(selectFocus);

  return (
    <nav className="pointer-events-auto flex flex-wrap gap-1.5 rounded-xl border border-white/10 bg-black/70 px-3 py-2 backdrop-blur-md">
      {BODY_IDS.map((id) => (
        <button
          key={id}
          type="button"
          aria-current={focus === id}
          onClick={() => viewport.setFocus(id)}
          className={`rounded-md px-2.5 py-1 text-xs transition ${
            focus === id
              ? "bg-amber-400/90 font-medium text-black"
              : "text-zinc-300 hover:bg-white/10"
          }`}
        >
          {BODY_CONTRACTS[id].displayName}
        </button>
      ))}
    </nav>
  );
}

export function Hud() {
  const epoch = useViewportValue(selectEpoch);

  return (
    <div className="pointer-events-none absolute inset-0 flex flex-col justify-between p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <BodyList />
        <BodyPanel epoch={epoch} />
      </div>
      <div className="flex justify-center">
        <TimeBar />
      </div>
    </div>
  );
}
