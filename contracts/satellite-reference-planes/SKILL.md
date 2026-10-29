---
name: satellite-reference-planes
description: Which plane a moon's orbital elements are measured in, and how to rotate each into the ecliptic. Read before adding a moon or before a moon appears to orbit through its planet.
---

# Satellite reference planes

JPL quotes satellite elements in three different planes, and the element
set does not say which. Using the wrong one puts a moon in a visibly wrong
orbit, and for Uranus it puts its moons through the planet.

| Plane | Which moons | Why |
|---|---|---|
| Parent equator | Close, regular satellites | The planet's oblateness dominates |
| Laplace | Distant satellites | The transition between equator and orbit |
| Ecliptic | Earth's Moon | The Sun dominates |

**The rule: every satellite declares its reference plane, and the position
function dispatches on it.** There is no default.

## The Laplace surface

Far from a planet the Sun's pull dominates and a moon follows the planet's
**orbital** plane. Close in, the planet's oblateness dominates and it
follows the **equatorial** plane. The Laplace surface is the warped
transition between the two, and its tilt follows Tremaine, Touma and
Namouni 2009:

    tan(2 i_L) = sin(2e) / (cos(2e) + (a / r_L)^5)

where e is the planet's obliquity, a the moon's semi-major axis and r_L
the Laplace radius, which depends on the planet's J2, its radius and its
heliocentric distance. Saturn's is 2.50 million km.

Treating everything as equatorial puts Iapetus and Phoebe visibly wrong.
With the surface implemented, the measured tilts run Rhea 27.8 degrees,
Iapetus 8.6, Phoebe 4.8, and the transition is visible on screen.

## Use the full element set

Semi-major axis, eccentricity and inclination are not enough. The argument
of periapsis, the longitude of the ascending node, the mean anomaly and
the epoch all matter, and the rotation sequence is
`rotateZ(node) . rotateX(inclination) . rotateZ(argument)`, the same
sequence the planets use so the two paths cannot drift apart.

## What happened

A first version used only a, e and i, and invented a node that regressed
from zero. That looks fine for a near-circular equatorial moon and is
badly wrong for Triton: its orbit came out 5 degrees from the ecliptic
instead of about 130, because its 157 degree inclination was being added
to Neptune's tilt rather than combined with its real node.

## What a new client must provide

- A reference-plane field on every satellite, with no default.
- All six elements plus an epoch, from JPL, not a subset.
- The Laplace computation, or an explicit decision to approximate it with
  the error stated per affected moon.
- Framing that accounts for apoapsis, not the semi-major axis: Phoebe's
  eccentricity of 0.16 puts it 1.6 million km further out than its mean
  distance suggests.
