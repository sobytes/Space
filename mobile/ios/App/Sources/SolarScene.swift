import Foundation
import SceneKit
import SolarKit

/**
 The SceneKit scene, positioned entirely from SolarKit.

 Nothing here invents a number. Positions come from `heliocentricState`, radii and colours from
 the generated body display data, and rotation from the sidereal period. That is the rule in
 `contracts/numbers-come-from-the-engine`, and it is what lets the iPhone and the website agree.

 ## Scale

 SceneKit works in Float, and the system spans 4.5e12 m, so physical metres cannot go straight
 into a node position: a Float at Neptune's distance quantises to about 500 km. This first
 version is a system view, so it divides by a fixed `metresPerUnit` chosen to put Neptune at a
 comfortable 30 units, which keeps every coordinate in the range Float holds exactly.

 That is deliberately not the full answer. Flying down to a surface needs the floating origin
 from `contracts/floating-origin`: subtract the focused body's position in Double first, so
 only small deltas reach Float. The structure here keeps the conversion in one function,
 `renderPosition`, so that change lands in one place.

 Bodies are drawn at an exaggerated radius because at true scale the Sun is a third of a pixel
 at this zoom and the planets are invisible. The exaggeration is a stated constant rather than
 a fudge, and the panel reports the real radius.
 */
@MainActor
final class SolarScene {
    /// One scene unit is this many metres. Neptune's 4.5e12 m lands at 30 units.
    static let metresPerUnit: Double = 1.5e11

    /**
     How big a body is drawn.

     One scene unit is about one astronomical unit, so true radii are hopeless: Earth is
     4.2e-5 units, far under a pixel. Some exaggeration is unavoidable.

     The first attempt exaggerated by a constant and clamped hard to [0.045, 0.10]. That is a
     2.2-fold spread across bodies whose real radii span 29-fold, Mercury's 2,441 km to
     Jupiter's 71,492, so every planet came out the same size and the clamp, not the data, was
     doing the talking.

     A square root instead. Sizes stay ordered and the spread is 5.4-fold, enough that Jupiter
     reads as a giant and Mercury stays visible at a few pixels. The compression is stated
     rather than hidden, and the panel always shows the true radius, so no number is fudged.

     The Sun keeps a fixed size. On the same curve it would be 10.4 Earth radii, 0.36 units,
     which reaches Mercury's orbit at 0.387 and reads as a Sun that really is that big.
     */
    static let earthRenderRadius: Double = 0.052
    static let earthRadiusM: Double = 6_378_137
    static let sunRenderRadius: CGFloat = 0.15

    let scene = SCNScene()
    /// Handed to SceneView as the point of view. Without an explicit camera SceneKit invents
    /// one that frames everything in the scene, and the thing with the largest extent is the
    /// star backdrop at 900 units, so the entire solar system rendered as a smudge two pixels
    /// across. The stars are scenery; the planets are the subject.
    let cameraNode = SCNNode()
    private var nodes: [Planet: SCNNode] = [:]
    private let sunNode = SCNNode()

    init() {
        scene.background.contents = UIColor.black
        buildCamera()
        buildStars()
        buildSun()
        buildPlanets()
    }

    private func buildCamera() {
        let camera = SCNCamera()
        camera.fieldOfView = 55
        camera.zNear = 0.05
        // Past the star shell, so the backdrop is not clipped away.
        camera.zFar = 4_000
        cameraNode.camera = camera
        // One scene unit is about one au, so this frames the inner system out past Mars with
        // Jupiter at 5.2 just in shot, which is what reads legibly on a phone. Pinching out
        // reaches Neptune at 30.
        cameraNode.position = SCNVector3(0, 3.2, 7.2)
        cameraNode.look(at: SCNVector3(0, 0, 0))
        scene.rootNode.addChildNode(cameraNode)
    }

    private func renderPosition(_ metres: Vec3) -> SCNVector3 {
        SCNVector3(
            Float(metres.x / Self.metresPerUnit),
            Float(metres.z / Self.metresPerUnit),
            Float(-metres.y / Self.metresPerUnit)
        )
    }

    /// Scene-unit radius: the square root of the body's size relative to Earth.
    private func renderRadius(_ metres: Double) -> CGFloat {
        CGFloat(Self.earthRenderRadius * (metres / Self.earthRadiusM).squareRoot())
    }

