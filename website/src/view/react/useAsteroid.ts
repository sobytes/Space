"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { AsteroidLaunch } from "@solar/engine/scenarios/asteroid";
import type {
  AsteroidRequest, AsteroidResponse, SolveRequest, SolveResponse,
} from "../workers/asteroid.worker";
import type { BodyId } from "@solar/engine/bodies/contract";
import type { JdTdb } from "@solar/engine/time";

export interface AsteroidRun {
  readonly status: "idle" | "running" | "done" | "failed";
  readonly response: AsteroidResponse | null;
  readonly error: string | null;
}

const IDLE: AsteroidRun = { status: "idle", response: null, error: null };

/**
 * Owns the propagation worker.
 *
 * Only the newest request is kept. Dragging a slider fires many launches and the earlier
 * answers are worthless the moment the input changes, so stale responses are dropped by id
 * rather than queued, which also stops a slow run overwriting a fast later one.
 */
export function useAsteroid() {
  const worker = useRef<Worker | null>(null);
  const latestId = useRef(0);
  const pendingSolve = useRef<((solved: SolveResponse["solved"]) => void) | null>(null);
  const [run, setRun] = useState<AsteroidRun>(IDLE);

  useEffect(() => {
    const instance = new Worker(new URL("../workers/asteroid.worker.ts", import.meta.url), {
      type: "module",
    });

    instance.onmessage = (event: MessageEvent<AsteroidResponse | SolveResponse>) => {
      if (event.data.id !== latestId.current) return;
      if ("solved" in event.data) {
        // Resolve whoever asked for an aim. Solving is a dozen propagations and belongs off
        // the main thread, so it comes back the same way a trajectory does.
        pendingSolve.current?.(event.data.solved);
        pendingSolve.current = null;
        return;
      }
      setRun({ status: "done", response: event.data, error: null });
    };
    instance.onerror = (event) => {
      setRun({ status: "failed", response: null, error: event.message || "worker failed" });
    };

    worker.current = instance;
    return () => {
      instance.terminate();
      worker.current = null;
    };
  }, []);

  const launch = useCallback((config: AsteroidLaunch) => {
    if (!worker.current) return;
    latestId.current += 1;
    setRun({ status: "running", response: null, error: null });
    const request: AsteroidRequest = { id: latestId.current, launch: config };
    worker.current.postMessage(request);
  }, []);

  /** Ask the worker to aim at a body, and resolve when it has. */
  const solve = useCallback(
    (from: BodyId, to: BodyId, startEpoch: JdTdb, releaseAltitudeM: number) =>
      new Promise<SolveResponse["solved"]>((resolve) => {
        if (!worker.current) {
          resolve(null);
          return;
        }
        latestId.current += 1;
        pendingSolve.current = resolve;
        const request: SolveRequest = {
          id: latestId.current,
          solve: { from, to, startEpoch, releaseAltitudeM },
        };
        worker.current.postMessage(request);
      }),
    [],
  );

  const clear = useCallback(() => {
    latestId.current += 1;
    setRun(IDLE);
  }, []);

  return { run, launch, clear, solve };
}
