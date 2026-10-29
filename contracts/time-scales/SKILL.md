---
name: time-scales
description: UTC, TAI, TT and TDB, and which one every input, computation and display uses. Read before parsing a date, before calling anything that takes an epoch, and before showing a time to a viewer.
---

# Time scales

Four time scales appear in this project and they are not interchangeable.
Mixing them produces an error of tens of seconds, which moves Mercury about
2,000 km and moves nothing else enough to notice, so it hides.

| Scale | What it is | Used for |
|---|---|---|
| UTC | Civil time. Has leap seconds. | Parsing user input, displaying a date |
| TAI | Atomic time. UTC plus the leap second count. | Only as a step to TT |
| TT | TAI + 32.184 s. Smooth. | Rotation, IAU prime meridian |
| TDB | TT plus periodic relativistic terms, under 2 ms. | Ephemerides, propagation |

**The rule: every epoch carries its scale in its type.** `JdUtc`, `JdTt` and
`JdTdb` are distinct branded types and no function accepts a bare number.
Swift and Kotlin should use separate wrapper types, not a typealias, so the
compiler rejects the mix.

## Leap seconds

TAI minus UTC is a step function with 27 insertions since 1972, currently
37 seconds. The table is data, not a constant, and a client that hardcodes
37 is correct only for dates after 2017-01-01. There has been no insertion
since, and the IERS may announce another at any time.

A date before 1972 has no leap-second definition in this table. Say so
rather than extrapolating.

## Rules

1. **Parse as UTC, convert once, compute in TDB.** The conversion chain is
   UTC to TAI by the leap table, TAI to TT by a constant, TT to TDB by the
   periodic terms.
2. **Display as UTC.** A viewer's clock is civil time.
3. **Rotation uses TT**, matching the IAU convention for W.
4. **Ephemerides and propagation use TDB.** The Standish tables, the
   Horizons fixtures and the integrator all do.
5. **Never difference two epochs in different scales.** The type system
   should make it impossible.

## What a new client must provide

- Three distinct epoch types with no implicit conversion between them.
- The full leap-second table, not a constant, with the date of its last
  entry recorded so staleness is visible.
- A refusal, not an approximation, for dates the table does not cover.
- Tests that convert a known UTC instant to TDB and back, and that assert
  TAI minus UTC across at least one leap-second boundary.
