"use client";

import { useState } from "react";
import { BODY_CONTRACTS, BODY_IDS, type BodyId } from "@solar/engine/bodies/registry";
import { DEFAULT_LAUNCH, type AsteroidLaunch } from "@solar/engine/scenarios/asteroid";
import { AU_IN_METRES } from "@solar/engine/units";
import { jdUtcFromEpochMs, tdbFromUtc } from "@solar/engine/time";
import type { ImpactConsequences } from "@solar/engine/scenarios/impact";
import type { useAsteroid } from "./useAsteroid";
import { useViewport } from "./ViewportContext";

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
/**
 * What happens where it lands.
 *
 * Collins, Melosh & Marcus 2005, by way of `@solar/engine/scenarios/impact`. The caveats are
 * shown rather than hidden: these are empirical fits over a finite range and the model says
 * when it has been pushed outside it.
 */
function ConsequenceReadout({ consequences }: { consequences: ImpactConsequences }) {
  const km = (metres: number) => `${(metres / 1000).toFixed(metres < 10_000 ? 2 : 0)} km`;
  return (
    <div className="mt-2.5 space-y-1.5 border-t border-red-500/20 pt-2.5">
      <p className="text-[11px] leading-relaxed text-red-100">
        {consequences.airburst
          ? `It never reaches the ground. The atmosphere breaks it up and it detonates `
            + `${km(consequences.burstAltitudeM ?? 0)} up.`
          : consequences.craterDiameterM
            ? `It leaves a crater ${km(consequences.craterDiameterM)} across and `
              + `${km(consequences.craterDepthM ?? 0)} deep.`
            : "It leaves no crater."}
      </p>
      <p className="text-[11px] leading-relaxed text-red-200/70">
        For scale, {consequences.comparison}.
        {consequences.seismicMagnitude !== null
          ? ` The shaking registers magnitude ${consequences.seismicMagnitude.toFixed(1)}.`
          : ""}
      </p>
      {consequences.blast.length > 0 ? (
        <dl className="grid grid-cols-2 gap-x-3 gap-y-0.5 pt-0.5">
          {consequences.blast.map((band) => (
            <div key={band.effect} className="contents">
              <dt className="truncate text-[10px] text-red-200/60">{band.effect}</dt>
              <dd className="text-right font-mono text-[10px] text-red-100">{km(band.radiusM)}</dd>
            </div>
          ))}
        </dl>
      ) : null}
      {consequences.caveats.map((caveat) => (
        <p key={caveat} className="text-[10px] leading-relaxed text-zinc-500">
          {caveat}
        </p>
      ))}
    </div>
  );
}

