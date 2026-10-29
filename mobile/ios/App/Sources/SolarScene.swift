import Foundation
import SceneKit
import SolarKit

/**
 The SceneKit scene, positioned entirely from SolarKit.

 Nothing here invents a number. Positions, orientations, radii, colours and ring geometry all
 come from the body contracts, which is the rule in `contracts/numbers-come-from-the-engine`
 and what lets the phone and the website agree.

 ## The floating origin

 SceneKit works in Float, and the system spans 4.5e12 m, so physical metres cannot go straight
 into a node position: a Float at Neptune's distance quantises to about 500 km.

 So the scene subtracts the **focused body's position in Double first**, and only the small
 remainder is converted to Float. The focused body sits at exactly (0,0,0), which also removes
 the usual source of jitter in a camera chasing something at 1e12 m. See
 `contracts/floating-origin`.

 `renderPosition` is the only place a Double becomes a Float. One writer, as the contract
 requires.

 ## The scale ladder

 A single divisor cannot serve both a view of Neptune's orbit and a view of a crater. The
 scale is chosen from what is focused: the system view puts one unit at one au, and focusing a
 body puts one unit at a few of its radii. Both keep the numbers reaching Float small.
 */
@MainActor
final class SolarScene {
    let scene = SCNScene()
    let cameraNode = SCNNode()

    private(set) var focus: BodyId = .embary
    private var nodes: [BodyId: SCNNode] = [:]
    private var orbitNodes: [BodyId: SCNNode] = [:]
    private var nightMaterials: [BodyId: SCNMaterial] = [:]
    private let sunLight = SCNNode()
    private var positions: [BodyId: Vec3] = [:]
    private var origin: Vec3 = .zero

    /// Metres per scene unit for the current focus.
    private(set) var metresPerUnit: Double = Constants.auInMetres

    init() {
        scene.background.contents = UIColor.black
        buildCamera()
        buildStars()
        buildBodies()
        buildLight()
        setFocus(.embary, at: JdTdb(Epochs.j2000))
    }

    // MARK: - Scale and placement

    /**
     One scene unit, chosen from what is focused so Float never carries a large number.

     Focusing the Sun is the system view, so a unit is an astronomical unit and Neptune lands
     at 30. Focusing anything else puts a unit at that body's own equatorial radius, so the
     body is exactly 1 unit across the radius and its moons are tens of units out: the Moon at
     60 Earth radii, Phobos at 1.5 Mars radii. Every number the camera and the geometry see is
     then of order one, which is where Float has all of its precision.
     */
    private static func unitFor(_ body: BodyId) -> Double {
        body == .sun ? Constants.auInMetres : bodyContracts[body]!.equatorialRadiusM
    }

    /// The single Double-to-Float conversion in the app. Camera-relative by construction.
    private func renderPosition(_ metres: Vec3) -> SCNVector3 {
        let d = metres - origin
        return SCNVector3(
            Float(d.x / metresPerUnit),
            Float(d.z / metresPerUnit),
            Float(-d.y / metresPerUnit)
        )
    }

    private func renderRadius(_ metres: Double) -> CGFloat {
        if focus == .sun {
            /**
             System view. True radii are hopeless here, Earth being 4.2e-5 units, so sizes are
             compressed by a square root of the body's size relative to Earth. That keeps them
             ordered with a 5.4-fold spread across a 29-fold real range, rather than the hard
             clamp this started with, which made every planet the same size. The panel always
             reports the true radius, so nothing is fudged.
             */
            return CGFloat(0.052 * (metres / 6_378_137).squareRoot())
        }
        // Focused on a body: everything at true size, which the scale makes legible.
        return CGFloat(metres / metresPerUnit)
    }

    // MARK: - Construction

    private func buildCamera() {
        let camera = SCNCamera()
        camera.fieldOfView = 55
        camera.zNear = 0.001
        camera.zFar = 6_000
        cameraNode.camera = camera
        cameraNode.position = SCNVector3(0, 3.2, 7.2)
        cameraNode.look(at: SCNVector3(0, 0, 0))
        scene.rootNode.addChildNode(cameraNode)
    }

