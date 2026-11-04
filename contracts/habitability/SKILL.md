---
name: habitability
description: What every client may claim about making a body habitable, and where each number comes from.
---

# Habitability

Every client offers the same question on a focused body: what would it take to live here? This
contract says what an answer is allowed to contain.

## The rule

**No habitability number is written in a client.** `engine/src/habitability.ts` computes the
assessment and `formatQuantity` renders it. The iOS client reads a table generated from that
module by `mobile/ios/SolarKit/generate.mjs`, and ports the physics by hand into
`SolarKit/Habitability.swift` so the port is gated rather than merely transcribed.

That split is deliberate. The prose is generated because several thousand words of sourced
explanation transcribed by hand is several thousand chances to drop a clause, and wrong prose
compiles perfectly and fails no test. The arithmetic is ported because generating it too would
have made the Swift gate circular: `HabitabilityTests` recomputes every headline figure from
the ported functions and compares it against the generated table, so a divergence between the
two languages fails a build.

## What an answer is made of

- **State.** Energy balance, gravity, escape velocity, pressure, radiation, day length. Each
  derived, never tabulated: equilibrium temperature from the IAU luminosity, the body's own
  semi-major axis and its **Bond** albedo, not the geometric albedo the body contracts carry.
- **Barriers.** Severity assigned from the physics, not by hand, so a body cannot be flattered
  by whoever wrote its entry. `fatal` means no engineering changes it. `severe` means
  planetary-scale work. `manageable` means a building.
- **A ladder.** Ordered steps, each with a mechanism, computed quantities, a timescale, a
  maturity (`demonstrated`, `engineering-extrapolation`, `speculative`) and a citation.
- **Caveats.** Every substitution named. Half the registry has no published Bond albedo and no
  radiation measurement; those are filled from documented fallbacks and declared, because the
  failure to guard against is not a missing panel but a confident one.

## Strategy is chosen by physics

`strategyFor` routes from measured quantities, never from a lookup table of body names. The
ordering matters and each branch earns its place:

1. A star is not a place, and the generic path gave the Sun Earth's insolation.
2. No solid surface at any depth means the only habitable structure floats.
3. A lethal surface dose sends you down **only where down helps**: Europa has an ocean under
   the ice, Io has the same radiation and no water, so they are not the same answer.
4. Past the runaway greenhouse limit the light has to go before any chemistry matters.
5. A body that cannot hold nitrogen for geological time gets sealed volumes, not an atmosphere.

## Claims that must survive their own numbers

These are results, not editorial, and `habitability.test.ts` checks each one:

- Mars is **inside** the conservative habitable zone. Distance is not what is wrong with Mars.
- Venus absorbs **less** sunlight than Earth. It is hot because of 92 bar of CO2, not proximity.
- At MAVEN's measured loss rate, stripping a full bar from Mars takes longer than the Sun has
  left on the main sequence. The missing magnetic field explains the past, not the future.
- Breathing air is a lifting gas on Venus and sinks on Jupiter. One ratio of molar masses
  separates the two aerostat cases.

## Sources, and which of them have been checked

Every step carries its own citation, and `citations.json` records what is actually known
about each one. 41 are registered with a DOI whose Crossref metadata was compared against the
cited author, year, journal and volume. 35 have no DOI to check, because they are books, JBIS
papers, NASA technical reports or conference abstracts, and each says so rather than resting
on the authority of a journal name.

That audit found one error in the machine-checked set. Juno's magnetic field model was cited
as Connerney et al. 2018, Nature 356; volume 356 of Nature is from 1992, so the citation was
impossible. It is Geophysical Research Letters 45, 2590.

Two gates keep it that way. `website/src/citations.test.ts` runs offline and requires every
author-and-year appearing in the module, its data or its commentary to be registered one way
or the other, so a new citation cannot be added without someone deciding whether it has been
checked. `./build.sh citations` re-resolves every DOI and is deliberately not part of
`./build.sh check`, because a gate that fails when the network is down teaches people to
ignore gates.

Every step carries its own citation. The survey backbone is Fogg, *Terraforming: Engineering
Planetary Environments* (SAE 1995) and Pierrehumbert, *Principles of Planetary Climate* (CUP
2010). Measured environment parameters and their provenance are in
`engine/src/data/habitability-environment.ts`, one source per field.

## Parity

`contracts/features.json` carries `habitability`. A client that ships it ships the whole
assessment: state, barriers, ladder and caveats. A client may lay it out differently; it may
not drop a barrier, round a quantity differently, or omit the caveats.
