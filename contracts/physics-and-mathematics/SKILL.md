---
name: physics-and-mathematics
description: The complete physical and mathematical model every solar client implements - gravitation, mass, orbits, perturbation, relativity, conservation, integration and uncertainty - with the source for each. Read before implementing any physics on any platform, before changing a constant or an equation, and before claiming a client is finished.
---

# Physics and mathematics

This is the contract the others hang from. Every client computes the same
physics from the same equations with the same constants, or it is not the
same product. A planet in the wrong place does not throw an exception; it
renders beautifully and lies.

Each section gives the equation as implemented, the reasoning behind it,
where it lives in the engine, and the source. Nothing here is folklore.

**A note on the citations.** Each one carries a confidence marker. The
sources are named from knowledge rather than fetched, because this
session's web search budget was exhausted, and the project's own rule
(`ephemeris-accuracy`) is that a figure recalled rather than checked must
say so. Marked **[verified in repo]** means the repository reproduces the
result numerically and the agreement is gated. Marked **[citation
recalled]** means the reference is believed correct but was not fetched;
treat the bibliographic detail as provisional while the physics itself is
gated. Anyone with a library should upgrade these.

---

## 1. Gravitation

### The law

Newton's law of universal gravitation. Two bodies attract along the line
between them, proportionally to the product of their masses and inversely
to the square of their separation:

```
F = G m1 m2 / r^2
```

For a system of bodies this becomes the acceleration of each body as the
vector sum over all the others. Writing mu_j = G m_j:

```
d2 r_i / dt2  =  sum over j != i  of  mu_j (r_j - r_i) / |r_j - r_i|^3
```

**That single line is the whole solar system.** Every orbit, every
resonance, every perturbation in this project is a consequence of it. It
is implemented once, in `engine/src/nbody.ts` (`accelerations`).

What it does not have is a closed-form solution. Two bodies give Kepler's
ellipse. Three or more have no general solution in elementary functions,
which Poincare established, so the only honest way to evaluate the
equation is to integrate it step by step. Section 7 covers how.

> Newton, *Philosophiae Naturalis Principia Mathematica* (1687), Book III.
> **[citation recalled]**
>
> Poincare, "Sur le probleme des trois corps et les equations de la
> dynamique", *Acta Mathematica* 13 (1890). The prize memoir establishing
> non-integrability. **[citation recalled]**

### Implementation rule: pairwise, not per-body

Accelerations are accumulated by iterating over **pairs**, evaluating each
separation once and applying equal and opposite impulses:

```
for i in 0..n:
  for j in i+1..n:
    d = r_j - r_i
    invR3 = 1 / |d|^3
    a_i += mu_j * d * invR3
    a_j -= mu_i * d * invR3
```

This is not an optimisation. Newton's third law then holds **to
round-off** rather than approximately, which makes momentum conservation
(section 6) a genuine check on the implementation rather than a
restatement of it. A loop that computes each body's acceleration
independently loses that property and the check becomes worthless.

Gated in `engine/src/nbody.test.ts`: `mu_1 a_1 = -mu_2 a_2` to within
1e-15 relative. **[verified in repo]**

---

## 2. Mass, and why the engine never stores one

**The engine stores `gm`, not mass.** Every body carries a gravitational
parameter mu = GM in m^3 s^-2, and no body carries a mass in kilograms.

The reason is measurement, not convenience. G is the least precisely known
fundamental constant, at roughly one part in 10^5. The *product* GM for a
body with something orbiting it is known far better, to one part in 10^9
or better for the Sun and the major planets, because it is what orbital
dynamics actually measures. Splitting a well-known GM into a poorly-known
G and a derived M, then multiplying them back together, throws away four
orders of magnitude of precision for nothing.

So: `GM_SUN = 1.327_124_400_41e20`, exactly as published, and no `G`
anywhere in the engine.

### Which GM

