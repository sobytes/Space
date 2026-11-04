import Foundation
import SceneKit
import SolarKit

/**
 Surface relief from real elevation data.

 Two pieces, the same two the website has.

 The **global normal map** is bundled, one texture per body that has one, and is what makes
 craters shade correctly through the terminator at orbital range. It is applied whenever the
 body is drawn, costs nothing per frame, and is the larger share of the visible effect.

 The **tile pyramid** is streamed from the terrain host on demand, because the Moon's alone is
 13 MB across four levels and that does not belong in a binary. The level is chosen by the
 ported arithmetic in SolarKit's `Tiles.swift`, which picks the coarsest level whose texel is
 still finer than a screen pixel.

 ## The honest limit

 Below roughly 1,000 km the screen out-resolves the data. LRO LOLA at 64 pixels per degree is
 474 m per sample, so the ground smooths out and that is the elevation model running out, not
 a flat Moon. The UI says so rather than leaving someone to conclude otherwise. Measured on
 the website: relief contrast peaks at 2,000 km and holds from 1,000 to 20,000 km.
 */
@MainActor
final class Terrain {
    struct Surface {
        let manifest: TerrainManifest
        let normalMap: UIImage
    }

    private var surfaces: [BodyId: Surface] = [:]
    private var tileCache: [TileId: UIImage] = [:]
    private var inFlight: Set<TileId> = []

    /// Where streamed tiles come from. The same host the Ask screen uses.
    var host: String {
        UserDefaults.standard.string(forKey: "solar.apiHost") ?? "http://localhost:3000"
    }

    init() {
        for id in bodyIds { load(id) }
    }

    private func load(_ body: BodyId) {
        let name = body.rawValue
        guard
            let manifestUrl = Bundle.main.url(
                forResource: "\(name)-manifest", withExtension: "json", subdirectory: "Terrain"
            ) ?? Bundle.main.url(forResource: "\(name)-manifest", withExtension: "json"),
            let data = try? Data(contentsOf: manifestUrl),
            let manifest = try? JSONDecoder().decode(TerrainManifest.self, from: data),
            let normalUrl = Bundle.main.url(
                forResource: "\(name)-normal", withExtension: "jpg", subdirectory: "Terrain"
            ) ?? Bundle.main.url(forResource: "\(name)-normal", withExtension: "jpg"),
            let normal = UIImage(contentsOfFile: normalUrl.path)
        else { return }

        surfaces[body] = Surface(manifest: manifest, normalMap: normal)
    }

    func surface(for body: BodyId) -> Surface? { surfaces[body] }
    func hasTerrain(_ body: BodyId) -> Bool { surfaces[body] != nil }

    /**
     Altitude below which the screen out-resolves the elevation data, metres.

     Derived from the manifest's finest level rather than hardcoded, so it tracks whatever
     data is actually shipped: the altitude at which one screen pixel covers one texel.
     */
    func smoothBelowM(for body: BodyId, verticalFovRadians: Double, viewportHeightPx: Double) -> Double? {
        guard let finest = surfaces[body]?.manifest.levels.last else { return nil }
        // Invert metresPerPixel for the altitude where a pixel equals a texel.
        return finest.metresPerTexel * viewportHeightPx / (2 * tan(verticalFovRadians / 2))
    }

    /// Fetches a tile, caching it. Returns nil until it arrives; the global normal map covers
    /// the gap, so a slow network degrades detail rather than showing a hole.
    func tile(_ id: TileId, body: BodyId, onArrival: @escaping @MainActor () -> Void) -> UIImage? {
        if let cached = tileCache[id] { return cached }
        guard !inFlight.contains(id) else { return nil }
        guard let url = URL(string: host + tilePath(body: body.rawValue, tile: id)) else { return nil }

        inFlight.insert(id)
        Task { [weak self] in
            defer { Task { @MainActor in self?.inFlight.remove(id) } }
            guard let (data, response) = try? await URLSession.shared.data(from: url),
                  (response as? HTTPURLResponse)?.statusCode == 200,
                  let image = UIImage(data: data) else { return }
            await MainActor.run {
                self?.tileCache[id] = image
                onArrival()
            }
        }
        return nil
    }

    var cachedTileCount: Int { tileCache.count }
}

/**
 A sphere patch covering one tile's lat/lon extent.

 SceneKit's `SCNSphere` is all or nothing, so a tile needs its own geometry. This builds the
 grid directly: positions on the unit sphere, normals equal to the positions because it is a
 unit sphere, and texture coordinates spanning the tile so the tile's own image maps onto it
 without an atlas offset.

 The patch sits very slightly above the body's surface. Coincident surfaces z-fight, and the
 artefact looks exactly like a corrupt texture, which is a confusing thing to debug.
 */