    /**
     A texture from the bundle, or nil.

     Synced from `website/public/textures` by `sync-textures.mjs`, downsized, and chosen by
     the body contract rather than by a name written here, so the phone and the website cannot
     show different imagery for the same planet. Returning nil rather than failing is
     deliberate: the body then draws at its measured geometric albedo in its measured colour,
     which is real data and a reasonable thing to see if someone has not run the sync.
     */
    private static func texture(_ id: String?) -> UIImage? {
        guard let id else { return nil }
        for ext in ["jpg", "png"] {
            if let url = Bundle.main.url(forResource: id, withExtension: ext, subdirectory: "Textures")
                ?? Bundle.main.url(forResource: id, withExtension: ext) {
                return UIImage(contentsOfFile: url.path)
            }
        }
        return nil
    }

    private static func colour(_ hex: String) -> UIColor {
        var value: UInt64 = 0
        Scanner(string: hex.replacingOccurrences(of: "#", with: "")).scanHexInt64(&value)
        return UIColor(
            red: CGFloat((value >> 16) & 0xff) / 255,
            green: CGFloat((value >> 8) & 0xff) / 255,
            blue: CGFloat(value & 0xff) / 255,
            alpha: 1
        )
    }

    private func buildSun() {
        let sphere = SCNSphere(radius: Self.sunRenderRadius)
        sphere.segmentCount = 48
        let material = SCNMaterial()
        // Emissive, not lit: the Sun is the light source, so shading it would be wrong.
        material.lightingModel = .constant
        let sunTexture = Self.texture("sun")
        material.diffuse.contents = sunTexture ?? Self.colour(sunDisplay.tintHex)
        material.emission.contents = sunTexture ?? Self.colour(sunDisplay.tintHex)
        sphere.materials = [material]
        sunNode.geometry = sphere

        // The light rides inside the Sun's own node, so it lands at the Sun's position rather
        // than at the scene origin. The website had exactly this bug and every planet was unlit.
        let light = SCNLight()
        light.type = .omni
        light.intensity = 2_400
        light.attenuationStartDistance = 0
        light.attenuationEndDistance = 0
        sunNode.light = light

        scene.rootNode.addChildNode(sunNode)

        let ambient = SCNNode()
        ambient.light = SCNLight()
        ambient.light?.type = .ambient
        // Low, not zero. A true zero night side is correct and reads as a missing planet.
        ambient.light?.intensity = 90
        scene.rootNode.addChildNode(ambient)
    }

    private func buildPlanets() {
        for planet in Planet.allCases {
            guard let display = bodyDisplay[planet] else { continue }
            let sphere = SCNSphere(radius: renderRadius(display.equatorialRadiusM))
            sphere.segmentCount = 64
            let material = SCNMaterial()
            // Imagery when there is some, and the measured geometric albedo in the measured
            // colour when there is not. The fallback is real data, not a placeholder grey.
            material.diffuse.contents = Self.texture(display.albedoTextureId)
                ?? Self.colour(display.tintHex)
            material.roughness.contents = 0.95
            material.metalness.contents = 0.0
            sphere.materials = [material]

            let node = SCNNode(geometry: sphere)
            node.name = planet.rawValue
            // Axial tilt, about the line of nodes. Not the full IAU pole yet; see the README
            // for what is and is not ported.
            node.eulerAngles.z = Float(toRadians(deg(display.axialTiltDeg)))
            scene.rootNode.addChildNode(node)
            nodes[planet] = node

            if let rings = ringNode(for: display, bodyRadius: renderRadius(display.equatorialRadiusM)) {
                node.addChildNode(rings)
            }

            if let path = orbitPath(for: planet) {
                scene.rootNode.addChildNode(path)
            }
        }
    }