Planetary values are **system** values, planet plus satellites, because
they pair with barycentric orbital elements. Jupiter's is 126,712,764.1
km^3 s^-2 for the Jovian system, not 126,686,534 for the planet alone.
Mixing the two is a 2e-4 relative error in Jupiter's pull.

`embary` is the Earth-Moon barycentre with GM = GM_Earth + GM_Moon, which
is what the Standish element set models.

> IAU 2015 Resolution B3 on nominal solar and planetary conversion
> constants; JPL DE ephemeris GM values. **[citation recalled]**

---

## 3. The two-body problem, and Kepler

With two bodies the equation of section 1 reduces to a conic. The orbit
equation in polar form:

```
r = a (1 - e^2) / (1 + e cos(nu))
```

and the three laws, which are consequences rather than axioms:

1. The orbit is an ellipse with the primary at one focus.
2. The radius vector sweeps equal areas in equal times, which is
   conservation of angular momentum.
3. `T^2 proportional to a^3`, precisely `n^2 a^3 = mu` for the mean
   motion n.

Kepler's third law is reproduced as a demonstration in
`engine/src/demonstrations/keplers-third-law.ts`. **[verified in repo]**

### Kepler's equation

Position as a function of time requires solving

```
M = E - e sin(E)
```

for the eccentric anomaly E. It is transcendental and has no closed-form
inverse. The engine uses Newton-Raphson,

```
E_{k+1} = E_k - (E_k - e sin E_k - M) / (1 - e cos E_k)
```

seeded at `M + e sin M`, to 1e-13 radians, and **throws rather than
returning a half-solved value** if it has not converged in 40 iterations.
That matters: a silently unconverged solve puts a planet somewhere
plausible.

Convergence is fast for the eccentricities here (Mercury's 0.206 is the
largest planetary value). A near-parabolic orbit would need a different
method, and the engine does not pretend otherwise.

> Kepler, *Astronomia Nova* (1609) for the first two laws, *Harmonices
> Mundi* (1619) for the third. **[citation recalled]**

### Velocity is analytic, never differenced

The engine's `heliocentricState` returns the **exact analytic derivative**
of its own position function, including the drift of every element and of
the long-period terms, carried through each rotation by the product rule:

```
d/dT (R v) = R dv/dT + (dangle/dT) (axis x R v)
```

A finite-difference velocity would carry a truncation error that becomes a
position error growing linearly in time once it seeds an integration.
Gated against a central difference of the same position function to 1e-6
relative, which pins the hand-derived derivatives without pinning
round-off. **[verified in repo]**

---

## 4. Orbital elements

Six numbers define an orbit: semi-major axis a, eccentricity e,
inclination i, longitude of the ascending node Omega, argument of
pericentre omega, and a time anchor (mean anomaly M at an epoch).

### Osculating versus mean

**Osculating** elements are those of the Keplerian orbit the body would
follow from this instant if every perturbation switched off. Under
perturbation they drift, and *that drift is the signal*: an apsidal
precession rate is the secular trend in the osculating longitude of
pericentre.

**Mean** elements have the short-period variation averaged out. JPL
publishes satellite elements as mean elements at an epoch, which is why
they give an orbit's shape and orientation well and its phase poorly as
you move away from that epoch.

### The eccentricity vector

```
e_vec = ((v.v - mu/r) r - (r.v) v) / mu
```

Points from the focus to pericentre; its magnitude is the eccentricity.
Used rather than angles because it has no quadrant logic and no branch at
e = 0. (The Laplace-Runge-Lenz vector is this, scaled.)

### The definition that cost half a percent

`varpi = Omega + omega`, the longitude of pericentre, is **not** the
ecliptic longitude of the eccentricity vector, `atan2(e_y, e_x)`. The two
agree only for a coplanar orbit, and their *secular rates* differ.

Mercury is inclined 7 degrees, and measuring the projected longitude
instead of varpi changes its perihelion advance by 2.6 arcsec/century,
about half a percent, in a quantity whose whole historical significance is
a 43 arcsec/century residual. Published figures are quoted for varpi.
`engine/src/elements.ts`. **[verified in repo]**

