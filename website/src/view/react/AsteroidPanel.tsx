"use client";

import { useState } from "react";
import { BODY_CONTRACTS, BODY_IDS, type BodyId } from "@solar/engine/bodies/registry";
import { DEFAULT_LAUNCH, type AsteroidLaunch } from "@solar/engine/scenarios/asteroid";
import { AU_IN_METRES } from "@solar/engine/units";
import { jdUtcFromEpochMs, tdbFromUtc } from "@solar/engine/time";
import type { useAsteroid } from "./useAsteroid";

const LAUNCHABLE: readonly BodyId[] = BODY_IDS.filter((id) => id !== "sun" && id !== "moon");

function Slider({
  label,
  value,
  min,
  max,
  step,
  format,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  format: (v: number) => string;
  onChange: (v: number) => void;
}) {
  return (
    <label className="block">
      <span className="flex items-baseline justify-between text-[11px] text-zinc-400">
        {label}
        <span className="tabular-nums text-zinc-200">{format(value)}</span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="mt-1 w-full accent-orange-400"
      />
    </label>
  );
}

/**
 * Fire an asteroid and find out where it ends up.
 *
 * Every number shown here comes from the propagator, which is gated against four orbits that
 * must close, energy conservation over 200 orbits, and three real impacts spanning eight
 * orders of magnitude. Nothing on this panel is estimated in the UI layer.
 */
