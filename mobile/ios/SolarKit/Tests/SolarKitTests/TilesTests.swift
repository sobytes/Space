import XCTest
@testable import SolarKit

/**
 The tile selection maths, gated the same way the website gates it.

 Mirrors `website/src/view/core/tiles.test.ts` case for case. The point of keeping this logic
 free of any renderer is that it can be checked numerically rather than judged from a
 screenshot, and a port that drifts here picks the wrong level and nobody notices until a
 crater is a blur.
 */
final class TilesTests: XCTestCase {

    /// The Moon's pyramid, matching what `build-terrain.mjs` writes.
    private let manifest = TerrainManifest(
        body: "moon",
        tileSize: 512,
        levels: [
            PyramidLevel(level: 0, tilesX: 2, tilesY: 1, levelWidth: 1024, levelHeight: 512,
                         metresPerTexel: 10_660.552883490052),
            PyramidLevel(level: 1, tilesX: 4, tilesY: 2, levelWidth: 2048, levelHeight: 1024,
                         metresPerTexel: 5_330.276441745026),
            PyramidLevel(level: 2, tilesX: 8, tilesY: 4, levelWidth: 4096, levelHeight: 2048,
                         metresPerTexel: 2_665.138220872513),
            PyramidLevel(level: 3, tilesX: 16, tilesY: 8, levelWidth: 8192, levelHeight: 4096,
                         metresPerTexel: 1_332.5691104362565),
        ],
        globalNormalMap: "normal-global.jpg",
        globalWidth: 8192,
        referenceRadiusM: 1_737_400,
        elevationRangeM: [-9_106, 10_747],
        source: "LRO LOLA"
    )

    private let fov = 55.0 * Double.pi / 180
    private let height = 900.0

    func testAPixelCoversLessGroundTheCloserYouGet() {
        var previous = Double.infinity
        for altitude in [1e7, 1e6, 1e5, 1e4] {
            let metres = metresPerPixel(
                altitudeM: altitude, verticalFovRadians: fov, viewportHeightPx: height
            )
            XCTAssertLessThan(metres, previous)
            previous = metres
        }
    }

    func testPicksACoarseLevelFarAwayAndAFineOneClose() {
        let far = levelFor(manifest, altitudeM: 5e7, verticalFovRadians: fov, viewportHeightPx: height)
        let near = levelFor(manifest, altitudeM: 2e5, verticalFovRadians: fov, viewportHeightPx: height)
        XCTAssertLessThan(far.level, near.level)
    }

    /// Coarsest-that-suffices, never finer than the screen can show.
    func testNeverPicksALevelFinerThanTheScreenCanShow() {
        for altitude in [1e4, 1e5, 1e6, 1e7, 1e8] {
            let target = metresPerPixel(
                altitudeM: altitude, verticalFovRadians: fov, viewportHeightPx: height
            )
            let chosen = levelFor(
                manifest, altitudeM: altitude, verticalFovRadians: fov, viewportHeightPx: height
            )
            if chosen.level > 0 {
                let coarser = manifest.levels[chosen.level - 1]
                XCTAssertGreaterThan(
                    coarser.metresPerTexel, target,
                    "a coarser level would also have sufficed at \(altitude) m"
                )
            }
        }
    }

    func testSaturatesAtTheDeepestLevelWhenVeryClose() {
        let chosen = levelFor(manifest, altitudeM: 10, verticalFovRadians: fov, viewportHeightPx: height)
        XCTAssertEqual(chosen.level, manifest.levels.count - 1)
    }

    func testSeesASmallCapLowDownAndMostOfAHemisphereFarOut() {
        let low = visibleCapAngle(radiusM: 1_737_400, altitudeM: 1_000)
        let high = visibleCapAngle(radiusM: 1_737_400, altitudeM: 1e9)
        XCTAssertLessThan(low, 0.1)
        XCTAssertGreaterThan(high, 1.5)
        XCTAssertLessThan(high, Double.pi / 2)
    }

    func testNeverExceedsItsTileBudget() {
        let level = manifest.levels[3]
        let tiles = tilesInView(
            level: level,
            centre: SubCameraPoint(latitude: 0, longitude: 0),
            capAngle: Double.pi / 2,
            budget: 24
        )
        XCTAssertLessThanOrEqual(tiles.count, 24)
    }

    func testReturnsNoDuplicates() {
        let level = manifest.levels[2]
        let tiles = tilesInView(
            level: level,
            centre: SubCameraPoint(latitude: 0.3, longitude: 1.2),
            capAngle: 0.8
        )
        XCTAssertEqual(Set(tiles).count, tiles.count)
    }

    /// Longitude wraps rather than running off the edge of the map.
    func testWrapsLongitude() {
        let level = manifest.levels[2]
        let tiles = tilesInView(
            level: level,
            centre: SubCameraPoint(latitude: 0, longitude: 0.01),
            capAngle: 0.6
        )
        XCTAssertTrue(tiles.contains { $0.x == level.tilesX - 1 },
                      "a cap straddling zero longitude must include the last column")
        for tile in tiles {
            XCTAssertGreaterThanOrEqual(tile.x, 0)
            XCTAssertLessThan(tile.x, level.tilesX)
        }
    }

    /// At a pole every longitude is in view, and nothing may fall outside the row range.
    func testCopesWithThePoles() {
        let level = manifest.levels[1]
        for latitude in [Double.pi / 2, -Double.pi / 2] {
            let tiles = tilesInView(
                level: level,
                centre: SubCameraPoint(latitude: latitude, longitude: 0),
                capAngle: 0.5,
                budget: 64
            )
            XCTAssertFalse(tiles.isEmpty)
            for tile in tiles {
                XCTAssertGreaterThanOrEqual(tile.y, 0)
                XCTAssertLessThan(tile.y, level.tilesY)
            }
        }
    }

    /**
     Every level tiles the whole sphere exactly once.

     Summed solid angle must be 4 pi steradians. This is the check that catches an off-by-one
     in the row or column mapping, which otherwise shows up as a seam or an overlap that is
     easy to mistake for a texture problem.
     */
    func testCoversTheWholeSphereExactlyOnceAtEveryLevel() {
        for level in manifest.levels {
            var total = 0.0
            for y in 0 ..< level.tilesY {
                for x in 0 ..< level.tilesX {
                    let extent = tileExtent(level: level, tile: TileId(level: level.level, x: x, y: y))
                    // Solid angle of a sphere segment: dphi * (cos(theta0) - cos(theta1)).
                    total += extent.phiLength
                        * (cos(extent.thetaStart) - cos(extent.thetaStart + extent.thetaLength))
                }
            }
            XCTAssertEqual(total, 4 * Double.pi, accuracy: 1e-9,
                           "level \(level.level) does not cover the sphere exactly once")
        }
    }

    func testBuildsPathsMatchingWhatThePipelineWrites() {
        XCTAssertEqual(
            tilePath(body: "moon", tile: TileId(level: 3, x: 5, y: 2)),
            "/terrain/moon/3/5-2.jpg"
        )
        XCTAssertEqual(terrainManifestPath(body: "moon"), "/terrain/moon/manifest.json")
    }
}