    private func buildLight() {
        // The light rides inside the Sun's own node, so it lands at the Sun's position rather
        // than at the scene origin. The website had exactly this bug and every planet was unlit.
        let light = SCNLight()
        light.type = .omni
        light.intensity = 2_600
        light.attenuationStartDistance = 0
        light.attenuationEndDistance = 0
        sunLight.light = light
        nodes[.sun]?.addChildNode(sunLight)

        let ambient = SCNNode()
        ambient.light = SCNLight()
        ambient.light?.type = .ambient
        // Low, not zero. A true black night side is correct and reads as a missing planet.
        ambient.light?.intensity = 70
        scene.rootNode.addChildNode(ambient)
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

    /**
     A texture from the bundle, or nil.

     Synced from the website by `sync-textures.mjs` and chosen by the body contract rather than
     by a name written here, so the phone and the website cannot show different imagery for the
     same body. Returning nil is deliberate: the body then draws at its measured geometric
     albedo in its measured colour, which is real data.
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

    private func buildBodies() {
        for id in bodyIds {
            let contract = bodyContracts[id]!
            let sphere = SCNSphere(radius: 1)
            sphere.segmentCount = contract.kind == .moon ? 32 : 64
            sphere.isGeodesic = false

            let material = SCNMaterial()
            let albedo = Self.texture(contract.appearance.albedoTextureId)
            if contract.appearance.isEmissive {
                // The Sun is the light source. Shading it would be wrong.
                material.lightingModel = .constant
                material.diffuse.contents = albedo ?? Self.colour(contract.appearance.tintHex)
                material.emission.contents = albedo ?? Self.colour(contract.appearance.tintHex)
            } else {
                material.diffuse.contents = albedo ?? Self.colour(contract.appearance.tintHex)
                material.roughness.contents = 0.95
                material.metalness.contents = 0.0
                applyNightSide(to: material, contract: contract, id: id)
            }
            sphere.materials = [material]

            let geometryNode = SCNNode(geometry: sphere)
            // Oblateness is real and visible on Saturn, 10% wider than it is tall.
            geometryNode.scale = SCNVector3(
                1, Float(contract.polarRadiusM / contract.equatorialRadiusM), 1
            )

            // An outer node carries position and orientation; the inner one carries the
            // flattening, so a scale does not end up multiplying a rotation.
            let node = SCNNode()
            node.name = id.rawValue
            node.addChildNode(geometryNode)

            if let rings = ringNode(for: contract) { node.addChildNode(rings) }

            scene.rootNode.addChildNode(node)
            nodes[id] = node
        }
    }

    /**
     City lights on the dark side, masked by the lighting geometry.

     Cannot be an emission map, which SceneKit adds unconditionally and would light the cities
     at noon. The mask has to come from the geometry, so a fragment shader modifier dots the
     world-space normal with the direction to the Sun and fades the lights in across the
     terminator. `_surface.normal` is in view space, so it is taken back to world space with
     the inverse view transform before the dot.

     The same approach as the website's `onBeforeCompile`, for the same reason.
     */
    private func applyNightSide(to material: SCNMaterial, contract: BodyContract, id: BodyId) {
        guard let night = Self.texture(contract.appearance.nightTextureId) else { return }
        material.setValue(SCNMaterialProperty(contents: night), forKey: "nightMap")
        material.setValue(NSValue(scnVector3: SCNVector3(0, 0, 1)), forKey: "sunDirection")
        material.shaderModifiers = [
            .fragment: """
            #pragma arguments
            texture2d<float> nightMap;
            float3 sunDirection;
            #pragma body
            float3 worldNormal = normalize((scn_frame.inverseViewTransform
                * float4(_surface.normal, 0.0)).xyz);
            float sunFacing = dot(worldNormal, normalize(sunDirection));
            // Widened either side of the geometric terminator. A hard edge reads as a seam;
            // the real one is softened by atmosphere over roughly this width.
            float nightAmount = smoothstep(0.12, -0.08, sunFacing);
            constexpr sampler nightSampler(filter::linear, address::repeat);
            float3 cityLights = nightMap.sample(nightSampler, _surface.diffuseTexcoord).rgb;
            _output.color.rgb += cityLights * nightAmount * 2.2;
            """
        ]
        nightMaterials[id] = material
    }

    /// Saturn's rings at their real extent, inside the body's node so they lean with the planet.
    private func ringNode(for contract: BodyContract) -> SCNNode? {
        guard let rings = contract.appearance.ringSystem,
              let image = Self.texture(rings.textureId) else { return nil }

        let inner = CGFloat(rings.innerRadiusM / contract.equatorialRadiusM)
        let outer = CGFloat(rings.outerRadiusM / contract.equatorialRadiusM)
        let disc = SCNTube(innerRadius: inner, outerRadius: outer, height: 0.001)

        let material = SCNMaterial()
        material.diffuse.contents = image
        material.isDoubleSided = true
        material.transparencyMode = .aOne
        material.lightingModel = .constant
        material.writesToDepthBuffer = false
        disc.materials = [material]

        let node = SCNNode(geometry: disc)
        node.name = "rings"
        return node
    }

    /**
     Orbit paths, sampled from the same solvers that position the bodies rather than drawn as
     idealised ellipses. The elements drift, so this is the path the body will actually follow.

     Rebuilt on a focus change because they are expressed in the current scale and origin.
     */
    private func rebuildOrbits() {
        for (_, node) in orbitNodes { node.removeFromParentNode() }
        orbitNodes.removeAll()

        for id in bodyIds {
            let contract = bodyContracts[id]!
            guard let path = orbitPath(for: id, contract: contract) else { continue }
            scene.rootNode.addChildNode(path)
            orbitNodes[id] = path
        }
    }

    private func orbitPath(for id: BodyId, contract: BodyContract) -> SCNNode? {
        let samples = 256
        var periodDays: Double
        switch contract.ephemeris {
        case .fixedAtBarycentre:
            return nil
        case let .standishElements(planet):
            // Only draw planetary orbits when the system is in view; at body scale they are
            // vastly off screen and cost vertices for nothing.
            guard focus == .sun else { return nil }
            guard let elements = shortSpan.elements[planet] else { return nil }
            periodDays = 360 / elements.ratePerCentury.meanLongitudeDeg * Constants.daysPerJulianCentury
        case let .meanElementsAboutParent(source):
            // And only draw a moon's orbit when its own planet is in view.
            guard focus == contract.parent || focus == id else { return nil }
            periodDays = source.periodDays
        }

        var vertices: [SCNVector3] = []
        let start = Epochs.j2000
        for i in 0 ..< samples {
            let jd = JdTdb(start + periodDays * Double(i) / Double(samples))
            vertices.append(renderPosition(heliocentricPositionOf(id, at: jd)))
        }

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
        material.diffuse.contents = Self.colour(contract.appearance.tintHex)
            .withAlphaComponent(id == focus ? 0.9 : 0.3)
        geometry.materials = [material]
        return SCNNode(geometry: geometry)
    }

    /**
     The real sky, from the Yale Bright Star Catalogue.

     The same `bsc5.bin` the website reads, synced into the bundle unchanged: 9,096 stars as a
     flat Float32 array of right ascension, declination, visual magnitude and B-V colour
     index. Both clients reading the identical bytes is worth more than any saving from
     reformatting it.

     Catalogue positions are **equatorial** J2000, so they get the same obliquity rotation the
     planet orientations do. Without it the constellations sit 23 degrees out of place relative
     to the ecliptic the planets move in, which looks like a plausible sky and is the wrong one.

     A missing catalogue means no stars, not invented ones. A fake sky is worse than no sky in
     an instrument.
     */
    private func buildStars() {
        guard let url = Bundle.main.url(forResource: "bsc5", withExtension: "bin"),
              let data = try? Data(contentsOf: url) else { return }

        let values = data.withUnsafeBytes { raw -> [Float] in
            Array(raw.bindMemory(to: Float.self))
        }
        let stride = 4
        guard values.count >= stride else { return }

        var vertices: [SCNVector3] = []
        var colours: [SCNVector3] = []
        let shell: Float = 2_000

        for i in Swift.stride(from: 0, to: values.count - stride + 1, by: stride) {
            let ra = Double(values[i])
            let dec = Double(values[i + 1])
            let magnitude = Double(values[i + 2])
            let colourIndex = Double(values[i + 3])

            let equatorial = Vec3(cos(dec) * cos(ra), cos(dec) * sin(ra), sin(dec))
            let e = equatorialToEcliptic(equatorial)
            vertices.append(SCNVector3(Float(e.x) * shell, Float(e.z) * shell, Float(-e.y) * shell))

            // Brighter stars are drawn brighter rather than larger, which keeps the point size
            // uniform and stops the sky looking like confetti.
            let brightness = max(0.18, min(1.0, (7.0 - magnitude) / 6.0))
            let (r, g, b) = Self.rgbFromColourIndex(colourIndex)
            colours.append(SCNVector3(
                Float(r * brightness), Float(g * brightness), Float(b * brightness)
            ))
        }
        guard !vertices.isEmpty else { return }

        // Built from raw bytes because SceneKit has no colour-source convenience initialiser
        // taking SCNVector3. Three floats per vertex, tightly packed.
        let colourData = colours.withUnsafeBufferPointer {
            Data(buffer: $0)
        }
        let colourSource = SCNGeometrySource(
            data: colourData,
            semantic: .color,
            vectorCount: colours.count,
            usesFloatComponents: true,
            componentsPerVector: 3,
            bytesPerComponent: MemoryLayout<Float>.size,
            dataOffset: 0,
            dataStride: MemoryLayout<SCNVector3>.size
        )

        let geometry = SCNGeometry(
            sources: [SCNGeometrySource(vertices: vertices), colourSource],
            elements: [SCNGeometryElement(
                indices: Array(Int32(0) ..< Int32(vertices.count)), primitiveType: .point
            )]
        )
        let element = geometry.elements[0]
        element.pointSize = 2.2
        element.minimumPointScreenSpaceRadius = 1
        element.maximumPointScreenSpaceRadius = 3
        let material = SCNMaterial()
        material.lightingModel = .constant
        material.diffuse.contents = UIColor.white
        geometry.materials = [material]
        scene.rootNode.addChildNode(SCNNode(geometry: geometry))
    }

    /// B-V colour index to RGB, via an effective temperature and a blackbody approximation.
    /// Good enough that Betelgeuse reads red and Rigel blue, which is the point.
    ///
    /// > Ballesteros (2012) for the B-V to temperature relation.
    private static func rgbFromColourIndex(_ bv: Double) -> (Double, Double, Double) {
        let kelvin = 4600 * (1 / (0.92 * bv + 1.7) + 1 / (0.92 * bv + 0.62))
        let t = min(40_000, max(1_000, kelvin)) / 100
        func clamp(_ v: Double) -> Double { min(1, max(0, v)) }

        let r = t <= 66 ? 1.0 : clamp(1.292936 * pow(t - 60, -0.1332047) )
        let g = t <= 66
            ? clamp(0.3900816 * log(t) - 0.6318414)
            : clamp(1.129891 * pow(t - 60, -0.0755148))
        let b = t >= 66 ? 1.0 : (t <= 19 ? 0.0 : clamp(0.5432068 * log(t - 10) - 1.196254))
        return (r, g, b)
    }

    // MARK: - Focus and update

    func setFocus(_ body: BodyId, at epoch: JdTdb? = nil) {
        focus = body
        metresPerUnit = Self.unitFor(body)

        for id in bodyIds {
            let contract = bodyContracts[id]!
            guard let node = nodes[id], let sphere = node.childNodes.first?.geometry as? SCNSphere
            else { continue }
            sphere.radius = renderRadius(contract.equatorialRadiusM)
        }

        rebuildOrbits()
        frameFocus(at: epoch)
    }

    /**
     Places the camera for the focused body, approaching from the lit side.

     Arriving over a body's night side is a black screen and reads as a bug. The floating
     origin puts the focused body at the render origin, so the direction to the Sun from it is
     just the normalised negative of its heliocentric position. Lifted slightly out of the
     plane so the terminator is visible rather than edge on.
     */
    private func frameFocus(at epoch: JdTdb?) {
        let when = epoch ?? JdTdb(Epochs.j2000)
        let distance: Float = focus == .sun ? 7.5 : 6
        let sun = sunDirection(from: focus, at: when)
        cameraNode.position = SCNVector3(
            sun.x * distance,
            sun.y * distance + distance * 0.28,
            sun.z * distance
        )
        cameraNode.look(at: SCNVector3(0, 0, 0))
    }

    /// Distance from the focused body's surface, in metres, for the current camera.
    var distanceToSurfaceM: Double {
        let radius = bodyContracts[focus]!.equatorialRadiusM
        let d = Double(
            (cameraNode.position.x * cameraNode.position.x
                + cameraNode.position.y * cameraNode.position.y
                + cameraNode.position.z * cameraNode.position.z).squareRoot()
        ) * metresPerUnit
        return max(0, d - radius)
    }

    /**
     Unit vector from a body towards the Sun, in render space.

     Takes an epoch rather than reading the cached position, because changing focus does not
     recompute positions; the frame loop does, on its next tick. The website had exactly this
     bug: a camera placed from the stale origin aimed using the previous body's position,
     which looked fine for a short hop and put the camera over the night side for a jump
     across the solar system.
     */
    func sunDirection(from body: BodyId, at epoch: JdTdb) -> SCNVector3 {
        let p = heliocentricPositionOf(body, at: epoch)
        if p.length == 0 { return SCNVector3(0, 0, 1) }
        let toSun = (Vec3.zero - p).normalised
        return SCNVector3(Float(toSun.x), Float(toSun.z), Float(-toSun.y))
    }

    /**
     Moves and orients every body for `epoch`.

     Under mutual gravity a body the integration carries comes from the integration, and
     anything it does not comes from the analytic ephemeris. That mixture is deliberate: the
     default integrates the planets and leaves the moons analytic about their parents, which
     then follow a planet that is itself moving under mutual gravity.
     */
    func update(to epoch: JdTdb, gravity: Gravity? = nil) {
        for id in bodyIds {
            positions[id] = gravity?.heliocentricPosition(of: id)
                ?? heliocentricPositionOf(id, at: epoch)
        }
        origin = positions[focus] ?? .zero

        for id in bodyIds {
            guard let node = nodes[id], let position = positions[id] else { continue }
            node.position = renderPosition(position)

            /**
             Orientation from the full IAU elements, not just a spin rate.

             The pole fixes which way the axis points and the prime meridian fixes where the
             surface has got to. A rate alone turns the body at the right speed about the wrong
             axis, which looks plausible and puts every surface feature in the wrong place.
             */
            let o = orientationOf(id, at: epoch)
            let pole = SCNVector3(Float(o.poleEcliptic.x), Float(o.poleEcliptic.z), Float(-o.poleEcliptic.y))
            let tilt = acos(max(-1, min(1, pole.y)))
            let azimuth = atan2(pole.z, pole.x)

            node.transform = SCNMatrix4Identity
            node.position = renderPosition(position)
            // Swing the axis to the pole, then spin about it.
            node.eulerAngles = SCNVector3(0, 0, 0)
            let spinNode = node.childNodes.first
            spinNode?.eulerAngles = SCNVector3(0, Float(o.spin), 0)
            node.rotation = SCNVector4(0, 0, 0, 0)
            node.simdOrientation = simd_quatf(angle: -azimuth, axis: SIMD3<Float>(0, 1, 0))
                * simd_quatf(angle: tilt, axis: SIMD3<Float>(0, 0, 1))

            if let material = nightMaterials[id] {
                material.setValue(
                    NSValue(scnVector3: sunDirection(from: id, at: epoch)), forKey: "sunDirection"
                )
            }
        }
    }

    func node(for body: BodyId) -> SCNNode? { nodes[body] }

    // MARK: - Trajectory

    private var trajectoryNode: SCNNode?

    /**
     Draws a propagated trajectory, in the same frame and scale as everything else.

     Positions come straight from the integrator's samples and go through `renderPosition`
     like any body, so the path and the planets cannot disagree about where anything is.
     */
    func showTrajectory(_ samples: [TrajectorySample]) {
        clearTrajectory()
        guard samples.count > 1 else { return }

        let vertices = samples.map { renderPosition($0.position) }
        var indices: [Int32] = []
        for i in 0 ..< (vertices.count - 1) {
            indices.append(Int32(i))
            indices.append(Int32(i + 1))
        }

        let geometry = SCNGeometry(
            sources: [SCNGeometrySource(vertices: vertices)],
            elements: [SCNGeometryElement(indices: indices, primitiveType: .line)]
        )
        let material = SCNMaterial()
        material.lightingModel = .constant
        material.diffuse.contents = UIColor.systemTeal
        geometry.materials = [material]

        let node = SCNNode(geometry: geometry)
        scene.rootNode.addChildNode(node)
        trajectoryNode = node
    }

    func clearTrajectory() {
        trajectoryNode?.removeFromParentNode()
        trajectoryNode = nil
    }

    // MARK: - View commands

    /**
     Swings the camera to a chosen angle from the Sun, keeping the current distance.

     0 is the fully lit disc, 90 puts the terminator down the middle, 180 is the night side.
     The rotation is about ecliptic north, so it reads as the body's phases:

         d = S cos(t) + (n x S) sin(t) + n (n . S)(1 - cos(t))

     Rodrigues with the axis not perpendicular to S, because a body's Sun direction is never
     exactly in the ecliptic. No vertical lift, unlike the arrival framing: at 90 degrees that
     puts the viewer exactly in the plane containing the Sun, which makes the terminator a
     clean line down the middle rather than a curve, and that is the whole point of the view.

     Distance is preserved deliberately. Choosing a lighting angle should not undo a zoom.
     */
    func setSunAngle(_ degrees: Double, at epoch: JdTdb) {
        let sun = sunDirection(from: focus, at: epoch)
        let t = degrees * Double.pi / 180
        let c = Float(cos(t))
        let s = Float(sin(t))

        // Ecliptic north in render space is the scene's y axis.
        let n = SCNVector3(0, 1, 0)
        let dot = n.x * sun.x + n.y * sun.y + n.z * sun.z
        let cross = SCNVector3(
            n.y * sun.z - n.z * sun.y,
            n.z * sun.x - n.x * sun.z,
            n.x * sun.y - n.y * sun.x
        )
        var d = SCNVector3(
            sun.x * c + cross.x * s + n.x * dot * (1 - c),
            sun.y * c + cross.y * s + n.y * dot * (1 - c),
            sun.z * c + cross.z * s + n.z * dot * (1 - c)
        )
        let length = (d.x * d.x + d.y * d.y + d.z * d.z).squareRoot()
        if length == 0 { return }
        d = SCNVector3(d.x / length, d.y / length, d.z / length)

        let p = cameraNode.position
        let distance = max(0.001, (p.x * p.x + p.y * p.y + p.z * p.z).squareRoot())
        cameraNode.position = SCNVector3(d.x * distance, d.y * distance, d.z * distance)
        cameraNode.look(at: SCNVector3(0, 0, 0))
    }

    /// Whether the focused body has moons to frame.
    var focusHasMoons: Bool { satelliteSystemRadiusM(focus) != nil }

    /**
     Pulls back far enough to hold the focused body and all of its moons.

     The distance comes from the camera's field of view rather than a fixed multiple, because
     a constant only works at one field of view: at 2.4 times the apoapsis a moon subtends
     22.6 degrees off axis, which squeaks inside a 55 degree field and falls out of a narrower
     one. Solving for the distance that puts the apoapsis at a set fraction of the vertical
     half-frame holds regardless.

     Vertical rather than horizontal, because that is the shorter axis on a landscape window
     and so the one that crops.
     */
    func frameMoons() {
        guard let systemRadius = satelliteSystemRadiusM(focus) else { return }
        let fov = cameraNode.camera?.fieldOfView ?? 55
        let halfFovRad = fov * Double.pi / 360
        let fill = 0.72
        let units = Float(systemRadius / metresPerUnit / tan(halfFovRad * fill))

        let p = cameraNode.position
        let current = max(0.0001, (p.x * p.x + p.y * p.y + p.z * p.z).squareRoot())
        cameraNode.position = SCNVector3(
            p.x / current * units, p.y / current * units, p.z / current * units
        )
        cameraNode.look(at: SCNVector3(0, 0, 0))
    }
}
