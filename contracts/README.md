# Contracts

The rules every solar client follows, so the website, iPhone, Android,
Apple TV and Android TV make the same decisions from the same data. Each
folder is one contract.

Read the contract before changing a client, and write the rule back into
it afterwards. Never just change the code.

| Contract | Governs |
|---|---|
| [units-and-frames](units-and-frames/SKILL.md) | SI inside, branded at the boundary, float64, J2000 ecliptic |
| [time-scales](time-scales/SKILL.md) | UTC, TAI, TT and TDB, and which one each input and output uses |
| [ephemeris-accuracy](ephemeris-accuracy/SKILL.md) | Where positions come from, how wrong they may be, and declaring it |
| [rotation-and-poles](rotation-and-poles/SKILL.md) | IAU rotational elements, and the 180 degree retrograde trap |
| [satellite-reference-planes](satellite-reference-planes/SKILL.md) | Which plane a moon's elements are in, and the Laplace surface |
| [floating-origin](floating-origin/SKILL.md) | Rendering ten orders of magnitude without jitter or clipping |
| [numbers-come-from-the-engine](numbers-come-from-the-engine/SKILL.md) | No client and no model states a figure the engine did not compute |
| [gravity-modes](gravity-modes/SKILL.md) | Analytic rails versus full mutual gravity, and what each must admit |

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

Read every contract. Each ends with what a new platform has to provide,
and a client is not done until it meets all of them.
