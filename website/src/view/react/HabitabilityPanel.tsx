"use client";

import { useEffect, useMemo } from "react";
import {
  assessHabitability,
  formatQuantity,
  HUMAN_REQUIREMENTS,
  type Assessment,
  type Barrier,
  type Maturity,
  type Quantity,
  type Severity,
  type Step,
} from "@solar/engine/habitability";
import type { BodyId } from "@solar/engine/bodies/contract";

/**
 * What would it take to live here?
 *
 * The panel exists because the question is the one people actually ask about a planet, and
 * because the honest answer is far more interesting than the folklore. Every number shown is
 * computed by `@solar/engine/habitability` from the same contracts that position the body on
 * screen, so the panel cannot drift from the simulation and cannot drift from the iOS one.
 * Nothing here is written into the markup: the prose belongs to the engine's steps and the
 * figures to its quantities.
 */

const SEVERITY: Record<Severity, { label: string; ring: string; text: string; dot: string }> = {
  fatal: { label: "No way round it", ring: "border-rose-500/40 bg-rose-500/5", text: "text-rose-300", dot: "bg-rose-400" },
  severe: { label: "Planetary scale", ring: "border-amber-500/40 bg-amber-500/5", text: "text-amber-300", dot: "bg-amber-400" },
  manageable: { label: "Buildable", ring: "border-sky-500/40 bg-sky-500/5", text: "text-sky-300", dot: "bg-sky-400" },
  none: { label: "Fine as it is", ring: "border-emerald-500/40 bg-emerald-500/5", text: "text-emerald-300", dot: "bg-emerald-400" },
};

const MATURITY: Record<Maturity, { label: string; className: string }> = {
  demonstrated: { label: "Demonstrated", className: "bg-emerald-500/15 text-emerald-300" },
  "engineering-extrapolation": {
    label: "Extrapolated from built hardware",
    className: "bg-sky-500/15 text-sky-300",
  },
  speculative: { label: "Speculative", className: "bg-fuchsia-500/15 text-fuchsia-300" },
};

const STRATEGY_LABEL: Record<Assessment["strategy"], string> = {
  star: "Not a place, a power source",
  home: "Home",
  "greenhouse-terraform": "Warm it and thicken it",
  "shade-and-condense": "Shade it and let it condense",
  aerostat: "Float in it",
  "pressurised-habitat": "Seal a volume and bury it",
  "ice-shell-subsurface": "Go under the ice",
  "cryo-paraterraform": "Warm a world that already has air",
};

/**
 * A comparison against Earth, on a log scale, because the range demands it.
 *
 * These quantities span from 0.14 of Earth's gravity to five million times its radiation.
 * A linear bar makes every value except the largest indistinguishable from zero, which is the
 * opposite of what the comparison is for. Log is the only scale on which "a third of Earth's
 * gravity" and "a million times Earth's radiation" can appear in the same column and both
 * read correctly.
 */
function EarthBar({ ratio, label, value }: { ratio: number; label: string; value: string }) {
  const clamped = Math.max(1e-4, Math.min(1e6, ratio));
  // Earth sits at the centre. Four decades either side covers everything in the registry.
  const position = 50 + (Math.log10(clamped) / 4) * 50;
  const above = ratio > 1;
  return (
    <div className="space-y-1">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[11px] text-zinc-400">{label}</span>
        <span className="font-mono text-[11px] text-zinc-200">{value}</span>
      </div>
      <div className="relative h-1.5 rounded-full bg-white/5">
        <div className="absolute inset-y-0 left-1/2 w-px bg-white/25" aria-hidden />
        <div
          className={`absolute top-0 h-1.5 rounded-full ${above ? "bg-amber-400/70" : "bg-sky-400/70"}`}
          style={
            above
              ? { left: "50%", width: `${Math.max(1, position - 50)}%` }
              : { left: `${Math.min(49, position)}%`, width: `${Math.max(1, 50 - position)}%` }
          }
        />
      </div>
      <div className="text-[10px] text-zinc-600">
        {ratio === 1 ? "same as Earth" : `${formatRatio(ratio)} Earth`}
      </div>
    </div>
  );
}

function formatRatio(ratio: number): string {
  if (!Number.isFinite(ratio)) return "unbounded vs";
  if (ratio >= 1000 || ratio <= 0.001) return `${ratio.toExponential(1)}x`;
  if (ratio >= 1) return `${ratio.toFixed(ratio >= 10 ? 0 : 2)}x`;
  return `${ratio.toFixed(2)}x`;
}

function Quantities({ items }: { items: readonly Quantity[] }) {
  return (
    <dl className="mt-3 grid gap-x-4 gap-y-1.5 sm:grid-cols-2">
      {items.map((q) => (
        <div key={q.label} className="flex flex-col border-l border-white/10 pl-2.5">
          <dt className="text-[10px] uppercase tracking-wide text-zinc-500">{q.label}</dt>
          <dd className="font-mono text-xs text-zinc-100">{formatQuantity(q)}</dd>
          {q.note ? <dd className="text-[10px] leading-snug text-zinc-500">{q.note}</dd> : null}
        </div>
      ))}
    </dl>
  );
}

