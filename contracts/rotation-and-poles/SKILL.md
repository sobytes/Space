---
name: rotation-and-poles
description: How every client orients a body in space and spins it, from the IAU WGCCRE rotational elements. Read before drawing a body, before quoting an axial tilt or a day length, and before adding a body to the registry.
---

# Rotation and poles

Orientation comes from the IAU Working Group on Cartographic Coordinates
and Rotational Elements, as published in NASA NAIF's `pck00011.tpc`. Four
numbers per body: pole right ascension and declination with their rates,
and the prime meridian angle W0 with its rate W1.

**The rule: the IAU elements are the source. A fact sheet is a cross-check,
never an input.**

## The two conventions, and the 180 degree trap

The IAU defines a body's north pole as the one on the north side of the
**invariable plane of the solar system**, regardless of rotation direction.
Planetary fact sheets define it by the right-hand rule from the body's own
spin.

For a prograde body these agree. **For a retrograde body they are exactly
180 degrees apart.** Venus and Uranus are retrograde, and a client that
takes a fact sheet's obliquity and an IAU pole without reconciling them
will draw one of them upside down and compute its seasons backwards.

Uranus is the one people notice: it rotates on its side, about 97.8 degrees
to its orbit, and its moons orbit in that tilted plane. If Uranus's moons
sweep through the planet rather than around it, this is why.

Retrograde rotation shows up as a **negative W1**, not as a flipped pole.

## Rules

1. **W is measured in TT**, and increases with time for a prograde body.
2. **The sidereal period derives from W1**, as 360 / |W1| days. Do not
   carry a separate period constant that can drift from the rate.
3. **Pole data is J2000 equatorial.** Convert to ecliptic before use.
4. **A synchronous moon's W1 equals its orbital mean motion.** That is a
   physical fact and the gate should assert it, not assume it.
5. **Where the IAU rate and a published period disagree, the IAU rate
   wins and the conflict is declared** on the body, with both values and a
   citation. Silently preferring one is how a wrong number survives.

## What happened

JPL's satellite table lists Europa's period as exactly twice Io's. That is
the Laplace resonance being imposed on the table rather than measured, and
it does not match either moon's IAU rate. Both bodies now carry a declared
discrepancy naming the two sources and which one the engine uses.

Two pole assumptions were also wrong and became tests. Earth's Moon does
not follow Earth's equator; its pole sits about 23.5 degrees away, because
it follows the ecliptic. Triton's pole is only 2.3 degrees from Neptune's,
and its capture shows in the sign of W1 and in a 157 degree inclination,
not in its pole.

## What a new client must provide

- The four IAU elements per body, from the NAIF kernel, not retyped from a
  web page.
- A conversion from equatorial to ecliptic applied to the pole.
- A derived period rather than a stored one.
- A declared-discrepancy mechanism, and a test that a declared conflict is
  a real one, so a declaration cannot cover nothing.
- A test asserting the obliquity of at least one retrograde body against a
  published figure, which is what catches the 180 degree convention error.
