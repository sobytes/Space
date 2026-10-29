# Contracts

The rules every solar client follows, so the website, iPhone, Android,
Apple TV and Android TV make the same decisions from the same data. Each
folder is one contract.

Read the contract before changing a client, and write the rule back into
it afterwards. Never just change the code.

| Contract | Governs |
|---|---|
| [physics-and-mathematics](physics-and-mathematics/SKILL.md) | **The master contract.** Gravitation, mass, orbits, perturbation, relativity, conservation, integration, uncertainty, with the source for each |
| [feature-parity](feature-parity/SKILL.md) | What the product does, and which clients do it. Backed by `features.json` and a gate |
| [units-and-frames](units-and-frames/SKILL.md) | SI inside, branded at the boundary, float64, J2000 ecliptic |
| [time-scales](time-scales/SKILL.md) | UTC, TAI, TT and TDB, and which one each input and output uses |
| [ephemeris-accuracy](ephemeris-accuracy/SKILL.md) | Where positions come from, how wrong they may be, and declaring it |
| [rotation-and-poles](rotation-and-poles/SKILL.md) | IAU rotational elements, and the 180 degree retrograde trap |
| [satellite-reference-planes](satellite-reference-planes/SKILL.md) | Which plane a moon's elements are in, and the Laplace surface |
| [floating-origin](floating-origin/SKILL.md) | Rendering ten orders of magnitude without jitter or clipping |
| [numbers-come-from-the-engine](numbers-come-from-the-engine/SKILL.md) | No client and no model states a figure the engine did not compute |
| [gravity-modes](gravity-modes/SKILL.md) | Analytic rails versus full mutual gravity, and what each must admit |

The first two are the ones to read first. `physics-and-mathematics` is the
model every client implements and the others specialise it;
`feature-parity` is what stops a client being numerically perfect and
missing half the product.

## Why these exist as prose

`engine/` is the single implementation, in TypeScript, and any TypeScript
client imports it directly and inherits every rule for free. Swift and
Kotlin cannot import it. They hand-port the parts they need and keep a
test suite that mirrors the engine's gates case for case, asserting the
same published values.

That is the whole reason this folder exists. A hand-port drifts, and a
drifted physics engine produces a plausible wrong answer rather than an
error. The contracts are what a port is checked against, and the mirrored
tests are what catches the drift.

## Clients

| Client | Code | Shares the engine? |
|---|---|---|
| Website | `website/` | Yes, imports `@solar/engine` |
| iPhone | `mobile/ios/` | No, hand-ported into SolarKit |
| Android phone | `mobile/android/` | No, hand-ported |
| Apple TV | `tv/ios/` | No, consumes SolarKit |
| Android TV | `tv/android/` | No, hand-ported |

## Adding a client

Read every contract, starting with `physics-and-mathematics`. Each ends
with what a new platform has to provide, and a client is not done until it
meets all of them.

Then add your platform key to `features.json` with an entry for every
feature. The gate will not let you leave a blank.

## What is enforced, and by what

Contracts are prose, but three of them have teeth:

| Check | Where | Catches |
|---|---|---|
| Cross-language drift | `website/src/swift-port.test.ts` | A hand-port diverging from the engine |
| Feature parity | `website/src/feature-parity.test.ts` | A client missing a feature, or a stale path |
| Engine purity | `website/src/view/core/invariants.test.ts`, `engine/tsconfig.json` | The engine gaining a dependency on a renderer |

Run them all with `./build.sh check`.
