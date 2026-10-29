---
name: gravity-modes
description: The two ways a client can move the planets, what each guarantees, and what it must admit. Read before adding a body with mass, before offering time travel, and before claiming a simulation is physical.
---

# Gravity modes

Two modes, both correct about different things. Neither supersedes the
other and a client must not present one as an upgrade.

## On rails: the analytic ephemeris

Positions come from the Standish Keplerian tables. Accurate over the span
they were fitted for, cheap, exactly reversible, and nothing drifts.

**A mass you add changes nothing.** The tables are analytic fits, so a new
body cannot move Jupiter. Asteroid and spacecraft trajectories still feel
every planet, because the propagator builds its perturber list from the
body registry, but the planets themselves are on rails.

## Mutual gravity: full N-body

Initial conditions come from those same ephemerides at a chosen epoch,
then every body moves under the gravity of every other:

    d2 r_i / dt2 = sum over j != i of mu_j (r_j - r_i) / |r_j - r_i|^3

Barycentric, never heliocentric. A pinned Sun makes total momentum
non-conserved, which throws away the best free check on the integrator.

**Three conserved quantities are free checks.** Energy, momentum and
angular momentum come from the equation's symmetries and are never handed
to the integrator, so any drift in them is numerical error and nothing
else. Reference figures over 100 years with 9 bodies: energy 1.6e-14,
angular momentum 3.6e-14, barycentre drift 0.85 mm.

**The null test matters more than the positive one.** Two bodies alone
must precess by exactly zero. If they do not, the integrator is
manufacturing physics and every positive result is worthless.

## What a client must admit

A sequential integrator cannot follow a clock naively, and each failure
has to be visible rather than hidden:

- **It runs backwards.** Newton's equations are time-reversible, so a
  signed step is valid. Dormand-Prince is not symplectic, so a backward
  run retraces a forward one to tolerance, not bit for bit. Say which.
- **It jumps.** Scrubbing centuries cannot be integrated in a frame. Past
  a threshold the state is abandoned and re-seeded from the analytic
  ephemeris, which is a real discontinuity that loses the accumulated
  perturbation history. Report it.
- **It outruns gravity.** At a high time rate a frame may ask for more
  simulated time than the step budget allows. Do what fits and report the
  shortfall. Rendering stale positions as live ones is the dishonest
  failure.

## Cost

A single global step is set by the fastest body. Measured: eight planets
integrate a simulated century in 3.7 seconds; all 32 bodies take about
950, because Phobos orbits in 7.65 hours and drags the mean step from four
hours to 66 seconds. Offer the choice with the price stated.

## Measuring influence

"Does a planet pull the others" is answered differentially, never by
comparing against the analytic ephemeris. Run twice from bit-identical
initial conditions, once with a body's mass and once with it zeroed; the
separation is that body's gravity and nothing else. Comparing against the
fit instead measures the fit's own error, which is dominated by
along-track drift from an imperfect initial semi-major axis.

The result is strongly epoch dependent. Jupiter's 10-year displacement of
Saturn is 19,502 Mm from J2000 and 1,746 Mm from 2026, an elevenfold swing
driven by the phase of the 900-year great inequality. Never assert a
ranking.

## What a new client must provide

- Both modes, with the active one named on screen.
- Conserved-quantity reporting, and the two-body null test.
- Honest lag, re-seed and drift reporting.
- Determinism: identical inputs give bit-identical output. There is no
  randomness in the solar system. Chaos is a separate matter; the inner
  planets have a Lyapunov time of a few million years, which limits
  prediction without introducing any randomness.