    /**
     Saturn's rings, at their real extent relative to the planet.

     Drawn as a flat annulus inside the planet's own node, so it inherits the axial tilt and
     the rings lean with the planet rather than sitting level with the ecliptic, which is what
     makes them read as rings rather than as a disc someone dropped in.
     */
    private func ringNode(for display: BodyDisplay, bodyRadius: CGFloat) -> SCNNode? {
        guard let rings = display.ringSystem, let image = Self.texture(rings.textureId) else {
            return nil
        }
        let inner = bodyRadius * CGFloat(rings.innerRadiusM / display.equatorialRadiusM)
        let outer = bodyRadius * CGFloat(rings.outerRadiusM / display.equatorialRadiusM)

        let disc = SCNTube(innerRadius: inner, outerRadius: outer, height: 0.0001)
        let material = SCNMaterial()
        material.diffuse.contents = image
        material.isDoubleSided = true
        material.transparencyMode = .aOne
        material.lightingModel = .constant
        disc.materials = [material]
        return SCNNode(geometry: disc)
    }

    /**
     The orbit, sampled from the same solver that positions the planet rather than drawn as an
     idealised ellipse. The elements drift, so this is the path the body will actually follow.
     */
    private func orbitPath(for planet: Planet) -> SCNNode? {
        let samples = 240
        guard let elements = shortSpan.elements[planet] else { return nil }
        let periodDays = 360 / elements.ratePerCentury.meanLongitudeDeg * Constants.daysPerJulianCentury

        var vertices: [SCNVector3] = []
        for i in 0 ..< samples {
            let jd = JdTdb(Epochs.j2000 + periodDays * Double(i) / Double(samples))
            guard let p = try? heliocentricPosition(planet, at: jd, model: shortSpan) else { continue }
            vertices.append(renderPosition(p))
        }
        guard vertices.count == samples else { return nil }

        var indices: [Int32] = []
        for i in 0 ..< samples {
            indices.append(Int32(i))
            indices.append(Int32((i + 1) % samples))
        }

        let geometry = SCNGeometry(
            sources: [SCNGeometrySource(vertices: vertices)],
            elements: [SCNGeometryElement(indices: indices, primitiveType: .line)]
        )
        let material = SCNMaterial()
        material.lightingModel = .constant
        material.diffuse.contents = Self.colour(bodyDisplay[planet]?.tintHex ?? "#666666")
            .withAlphaComponent(0.35)
        geometry.materials = [material]
        return SCNNode(geometry: geometry)
    }

    private func buildStars() {
        // A sphere of points, far enough out to read as a backdrop. Not a real catalogue yet;
        // the website builds one from Hipparcos and this should too rather than keep randoms.
        var generator = SystemRandomNumberGenerator()
        var vertices: [SCNVector3] = []
        for _ in 0 ..< 1_400 {
            let u = Double.random(in: -1 ... 1, using: &generator)
            let theta = Double.random(in: 0 ..< 2 * Double.pi, using: &generator)
            let r = (1 - u * u).squareRoot()
            let radius: Float = 900
            vertices.append(SCNVector3(
                Float(r * cos(theta)) * radius,
                Float(u) * radius,
                Float(r * sin(theta)) * radius
            ))
        }
        let geometry = SCNGeometry(
            sources: [SCNGeometrySource(vertices: vertices)],
            elements: [SCNGeometryElement(
                indices: Array(Int32(0) ..< Int32(vertices.count)), primitiveType: .point
            )]
        )
        let element = geometry.elements[0]
        element.pointSize = 2
        element.minimumPointScreenSpaceRadius = 1
        element.maximumPointScreenSpaceRadius = 2.5
        let material = SCNMaterial()
        material.lightingModel = .constant
        material.diffuse.contents = UIColor.white
        geometry.materials = [material]
        scene.rootNode.addChildNode(SCNNode(geometry: geometry))
    }

    /// Moves every body to where SolarKit says it is at `epoch`, and spins it.
    func update(to epoch: JdTdb) {
        for (planet, node) in nodes {
            guard let state = try? heliocentricState(planet, at: epoch) else { continue }
            node.position = renderPosition(state.position)

            if let display = bodyDisplay[planet], display.siderealRotationDays != 0 {
                let turns = (epoch.value - Epochs.j2000) / display.siderealRotationDays
                node.eulerAngles.y = Float(normaliseAngle(turns * 2 * Double.pi))
            }
        }
    }

    func node(for planet: Planet) -> SCNNode? { nodes[planet] }

    func planet(named name: String?) -> Planet? {
        guard let name else { return nil }
        return Planet(rawValue: name)
    }
}
