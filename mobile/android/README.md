# mobile/android

Not started.

Intended stack: Kotlin and Compose, with a Kotlin port of the engine mirroring
`mobile/ios/SolarKit`. Rendering is an open question; Filament is the likely answer for a
scene at this dynamic range.

Before writing any of it, read every contract in `contracts/`. Each ends with what a new
platform has to provide, and a client is not done until it meets all of them. In particular:

- `generate.mjs` under the Kotlin source should emit the Standish tables, leap seconds and
  accuracy envelopes the same way the Swift one does. Four hundred numbers typed by hand is
  four hundred chances to put a digit in the wrong column, and a wrong element renders as a
  planet in a plausible but wrong place rather than as an error.
- The drift gate is the deliverable that matters as much as the app. Emit residuals against
  the JPL Horizons fixtures and have the website's test suite check them, the way
  `website/src/swift-port.test.ts` does for Swift.
