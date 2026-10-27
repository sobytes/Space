"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { AsteroidLaunch } from "@/engine/scenarios/asteroid";
import type { AsteroidRequest, AsteroidResponse } from "../workers/asteroid.worker";

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
  const [run, setRun] = useState<AsteroidRun>(IDLE);

  useEffect(() => {
    const instance = new Worker(new URL("../workers/asteroid.worker.ts", import.meta.url), {
      type: "module",
    });

    instance.onmessage = (event: MessageEvent<AsteroidResponse>) => {
      if (event.data.id !== latestId.current) return;
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

  const clear = useCallback(() => {
    latestId.current += 1;
    setRun(IDLE);
  }, []);

  return { run, launch, clear };
}
