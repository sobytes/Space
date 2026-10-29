# mobile/ios

The iPhone app.

```
SolarKit/        Swift package: the ported engine, and the gates that keep it honest
  generate.mjs   emits the Standish tables, leap seconds, accuracy envelopes and body
                 display data from engine/src. Do not hand-edit anything in Generated/.
App/Sources/     SwiftUI shell, SceneKit scene, clock
project.yml      XcodeGen spec. Solar.xcodeproj is generated and not committed.
residuals.json   written by `swift test`, read by the website's drift gate. Committed.
```

## Running it

```
./build.sh ios run         build, install and launch on a simulator
./build.sh ios test        SolarKit against the JPL Horizons fixtures
./build.sh generate        re-emit the generated Swift after an engine change
```

Set `SOLAR_SIMULATOR` to pick a device; it defaults to iPhone 17 Pro.

## What is ported, and what is not

Ported and gated: units and frames, the four time scales with the full leap-second table,
the Standish Keplerian solver with its exact analytic velocity, and the accuracy envelopes.

Not yet ported: IAU rotation elements beyond a sidereal spin, the moons, the Dormand-Prince
propagator, N-body, secular theory, the launch model and the AI tools. The app currently
spins each planet from its sidereal period rather than from W0 and W1, which is right for the
rate and does not place the prime meridian correctly. That is a stated gap, not an
approximation anyone should rely on.

## Rendering, and the honest part

One scene unit is about one astronomical unit. SceneKit works in Float, and a Float at
Neptune's 4.5e12 m quantises to roughly 500 km, so physical metres never go straight into a
node position.

This is a system view, so a fixed divisor is enough. Flying down to a surface needs the
floating origin from `contracts/floating-origin`: subtract the focused body's position in
Double first so only small deltas reach Float. `renderPosition` is the single place that
conversion happens, so that change lands in one function.

Body radii are exaggerated to be visible, the Sun on its own fixed size because sharing the
planets' factor made it 1.5 units across and swallowed Mercury's orbit at 0.387. The panel
always reports the true radius.