export function AsteroidPanel({ asteroid }: { asteroid: ReturnType<typeof useAsteroid> }) {
  const [open, setOpen] = useState(false);
  const [launch, setLaunch] = useState<AsteroidLaunch>(DEFAULT_LAUNCH);
  const { run } = asteroid;

  const set = <K extends keyof AsteroidLaunch>(key: K, value: AsteroidLaunch[K]) =>
    setLaunch((previous) => ({ ...previous, [key]: value }));

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="pointer-events-auto absolute bottom-24 left-4 rounded-xl border border-orange-400/30 bg-black/70 px-3.5 py-2 text-xs font-medium text-orange-300 backdrop-blur-md transition hover:bg-orange-400/10"
      >
        Launch an asteroid
      </button>
    );
  }

  return (
    <aside className="pointer-events-auto absolute bottom-24 left-4 w-80 max-w-[calc(100vw-2rem)] rounded-xl border border-white/10 bg-black/80 p-4 backdrop-blur-md">
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-sm font-semibold text-zinc-50">Asteroid</h2>
          <p className="mt-0.5 text-[11px] text-zinc-500">
            Propagated under the Sun and every planet
          </p>
        </div>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="rounded-md px-2 py-0.5 text-xs text-zinc-400 transition hover:bg-white/10"
        >
          Close
        </button>
      </div>

      <div className="mt-3 space-y-2.5">
        <label className="block">
          <span className="text-[11px] text-zinc-400">Released near</span>
          <select
            value={launch.originBody}
            onChange={(e) => set("originBody", e.target.value as BodyId)}
            className="mt-1 w-full rounded-md border border-white/10 bg-zinc-900 px-2 py-1 text-xs text-zinc-100"
          >
            {LAUNCHABLE.map((id) => (
              <option key={id} value={id}>
                {BODY_CONTRACTS[id].displayName}
              </option>
            ))}
          </select>
        </label>

        <Slider
          label="Speed relative to that body"
          value={launch.speedMS}
          min={0}
          max={30_000}
          step={100}
          format={(v) => `${(v / 1000).toFixed(1)} km/s`}
          onChange={(v) => set("speedMS", v)}
        />
        <Slider
          label="Heading in the orbital plane"
          value={launch.headingDeg}
          min={0}
          max={359}
          step={1}
          format={(v) => `${v}°`}
          onChange={(v) => set("headingDeg", v)}
        />
        <Slider
          label="Out of plane"
          value={launch.inclinationDeg}
          min={-60}
          max={60}
          step={1}
          format={(v) => `${v}°`}
          onChange={(v) => set("inclinationDeg", v)}
        />
        <Slider
          label="Diameter"
          value={launch.diameterM}
          min={10}
          max={10_000}
          step={10}
          format={(v) => (v >= 1000 ? `${(v / 1000).toFixed(1)} km` : `${v} m`)}
          onChange={(v) => set("diameterM", v)}
        />
        <Slider
          label="Simulate for"
          value={launch.durationYears}
          min={5}
          max={200}
          step={5}
          format={(v) => `${v} years`}
          onChange={(v) => set("durationYears", v)}
        />
      </div>

      <div className="mt-3 flex gap-2">
        <button
          type="button"
          disabled={run.status === "running"}
          onClick={() =>
            asteroid.launch({ ...launch, startEpoch: tdbFromUtc(jdUtcFromEpochMs(Date.now())) })
          }
          className="flex-1 rounded-md bg-orange-400 px-3 py-1.5 text-xs font-medium text-black transition hover:bg-orange-300 disabled:opacity-50"
        >
          {run.status === "running" ? "Propagating…" : "Launch"}
        </button>
        <button
          type="button"
          onClick={asteroid.clear}
          className="rounded-md border border-white/10 px-3 py-1.5 text-xs text-zinc-300 transition hover:bg-white/10"
        >
          Clear
        </button>
      </div>

      {run.error ? (
        <p className="mt-3 text-[11px] text-red-400">{run.error}</p>
      ) : null}

      {run.response ? (
        <div className="mt-3 border-t border-white/10 pt-3">
          <p className="text-[12px] leading-relaxed text-zinc-100">{run.response.summary}</p>

          <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[11px] tabular-nums">
            <dt className="text-zinc-500">Final eccentricity</dt>
            <dd className="text-zinc-300">{run.response.finalEccentricity.toFixed(4)}</dd>
            {run.response.finalSemiMajorAxisAu !== null ? (
              <>
                <dt className="text-zinc-500">Semi-major axis</dt>
                <dd className="text-zinc-300">
                  {run.response.finalSemiMajorAxisAu.toFixed(3)} au
                </dd>
              </>
            ) : null}
            <dt className="text-zinc-500">Integrator steps</dt>
            <dd className="text-zinc-300">
              {run.response.steps.toLocaleString()} in {run.response.elapsedMs.toFixed(0)} ms
            </dd>
          </dl>

          {run.response.impact ? (
            <div className="mt-2 rounded-lg border border-red-500/25 bg-red-500/5 p-2.5">
              <p className="text-[11px] font-medium uppercase tracking-wide text-red-300/80">
                Impact energy
              </p>
              <p className="mt-1 text-[13px] font-semibold text-red-100">
                {run.response.impact.energyMegatonsTnt < 1
                  ? `${(run.response.impact.energyMegatonsTnt * 1000).toFixed(0)} kilotons TNT`
                  : `${run.response.impact.energyMegatonsTnt.toLocaleString(undefined, { maximumFractionDigits: 0 })} megatons TNT`}
              </p>
              <p className="mt-1 text-[11px] leading-relaxed text-red-200/70">
                For scale, {run.response.impact.comparison}. Arrival speed{" "}
                {(run.response.impact.speedMS / 1000).toFixed(1)} km/s, mass{" "}
                {run.response.impact.massKg.toExponential(2)} kg.
              </p>
            </div>
          ) : null}

          {run.response.closeApproaches.length > 0 ? (
            <div className="mt-2">
              <p className="text-[11px] text-zinc-500">Closest approaches</p>
              <ul className="mt-1 space-y-0.5 text-[11px] tabular-nums text-zinc-400">
                {[...run.response.closeApproaches]
                  .sort((a, b) => a.distanceM - b.distanceM)
                  .slice(0, 4)
                  .map((approach) => (
                    <li key={approach.body}>
                      {BODY_CONTRACTS[approach.body as BodyId]?.displayName ?? approach.body}:{" "}
                      {approach.distanceM < 1e9
                        ? `${(approach.distanceM / 1000).toLocaleString(undefined, { maximumFractionDigits: 0 })} km`
                        : `${(approach.distanceM / AU_IN_METRES).toFixed(4)} au`}
                    </li>
                  ))}
              </ul>
            </div>
          ) : null}

          <p className="mt-2 text-[10px] leading-relaxed text-zinc-600">
            Perturbing planet positions come from the Standish tables, whose own error reaches
            about 20 arcseconds for Earth. That is roughly 14,000 km at one astronomical unit, so
            this answers hit, escape or stay with confidence and does not claim a flyby distance
            to the kilometre.
          </p>
        </div>
      ) : null}
    </aside>
  );
}