---

## 5. Perturbation

The two-body solution is the opening move. Real orbits are perturbed, and
where a perturbing term matters it is included and quantified.

### The disturbing function

For a body perturbed by another, the perturbing potential is the direct
pull plus the **indirect** term from the perturber's pull on the central
body:

```
R = G m2 [ 1/|r1 - r2|  -  (r1 . r2)/r2^3 ]
```

The indirect term is not optional. Omitting it leaves the central body
treated as fixed, which it is not, and the error is first order in the
perturber's mass. In the Legendre expansion the l = 1 direct term cancels
the indirect term exactly, which is a useful check that both are present.

### Lagrange's planetary equations

The secular drift follows from the disturbing function. For a coplanar
orbit the pericentre equation is

```
dvarpi/dt = sqrt(1 - e^2) / (n a^2 e) * dR/de
```

which comes from the Delaunay pair (G = L sqrt(1-e^2), g = varpi) and
dg/dt = -dH/dG.

`engine/src/secular.ts` evaluates this by quadrature over both mean
anomalies, differentiating the integrand analytically rather than
differencing the averaged function, because differencing would need the
quadrature accurate to 1e-8 of its own value.

### The hand-derived limit

Expanding for a circular coplanar exterior perturber: the l = 1 terms
cancel, `<P2(cos psi)> = 1/4`, and `<r1^2> = a1^2 (1 + 3 e1^2 / 2)`, giving

```
dvarpi/dt  ->  (3/4) sqrt(1 - e1^2) n1 (m2/M) alpha^3,   alpha = a1/a2
```