function BarrierCard({ barrier }: { barrier: Barrier }) {
  const s = SEVERITY[barrier.severity];
  return (
    <section className={`rounded-xl border p-3.5 ${s.ring}`}>
      <header className="flex items-center gap-2">
        <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${s.dot}`} aria-hidden />
        <h4 className="text-sm font-medium text-zinc-100">{barrier.title}</h4>
        <span className={`ml-auto shrink-0 text-[10px] uppercase tracking-wide ${s.text}`}>
          {s.label}
        </span>
      </header>
      <p className="mt-1.5 text-xs leading-relaxed text-zinc-400">{barrier.statement}</p>
      <Quantities items={barrier.quantities} />
    </section>
  );
}

function StepCard({ step, last }: { step: Step; last: boolean }) {
  const m = MATURITY[step.maturity];
  return (
    <li className="relative pl-9">
      {!last ? <span className="absolute left-[13px] top-7 h-[calc(100%-1rem)] w-px bg-white/10" aria-hidden /> : null}
      <span className="absolute left-0 top-0 flex h-7 w-7 items-center justify-center rounded-full border border-white/15 bg-zinc-900 font-mono text-xs text-zinc-300">
        {step.order}
      </span>
      <h4 className="pt-1 text-sm font-medium text-zinc-100">{step.title}</h4>
      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
        <span className={`rounded px-1.5 py-0.5 text-[10px] ${m.className}`}>{m.label}</span>
        <span className="text-[10px] text-zinc-500">{step.timescale}</span>
      </div>
      <p className="mt-2 text-xs leading-relaxed text-zinc-300">{step.mechanism}</p>
      <Quantities items={step.quantities} />
      <p className="mt-2.5 text-[10px] leading-relaxed text-zinc-600">{step.source}</p>
    </li>
  );
}

export function HabitabilityPanel({ focus, onClose }: { focus: BodyId; onClose: () => void }) {
  const assessment = useMemo(() => assessHabitability(focus), [focus]);

  useEffect(() => {
    const escape = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", escape);
    return () => window.removeEventListener("keydown", escape);
  }, [onClose]);

  const s = assessment.state;
  const bars = [
    { label: "Sunlight", ratio: s.solarConstantRelativeToEarth, value: `${s.solarConstantWPerM2.toFixed(0)} W/m²` },
    { label: "Gravity", ratio: s.gravityRelativeToEarth, value: `${s.surfaceGravityMS2.toFixed(2)} m/s²` },
    {
      label: "Surface temperature",
      ratio: s.measuredSurfaceTemperatureK / HUMAN_REQUIREMENTS.targetSurfaceTemperatureK,
      value: `${s.measuredSurfaceTemperatureK.toFixed(0)} K`,
    },
    {
      label: "Surface pressure",
      ratio: s.surfacePressurePa / HUMAN_REQUIREMENTS.targetSurfacePressurePa,
      value: s.surfacePressurePa > 0 ? `${s.surfacePressurePa.toExponential(1)} Pa` : "none",
    },
    ...(s.doseRelativeToEarth !== null
      ? [
          {
            label: "Radiation at the surface",
            ratio: s.doseRelativeToEarth,
            value: `${(s.surfaceDoseSvPerYear ?? 0).toExponential(1)} Sv/yr`,
          },
        ]
      : []),
  ];

  return (
    <div
      className="pointer-events-auto fixed inset-0 z-50 flex justify-end bg-black/50 backdrop-blur-sm"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="flex h-full w-full max-w-xl flex-col border-l border-white/10 bg-zinc-950/95 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={`Making ${assessment.displayName} habitable`}
      >
        <header className="flex items-start gap-3 border-b border-white/10 p-5">
          <div className="min-w-0 flex-1">
            <p className="text-[10px] uppercase tracking-widest text-zinc-500">
              Making it habitable
            </p>
            <h2 className="mt-0.5 text-xl font-semibold text-zinc-50">{assessment.displayName}</h2>
            <p className="mt-1 inline-block rounded bg-white/5 px-2 py-0.5 text-[11px] text-zinc-300">
              {STRATEGY_LABEL[assessment.strategy]}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="shrink-0 rounded-lg border border-white/10 px-2.5 py-1.5 text-xs text-zinc-400 transition hover:bg-white/10 hover:text-zinc-100"
          >
            Close
          </button>
        </header>

        <div className="min-h-0 flex-1 space-y-6 overflow-y-auto p-5">
          <p className="text-sm leading-relaxed text-zinc-300">{assessment.headline}</p>

          <section>
            <h3 className="mb-3 text-[11px] uppercase tracking-widest text-zinc-500">
              Where it stands, against Earth
            </h3>
            <div className="grid gap-3 sm:grid-cols-2">
              {bars.map((b) => (
                <EarthBar key={b.label} {...b} />
              ))}
            </div>
            <p className="mt-3 text-[11px] leading-relaxed text-zinc-500">
              {s.greenhouseSummary}{" "}
              {s.insideHabitableZone
                ? "This orbit is inside the conservative habitable zone."
                : "This orbit is outside the conservative habitable zone."}
            </p>
          </section>

          {assessment.barriers.length > 0 ? (
            <section>
              <h3 className="mb-3 text-[11px] uppercase tracking-widest text-zinc-500">
                What stands in the way
              </h3>
              <div className="space-y-2.5">
                {assessment.barriers.map((b) => (
                  <BarrierCard key={b.id} barrier={b} />
                ))}
              </div>
            </section>
          ) : null}

          <section>
            <h3 className="mb-4 text-[11px] uppercase tracking-widest text-zinc-500">
              How it could be done
            </h3>
            <ol className="space-y-7">
              {assessment.ladder.map((step, i) => (
                <StepCard key={step.order} step={step} last={i === assessment.ladder.length - 1} />
              ))}
            </ol>
          </section>

          <section className="rounded-xl border border-white/10 bg-white/[0.02] p-3.5">
            <h3 className="text-[11px] uppercase tracking-widest text-zinc-500">
              What is not certain here
            </h3>
            <ul className="mt-2 space-y-1.5">
              {assessment.caveats.map((c) => (
                <li key={c} className="text-[11px] leading-relaxed text-zinc-500">
                  {c}
                </li>
              ))}
            </ul>
          </section>
        </div>
      </div>
    </div>
  );
}
