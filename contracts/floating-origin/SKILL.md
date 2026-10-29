---
name: floating-origin
description: How a client renders ten orders of magnitude without jitter or depth artifacts. Read before touching camera placement, scene transforms, or anything that converts a physical position into a render coordinate.
---

# Floating origin

The scene spans from a crater a few metres across to Neptune's orbit at
4.5e12 m, about ten orders of magnitude. No single-precision renderer can
hold that, and GPUs are single precision.

**The rule: the render origin tracks the focused body, and the conversion
from physical float64 to render float32 happens in exactly one place.**

## Why

A float32 holds roughly 24 bits of mantissa. At Neptune's distance one
float32 step is about 500 km, so a body placed at its true coordinate
jitters by hundreds of kilometres between frames. Subtracting the focused
body's position first means only small deltas ever reach float32, and the
focused body sits at exactly (0,0,0), which also removes the usual source
of jitter in a camera chasing something at 1e12 m.

## Consequences a client must honour

1. **One writer.** Exactly one module converts float64 to float32 and
   writes a transform. Everything else asks it. In the TypeScript client
   this is enforced by a source-scanning test with a declared list of
   writers, each carrying a justification, and the test also rejects a
   stale declaration.
2. **The focused body is the origin**, so the direction to the Sun from it
   is simply the normalised negative of the origin.
3. **Depth is planned, not fixed.** A logarithmic depth buffer plus a
   per-frame near and far chosen from the actual scene contents, with a
   bounded ratio.
4. **Disable automatic matrix updates** on anything the origin writes, or
   the scene graph will overwrite it.

## What happened

Four separate bugs, all invisible in a still screenshot:

- With automatic matrix updates off, the renderer composed the world
  matrix once and never again, so every body stayed at the origin at one
  metre. The fix is to mark the world matrix dirty explicitly.
- The projection used only the rotation part of the view matrix and
  dropped the translation column, so every distance was reported as the
  offset from the origin rather than from the camera. The focused body's
  offset is exactly zero, so the depth planner believed the camera was on
  the surface and clamped the far plane to 5,000 km with the camera
  38,000 km out.
- The light was placed at the render origin, which is the focused body,
  not the Sun. Earth, Mars and the Moon rendered unlit.
- The camera was placed using a Sun direction read from a stale origin,
  because changing focus does not recompute the origin; the frame loop
  does, on its next tick. Short hops looked fine and a jump across the
  system arrived over the night side.

## What a new client must provide

- A single conversion point, with a test that proves it is single.
- A per-frame depth plan with a stated maximum ratio.
- A test that flies a decade sweep and asserts no clipping at any scale.
- A measurement that the scene actually animates. A frozen scene that
  renders correctly is identical in a screenshot to a working one.
