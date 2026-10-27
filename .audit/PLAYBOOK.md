# Playbook: Solar system simulator and astrodynamics workbench

Routed to **figure-it-out** rather than Feature. The task is an ambitious multi-part
build with no existing codebase, several one-way-door design decisions, and a
correctness claim ("accurate enough for a NASA engineer") that needs a real gate.

## figure-it-out steps, copied verbatim

- [x] Read the Principles section of the poteto-mode skill.
- [ ] **Phase A: Frame.** Definition of done as a falsifiable predicate. Scope, quantified.
      Rigor level, biased high. Present framing and tradeoffs before committing to a long run.
- [ ] **Phase B: Design the workflow.** Decompose into atomic independently-landable units.
      Sequence riskiest-unknown-first. Build the verification harness before the work, with
      the baseline captured from the pre-change state. Run `architect` for one-way-door
      design decisions. Decide what fans out. Write the designed phase list down.
- [ ] **Phase C: Run the loop.** Each unit is an experiment: hypothesis, smallest change,
      measure against the predicate on the real artifact, keep or revert. Verify by inspecting
      the artifact, never a self-report. Verdict is VERIFIED, NOT VERIFIED, or INCONCLUSIVE.
- [ ] **Phase D: Keep the audit trail.** Log the run via show-me-your-work. Commit the trail.
- [ ] **Phase E: Verify and hand back.** Check the whole against the Phase A predicate on the
      real product, not just the harness. Encode recurring corrections as a gate or script.

## Phase A: Frame

### What the user asked for, consolidated across four messages

1. Solar system to scale, correct rotation periods and spin axes, from real NASA data.
2. Zoom and navigate from system scale to planet surfaces, craters visible.
3. Educational, seamless, beautiful.
4. Launch rockets from Earth with variable inputs, see valid trajectories and propulsion data.
5. Inject asteroids, propagate under real gravity, see where they end up.
6. Time control, from slow motion to enormous acceleration.
7. AI integrated throughout.
8. Credible to an aerospace engineer, not a portfolio toy.

### Definition of done, as falsifiable predicates

A predicate counts only when a committed script prints its own pass or fail.

| # | Predicate | Gate |
|---|-----------|------|
| P1 | Heliocentric positions of the 8 planets and Pluto match JPL Horizons within the accuracy JPL quotes for the elements we embed, sampled across 1800-2050 | `npm run verify:ephemeris` |
| P2 | Sidereal rotation period of every body matches its IAU WGCCRE value to 1e-6 relative error | `npm run verify:rotation` |
| P3 | Spin axis matches the IAU pole right ascension and declination within 0.01 degrees | `npm run verify:rotation` |
| P4 | The 2024-04-08 total solar eclipse reproduces, with Moon-Sun angular separation from Earth inside the real value | `npm run verify:events` |
| P5 | A Lambert solver reproduces published Vallado test cases to the printed significant figures | `npm run verify:lambert` |
| P6 | The N-body integrator conserves energy below a stated tolerance over 1000 years, and reproduces a JPL-published asteroid close approach in date and distance | `npm run verify:integrator` |
| P7 | The ascent model reproduces published payload-to-LEO for at least three real vehicles within a stated percentage | `npm run verify:ascent` |
| P8 | Continuous zoom across 10 orders of magnitude with no depth artifact and no position jitter | Playwright, screenshots per decade |
| P9 | 60fps on this Mac, 30fps on a throttled mobile profile | Playwright trace, frame timings |
| P10 | Craters resolve on the Moon and Mars from low altitude, from real elevation data | Screenshot against a NASA reference image |
| P11 | Every AI tool call maps onto a real engine function, and the AI cannot assert a number the engine did not compute | `npm run verify:ai-tools` |

P11 is the one that keeps the AI honest. The model narrates and drives; the engine owns every number.

### Scope, quantified

Estimate, not measured. 11 landable units: data layer, ephemeris engine, verification
harness, render core, camera and navigation, surfaces and textures, propagator, launch and
transfer solver, AI mission control, educational layer, UI chrome.

### Rigor level: high

Three one-way doors justify it. The renderer choice, the coordinate and precision
architecture, and the engine's runtime split are all expensive to reverse once bodies,
camera, shaders and the AI tool surface depend on them. The accuracy claim needs gates
because on screen, "right" and "wrong by a million kilometres" look identical.

### The architectural consequence of the AI requirement

The physics engine must be pure TypeScript with no DOM and no WebGL dependency, so the
same code runs in the browser, in a Web Worker, and in a Node route handler. That single
constraint buys three things. The AI's tools execute against the real engine server-side
rather than against a described version of it. The verification gates run headless in CI.
The heavy propagation moves to a worker without a rewrite. This is the decision that most
shapes the file layout, so it is settled before any rendering code is written.

### Honest limits, to be stated in the product itself

A browser tool does not replace GMAT, STK or Copernicus. The plan is a narrow validated
envelope with the validation visible in the UI, rather than a broad claim. Where a number
comes from a model with known error, the UI shows the error.


## Status as of the render milestone

Verified by running the gates, not by assertion. `npm run verify` is 158 tests across 6 files.

| # | Predicate | State | Evidence |
|---|-----------|-------|----------|
| P1 | Planet positions match JPL Horizons | **met, with one declared limit** | 64 real Horizons fixtures, RMS inside JPL nominal for 6 of 8 bodies; Uranus and Neptune carry declared envelopes with written justification. `npm run verify:ephemeris` |
| P2 | Rotation periods match IAU | **met** | `verify:contracts`, 93 assertions, period derived from W1 cross-checked against the fact sheet with Neptune's conflict declared |
| P3 | Spin axes match IAU poles | **met** | `src/engine/rotation.test.ts`, 34 assertions, obliquity reproduced once the IAU and fact-sheet pole conventions are reconciled |
| P4 | 2024 eclipse reproduces | **not started** | needs a real lunar theory; mean elements are good to about a degree, which is nowhere near eclipse grade |
| P5 | Lambert solver vs Vallado | **not started** | research for it was lost to the spend limit and needs redoing |
| P6 | N-body integrator energy and a JPL close approach | **not started** | RK4 exists and is used for the precession demonstration; no adaptive integrator, no Apophis fixture yet |
| P7 | Ascent reproduces payload to LEO | **data captured, no model** | `src/engine/launch/reference-data.ts` holds the Atlas V fixtures and the validated constants |
| P8 | Continuous zoom across 10 decades | **numeric half met, visual half not** | `verify:depth` sweeps ten decades; no Playwright zoom sweep yet |
| P9 | 60fps desktop, 30fps mobile | **not started** | no frame timing captured |
| P10 | Craters resolve from low altitude | **not started** | needs streamed tiles; no global texture can carry it |
| P11 | AI never supplies a number | **not started** | no AI code written yet |

Four of eleven met, one partial. The engine's correctness spine is real; the astrodynamics
and AI halves are specified and unbuilt.
