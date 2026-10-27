# Render core design, synthesised

Produced by the `architect` skill's Phase B. Two runners on different models were given the
same brief independently and each asked for two structurally distinct candidates. This file is
the synthesis, written so the decision-trail row pointing at it actually resolves.

## The fork

Both runners were asked to explore where responsibility for writing a body's transform should
live. Both produced the same two shapes and both recommended the same one.

| | Centralised | Decentralised |
|---|---|---|
| Runner A called it | `Viewport` | `Frame` threaded through |
| Runner B called it | Origin Authority | Self-Resolving Bodies |
| Who writes a transform | one object, one call site | each body component, N call sites |
| Recommended by | both | neither |

## Why the decentralised shape lost

Both runners rejected it on the same ground, independently, which is the strongest signal this
exercise produced. "Never write a true world coordinate into a THREE.Vector3" is a single-writer
invariant. A design with one writer per body cannot hold it with types, only with convention,
and convention does not survive a contributor who opens one file and copies the nearest example.

Runner B scored the two against the design red flags and found the decentralised shape tripping
five of eight: shallow module, information leakage, pass-through method, split ownership, and
two ways to do one task. Split ownership was judged unfixable within that shape.

## What was taken from each

From runner A, the ideas that shaped the implementation:

- **`positionAt(epoch)` rather than `step(dt)`.** Forced by the engine rather than chosen, since
  `heliocentricPosition` is a pure function of an instant. This is why the clock can run at a
  century a second with no propagator step limit having an opinion about it.
- **`planDepth` as a pure named function with a published bound.** Turns predicate P8's numeric
  half into a unit test instead of a screenshot. Implemented as `src/view/core/depth.ts`.
- **One unit equals one metre, no scale factor.** Camera-relative placement makes magnitude
  irrelevant and depth ratio is the thing that actually breaks, so a scale conversion would add
  a step someone eventually applies twice or not at all.
- **The screen placement index serving picking, labels and LOD from one structure**, so those
  three cannot disagree about where a body is.

From runner B:

- **Bodies stay declarative JSX.** Appearance is a React concern; position is not. Implemented
  as `Body.tsx` declaring geometry and materials while the Viewport writes the transform.

## What was deferred, and the forward cost

- The NASA Eyes blended `gl_FragDepth` is not built. `DepthPlan.blendDistance` is computed so a
  later material override has its number ready. Cost of leaving the door open: one line.
- `reversedDepthBuffer` stays off. three.js gates it on the `EXT_clip_control` extension, so it
  is a probe-then-enable, never an assume.
- Tiled surfaces are not built. The seam is that a body's group already carries the
  camera-relative transform, so a tile renderer parented there inherits the floating origin.

## The precision argument, restated

Runner A's sharpest contribution, and worth keeping visible because it recurs: the invariant is
not "never a large float32 number". It is "never a float32 error you can resolve". An orbit
polyline 500 m off at Neptune's distance is sub-pixel forever. That is why orbit vertices stay
in true heliocentric metres while body transforms do not, and why `invariants.test.ts` lists
declared writers with reasons rather than banning float32 outright.

## What would make this design wrong

Named up front so the signal is recognisable later.

- If drei or the post-processing composer legitimately mutates transforms on attached nodes, the
  single-writer claim becomes prose and this is the decentralised shape with extra indirection.
- If something genuinely cannot be expressed as a pure function of an instant, the anchor
  abstraction is wrong and the unbounded clock rate goes with it.
- If an instanced asteroid belt cannot be expressed as one registration, a second placement path
  arrives and "two ways to do one task" lands after all.