@MainActor
enum TilePatch {
    static let liftFactor: Float = 1.0008

    /**
     Two sets of texture coordinates, which is the whole trick.

     Channel 0 holds the body's **global** equirectangular coordinates, so the patch samples
     the same albedo as the sphere underneath and the imagery lines up seamlessly. Channel 1
     holds the tile's own 0 to 1 span, so the streamed normal map maps onto the patch without
     an atlas offset.

     A single channel forces a choice between the two, and choosing wrong paints a white
     rectangle over the surface, which looks like a blown-out exposure rather than a mapping
     error.
     */
    /**
     A flat annulus for a ring system, with the texture mapped radially.

     `SCNTube` is the obvious shape and the wrong one. It has inner and outer walls as well as
     the two annular faces, so a ring a thousandth of a radius thick still renders its inner
     wall, which shows as a hard black band hugging the planet. Its UVs also wrap the texture
     around the tube rather than across it, while a ring texture is a radial strip: one pixel
     column per distance from the planet.

     So: one flat ring of triangles, `u` running from the inner edge to the outer, which is
     what the imagery expects.
     */
    static func annulus(innerRadius: Double, outerRadius: Double, segments: Int = 180) -> SCNGeometry {
        var positions: [SCNVector3] = []
        var normals: [SCNVector3] = []
        var uvs: [CGPoint] = []

        for i in 0 ... segments {
            let angle = 2 * Double.pi * Double(i) / Double(segments)
            let c = Float(cos(angle))
            let s = Float(sin(angle))
            for (edge, radius) in [(0.0, innerRadius), (1.0, outerRadius)] {
                positions.append(SCNVector3(c * Float(radius), 0, s * Float(radius)))
                normals.append(SCNVector3(0, 1, 0))
                uvs.append(CGPoint(x: edge, y: 0.5))
            }
        }

        var indices: [Int32] = []
        for i in 0 ..< segments {
            let a = Int32(i * 2)
            let b = Int32(i * 2 + 1)
            let c = Int32((i + 1) * 2)
            let d = Int32((i + 1) * 2 + 1)
            indices.append(contentsOf: [a, c, b, b, c, d])
        }

        return SCNGeometry(
            sources: [
                SCNGeometrySource(vertices: positions),
                SCNGeometrySource(normals: normals),
                SCNGeometrySource(textureCoordinates: uvs),
            ],
            elements: [SCNGeometryElement(indices: indices, primitiveType: .triangles)]
        )
    }

    static func geometry(extent: TileExtent, segments: Int = 24) -> SCNGeometry {
        var positions: [SCNVector3] = []
        var normals: [SCNVector3] = []
        var globalUVs: [CGPoint] = []
        var tileUVs: [CGPoint] = []

        for row in 0 ... segments {
            let v = Double(row) / Double(segments)
            let theta = extent.thetaStart + v * extent.thetaLength
            for column in 0 ... segments {
                let u = Double(column) / Double(segments)
                let phi = extent.phiStart + u * extent.phiLength

                // SceneKit's y is the pole here, matching how the bodies are built.
                let x = Float(sin(theta) * cos(phi))
                let y = Float(cos(theta))
                let z = Float(-sin(theta) * sin(phi))

                positions.append(SCNVector3(x * liftFactor, y * liftFactor, z * liftFactor))
                normals.append(SCNVector3(x, y, z))
                globalUVs.append(CGPoint(
                    x: phi / (2 * Double.pi),
                    y: theta / Double.pi
                ))
                tileUVs.append(CGPoint(x: u, y: v))
            }
        }

        var indices: [Int32] = []
        let stride = segments + 1
        for row in 0 ..< segments {
            for column in 0 ..< segments {
                let a = Int32(row * stride + column)
                let b = Int32(row * stride + column + 1)
                let c = Int32((row + 1) * stride + column)
                let d = Int32((row + 1) * stride + column + 1)
                indices.append(contentsOf: [a, c, b, b, c, d])
            }
        }

        return SCNGeometry(
            sources: [
                SCNGeometrySource(vertices: positions),
                SCNGeometrySource(normals: normals),
                SCNGeometrySource(textureCoordinates: globalUVs),
                SCNGeometrySource(textureCoordinates: tileUVs),
            ],
            elements: [SCNGeometryElement(indices: indices, primitiveType: .triangles)]
        )
    }
}
