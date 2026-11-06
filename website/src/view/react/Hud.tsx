"use client";

import { useEffect, useMemo, useState } from "react";
import { markIntervalFor } from "@solar/engine/orbit-time";
import { formatDuration, timeHeadline, timeSense } from "@solar/engine/time-sense";
import { BODY_CONTRACTS, BODY_IDS, satelliteSystemRadiusM, type BodyId } from "@solar/engine/bodies/registry";
import { obliquityToOrbitDeg, rotationPeriodDays } from "@solar/engine/rotation";
import { ACCURACY } from "@solar/engine/data/ephemeris-accuracy";
import { SHORT_SPAN } from "@solar/engine/data/planets";
import { epochMsFromJdUtc, utcFromTdb, type JdTdb } from "@solar/engine/time";
import { AU_IN_METRES, SPEED_OF_LIGHT_M_S } from "@solar/engine/units";
import { heliocentricPositionOf } from "@solar/engine/bodies/position";
import { length, sub } from "@solar/engine/vec";
import { RATE_PRESETS } from "../core/clock";
import type { ViewportSnapshot } from "../core/viewport";
import { useViewport, useViewportValue } from "./ViewportContext";
import { ALL_MOONS, PLANETARY_SET } from "@solar/engine/nbody-tracker";
import { HabitabilityPanel } from "./HabitabilityPanel";
import { LabelLayer } from "./LabelLayer";
import { SurfacePanel } from "./SurfacePanel";

/** Hoisted so `useSyncExternalStore` is not handed a new selector identity every render. */
const selectEpoch = (s: ViewportSnapshot) => s.epoch;
const selectRate = (s: ViewportSnapshot) => s.secondsPerSecond;
const selectRunning = (s: ViewportSnapshot) => s.running;
const selectFocus = (s: ViewportSnapshot) => s.focus;
const selectAltitude = (s: ViewportSnapshot) => s.distanceToFocus;
const selectGravity = (s: ViewportSnapshot) => s.gravity;

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

/**
 * How long a simulated duration takes in real seconds at the current rate.
 *
 * This exists because "1 day/s" is accurate and still tells you nothing about what you are
 * about to watch. At that rate Earth turns once per real second, which looks wrong until you
 * do the arithmetic, and the first thing anyone concludes is that the rotation is broken
 * rather than that the clock is running at 86,400 times real time. Showing the consequence
 * next to the cause turns a suspected bug into the lesson the number was there to teach.
 */
function formatRealDuration(simulatedSeconds: number): string | null {
  const s = Math.abs(simulatedSeconds);
  // Below a couple of frames there is nothing honest to say about what you are seeing.
  if (s < 0.05) return null;
  if (s < 1) return `${s.toFixed(2)} s`;
  if (s < 90) return `${s.toFixed(1)} s`;
  if (s < 5_400) return `${(s / 60).toFixed(1)} min`;
  if (s < 172_800) return `${(s / 3_600).toFixed(1)} h`;
  if (s < 63_115_200) return `${(s / 86_400).toFixed(1)} days`;
  return `${(s / 31_557_600).toFixed(1)} years`;
}

/**
 * Where to stand relative to the Sun, and how far back to stand.
 *
 * The lighting angles exist because the thing worth seeing on a planet is usually the line
 * between its day and its night, and arriving over the lit face hides it. At 90 degrees the
 * terminator runs straight down the middle of the disc, which is the clearest way to show that
 * half a world is always in darkness. At 180 degrees Earth shows its city lights.
 *
 * "Fit moons" is here because framing a planet against its own radius crops its moons out
 * entirely. Earth's Moon lands over 1,300 pixels above the top of the window at the default
 * distance, which reads as a missing Moon rather than as a camera far too close.
 */
