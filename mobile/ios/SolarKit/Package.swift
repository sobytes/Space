// swift-tools-version: 6.0
import PackageDescription

/**
 SolarKit: the Swift port of the solar engine.

 The TypeScript engine in `engine/` is the single source of truth for the physics. Swift cannot
 import it, so the parts the Apple clients need are hand-ported here and checked against the
 same JPL Horizons fixtures, to the same tolerances, as the original. See `contracts/` for the
 rules a port has to meet, and `Tests/` for the mirrored gates that catch drift.

 The Standish element tables are not hand-typed. `Generated/StandishTables.swift` is emitted
 from the TypeScript by `mobile/ios/SolarKit/generate.mjs`, so the two cannot disagree about a
 digit. Everything else in `Sources/` is a deliberate re-implementation.

 Builds for macOS as well as iOS so the gates run headlessly in a second, without a simulator.
 */
let package = Package(
    name: "SolarKit",
    platforms: [.iOS(.v17), .macOS(.v14), .tvOS(.v17)],
    products: [
        .library(name: "SolarKit", targets: ["SolarKit"])
    ],
    targets: [
        .target(name: "SolarKit"),
        .testTarget(name: "SolarKitTests", dependencies: ["SolarKit"])
    ]
)
