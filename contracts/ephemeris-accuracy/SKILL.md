---
name: ephemeris-accuracy
description: Where planet positions come from, how wrong they are allowed to be, and how a client states that. Read before changing a position source, before widening a tolerance, and before showing a position without its error bar.
---

# Ephemeris accuracy

Planet positions come from the JPL Standish approximate-elements tables,
two of them: a short-span set fitted for 1800 to 2050 and a long-span set
for 3000 BC to 3000 AD. They disagree at the seam, so a span that crosses
1800 or 2050 must pass one model explicitly rather than letting the year
pick.

**The rule: a number without its error bar is a guess wearing a lab coat.**

## Errors are nominal, not bounds

JPL publishes a per-body error table and calls the figures "nominal
errors". They are not maxima. Asserting that every epoch falls inside them
is the wrong test and it fails on six of eight bodies with a correct
implementation.

The right test is the root-mean-square residual against nominal, plus a
ceiling on any single epoch, both scaled by a **declared envelope** per
body. Any body whose envelope exceeds JPL's nominal carries a written
justification, and a gate enforces that the justification exists and is
substantial. That is what stops a tolerance being widened quietly to make
a red build green.

## Declared uncertainty is a first-class artifact

Two kinds of expectation exist and they are not interchangeable.

- **Derived**: computed in this repository by an independent method. A
  disagreement means one of the two is wrong, so these are gated tightly.
- **External**: a published number. Strong evidence with a solid citation,
  worthless when misremembered. An expectation recorded without a checked
  citation is marked unverified, must say what is missing, and must carry
  a tolerance wide enough to be honest about it.

Narrowing a tolerance around a half-remembered figure manufactures false
precision. The remedy is a citation, not a tighter bound.

## What happened

Uranus and Neptune needed envelopes wider than nominal, which could mean
the table is poor or the implementation is wrong. Rather than assume, an
independent theory, VSOP87, was run over the same Horizons fixtures.
Uranus came out decisive: Standish 54.9 arcsec against VSOP87's 4.6, a
factor of twelve, so the residual is a property of the table. Neptune was
30.7 against 10.2, suggestive but not decisive, and the justification says
so. Mercury's Standish result was better than VSOP87's.

## What a new client must provide

- Both element tables, with explicit model selection across the seam.
- A per-body declared envelope with a required justification field.
- RMS-plus-ceiling tests against real JPL Horizons fixtures, not against
  another implementation of the same tables.
- A visible statement of the current body's positional accuracy in the UI.
- A refusal to state a quantity the model cannot resolve. "The Standish
  tables cannot resolve that" is a better answer than a confident number.