function ViewControls({ focus }: { focus: BodyId }) {
  const viewport = useViewport();
  const systemRadius = satelliteSystemRadiusM(focus);

  // The Sun is the light source, so there is no angle to it and no dark side to swing around to.
  if (focus === "sun") return null;

  const angles: readonly { label: string; degrees: number; title: string }[] = [
    { label: "Day", degrees: 0, title: "Look from the Sun's side. The whole disc is lit." },
    { label: "Terminator", degrees: 90, title: "Half lit, half dark, with the day-night line down the middle." },
    { label: "Night", degrees: 180, title: "Look at the dark side. Earth shows its city lights." },
  ];

  return (
    <div className="mt-3 flex flex-wrap items-center gap-1.5">
      <span className="mr-1 text-[11px] uppercase tracking-wide text-zinc-500">View</span>
      {angles.map(({ label, degrees, title }) => (
        <button
          key={label}
          type="button"
          title={title}
          onClick={() => viewport.requestView({ kind: "sunAngle", degrees })}
          className="rounded-md border border-white/10 px-2 py-0.5 text-[11px] text-zinc-300 transition hover:bg-white/10"
        >
          {label}
        </button>
      ))}
      {systemRadius !== null ? (
        <button
          type="button"
          /**
           * The tooltip carries the number because the view itself is the lesson. Almost every
           * diagram of the Earth and Moon draws them a few diameters apart; the real gap is
           * thirty Earths, which is why the planet shrinks to a few pixels the moment the Moon
           * fits on screen. That emptiness is the thing worth seeing, not a framing problem.
           */
          title={
            `Pull back to ${Math.round(systemRadius / 1000).toLocaleString()} km so the moons fit. ` +
            `That is ${Math.round(systemRadius / (2 * BODY_CONTRACTS[focus].equatorialRadiusM))} ` +
            `${BODY_CONTRACTS[focus].displayName} diameters away, which is why it ends up so small.`
          }
          onClick={() => viewport.requestView({ kind: "frameMoons" })}
          className="rounded-md border border-sky-400/30 px-2 py-0.5 text-[11px] text-sky-200 transition hover:bg-sky-400/10"
        >
          Fit moons
        </button>
      ) : null}
    </div>
  );
}

