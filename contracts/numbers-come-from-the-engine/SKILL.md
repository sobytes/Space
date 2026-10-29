---
name: numbers-come-from-the-engine
description: The rule that keeps the AI layer and the UI honest. Read before adding an AI tool, before writing any text that contains a figure, and before letting a model describe a result.
---

# Numbers come from the engine

**The rule: no client, and no language model, ever states a quantity the
engine did not compute in that same interaction.**

This is not a style preference. Ask a language model to integrate an orbit
and it returns a fluent, confident, wrong number, and the failure is
invisible because a wrong orbit renders exactly like a right one. A tool
surface is the only way to have the conversational interface without
inheriting that.

## How it is enforced

Every tool is a thin wrapper over a named engine function and declares
which one in a `backedBy` field. The gate:

1. Walks the engine tree and requires each named symbol to be a real
   export. The list of files is discovered, never hardcoded; a hardcoded
   list went stale the first time a tool was backed by a new module.
2. Compares tool output against a direct call to the same engine function
   with **exact equality**, so a hand-rounded literal fails.
3. Requires each tool to refuse an unknown body, an unparseable date and
   a missing demonstration, rather than inventing a result.
4. Asserts the engine walk found something, because a walk that finds
   nothing passes every assertion it owns.

## The system prompt carries the rule

The model is told, in the prompt itself, that it does not produce numbers,
that it must call a tool and then explain what came back, and that it must
pass on any caveat or known discrepancy a tool reports. A plausible wrong
figure is worse than no figure, because the viewer cannot tell which they
have.

## Say what the viewer is actually seeing

The same honesty applies to the UI, not just to the AI.

- Surface relief smooths out below the altitude where the screen
  out-resolves the elevation data. The UI says that, with the sample
  spacing, rather than letting someone conclude the Moon is flat.
- A time rate of "1 day/s" is accurate and tells a viewer nothing. The
  panel also says what it means for the body in view: one turn every 1.00
  second on screen. Someone read Earth spinning once a second as a bug.
- Mutual-gravity mode reports its own accumulated energy drift and how far
  behind the clock it is.

## What a new client must provide

- A tool or service layer where every figure traces to an engine call.
- Exact-equality tests between the client's rendering of a number and the
  engine's value.
- Visible provenance for every quantity on screen.
- A way to say "this model cannot resolve that", and the willingness to.
