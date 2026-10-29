import Foundation

/**
 Choosing which surface tiles to draw, as pure arithmetic.

 A port of `website/src/view/core/tiles.ts`, kept free of any renderer for the same reason the
 original is: the selection logic can then be gated as a unit test rather than judged from a
 screenshot. The question "does the renderer pick a tile level whose texel is finer than a
 screen pixel" has a numerical answer, and this is where it lives.
 */

public struct PyramidLevel: Sendable, Decodable {
    public let level: Int
    public let tilesX: Int
    public let tilesY: Int
    public let levelWidth: Int
    public let levelHeight: Int
    public let metresPerTexel: Double
}

public struct TerrainManifest: Sendable, Decodable {
    public let body: String
    public let tileSize: Int
    public let levels: [PyramidLevel]
    public let globalNormalMap: String
    public let globalWidth: Int
    public let referenceRadiusM: Double
    public let elevationRangeM: [Double]
    public let source: String
}

public struct TileId: Sendable, Hashable {
    public let level: Int
    public let x: Int
    public let y: Int

    public init(level: Int, x: Int, y: Int) {
        self.level = level
        self.x = x
        self.y = y
    }
}

/// Metres on the surface covered by one screen pixel at the given altitude.
public func metresPerPixel(
    altitudeM: Double, verticalFovRadians: Double, viewportHeightPx: Double
) -> Double {
    2 * max(altitudeM, 1) * tan(verticalFovRadians / 2) / viewportHeightPx
}

/**
 The coarsest level whose texel is at least as fine as a screen pixel.

 Coarsest rather than finest, deliberately. Going finer than the screen can resolve costs
 texture memory and download time for detail nobody can see, which is the same mistake as
 shipping an 8K texture for a body that is four pixels across.
 */
public func levelFor(
    _ manifest: TerrainManifest,
    altitudeM: Double,
    verticalFovRadians: Double,
    viewportHeightPx: Double
) -> PyramidLevel {
    let target = metresPerPixel(
        altitudeM: altitudeM,
        verticalFovRadians: verticalFovRadians,
        viewportHeightPx: viewportHeightPx
    )
    for level in manifest.levels where level.metresPerTexel <= target {
        return level
    }
    return manifest.levels[manifest.levels.count - 1]
}

/// Half-angle of the surface cap a camera at this altitude can see, radians.
/// The horizon sits where the line of sight is tangent to the sphere.
public func visibleCapAngle(radiusM: Double, altitudeM: Double) -> Double {
    let d = radiusM + max(altitudeM, 1)
    return acos(min(1, radiusM / d))
}

public struct SubCameraPoint: Sendable {
    /// Radians, -pi/2 at the south pole.
    public let latitude: Double
    /// Radians, 0 to 2pi.
    public let longitude: Double

    public init(latitude: Double, longitude: Double) {
        self.latitude = latitude
        self.longitude = longitude
    }
}

/**
 Tiles intersecting the visible cap, capped in count.

 The budget exists because a camera just above the surface sees a tiny cap but a camera far
 out sees a hemisphere, and at a deep level a hemisphere is thousands of tiles. When the cap
 needs more than the budget the caller should be at a coarser level, so returning a clamped
 set is the honest failure mode rather than queueing a thousand downloads.
 */
public func tilesInView(
    level: PyramidLevel,
    centre: SubCameraPoint,
    capAngle: Double,
    budget: Int = 24
) -> [TileId] {
    let latSpan = capAngle
    // Longitude span widens with latitude; near a pole the whole ring is visible.
    let cosLat = cos(centre.latitude)
    let lonSpan: Double = (abs(cosLat) < 1e-6 || capAngle >= Double.pi / 2)
        ? Double.pi
        : min(Double.pi, asin(min(1, sin(capAngle) / abs(cosLat))))

    func latToRow(_ lat: Double) -> Int {
        min(level.tilesY - 1,
            max(0, Int(floor(((Double.pi / 2 - lat) / Double.pi) * Double(level.tilesY)))))
    }
    func lonToCol(_ lon: Double) -> Int {
        let wrapped = lon.truncatingRemainder(dividingBy: 2 * Double.pi)
        let positive = wrapped < 0 ? wrapped + 2 * Double.pi : wrapped
        return min(level.tilesX - 1,
                   Int(floor((positive / (2 * Double.pi)) * Double(level.tilesX))))
    }

    let rowTop = latToRow(min(Double.pi / 2, centre.latitude + latSpan))
    let rowBottom = latToRow(max(-Double.pi / 2, centre.latitude - latSpan))

    var tiles: [TileId] = []
    var seen = Set<TileId>()
    let colCentre = lonToCol(centre.longitude)
    let colRadius = Int(ceil((lonSpan / (2 * Double.pi)) * Double(level.tilesX)))

    for row in rowTop ... max(rowTop, rowBottom) {
        for offset in -colRadius ... colRadius {
            let col = ((colCentre + offset) % level.tilesX + level.tilesX) % level.tilesX
            let tile = TileId(level: level.level, x: col, y: row)
            if seen.contains(tile) { continue }
            seen.insert(tile)
            tiles.append(tile)
            if tiles.count >= budget { return tiles }
        }
    }
    return tiles
}

/// The sphere-segment extent a tile covers, in radians.
public struct TileExtent: Sendable {
    public let phiStart: Double
    public let phiLength: Double
    public let thetaStart: Double
    public let thetaLength: Double
}

public func tileExtent(level: PyramidLevel, tile: TileId) -> TileExtent {
    TileExtent(
        phiStart: Double(tile.x) / Double(level.tilesX) * 2 * Double.pi,
        phiLength: 2 * Double.pi / Double(level.tilesX),
        thetaStart: Double(tile.y) / Double(level.tilesY) * Double.pi,
        thetaLength: Double.pi / Double(level.tilesY)
    )
}

/// Path of a tile relative to the terrain host, matching the website's layout exactly so the
/// phone and the browser fetch the identical bytes from the identical place.
public func tilePath(body: String, tile: TileId) -> String {
    "/terrain/\(body)/\(tile.level)/\(tile.x)-\(tile.y).jpg"
}

public func terrainManifestPath(body: String) -> String {
    "/terrain/\(body)/manifest.json"
}
