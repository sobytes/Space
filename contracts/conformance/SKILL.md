---
name: conformance
description: The cross-platform test suite every client must pass. Read before porting any physics to a new language, before changing an engine function's output, and before trusting that two clients agree.
---

# Conformance

One set of test cases. Every client runs it. A client that disagrees with
any case is wrong by definition.

`contracts/conformance/` holds the cases as JSON, generated from the
engine, which is the reference implementation. 779 cases across 21
domains, committed, language-neutral.

| Runner | Lives in |
|---|---|
| TypeScript | `website/src/conformance.test.ts` |
| Swift | `mobile/ios/SolarKit/Tests/SolarKitTests/ConformanceTests.swift` |

Regenerate with `./build.sh conformance` after an engine change that
alters an answer.

## Why this, and not what came before

The first arrangement was each platform having its own tests, plus the
Swift suite writing a snapshot that a TypeScript test checked. That caught
drift in exactly what it covered and nothing else. Every new function
needed a bespoke artifact, two runners, and a format agreed between them,
so in practice coverage followed whatever had recently gone wrong.

Here a domain is a list of cases and a port either reproduces them or does
not. Adding a platform means writing one more runner, not one more
artifact per function.

## It is not circular

The cases are generated from the engine, and the engine is then tested
against them. That sounds like a tautology and is not, because the cases
are **committed**. A change to the engine that alters an answer turns the
TypeScript runner red, and clearing it means regenerating, which is
precisely the moment every port needs telling. The suite's job is to make
a change in behaviour loud, not to prove the engine correct. What proves
the engine correct is the JPL Horizons fixtures, the published values in
the demonstrations, and the independent quadrature in `secular.ts`.

## Tolerances

Each domain carries two:

```
|a - b| <= relative * |expected| + absolute
```

The absolute term is not slack. A relative tolerance is the right test for
a quantity of ordinary magnitude and the wrong one near zero. Earth's
inclination to the ecliptic is 4e-7 radians, computed as `acos` of
something within 1e-13 of one, and `acos(1 - eps)` is about `sqrt(2 eps)`,
so a last-bit difference in the input becomes 1e-8 in the angle. Two
correct implementations differing only in their order of operations then
look like a port bug.

Domains setting a non-trivial absolute tolerance say why, in the
generator, next to the number.

## What it has already caught

Generating the suite and running it against the Swift port found, in one
pass:

- Mercury's semi-major axis, eccentricity and orbital period had all
  drifted in the port. Three plausible figures, all different from the
  engine's, none flagged by anything.
- `secular.ts` had never been ported at all. The suite would not compile
  against the Swift until it was.

And a planted check: changing the astronomical unit by nine metres, six
parts in 10^11, fails 264 of the 487 cases.

## Adding a domain

1. Add it to `scripts/generate-conformance.mjs`, with a description, a
   relative tolerance and an absolute one.
2. Regenerate.
3. Add the case to each runner's dispatch. A runner that does not know a
   domain fails loudly rather than skipping it, and both runners assert
   they executed the full case count.

## What a new client must provide

- A runner over every domain in `index.json`, with no domain skipped.
- An assertion that the number of cases executed equals `totalCases`. A
  runner that silently skips a domain otherwise passes.
- The same mixed tolerance. Do not substitute a looser one to make a port
  pass; a failing case is a finding.