/** Translates a period into what you will actually watch at the clock's current rate. */
function OnScreen({
  label,
  simulatedSeconds,
  rate,
}: {
  label: string;
  simulatedSeconds: number;
  rate: number;
}) {
  if (rate === 0) return null;
  const real = formatRealDuration(simulatedSeconds / Math.abs(rate));
  return (
    <span className="block text-[11px] text-zinc-500">
      {real === null
        ? `${label} is too fast to see at this speed`
        : `${label} every ${real} on screen at this speed`}
    </span>
  );
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
  const rate = useViewportValue(selectRate);
  const contract = BODY_CONTRACTS[focus];
  // Pure in the body id, so it costs one memo rather than a recompute per published epoch.
  const time = useMemo(() => timeSense(focus), [focus]);

  const derived = useMemo(() => {
    const self = heliocentricPositionOf(focus, epoch);
    const earth = heliocentricPositionOf("embary", epoch);
    // Mean longitude advances 360 degrees in one orbit, and the table gives its rate per
    // century, so the period falls straight out of the element set rather than from a constant.
    const ephemeris = BODY_CONTRACTS[focus].ephemeris;
    const orbitDays =
      ephemeris.kind === "standish-elements"
        ? (360 / SHORT_SPAN.elements[ephemeris.planet].ratePerCentury.meanLongitudeDeg) * 36_525
        : ephemeris.kind === "mean-elements-about-parent"
          ? ephemeris.periodDays
          : null;

    return {
      fromSun: length(self),
      fromEarth: length(sub(self, earth)),
      obliquity: obliquityToOrbitDeg(focus, epoch),
      rotationDays: rotationPeriodDays(focus),
      orbitDays,
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

      <ViewControls focus={focus} />

      <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-[13px] tabular-nums">
        <dt className="text-zinc-500">From the Sun</dt>
        <dd className="text-zinc-200">
          {formatDistance(derived.fromSun)}
          {derived.orbitDays !== null ? (
            <OnScreen
              label="one orbit"
              simulatedSeconds={derived.orbitDays * 86_400}
              rate={rate}
            />
          ) : null}
          {/*
            What the dots on this body's orbit are worth.
            Without this they are decoration: a mark only means something once you can say how
            far apart in time two of them are. The marks are drawn whenever that orbit is on
            screen, which for a moon is while its planet is in view.
          */}
          {derived.orbitDays !== null ? (
            <span className="mt-0.5 block text-[11px] leading-snug text-zinc-500">
              orbit marks every {markIntervalFor(derived.orbitDays).label}, crowding where it
              moves fastest
            </span>
          ) : null}
        </dd>
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
          <OnScreen
            label="one turn"
            simulatedSeconds={Math.abs(derived.rotationDays) * 86_400}
            rate={rate}
          />
        </dd>
        <dt className="text-zinc-500">A day here</dt>
        <dd className="text-zinc-200">
          {formatDuration(time.dayInEarthDays)}
          <span className="text-zinc-500">
            {" "}sunrise to sunrise
            {time.spinsBackwards ? ", Sun rises in the west" : ""}
          </span>
        </dd>
        <dt className="text-zinc-500">A year here</dt>
        <dd className="text-zinc-200">
          {formatDuration(time.yearDays)}
          <span className="text-zinc-500">
            {/*
              Two decimals right up to a thousand, because the fraction is the point: the
              Moon fits 12.37 of its days into a year, not 12, and Venus 1.92 rather than 2.
            */}
            {" "}= {time.solarDaysPerYear < 1000
              ? time.solarDaysPerYear.toFixed(2)
              : Math.round(time.solarDaysPerYear).toLocaleString()} of its own days
          </span>
        </dd>
        {time.synodicMonthDays !== null ? (
          <>
            <dt className="text-zinc-500">A month here</dt>
            <dd className="text-zinc-200">
              {time.monthDays!.toFixed(2)} days round {BODY_CONTRACTS[contract.parent!].displayName}
              <span className="text-zinc-500">
                {" "}&middot; {time.synodicMonthDays.toFixed(2)} full phase to full phase
              </span>
            </dd>
          </>
        ) : null}
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

      {/*
        The one paragraph a child would actually read, and the reason this section exists.
        Asked for after orbit marks turned out to answer a different question: not "where will
        it be in nine days" but how a spin, a month and a year relate to each other. Every
        number in it is computed, none is written into the sentence, and the wording is shared
        with the phone and gated as an exact string.
      */}
      <p className="mt-3 rounded-lg bg-sky-400/5 p-2.5 text-[12px] leading-relaxed text-sky-100/80">
        {timeHeadline(focus)}
      </p>

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
    <nav className="pointer-events-auto flex max-w-[min(62vw,52rem)] flex-wrap gap-1.5 overflow-y-auto rounded-xl border border-white/10 bg-black/70 px-3 py-2 backdrop-blur-md">
      {BODY_IDS.map((id) => (
        <button
          key={id}
          type="button"
          aria-current={focus === id}
          onClick={() => viewport.setFocus(id)}
          // Moons are indented under their planet, so nineteen bodies still read as a system
          // rather than as a flat list.
          className={`rounded-md px-2.5 py-1 text-xs transition ${
            BODY_CONTRACTS[id].kind === "moon" ? "text-[11px] opacity-80" : ""
          } ${
            focus === id
              ? "bg-amber-400/90 font-medium text-black opacity-100"
              : "text-zinc-300 hover:bg-white/10"
          }`}
        >
          {BODY_CONTRACTS[id].kind === "moon" ? "\u21b3 " : ""}
          {BODY_CONTRACTS[id].displayName}
        </button>
      ))}
    </nav>
  );
}


/**
 * The gravity mode switch, and an honest readout of what the chosen mode is doing.
 *
 * Both modes are correct about different things and neither supersedes the other, so this does
 * not present one as an upgrade. On rails the planets come from analytic fits that are accurate
 * over the span they were made for, exactly reversible, and completely deaf to any mass you
 * add. Under mutual gravity every body pulls every other, which is the complete physics and
 * also the one that accumulates error, falls behind a fast clock, and has to restart if you
 * scrub the date far enough. The numbers for all three of those are on screen rather than
 * hidden, because a viewer who cannot tell which mode they are in cannot trust either.
 */
function GravityBar() {
  const viewport = useViewport();
  const gravity = useViewportValue(selectGravity);
  const nbody = gravity.mode === "nbody";
  const [withMoons, setWithMoons] = useState(false);

  /**
   * Including the moons is the same equation over more bodies, and it costs what it costs.
   *
   * A single global step size is set by the fastest thing in the system, and that is Phobos at
   * 7.65 hours. Measured: the eight planets integrate a simulated century in 3.7 seconds, and
   * all 32 bodies take about 950, because the mean step collapses from 4 hours to 66 seconds.
   * That is fine at the rates you would watch moons at and hopeless for a century sweep, so it
   * is a choice with its price written next to it rather than a default or a hidden limit.
   */
  const choose = (moons: boolean) => {
    setWithMoons(moons);
    viewport.setGravityMode("nbody", {
      bodies: moons ? [...PLANETARY_SET, ...ALL_MOONS] : PLANETARY_SET,
    });
  };

  return (
    <div className="pointer-events-auto flex flex-wrap items-center gap-3 rounded-xl border border-white/10 bg-black/70 px-4 py-3 backdrop-blur-md">
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          aria-pressed={!nbody}
          onClick={() => viewport.setGravityMode("analytic")}
          className={`rounded-md border border-white/10 px-2.5 py-1 text-xs transition ${
            nbody ? "text-zinc-300 hover:bg-white/10" : "bg-amber-400/90 font-medium text-black"
          }`}
        >
          On rails
        </button>
        <button
          type="button"
          aria-pressed={nbody}
          onClick={() => choose(withMoons)}
          className={`rounded-md border border-white/10 px-2.5 py-1 text-xs transition ${
            nbody ? "bg-amber-400/90 font-medium text-black" : "text-zinc-300 hover:bg-white/10"
          }`}
        >
          Mutual gravity
        </button>
      </div>

      {nbody ? (
        <label className="flex items-center gap-1.5 text-[11px] text-zinc-400">
          <input
            type="checkbox"
            checked={withMoons}
            onChange={(e) => choose(e.target.checked)}
            className="accent-amber-400"
          />
          Include the 23 moons
          <span className="text-zinc-600">(Phobos sets the step: ~250x slower)</span>
        </label>
      ) : null}

      {nbody ? (
        <dl className="flex items-center gap-x-4 gap-y-0.5 text-[11px] tabular-nums text-zinc-400">
          <div className="flex gap-1.5">
            <dt>Integrated</dt>
            <dd className="text-zinc-200">
              {Math.abs(gravity.integratedDays) < 365
                ? `${gravity.integratedDays.toFixed(0)} d`
                : `${(gravity.integratedDays / 365.25).toFixed(1)} yr`}
            </dd>
          </div>
          <div className="flex gap-1.5">
            <dt>Bodies</dt>
            <dd className="text-zinc-200">{gravity.bodyCount}</dd>
          </div>
          <div className="flex gap-1.5">
            <dt>Energy drift</dt>
            <dd className="text-zinc-200">{gravity.energyDrift.toExponential(1)}</dd>
          </div>
          {Math.abs(gravity.lagDays) > 1 ? (
            <div className="flex gap-1.5">
              <dt className="text-amber-300/80">Behind by</dt>
              <dd className="text-amber-200">{Math.abs(gravity.lagDays).toFixed(0)} d</dd>
            </div>
          ) : null}
        </dl>
      ) : (
        <p className="text-[11px] leading-relaxed text-zinc-500">
          Planets follow the JPL Standish fits. Accurate and reversible, but a mass you add
          cannot move them.
        </p>
      )}
    </div>
  );
}

/**
 * Hides everything but the solar system.
 *
 * The panels are the point of the app right up until you want to look at the planet, at which
 * moment they are covering it. Hiding leaves one small control, because an overlay with no way
 * back is a trap: a viewer who cannot find the UI again has lost the app, not decluttered it.
 *
 * `h` toggles it from the keyboard, and Escape always restores, so there is a second way out
 * that does not depend on finding a button.
 */
function useHiddenOverlay(): [boolean, (hidden: boolean) => void] {
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      // Ignore while typing, or the Ask box loses every h the user types.
      const target = event.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA)$/.test(target.tagName)) return;
      if (event.key === "h" || event.key === "H") setHidden((value) => !value);
      if (event.key === "Escape") setHidden(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return [hidden, setHidden];
}

/**
 * Back out to the whole solar system.
 *
 * Focusing the Sun has always been the system view, and nothing said so: someone asked how to
 * unfocus a planet, which is the only evidence that matters about whether a route is
 * discoverable. "The Sun" stays in the body list because it is also a body with its own data;
 * this is the obvious route to the same place.
 */
function SystemViewButton() {
  const viewport = useViewport();
  const focus = useViewportValue(selectFocus);

  return (
    <button
      type="button"
      aria-label="View the whole solar system"
      title="Back out to the whole solar system"
      onClick={() => viewport.setFocus("sun")}
      className={`rounded-lg border px-2.5 py-1.5 text-xs backdrop-blur-md transition ${
        focus === "sun"
          ? "border-amber-400/40 bg-amber-400/15 text-amber-200"
          : "border-white/10 bg-black/70 text-zinc-400 hover:bg-white/10 hover:text-zinc-100"
      }`}
    >
      Solar system
    </button>
  );
}

export function Hud() {
  const epoch = useViewportValue(selectEpoch);
  const focus = useViewportValue(selectFocus);
  const [hidden, setHidden] = useHiddenOverlay();
  const [habitability, setHabitability] = useState(false);
  /**
   * Labels on by default.
   *
   * Asked for because the Moon could not be found while focused on Earth, which is the
   * off-screen case: there is nothing on screen to look harder at. Defaulting them off would
   * leave that unsolved for anyone who does not go hunting for a toggle, and the people most
   * likely to need a name for something are the least likely to know the control exists.
   */
  const [labels, setLabels] = useState(true);
  const [surface, setSurface] = useState(false);

  if (hidden) {
    return (
      <div className="pointer-events-none absolute inset-0 p-4">
        <LabelLayer visible={labels} />
        <button
          type="button"
          aria-label="Show the information overlay"
          title="Show the overlay (h)"
          onClick={() => setHidden(false)}
          className="pointer-events-auto absolute right-4 top-4 rounded-lg border border-white/10 bg-black/50 px-2.5 py-1.5 text-xs text-zinc-400 backdrop-blur-md transition hover:bg-white/10 hover:text-zinc-100"
        >
          Show panels
        </button>
      </div>
    );
  }

  return (
    <div className="pointer-events-none absolute inset-0 flex flex-col justify-between p-4">
      <LabelLayer visible={labels} />
      <div className="flex items-start justify-between gap-3">
        <BodyList />
        <div className="flex items-start gap-2">
          <BodyPanel epoch={epoch} />
          <div className="pointer-events-auto flex shrink-0 flex-col gap-1.5">
            <SystemViewButton />
            <button
              type="button"
              title={labels ? "Hide the body names" : "Show the body names, including for bodies off screen"}
              onClick={() => setLabels((on) => !on)}
              className={`rounded-lg border px-2.5 py-1.5 text-xs backdrop-blur-md transition ${
                labels
                  ? "border-amber-400/40 bg-amber-400/15 text-amber-200"
                  : "border-white/10 bg-black/70 text-zinc-400 hover:bg-white/10 hover:text-zinc-100"
              }`}
            >
              Labels
            </button>
            {/*
              Offered on the Sun too, where it answers a different and fair question: the Sun
              has no habitability ladder, and saying why in the same place is better than a
              control that silently disappears when the focus changes.
            */}
            <button
              type="button"
              onClick={() => setSurface(true)}
              title="Real photographs taken on the surface, where any exist"
              className="rounded-lg border border-sky-400/30 bg-sky-400/10 px-2.5 py-1.5 text-xs text-sky-200 backdrop-blur-md transition hover:bg-sky-400/20"
            >
              Stand here
            </button>
            <button
              type="button"
              onClick={() => setHabitability(true)}
              title="What would it take to live here?"
              className="rounded-lg border border-emerald-400/30 bg-emerald-400/10 px-2.5 py-1.5 text-xs text-emerald-200 backdrop-blur-md transition hover:bg-emerald-400/20"
            >
              Make it habitable
            </button>
            <button
              type="button"
              aria-label="Hide the information overlay"
              title="Hide the overlay (h)"
              onClick={() => setHidden(true)}
              className="rounded-lg border border-white/10 bg-black/70 px-2.5 py-1.5 text-xs text-zinc-400 backdrop-blur-md transition hover:bg-white/10 hover:text-zinc-100"
            >
              Hide
            </button>
          </div>
        </div>
      </div>
      <div className="flex flex-col items-center gap-2">
        <GravityBar />
        <TimeBar />
      </div>
      {habitability ? (
        <HabitabilityPanel focus={focus} onClose={() => setHabitability(false)} />
      ) : null}
      {surface ? <SurfacePanel focus={focus} onClose={() => setSurface(false)} /> : null}
    </div>
  );
}
