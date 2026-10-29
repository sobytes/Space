# mobile/

Phone and tablet clients.

| Folder | State | Stack |
|---|---|---|
| `ios/` | **working** | SwiftUI + SceneKit over SolarKit, a Swift package |
| `android/` | not started | Kotlin + Compose, with a Kotlin port of the engine |

Neither can import `@solar/engine`, so each hand-ports what it needs and keeps a test suite
that mirrors the engine's gates case for case, measured against the same JPL Horizons
fixtures. `contracts/` holds the rules those ports have to meet, and each contract ends with
what a new platform must provide.

The drift check is not optional. `website/src/swift-port.test.ts` reads the residuals
`swift test` writes and asserts the TypeScript engine reproduces them to one part in a
billion. A port that drifts turns the normal `./build.sh check` run red rather than being
discovered when a planet is in the wrong place on a phone.