export function AsteroidPanel({ asteroid }: { asteroid: ReturnType<typeof useAsteroid> }) {
  const viewport = useViewport();
  const [open, setOpen] = useState(false);
  const [launch, setLaunch] = useState<AsteroidLaunch>(DEFAULT_LAUNCH);
  const [target, setTarget] = useState<BodyId | "">("");
  const [aimed, setAimed] = useState<Awaited<ReturnType<typeof asteroid.solve>>>(null);
  const [solving, setSolving] = useState(false);
  const { run } = asteroid;

  /**
   * Search for a transfer, then write it into the sliders.
   *
   * The sliders stay live afterwards on purpose: nudging a solved aim and watching the miss
   * grow is the most instructive thing in the tool, and locking them would hide it.
   */
  const set = <K extends keyof AsteroidLaunch>(key: K, value: AsteroidLaunch[K]) =>
    setLaunch((previous) => ({ ...previous, [key]: value }));

  const aim = async () => {
    if (!target) return;
    setSolving(true);
    const epoch = tdbFromUtc(jdUtcFromEpochMs(Date.now()));
    const solved = await asteroid.solve(launch.originBody, target, epoch, launch.altitudeM);
    setSolving(false);
    setAimed(solved);
    if (!solved) return;
    setLaunch((previous) => ({
      ...previous,
      startEpoch: solved.departEpoch,
      /**
       * Kept exact, and rounded only where it is displayed.
       *
       * Rounding the solution into the sliders looked like tidiness and threw the aim away.
       * The controls step in whole degrees, and one degree of heading at 2.8 km/s over a
       * nine-month transfer moves the arrival by 640,000 km: a hundred Earth radii, from a
       * change too small to see on the slider. Correcting to within a planet's radius and
       * then rounding the answer is the most expensive kind of tidying up.
       *
       * The slider shows a rounded value and still reads exactly until someone drags it, at
       * which point a whole degree is what they asked for.
       */
      speedMS: solved.departureDeltaVMS,
      headingDeg: solved.headingDeg,
      inclinationDeg: solved.inclinationDeg,
      durationYears: Math.max(1, Math.ceil((solved.flightDays / 365.25) * 1.3)),
    }));
  };

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

      {/*
        Aiming, which is what makes the tool worth having.

        Before this the controls were a heading in degrees and a speed in metres per second,
        and nothing ever hit anything: a planet's target volume is a few parts in a billion of
        the sky and nobody finds it by dragging a slider. Solving Lambert for the release
        velocity turns the question round into the one people actually have.
      */}
      <div className="mt-3 rounded-lg border border-orange-400/20 bg-orange-400/5 p-2.5">
        <span className="text-[11px] text-zinc-400">Aim it at</span>
        <div className="mt-1 flex gap-1.5">
          <select
            value={target}
            onChange={(e) => setTarget(e.target.value as BodyId | "")}
            className="min-w-0 flex-1 rounded-md border border-white/10 bg-zinc-900 px-2 py-1 text-xs text-zinc-100"
          >
            <option value="">nothing, I will aim by hand</option>
            {BODY_IDS.filter((id) => id !== launch.originBody && BODY_CONTRACTS[id].kind !== "moon").map((id) => (
              <option key={id} value={id}>
                {BODY_CONTRACTS[id].displayName}
              </option>
            ))}
          </select>
          <button
            type="button"
            disabled={!target || solving}
            onClick={() => aim()}
            className="shrink-0 rounded-md bg-orange-400 px-2.5 py-1 text-xs font-medium text-black transition hover:bg-orange-300 disabled:opacity-40"
          >
            {solving ? "Solving…" : "Solve"}
          </button>
        </div>
        {aimed ? (
          <p className="mt-1.5 text-[10px] leading-relaxed text-orange-200/80">
            Leave {BODY_CONTRACTS[launch.originBody].displayName} at{" "}
            {(aimed.departureDeltaVMS / 1000).toFixed(2)} km/s on heading{" "}
            {aimed.headingDeg.toFixed(0)}°, {aimed.inclinationDeg.toFixed(0)}° out of
            plane. Arrives in {aimed.flightDays.toFixed(0)} days at{" "}
            {(aimed.arrivalSpeedMS / 1000).toFixed(2)} km/s relative, passing within{" "}
            {(aimed.missM / 1000).toFixed(0)} km of the centre.
          </p>
        ) : null}
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
          format={(v) => `${v.toFixed(0)}°`}
          onChange={(v) => set("headingDeg", v)}
        />
        <Slider
          label="Out of plane"
          value={launch.inclinationDeg}
          min={-60}
          max={60}
          step={1}
          format={(v) => `${v.toFixed(0)}°`}
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
          onClick={() => {
            /**
             * Go to the body it leaves from.
             *
             * Launching used to leave the camera wherever it already was, so the most
             * interesting moment in the feature, the rock departing a planet you can see,
             * happened off screen unless you were already pointed at the right place.
             */
            viewport.setFocus(launch.originBody);
            /**
             * Depart on the date that was solved for, if one was.
             *
             * This always overwrote the start epoch with the current time, which quietly
             * threw away the whole answer: an aim is a departure date as much as it is a
             * direction, and leaving on the wrong day sends a perfectly solved trajectory to
             * where the target used to be going to be. With no aim, now is the right default.
             */
            asteroid.launch({
              ...launch,
              startEpoch: aimed ? launch.startEpoch : tdbFromUtc(jdUtcFromEpochMs(Date.now())),
            });
          }}
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
                Arrival speed {(run.response.impact.speedMS / 1000).toFixed(1)} km/s relative to
                the body it struck, mass {run.response.impact.massKg.toExponential(2)} kg.
              </p>

              {/*
                What the energy actually does, which is the part that was missing.

                Megatons is a fact about the kinetic energy and says almost nothing about the
                event: the same rock is a crater on the Moon and an airburst on Earth, and
                only gravity and the atmosphere decide which.
              */}
              {run.response.consequences ? (
                <ConsequenceReadout consequences={run.response.consequences} />
              ) : null}
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
