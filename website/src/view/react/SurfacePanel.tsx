"use client";

import { useEffect, useRef, useState } from "react";
import { surfaceViewFor } from "@solar/engine/surface-views";
import type { BodyId } from "@solar/engine/bodies/contract";

/**
 * Standing on another world, with real photographs.
 *
 * Every image is a specific NASA asset, curated by hand and re-checked by
 * `scripts/verify-imagery.mjs`, which rejects anything whose own description calls it a
 * concept, an illustration or a perspective view. Nothing here is generated and nothing is
 * searched for at runtime.
 *
 * The panoramas are the point, so they are shown at their natural height and scrolled
 * sideways rather than squeezed into the panel. A 360-degree view of Jezero Crater letterboxed
 * to fit is just a stripe.
 */
export function SurfacePanel({ focus, onClose }: { focus: BodyId; onClose: () => void }) {
  const view = surfaceViewFor(focus);
  const [index, setIndex] = useState(0);
  const scroller = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const escape = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", escape);
    return () => window.removeEventListener("keydown", escape);
  }, [onClose]);

  useEffect(() => {
    // A panorama opens at its middle, not its left edge, because the interesting thing is
    // usually ahead of the camera rather than ninety degrees to one side.
    const node = scroller.current;
    if (!node) return;
    node.scrollLeft = (node.scrollWidth - node.clientWidth) / 2;
  }, [index]);

  const image = view.images[index];

  return (
    <div
      className="pointer-events-auto fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-6 backdrop-blur-sm"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="flex max-h-full w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-white/10 bg-zinc-950"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={`Photographs from the surface of ${view.displayName}`}
      >
        <header className="flex items-start gap-3 border-b border-white/10 p-5">
          <div className="min-w-0 flex-1">
            <p className="text-[10px] uppercase tracking-widest text-zinc-500">
              Standing on the surface
            </p>
            <h2 className="mt-0.5 text-xl font-semibold text-zinc-50">{view.displayName}</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 rounded-lg border border-white/10 px-2.5 py-1.5 text-xs text-zinc-400 transition hover:bg-white/10 hover:text-zinc-100"
          >
            Close
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {image ? (
            <>
              <div ref={scroller} className="overflow-x-auto bg-black">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={image.url}
                  alt={image.whatYouAreSeeing}
                  className="h-[46vh] max-w-none object-contain"
                />
              </div>

              {view.images.length > 1 ? (
                <div className="flex flex-wrap gap-1.5 border-b border-white/10 p-3">
                  {view.images.map((candidate, i) => (
                    <button
                      key={candidate.nasaId}
                      type="button"
                      onClick={() => setIndex(i)}
                      className={`rounded-md px-2 py-1 text-[11px] transition ${
                        i === index
                          ? "bg-amber-400/20 text-amber-200"
                          : "text-zinc-400 hover:bg-white/10"
                      }`}
                    >
                      {candidate.mission}
                    </button>
                  ))}
                </div>
              ) : null}

              <div className="space-y-3 p-5">
                <h3 className="text-sm font-medium text-zinc-100">{image.title}</h3>
                <p className="text-xs leading-relaxed text-zinc-300">{image.whatYouAreSeeing}</p>
                <dl className="grid gap-x-6 gap-y-1.5 sm:grid-cols-2">
                  {[
                    ["Mission", image.mission],
                    ["Instrument", image.instrument],
                    ["Taken", image.captured],
                    ["NASA id", image.nasaId],
                  ].map(([label, value]) => (
                    <div key={label} className="flex flex-col border-l border-white/10 pl-2.5">
                      <dt className="text-[10px] uppercase tracking-wide text-zinc-500">{label}</dt>
                      <dd className="font-mono text-xs text-zinc-100">{value}</dd>
                    </div>
                  ))}
                </dl>
                <p className="text-[10px] leading-relaxed text-zinc-500">{image.credit}</p>
              </div>
            </>
          ) : (
            <div className="space-y-3 p-6">
              <p className="text-sm leading-relaxed text-zinc-200">{view.statement}</p>
            </div>
          )}

          {view.caveat ? (
            <p className="border-t border-white/10 p-5 text-[11px] leading-relaxed text-zinc-500">
              {view.caveat}
            </p>
          ) : null}

          {/*
            Linking is not copying. Venus is the only case: the photographs exist and NASA's
            own archive says they are not necessarily public domain, so this project points at
            them rather than serving them.
          */}
          {view.seeAlso ? (
            <div className="border-t border-white/10 p-5">
              <a
                href={view.seeAlso.url}
                target="_blank"
                rel="noreferrer"
                className="inline-block rounded-lg border border-sky-400/30 bg-sky-400/10 px-3 py-1.5 text-xs text-sky-200 transition hover:bg-sky-400/20"
              >
                {view.seeAlso.label} &rarr;
              </a>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
