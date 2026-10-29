---
name: units-and-frames
description: The units, reference frame and numeric precision every solar client computes in. Read before adding any quantity to a model, before accepting a number from a data source, and before storing or transmitting a position, velocity, mass or angle.
---

# Units and frames

Every client computes in the same units, in the same frame, at the same
precision. A client that quietly works in kilometres or in a body-fixed
frame produces answers that look plausible and are wrong by a factor or a
rotation, which no screenshot will reveal.

## The rule: SI inside, branded at the boundary, float64 throughout

**Inside the engine every number is bare SI.** Metres, seconds, kilograms,
radians. Gravitational parameters are `m^3 s^-2`. No kilometres, no days, no
degrees, no astronomical units.

**At the boundary every number is branded.** Data arrives from JPL in
kilometres, days, degrees and au, and arrives from a user in whatever the
UI offered. It is converted exactly once, at the edge, by a named function
(`toMetresFromKm`, `toRadians`, `toSecondsFromDays`). TypeScript enforces
this with branded types; Swift and Kotlin should use a wrapper struct or
value class per unit rather than a bare `Double`.

**Everything is float64.** Not float32, anywhere a physical quantity is
held. Neptune sits at 4.5e12 m, and float32 carries roughly 24 bits of
mantissa, so a float32 metre at that distance quantises to about 500 km.
Positions, velocities, times and intermediate results are all double.

## The frame

J2000 ecliptic, heliocentric unless stated. The x axis points at the mean
equinox of J2000, z is ecliptic north. Three conversions matter and are
easy to get silently wrong:

1. **IAU pole data is equatorial, not ecliptic.** The WGCCRE report gives
   pole right ascension and declination in the J2000 **equatorial** frame.
   Rotate by the obliquity, 84381.406 arcseconds, before combining it with
   anything else here.
2. **`embary` is the Earth-Moon barycentre**, not Earth. The Standish
   element set models the barycentre, and its `gm` is Earth plus Moon. The
   two differ by about 4,670 km, which is inside the Earth. That is
   irrelevant for a wide shot and decisive for an eclipse.
3. **Planetary `gm` values are system values**, planet plus its satellites,
   because they pair with barycentric elements. Jupiter's is 126,712,764.1
   km^3 s^-2, not the 126,686,534 for the planet alone.

## Constants

Use these exact values. They are definitions or current best estimates, not
roundings, and a client that carries its own copy will drift from the rest.

| Constant | Value | Note |
|---|---|---|
| au | 149,597,870,700 m | IAU 2012, exact by definition |
| GM Sun | 1.32712440041e20 m^3 s^-2 | |
| Obliquity at J2000 | 84,381.406 arcsec | |
| Julian year | 365.25 d exactly | not the tropical year, 365.2422 |
| Julian century | 36,525 d | |
| Day | 86,400 s | |

## What happened

A probe measured the N-body integrator diverging from the analytic
ephemeris by the same absolute 491,000 km for Uranus and Neptune, bodies at
19 and 30 au. Equal length at unequal distance is a translation, not a
rotation, and it grew linearly in time, so it was a velocity common to
every body. The cause was a frame conversion: the Standish tables give
**heliocentric** velocities, measured against a Sun that is itself
accelerating, and converting them to barycentric requires dividing by the
whole system's gravitational parameter and adding the result to every
planet, not just the Sun. Jupiter alone contributes 12.5 m/s to that sum,
which is 395,000 km a year.

Nothing errored. The orbits stayed closed, energy was conserved to 1e-14,
and every planet was in a plausible place.

## What a new client must provide

- One conversion function per unit, used at the boundary and nowhere else.
- A `Double`-backed type per unit, not bare numbers, so the compiler can
  catch a kilometre passed where metres were wanted.
- Float64 for every physical quantity, including any intermediate.
- A test that round-trips each conversion and asserts the constants above
  to their full printed precision.
- An explicit statement, in the type or the name, of which frame a position
  is in whenever it is not J2000 heliocentric ecliptic.
