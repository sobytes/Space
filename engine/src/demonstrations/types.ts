/**
 * A demonstration is a physical claim the app can be caught being wrong about.
 *
 * Every entry names a published value and the source it came from, and the gate in
 * `demonstrations.test.ts` iterates this registry and asserts each one. That is deliberate:
 * the registry is the single list, and the gate derives from it, so adding a demonstration
 * cannot leave a stale second list behind.
 *
 * This is also what separates the app from an animation. An animation shows you an orbit.
 * A demonstration shows you a number that could have disagreed with a textbook and did not.
 */

export interface PublishedValue {
  readonly value: number;
  readonly unit: string;
  /** Fractional tolerance the measurement must land inside, e.g. 0.01 for one percent. */
  readonly tolerance: number;
  readonly source: string;
}

export interface ResultRow {
  readonly label: string;
  readonly value: string;
}

export interface DemonstrationResult {
  /** The single number compared against the published value. */
  readonly measured: number;
  /** What the same measurement gives with the effect under test switched off, where that applies. */
  readonly control?: { readonly label: string; readonly value: number };
  readonly rows: readonly ResultRow[];
  /** Anything the measurement genuinely cannot resolve. Shown in the UI, not hidden. */
  readonly caveats?: readonly string[];
}

export interface Demonstration {
  readonly id: string;
  readonly title: string;
  /** The question a visitor actually has, in their words. */
  readonly question: string;
  readonly attribution: string;
  readonly history: string;
  readonly published: PublishedValue;
  readonly run: () => DemonstrationResult;
}