This exists so the chain of evidence terminates in algebra rather than in
another numerical method. The quadrature converges onto it to 1.0000 as
alpha shrinks, and departs from it where alpha is large (0.506 of it at
Venus's alpha = 0.535), which also proves the quadrature has not silently
collapsed into the closed form. **[verified in repo]**

### Why this earns its place

Two independent algorithms, Cartesian N-body integration and
disturbing-function quadrature, sharing no code and almost no method,
agree on Mercury's perihelion advance to **0.027%, 0.003% and 0.009%** for
Venus, Earth and Jupiter. One algorithm agreeing with itself is not
evidence. **[verified in repo]**

> Murray & Dermott, *Solar System Dynamics*, Cambridge University Press
> (1999). The standard modern treatment of the disturbing function,
> Laplace coefficients and secular theory. **[citation recalled]**
>
> Laplace, *Traite de mecanique celeste* (1799-1825); Lagrange's
> variation-of-parameters memoirs (1808-1810). **[citation recalled]**

---

## 6. Relativity

Newtonian gravity is not sufficient, and the place it fails is
measurable.

### The first post-Newtonian correction

The engine applies the first post-Newtonian (1PN) acceleration from the
Einstein-Infeld-Hoffmann equations. For a test body about a central mass,
the correction term is

```
a_1PN = (mu / (c^2 r^3)) [ (4 mu/r - v.v) r + 4 (r.v) v ]
```

`engine/src/relativity.ts`. This is the term, not the full EIH N-body
form; for the solar system at this accuracy the central-mass form carries
essentially all of the effect.

### The falsifiable number

Mercury's perihelion advances by about **43 arcsec/century** more than
Newtonian gravity with all the planets can account for. General relativity
predicts exactly that, from

```
dvarpi/dt = 6 pi mu / (c^2 a (1 - e^2))  per orbit
```

Einstein published it in 1915, and it is the result that earned general
relativity belief, because it was a number that could have been wrong.

The repository measures **42.9809 arcsec/century** against a closed form
of **42.9807**, an error of 0.001%, by differential measurement: the same
orbit integrated with and without the term, with the Newtonian arm
drifting 0.0000. **[verified in repo]**

### The budget, and what is honestly unresolved

The classical decomposition of Mercury's observed advance is: the general
precession of the equinox, plus the Newtonian pull of the other planets
(about 531 arcsec/century), plus the relativistic residual (about 43).

This repository measures the **planetary** part at 528.9 arcsec/century,
about 0.5% below the figure usually quoted. The in-repo cross-check
(section 5) agrees with the integrator to three decimal places, so the
disagreement is with the recalled external figure, not between the two
implementations. Earth's own contribution lands at 90.08 against a
recalled 90.0.

`engine/src/data/nbody-expectations.ts` records this as **unverified**,
states that the recalled budget does not sum self-consistently, and a gate
forbids tightening the tolerance around it. Resolving it needs a citation,
not a narrower bound. Do not tune the model to close this gap.

> Einstein, "Erklarung der Perihelbewegung des Merkur aus der allgemeinen
> Relativitatstheorie", *Sitzungsberichte der Preussischen Akademie der
> Wissenschaften* (1915). **[citation recalled]**
>
> Einstein, Infeld & Hoffmann, "The Gravitational Equations and the
> Problem of Motion", *Annals of Mathematics* 39 (1938), 65-100.
> **[citation recalled]**
>
> Clemence, "The Relativity Effect in Planetary Motions", *Reviews of
> Modern Physics* 19 (1947), 361. The classical perturbation budget.
> **[citation recalled, and the figure it supplies is the one in dispute
> above]**
>
> Will, "The Confrontation between General Relativity and Experiment",
> *Living Reviews in Relativity*. **[citation recalled]**

### What is deliberately not modelled

Light bending, Shapiro delay, frame dragging, the Sun's quadrupole J2
contribution to Mercury's precession (of order 0.03 arcsec/century), and
geodetic precession. Each is below the error of the ephemeris this
project uses. Light *travel time* is modelled, as a demonstration.

---

## 7. Conservation laws

Three quantities are constants of the motion, and they come from the
equation's symmetries rather than from any choice an implementer makes.

| Symmetry | Conserved quantity |
|---|---|
| Translation in space | Linear momentum |
| Rotation in space | Angular momentum |
| Translation in time | Energy |

Noether's theorem is why each symmetry pairs with each constant.

**None of the three is handed to the integrator.** That is what makes them
free checks: the physics says they must not drift, so any drift is
numerical error and nothing else.

```
E = sum_i (1/2) mu_i |v_i|^2  -  sum_{i<j} mu_i mu_j / r_ij
p = sum_i mu_i v_i
L = sum_i mu_i (r_i x v_i)
```

Measured over 100 years with 9 bodies: energy 1.6e-14, angular momentum
3.6e-14, barycentre drift 0.85 mm. **[verified in repo]**

### Read momentum as a velocity

Total momentum has units of gm times speed, and its baseline is pure
round-off, so comparing raw magnitudes is meaningless. Divide by the
system's total gm and read it as the barycentre's drift speed, which has a
scale you can judge: 4e-13 m/s over a century is half a micrometre.

### The null test matters more than the positive one

Two bodies alone must precess by **exactly zero**. If they do not, the
integrator is manufacturing physics and every positive result above is
worthless. Measured: 0.0000 arcsec/century. **[verified in repo]**

> Noether, "Invariante Variationsprobleme", *Nachrichten von der
> Gesellschaft der Wissenschaften zu Gottingen* (1918). **[citation
> recalled]**

---

## 8. Numerical integration

### The method

Dormand-Prince 5(4), an explicit embedded Runge-Kutta pair: a fifth-order
solution with an embedded fourth-order one, so the difference between them
estimates the local error at no extra force evaluations. Seven stages,
first-same-as-last.

The step is adapted from that estimate:

```
h_next = h * min(5, 0.9 * (tolerance / error)^(1/5))
```

with the growth capped and a floor on h, because an unbounded shrink on a
close approach will hang rather than fail.

**The Butcher tableau's c column never appears.** The force law depends on
position alone and not explicitly on t, so the system is autonomous and
the stage times are not needed. Carrying them would be harmless and
misleading.

> Dormand & Prince, "A family of embedded Runge-Kutta formulae",
> *Journal of Computational and Applied Mathematics* 6 (1980), 19-26.
> **[citation recalled]**
>
> Hairer, Norsett & Wanner, *Solving Ordinary Differential Equations I*,
> Springer. **[citation recalled]**

### What it is not

**Dormand-Prince is not symplectic.** It does not preserve phase-space
volume, so over very long spans energy drifts secularly rather than
oscillating. At the tolerances here that drift is 1e-14 per century, far
below the ephemeris error, so it is the right tool for this project. A
study over megayears would want a symplectic integrator (Wisdom-Holman
style) instead, and this contract should be revised if that day comes.

A consequence: **a backward run retraces a forward one to tolerance, not
bit for bit.** Reverse time is physically valid, because Newton's
equations are time-reversible, and a client must state which guarantee it
offers.

### Barycentric, never heliocentric

An N-body integration runs in a barycentric frame. In a heliocentric frame
the Sun is pinned, total momentum is not conserved, and the best available
check on the integrator is thrown away.

The conversion from heliocentric input is a real transformation, not a
translation, because the Sun accelerates:

```
V_sun = -(sum_i mu_i v_i) / (mu_sun + sum_i mu_i)
V_i   = v_i + V_sun
```

The denominator is the whole system's mu, not the Sun's, and the result
must be added to **every** planet. Getting either half wrong leaves every
body carrying the same spurious velocity: Jupiter alone contributes
12.5 m/s, which is 395,000 km of drift per year. It shows up as an
equal-length offset at unequal distances, growing linearly in time, and
nothing errors.

### Determinism

Identical inputs produce **bit-identical** outputs. There is no randomness
in the solar system and none in this engine. Asserted as bit equality, not
approximate equality, because a stray random, an iteration order that
depends on key insertion, or a scratch buffer leaking between runs would
all survive a tolerance check. **[verified in repo]**

---

## 9. Chaos is not randomness

Determinism does not mean predictability. The solar system is chaotic: two
initial conditions differing by a metre diverge exponentially, with a
Lyapunov time for the inner planets of roughly 5 million years.

This is a property of the equations, not of the implementation, and no
amount of numerical care removes it. It bounds how far any ephemeris can
usefully be propagated, and a client must not present a megayear
extrapolation as a prediction.

> Laskar, "A numerical experiment on the chaotic behaviour of the Solar
> System", *Nature* 338 (1989), 237. **[citation recalled]**

---

## 10. Resonance

Resonance is central here, not incidental.

- **The Laplace resonance.** Io, Europa and Ganymede are locked in
  1:2:4. JPL's satellite table lists Europa's period as exactly twice
  Io's, which is the resonance being imposed on the table rather than
  measured, and it does not match either moon's IAU rate. Both bodies
  carry a declared discrepancy naming the two sources.
- **The great inequality.** Jupiter and Saturn sit near a 2:5 commensur-
  ability, producing an exchange with a period of about 900 years. It is
  visible in the residuals as *anti-parallel radial offsets*: when
  Jupiter moves out, Saturn moves in. It is also why the differential
  influence of Jupiter on Saturn over 10 years is 19,502 Mm from J2000
  and 1,746 Mm from 2026, an elevenfold swing. **Never assert a ranking
  of gravitational influence without naming the epoch.** **[verified in
  repo]**
- **Spin-orbit.** Mercury is in a 3:2 spin-orbit resonance, so its
  solar day is two of its years.

---

## 11. Uncertainty

Every number carries its provenance and its error. A figure without an
error bar is a guess wearing a lab coat.

1. **Published errors are nominal, not bounds.** JPL calls its ephemeris
   figures nominal errors. Asserting every epoch inside them is the wrong
   test and fails on six of eight bodies with a correct implementation.
   Gate the RMS plus a per-epoch ceiling, scaled by a declared envelope.
2. **A widened envelope carries a written justification**, and a gate
   enforces that the justification exists and is substantial.
3. **Derived and external expectations are different things.** Derived
   means computed in-repo by an independent method, and is gated tightly.
   External means published, and is only as good as its citation.
4. **An unverified citation says so**, and carries a tolerance wide enough
   to be honest. Narrowing a tolerance around a half-remembered figure
   manufactures false precision.
5. **A failing gate is a finding, never a tolerance to loosen.**

> Gauss, *Theoria Motus Corporum Coelestium* (1809). Least squares, and
> the habit of stating what you do not know. **[citation recalled]**

---

## 12. Numerical precision

**Float64 everywhere a physical quantity is held.** Neptune sits at
4.5e12 m and a float32 step there is about 500 km, so single precision
anywhere in the physics quantises positions into visible jitter.

**Catastrophic cancellation** is the real hazard. Differencing two large
nearly-equal positions destroys significant digits, which is why:

- the floating origin subtracts in float64 and converts to float32 once,
  camera-relative, where the numbers are small (`floating-origin`);
- a moon's velocity by central difference uses an interval scaled to the
  body's own period, keeping truncation near 1e-8 while leaving nine
  significant digits in the difference;
- the barycentric conversion is done once at construction, not per frame.

**Angles are wrapped before differencing**, never after. The signed wrap
to (-pi, pi] is the one to use for a residual.

---

## 13. Constants

Use these exact values. A client carrying its own rounded copy drifts from
the rest.

| Constant | Value | Status |
|---|---|---|
| au | 149,597,870,700 m | IAU 2012, exact by definition |
| GM Sun | 1.327_124_400_41e20 m^3 s^-2 | |
| c | 299,792,458 m/s | exact by definition |
| Obliquity at J2000 | 84,381.406 arcsec | IAU 2006 |
| Julian year | 365.25 d | exact; not the tropical year |
| Julian century | 36,525 d | |
| Day | 86,400 s | |
| TT - TAI | 32.184 s | exact |

---

## 14. Where each piece lives

| Physics | Engine | Swift port |
|---|---|---|
| Units, constants, frames | `units.ts`, `vec.ts` | `Units.swift`, `Vec3.swift` |
| Time scales | `time.ts` | `Time.swift` |
| Kepler, Standish | `kepler.ts`, `data/planets.ts` | `Kepler.swift`, `Generated/` |
| Orbital elements | `elements.ts` | not ported |
| IAU rotation | `rotation.ts` | partial: rate only |
| Satellite planes | `bodies/position.ts`, `bodies/laplace.ts` | not ported |
| Propagation | `propagate.ts` | not ported |
| N-body | `nbody.ts`, `nbody-tracker.ts` | not ported |
| Secular theory | `secular.ts` | not ported |
| Relativity | `relativity.ts` | not ported |

---

## 15. What a new client must provide

A client is not finished until all of these hold.

1. **GM, never mass.** No `G` in the codebase.
2. **Float64 for every physical quantity**, including intermediates.
3. **Pairwise force accumulation**, so the third law holds to round-off.
4. **All three conservation checks**, reported, with the two-body null
   test among them.
5. **An analytic velocity**, gated against a central difference of the
   client's own position function.
6. **The indirect term** wherever a disturbing function appears.
7. **varpi = Omega + omega** for any apsidal rate, not the projected
   longitude.
8. **Barycentric N-body**, with the frame conversion done correctly.
9. **Bit-identical determinism** for identical inputs, asserted as bit
   equality.
10. **Declared error envelopes** with written justifications, gated
    against real JPL Horizons fixtures rather than against another
    implementation of the same tables.
11. **A cross-language drift gate.** A hand-port drifts, and a drifted
    physics engine does not throw. Emit residuals against the fixtures and
    have them checked. `website/src/swift-port.test.ts` is the pattern.
12. **Refusal over estimation.** A client that cannot resolve a quantity
    says so.

### The habit behind all of it

Every physical claim traces to a function; every function traces to a
gate; every gate compares against an independent published value rather
than against this project's own earlier output. A computed number is a
claim until something else verifies it.
