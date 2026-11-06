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
/**
 Observable, because SwiftUI will not re-evaluate a view whose inputs have not changed.

 `ViewControls` is handed a `BodyId` and two class references. A control whose visibility
 depends on scene state none of those three carry was correctly skipped by SwiftUI and simply
 never appeared. Driving it from the sixty-hertz tick instead would have worked by accident
 and broken the moment the tick was optimised. Of the properties written every frame, only
 `frameCounter` is read by a view, and only by the label layer, which wants every frame.
 */
@MainActor
@Observable
final class SolarScene {
    let scene = SCNScene()
    let cameraNode = SCNNode()

    /**
     Bumped on every scene update, and the only per-frame property any view is meant to read.

     Labels have to track the bodies exactly or they visibly lag during a drag, so they are the
     one part of the overlay that does want every frame. Subscribing them to this rather than
     to the clock's epoch is what keeps that cost inside the label layer: the epoch is observed
     by nothing, so the body picker, the panel and the time bar no longer rebuild sixty times a
     second alongside it. The website draws its labels on an animation frame for the same
     reason, while its HUD reads a throttled snapshot.
     */
    private(set) var frameCounter: UInt64 = 0

    private(set) var focus: BodyId = .embary
    private var nodes: [BodyId: SCNNode] = [:]
    private var orbitNodes: [BodyId: SCNNode] = [:]
    /// Time marks along each drawn orbit, one node per orbit holding up to 24 points.
    private var markNodes: [BodyId: SCNNode] = [:]
    /// Which period each drawn orbit has, so the marks can be replaced without re-deciding it.
    private var orbitPeriodDays: [BodyId: Double] = [:]
    /// The epoch the marks were last placed for. Written every frame, read on the refresh.
    private var markEpoch = JdTdb(Epochs.j2000)
    /// How far each drawn orbit's closest point misses its true perihelion, as a fraction.
    /// See `debug()`; this is the check that the orbits are drawn about the Sun.
    private var orbitPerihelionError: [BodyId: Double] = [:]
    private var nightMaterials: [BodyId: SCNMaterial] = [:]
    private let sunLight = SCNNode()
    private var positions: [BodyId: Vec3] = [:]
    private var origin: Vec3 = .zero
    private let terrain = Terrain()
    private var tileNodes: [TileId: SCNNode] = [:]
    private var tileRoot: SCNNode?

    /**
     Holds everything expressed in plain heliocentric coordinates: the orbit paths.

     Orbit geometry is static, and the floating origin is not. Building the vertices with the
     origin already subtracted bakes in whichever origin happened to be current at build time,
     and `setFocus` runs before the frame loop has recomputed one, so switching from Earth to
     the Sun built every orbit offset by an astronomical unit. The symptom is orbits whose
     shared focus is nowhere near the Sun.

     Worse, even a correct origin at build time goes stale immediately when the focused body
     is moving, so the orbits would drift away from the planets over a few seconds.

     So the vertices stay heliocentric and this one node carries the origin, repositioned
     every frame. Its children never need rebuilding as the camera moves.
     */
    private let heliocentricRoot = SCNNode()
    private var lastTileRefresh = Date.distantPast

    /**
     The camera, owned here rather than by SceneKit.

     `allowsCameraControl` builds its own camera node and ignores the `pointOfView` it is
     given, so every write to `cameraNode` went to a node that was no longer on screen. Worse,
     the scene's scale is chosen per focused body, and SceneKit's controller holds its distance
     in scene units: change focus and its camera stays at the old number of units, which in the
     new scale is either inside the body or billions of units away. The symptom is the scene
     vanishing after a pinch, with no error.

     So the orbit is held in physical terms instead. Distance is **metres from the body's
     centre**, which survives a scale change because it does not depend on one.
     */
    private var cameraAzimuth: Double = 0
    private var cameraElevation: Double = 0.28
    private var cameraDistanceM: Double = 0

    /// Metres per scene unit for the current focus.
    private(set) var metresPerUnit: Double = Constants.auInMetres

    init() {
        scene.background.contents = UIColor.black
        buildCamera()
        scene.rootNode.addChildNode(heliocentricRoot)
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

    /// Heliocentric metres to scene units, with no origin applied. Only for geometry that
    /// lives under `heliocentricRoot`, which supplies the origin itself.
    private func inHeliocentricUnits(_ metres: Vec3) -> SCNVector3 {
        SCNVector3(
            Float(metres.x / metresPerUnit),
            Float(metres.z / metresPerUnit),
            Float(-metres.y / metresPerUnit)
        )
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

    private func renderRadius(_ metres: Double, isStar: Bool = false) -> CGFloat {
        if focus == .sun {
            /**
             The Sun gets its own size in the system view.

             On the planets' curve it comes out 0.543 units, and Mercury's orbit is 0.387, so
             it swallows the inner solar system and reads as a Sun that really is that big.
             This is the second time that has happened here; the first was a shared
             exaggeration constant, this time a shared compression curve.
             */
            if isStar { return 0.16 }
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
        scene.rootNode.addChildNode(cameraNode)
    }

    /// Closest and furthest the camera may sit from the focused body's centre, in metres.
    private var distanceLimits: (min: Double, max: Double) {
        let radius = bodyContracts[focus]!.equatorialRadiusM
        if focus == .sun {
            // The system view reaches past Neptune and no closer than the photosphere.
            return (radius * 1.5, 1.2e13)
        }
        // A kilometre above the surface at the closest; far enough out to hold the moons at
        // the widest, or a few thousand radii for a body that has none.
        let systemRadius = satelliteSystemRadiusM(focus) ?? (radius * 400)
        return (radius + 1_000, max(systemRadius * 4, radius * 400))
    }

    /// Writes the camera from the orbit held above. The only place its position is set.
    private func applyCamera() {
        cameraDistanceM = min(distanceLimits.max, max(distanceLimits.min, cameraDistanceM))

        let units = Float(cameraDistanceM / metresPerUnit)
        let x = Float(cos(cameraElevation) * cos(cameraAzimuth)) * units
        let y = Float(sin(cameraElevation)) * units
        let z = Float(cos(cameraElevation) * sin(cameraAzimuth)) * units

        cameraNode.position = SCNVector3(x, y, z)
        cameraNode.look(at: SCNVector3(0, 0, 0))

        // The far plane has to clear both the body system and the star shell.
        cameraNode.camera?.zFar = Double(max(4_000, units * 12))
        cameraNode.camera?.zNear = Double(max(0.0005, units / 20_000))
    }

    /// Drag to orbit. Elevation is clamped short of the poles so the view never flips over.
    func orbit(deltaX: Double, deltaY: Double) {
        cameraAzimuth -= deltaX * 0.006
        cameraElevation = min(1.5, max(-1.5, cameraElevation + deltaY * 0.006))
        applyCamera()
    }

    /// Pinch to zoom. Multiplicative, so each pinch covers the same proportion at any scale,
    /// which is what makes ten orders of magnitude navigable with one gesture.
    func zoom(by factor: Double) {
        guard factor > 0 else { return }
        cameraDistanceM /= factor
        applyCamera()
    }

    /// Distance from the focused body's surface, metres.
    var altitudeM: Double {
        max(0, cameraDistanceM - bodyContracts[focus]!.equatorialRadiusM)
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
                /**
                 Real elevation relief, where there is any.

                 The global normal map comes from LRO LOLA topography, so craters shade
                 correctly through the terminator rather than being painted on. Below about
                 1,000 km the screen out-resolves the data at 474 m per sample and the ground
                 smooths; the panel says so rather than leaving someone to conclude the Moon
                 is flat.
                 */
                if let surface = terrain.surface(for: id) {
                    material.normal.contents = surface.normalMap
                    material.normal.intensity = 1.0
                }
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
            markerNodes[id] = buildMarker(for: contract, under: node)
        }
    }

    /**
     A dot for a body too small to see as geometry.

     From anywhere useful in the solar system most bodies are well under a pixel across, and
     drawing them larger than they are would be a lie about scale, which is the one thing this
     project will not do. Phobos focused from six Mars radii has an apparent radius of 0.46
     pixels: it is drawn, it is in frame, it is correct, and it is invisible. Reported as "why
     dont i see moons".

     So each body gets a soft dot in its own colour that fades in exactly as the real sphere
     stops being resolvable. Scale stays honest and nothing disappears. The website has done
     this since the beginning; it was never written into `features.json`, so the parity gate
     had nothing to compare and the gap survived every audit.

     Parented to the body, so it inherits the position the one Double-to-Float conversion
     already produced rather than computing a second one that could disagree.
     */
    private func buildMarker(for contract: BodyContract, under parent: SCNNode) -> SCNNode {
        let plane = SCNPlane(width: 1, height: 1)
        let material = SCNMaterial()
        material.lightingModel = .constant
        material.diffuse.contents = Self.markerImage(Self.colour(contract.appearance.tintHex))
        material.blendMode = .add
        material.writesToDepthBuffer = false
        // Depth testing off, so a marker is never hidden inside the body it marks or behind
        // a ring. It is an overlay, not geometry.
        material.readsFromDepthBuffer = false
        plane.firstMaterial = material

        let node = SCNNode(geometry: plane)
        node.constraints = [SCNBillboardConstraint()]
        node.opacity = 0
        node.renderingOrder = 100
        parent.addChildNode(node)
        return node
    }

    /// A radial falloff, drawn once and shared. A hard-edged quad reads as a square sprite at
    /// the two or three pixels these occupy, which looks like a rendering fault rather than a
    /// marker.
    private static func markerImage(_ tint: UIColor) -> UIImage {
        let size = 64
        let renderer = UIGraphicsImageRenderer(size: CGSize(width: size, height: size))
        return renderer.image { context in
            let centre = CGPoint(x: size / 2, y: size / 2)
            let colours = [tint.withAlphaComponent(1).cgColor, tint.withAlphaComponent(0).cgColor]
            guard let gradient = CGGradient(
                colorsSpace: CGColorSpaceCreateDeviceRGB(),
                colors: colours as CFArray,
                locations: [0, 1]
            ) else { return }
            context.cgContext.drawRadialGradient(
                gradient, startCenter: centre, startRadius: 0,
                endCenter: centre, endRadius: CGFloat(size) / 2, options: []
            )
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

    /**
     Saturn's rings at their real extent, inside the body's node so they lean with the planet.

     The geometry is built in **planet radii**, from the contract: the A ring's outer edge is
     136,775 km against a 60,268 km equatorial radius, so it reaches 2.27 radii. The node is
     then scaled by whatever the planet is drawn at, which is what converts those ratios into
     scene units.

     Leaving that scale off is why the rings once rendered about ten times too wide. A ratio
     of 2.27 was read as 2.27 scene units while Saturn itself was 0.16, so the rings spanned
     a quarter of the inner solar system and looked, plausibly, like a stylistic choice.
     */
    private func ringNode(for contract: BodyContract) -> SCNNode? {
        guard let rings = contract.appearance.ringSystem,
              let image = Self.texture(rings.textureId) else { return nil }

        let inner = rings.innerRadiusM / contract.equatorialRadiusM
        let outer = rings.outerRadiusM / contract.equatorialRadiusM

        let material = SCNMaterial()
        material.diffuse.contents = image
        material.diffuse.wrapS = .clamp
        material.diffuse.wrapT = .repeat
        material.isDoubleSided = true
        material.lightingModel = .constant
        material.blendMode = .alpha
        material.transparencyMode = .aOne
        material.writesToDepthBuffer = false

        let geometry = TilePatch.annulus(innerRadius: inner, outerRadius: outer)
        geometry.materials = [material]

        let node = SCNNode(geometry: geometry)
        node.name = "rings"
        // Scaled to the body's drawn radius in `setFocus`, which is where that is known.
        return node
    }

    /// The rings are drawn in planet radii, so they scale with however large the planet is.
    private func rescaleRings(_ id: BodyId, to radius: CGFloat) {
        guard let rings = nodes[id]?.childNodes.first(where: { $0.name == "rings" }) else { return }
        rings.scale = SCNVector3(Float(radius), Float(radius), Float(radius))
    }

    /**
     Orbit paths, sampled from the same solvers that position the bodies rather than drawn as
     idealised ellipses. The elements drift, so this is the path the body will actually follow.

     Rebuilt on a focus change because they are expressed in the current scale and origin.
     */
    private func rebuildOrbits() {
        for (_, node) in orbitNodes { node.removeFromParentNode() }
        orbitNodes.removeAll()
        for (_, node) in markNodes { node.removeFromParentNode() }
        markNodes.removeAll()
        orbitPeriodDays.removeAll()
        orbitPerihelionError.removeAll()

        orbitAnchors.removeAll()
        for id in bodyIds {
            let contract = bodyContracts[id]!
            guard let path = orbitPath(for: id, contract: contract) else { continue }
            if case .meanElementsAboutParent = contract.ephemeris, let parent = contract.parent {
                /**
                 A moon's orbit hangs off the scene and is moved to its planet each frame.

                 Its vertices are relative to the planet, so the node has to sit on the planet.
                 The heliocentric root cannot do that: it carries one origin for the whole
                 scene, and what this needs is a different origin per moon system.
                 */
                scene.rootNode.addChildNode(path)
                orbitAnchors[id] = parent
            } else {
                // Parented to the heliocentric root, so the origin is applied once per frame
                // to the parent rather than baked into every vertex.
                heliocentricRoot.addChildNode(path)
            }
            orbitNodes[id] = path

            // The marks share the orbit's parent, so they inherit the same origin handling:
            // the heliocentric root for a planet, the per-planet anchor for a moon.
            let marks = SCNNode()
            path.parent?.addChildNode(marks)
            marks.position = path.position
            markNodes[id] = marks
            orbitPeriodDays[id] = periodDaysFor(contract)
        }
        refreshTimeMarks(force: true)
    }

    /// The period the marks are spaced against. Nil for anything that does not orbit.
    private func periodDaysFor(_ contract: BodyContract) -> Double {
        switch contract.ephemeris {
        case .fixedAtBarycentre:
            return 0
        case let .standishElements(planet):
            guard let elements = shortSpan.elements[planet] else { return 0 }
            return 360 / elements.ratePerCentury.meanLongitudeDeg * Constants.daysPerJulianCentury
        case let .meanElementsAboutParent(source):
            return source.periodDays
        }
    }

    /**
     Where each drawn orbit's body will be, at equal intervals of time counted from now.

     An orbit line says where a body goes and nothing about when. These are sampled from the
     same ephemeris that drew the line, at the epochs `orbitTimeMarks` returns, so a mark is
     the body's actual future position at a stated time rather than a decoration. Equal spacing
     in time means unequal spacing along the path, and the crowding near periapsis is Kepler's
     second law measured rather than illustrated.

     Rebuilt at about ten hertz rather than every frame. Each refresh is one ephemeris
     evaluation per mark, which is a hundred or so across a satellite system, and at sixty
     hertz that is six thousand Kepler solves a second to move dots by less than a pixel. The
     same ten hertz the clock publishes its date on, and for the same reason.
     */
    private func refreshTimeMarks(force: Bool = false) {
        guard force || frameCounter % 6 == 0 else { return }

        for (id, node) in markNodes {
            guard let periodDays = orbitPeriodDays[id], periodDays > 0 else { continue }
            let contract = bodyContracts[id]!
            let parent: BodyId? = {
                if case .meanElementsAboutParent = contract.ephemeris { return contract.parent }
                return nil
            }()

            let timed = orbitTimeMarks(periodDays: periodDays, now: markEpoch)
            var vertices: [SCNVector3] = []
            vertices.reserveCapacity(timed.marks.count)
            for mark in timed.marks {
                let position = heliocentricPositionOf(id, at: mark.epoch)
                let relative = parent.map { position - heliocentricPositionOf($0, at: mark.epoch) }
                    ?? position
                vertices.append(inHeliocentricUnits(relative))
            }
            guard vertices.count > 0 else { continue }

            let source = SCNGeometrySource(vertices: vertices)
            let element = SCNGeometryElement(
                indices: Array(Int32(0) ..< Int32(vertices.count)), primitiveType: .point
            )
            /**
             Screen-space sizing, so a mark stays legible whether the orbit is an astronomical
             unit or four hundred thousand kilometres across. Without this the points are sized
             in scene units and vanish the moment the scale changes under them.
             */
            element.pointSize = 8
            // Matched to the website's 4.5 px points, measured against a screenshot of each.
            element.minimumPointScreenSpaceRadius = 3.5
            element.maximumPointScreenSpaceRadius = 4.5

            let geometry = SCNGeometry(sources: [source], elements: [element])
            let material = SCNMaterial()
            material.lightingModel = .constant
            material.diffuse.contents = Self.colour(contract.appearance.tintHex)
            material.writesToDepthBuffer = false
            geometry.materials = [material]

            node.geometry = geometry
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

        /**
         A moon's orbit is drawn about its planet, not about the Sun.

         Sampled heliocentrically, a moon's path over one of its own periods is dominated by
         where its planet went in that time, not by the orbit. Phobos goes round Mars in 7.7
         hours, during which Mars travels 660,000 km along its own orbit while Phobos stays
         within 9,400 km of it: the drawn path came out as a nearly straight streak seventy
         times longer than the orbit it was meant to show, which is why no moon ever appeared
         to have one. Subtracting the parent at the same instant leaves the ellipse.
         */
        let parent: BodyId? = {
            if case .meanElementsAboutParent = contract.ephemeris { return contract.parent }
            return nil
        }()

        var vertices: [SCNVector3] = []
        let start = Epochs.j2000
        for i in 0 ..< samples {
            let jd = JdTdb(start + periodDays * Double(i) / Double(samples))
            let position = heliocentricPositionOf(id, at: jd)
            // Planets: plain heliocentric, with the root carrying the origin. Moons: relative
            // to the planet, with the node carrying the planet's position each frame.
            let relative = parent.map { position - heliocentricPositionOf($0, at: jd) } ?? position
            vertices.append(inHeliocentricUnits(relative))
        }

        /**
         Does the drawn orbit actually go round the Sun?

         Its closest point to the origin must be the perihelion, a(1 - e). That is a crisp
         test and an origin baked into the vertices destroys it: Earth's orbit shifted by an
         astronomical unit passes within a whisker of the origin instead of staying 0.98 au
         away. Nothing on screen distinguishes the two; this number does.

         The vertex centroid is not the test, which cost a detour. Sampling uniformly in time
         biases it toward aphelion by (3/2) a e, so Uranus reads 1.36 units from the Sun with
         entirely correct geometry, and that is indistinguishable from a one-au offset.
         */
        /**
         The same check for a moon, which is where it would have mattered first.

         A moon's vertices are relative to its planet, so the closest vertex to the node's own
         origin is the periapsis and the arithmetic is identical. Drawn heliocentrically, as
         they were, Phobos's path was a 660,000 km streak of Mars's own motion with a closest
         approach nowhere near its 9,234 km periapsis. This reads that as a factor of seventy
         rather than as a missing line.
         */
        func periapsisError(expected: Double) -> Double {
            var closest = Double.infinity
            for v in vertices {
                closest = Swift.min(closest, Double(
                    (v.x * v.x + v.y * v.y + v.z * v.z).squareRoot()
                ))
            }
            return abs(closest - expected) / expected
        }

        if case let .meanElementsAboutParent(source) = contract.ephemeris {
            orbitPerihelionError[id] = periapsisError(
                expected: source.semiMajorAxisM * (1 - source.eccentricity) / metresPerUnit
            )
        }

        if case let .standishElements(planet) = contract.ephemeris,
           let at = shortSpan.elements[planet]?.atJ2000 {
            let expected = toMetres(au(at.semiMajorAxisAu)) * (1 - at.eccentricity) / metresPerUnit
            orbitPerihelionError[id] = periapsisError(expected: expected)
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
            let radius = renderRadius(
                contract.equatorialRadiusM, isStar: contract.kind == .star
            )
            sphere.radius = radius
            // The rings are built in planet radii, so they scale with the body.
            rescaleRings(id, to: radius)
        }

        clearTiles()
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
        /// `-zoom <radii>` starts the camera at a chosen multiple of the body's radius, so a
        /// screenshot run can reach the altitude band where streamed tiles are used. Test
        /// hook, not a feature.
        let requestedRadii: Double? = {
            guard let i = CommandLine.arguments.firstIndex(of: "-zoom"),
                  i + 1 < CommandLine.arguments.count else { return nil }
            return Double(CommandLine.arguments[i + 1])
        }()

        let radius = bodyContracts[focus]!.equatorialRadiusM
        if let requestedRadii {
            cameraDistanceM = radius * requestedRadii
        } else if focus == .sun {
            // Far enough out to hold Jupiter's orbit, which is what reads on a phone.
            cameraDistanceM = 7.5 * Constants.auInMetres
        } else {
            /**
             Six radii, for every body, moons or not.

             Framing the whole satellite system by default looked like the thoughtful choice
             and is the wrong one: Callisto's apoapsis is 26 Jupiter radii, so fitting it puts
             the camera 58 radii out and Jupiter covers about one percent of the screen.
             Measured that way, Mercury and Titan lit 88% of the centre and Jupiter lit 1.1%.

             The body is the subject. "Fit moons" is there for when the system is.
             */
            cameraDistanceM = radius * 6
        }

        // Approach from the lit side. Arriving over the night side is a black screen and
        // reads as a bug. The Sun direction is taken from the epoch rather than from a cached
        // position, because changing focus does not recompute positions; the frame loop does.
        let sun = sunDirection(from: focus, at: when)
        cameraAzimuth = atan2(Double(sun.z), Double(sun.x))
        cameraElevation = 0.28
        applyCamera()
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
        frameCounter &+= 1
        for id in bodyIds {
            positions[id] = gravity?.heliocentricPosition(of: id)
                ?? heliocentricPositionOf(id, at: epoch)
        }
        // The floating origin sits on the focused body. Everything downstream draws relative
        // to it, which is what keeps the numbers reaching Float small at any scale.
        origin = positions[focus] ?? .zero

        /**
         The origin, applied once to the parent instead of to every vertex.

         This assignment was missing, and the gap was invisible for as long as orbit paths
         were only ever drawn in the system view: focusing the Sun puts the origin at zero, so
         a root left at the identity is accidentally correct. Everything else parented here was
         drawn at absolute heliocentric coordinates while the camera sat at the focused body,
         which is an astronomical unit away. A moon's orbit path lands off screen rather than
         wrong, so nothing looked broken, there was just nothing there.
         */
        heliocentricRoot.position = renderPosition(.zero)

        // Moon orbits carry vertices relative to their planet, so each one rides its planet.
        for (moon, parent) in orbitAnchors {
            guard let at = positions[parent] else { continue }
            orbitNodes[moon]?.position = renderPosition(at)
            markNodes[moon]?.position = renderPosition(at)
        }

        markEpoch = epoch
        refreshTimeMarks()

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

        updateMarkers()
    }

    /**
     Fade each marker in as its body stops being resolvable.

     The apparent radius is the same expression the website uses, so the two clients cross the
     threshold at the same moment rather than at two thresholds that merely sound alike:
     radius over the distance times the tangent of the half field of view, scaled to half the
     viewport height.

     The marker's own size is set in the same breath, because a billboard at a fixed scene size
     grows and shrinks with distance like everything else, and a dot that does that is not a
     marker. Holding it at a constant pixel size is the entire point.
     */
    private func updateMarkers() {
        let fovRadians = (cameraNode.camera?.fieldOfView ?? 55) * Double.pi / 180
        let tanHalf = tan(fovRadians / 2)
        let cameraPosition = cameraNode.position

        for id in bodyIds {
            guard let node = nodes[id],
                  let marker = markerNodes[id],
                  let sphere = node.childNodes.first?.geometry as? SCNSphere
            else { continue }

            let dx = Double(node.position.x - cameraPosition.x)
            let dy = Double(node.position.y - cameraPosition.y)
            let dz = Double(node.position.z - cameraPosition.z)
            let depth = (dx * dx + dy * dy + dz * dz).squareRoot()
            guard depth > 0 else { marker.opacity = 0; continue }

            let apparentPx = (Double(sphere.radius) / (depth * tanHalf)) * (viewportHeightPx / 2)
            let fade = apparentPx < Self.markerFadePx ? 1 - apparentPx / Self.markerFadePx : 0
            marker.opacity = CGFloat(fade)
            guard fade > 0 else { continue }

            // Six pixels across, held constant by cancelling the perspective divide. Divided
            // by the body's own scale, because the marker hangs off the body node and would
            // otherwise inherit it.
            let widthScene = (2 * Self.markerFadePx * depth * tanHalf) / viewportHeightPx
            let scale = Float(widthScene) / max(node.scale.x, 1e-9)
            marker.scale = SCNVector3(scale, scale, scale)
        }
    }

    /// The HUD reports the live viewport, because the marker threshold is in pixels and a
    /// hardcoded height puts the fade at the wrong distance on every device but one.
    func setViewportHeight(_ px: Double) {
        guard px > 0 else { return }
        viewportHeightPx = px
    }

    // MARK: - Labels

    /**
     Project every body to normalised device coordinates, for the label layer.

     Done with the camera's own transform rather than through `SCNView.projectPoint`, because
     the view belongs to SwiftUI's `SceneView` and is not reachable from here. Inverting the
     camera's world transform gives the view matrix, and the projection is the standard
     perspective one built from the camera's own field of view and the supplied aspect; both
     numbers come from the camera that is actually rendering, so this cannot disagree with
     what is on screen.

     `behindCamera` is reported rather than filtered. A body behind the camera projects to a
     mirrored point, which is mathematically correct and visually a lie, and the label layer
     needs to know in order to point the right way.
     */
    func labelInputs(aspect: Double) -> [LabelInput] {
        let view = simd_inverse(cameraNode.simdWorldTransform)
        let fovRadians = (cameraNode.camera?.fieldOfView ?? 55) * Double.pi / 180
        let tanHalf = tan(fovRadians / 2)
        let satellites = Set(childrenOf(focus))

        return bodyIds.compactMap { id -> LabelInput? in
            guard let node = nodes[id],
                  let sphere = node.childNodes.first?.geometry as? SCNSphere
            else { return nil }

            let world = SIMD4<Float>(node.position.x, node.position.y, node.position.z, 1)
            let eye = view * world
            // SceneKit looks down its own negative z, so a visible body has negative eye z.
            let depth = -Double(eye.z)
            let behind = depth <= 0
            let safeDepth = max(abs(depth), 1e-9)

            let relevance: LabelRelevance =
                id == focus ? .focus : (satellites.contains(id) ? .satelliteOfFocus : .other)

            return LabelInput(
                id: id,
                ndcX: Double(eye.x) / (safeDepth * tanHalf * aspect),
                ndcY: Double(eye.y) / (safeDepth * tanHalf),
                radiusPx: (Double(sphere.radius) / (safeDepth * tanHalf)) * (viewportHeightPx / 2),
                distance: safeDepth * metresPerUnit,
                behindCamera: behind,
                relevance: relevance
            )
        }
    }

    func node(for body: BodyId) -> SCNNode? { nodes[body] }

    /**
     What the frame loop actually did, for the probes.

     The equivalent of the website's `window.__solar.debug()`. Pixel heuristics are the right
     tool for "is anything on screen" and the wrong one for "is this node where it should be":
     an attempt to check the orbits were centred on the Sun by comparing image centroids read
     53% off with correct code, because the starfield dominated the sample. Geometry questions
     get geometry answers.
     */
    /// How far the drawn rings reach, in planet radii. Saturn's contract says 2.27.
    private func ringExtentInPlanetRadii(_ id: BodyId) -> Double? {
        guard let node = nodes[id]?.childNodes.first(where: { $0.name == "rings" }),
              let sphere = nodes[id]?.childNodes.first?.geometry as? SCNSphere,
              sphere.radius > 0
        else { return nil }
        // The annulus is built in planet radii, so its bounding box gives the outer edge
        // directly. Measured from the geometry rather than recomputed from the contract,
        // which would only prove the contract agrees with itself.
        let (_, max) = node.boundingBox
        let extent = Double(Swift.max(abs(max.x), abs(max.z)))
        return extent * Double(node.scale.x) / Double(sphere.radius)
    }

    /**
     Where each body ended up, in scene units from the focused body.

     Enough to answer "why can I not see X" without squinting at a screenshot: a body that is
     missing, one that is behind another, and one that is simply too small to resolve are
     three different problems with the same appearance.
     */
    private func bodyReport() -> [String: Any] {
        var report: [String: Any] = [:]
        for id in bodyIds {
            guard let node = nodes[id],
                  let sphere = node.childNodes.first?.geometry as? SCNSphere else { continue }
            let p = node.position
            let distance = Double((p.x * p.x + p.y * p.y + p.z * p.z).squareRoot())
            report[id.rawValue] = [
                "distanceUnits": distance,
                "radiusUnits": Double(sphere.radius),
                /**
                 How big it actually looks, and whether anything is drawn for it.

                 "Why dont i see moons" had two separate causes and the same appearance.
                 Phobos from six Mars radii is 0.46 pixels across: drawn, in frame, correct,
                 invisible. The Galileans from the same framing are simply outside the
                 frustum. A probe that only measures lit pixels cannot tell those apart, or
                 tell either of them from a moon that is not being positioned at all.
                 */
                "apparentRadiusPx": apparentRadiusPx(of: id),
                "markerOpacity": Double(markerNodes[id]?.opacity ?? 0),
                // What fraction of the way to the body the drawn Sun reaches. Over one means
                // the Sun's disc swallows it from this viewpoint.
                "sunRadiiAway": distance / Double(
                    (nodes[.sun]?.childNodes.first?.geometry as? SCNSphere)?.radius ?? 1
                ),
            ]
        }
        return report
    }

    /// Apparent radius on screen, pixels. The same expression the marker fade uses, so the
    /// probe and the renderer cannot disagree about whether something is resolvable.
    private func apparentRadiusPx(of id: BodyId) -> Double {
        guard let node = nodes[id],
              let sphere = node.childNodes.first?.geometry as? SCNSphere
        else { return 0 }
        let p = node.position
        let c = cameraNode.position
        let dx = Double(p.x - c.x), dy = Double(p.y - c.y), dz = Double(p.z - c.z)
        let depth = (dx * dx + dy * dy + dz * dz).squareRoot()
        guard depth > 0 else { return 0 }
        let tanHalf = tan(((cameraNode.camera?.fieldOfView ?? 55) * Double.pi / 180) / 2)
        return (Double(sphere.radius) / (depth * tanHalf)) * (viewportHeightPx / 2)
    }

    /**
     Make a report encodable, and say what had to be changed.

     `JSONSerialization` rejects NaN and infinity outright, and the whole report is one
     object, so a single bad number anywhere produced no file at all. The probe then reported
     "no scene debug output", which reads as a missing feature rather than as a malformed
     number, and the actual value that went wrong was never seen by anyone.

     Non-finite values become strings naming themselves. The report still encodes, the probe
     still runs, and the bad number arrives as "nan" in the field that produced it instead of
     taking the whole diagnostic down with it.
     */
    private static func jsonSafe(_ value: Any) -> Any {
        switch value {
        case let d as Double:
            return d.isFinite ? d : (d.isNaN ? "nan" : (d > 0 ? "inf" : "-inf"))
        case let dict as [String: Any]:
            return dict.mapValues { jsonSafe($0) }
        case let array as [Any]:
            return array.map { jsonSafe($0) }
        default:
            return value
        }
    }

    func debug() -> [String: Any] {
        Self.jsonSafe(rawDebug()) as? [String: Any] ?? [:]
    }

    private func rawDebug() -> [String: Any] {
        let sun = nodes[.sun]?.presentation.worldPosition ?? SCNVector3Zero
        let root = heliocentricRoot.presentation.worldPosition
        // The Sun is at the heliocentric origin, so the root that carries that origin must
        // land exactly on the Sun's node. Any gap means orbit geometry and body positions
        // disagree about where the centre of the system is.
        let gap = Double((
            (sun.x - root.x) * (sun.x - root.x)
                + (sun.y - root.y) * (sun.y - root.y)
                + (sun.z - root.z) * (sun.z - root.z)
        ).squareRoot())

        return [
            "focus": focus.rawValue,
            "metresPerUnit": metresPerUnit,
            "cameraDistanceM": cameraDistanceM,
            "altitudeM": altitudeM,
            "sunNode": [Double(sun.x), Double(sun.y), Double(sun.z)],
            "heliocentricRoot": [Double(root.x), Double(root.y), Double(root.z)],
            "sunToRootUnits": gap,
            "orbitNodes": orbitNodes.count,
            // Time marks, so a probe can tell "the marks are not drawn" from "the marks are
            // drawn and I cannot see them", which a screenshot cannot.
            "markNodes": markNodes.count,
            "markVertices": markNodes.values.reduce(0) { total, node in
                total + (node.geometry?.sources.first { $0.semantic == .vertex }?.vectorCount ?? 0)
            },
            "maxPerihelionError": orbitPerihelionError.values.max() ?? 0,
            "saturnRingOuterInPlanetRadii": ringExtentInPlanetRadii(.saturn) ?? 0,
            /**
             Does the root that carries the origin actually carry it?

             A point drawn under `heliocentricRoot` at the focused body's heliocentric position
             must land on the camera origin, because that is where the focused body is. If the
             root is left at the identity this reads as the body's distance from the Sun in
             scene units instead of zero, which is how the missing assignment went unnoticed:
             the one focus anyone screenshotted was the Sun, where both answers are zero.
             */
            "focusUnderRootUnits": {
                let p = positions[focus] ?? .zero
                let inUnits = inHeliocentricUnits(p)
                let r = heliocentricRoot.position
                let dx = Double(r.x + inUnits.x)
                let dy = Double(r.y + inUnits.y)
                let dz = Double(r.z + inUnits.z)
                return (dx * dx + dy * dy + dz * dz).squareRoot()
            }(),
            /// Label geometry, so a probe can check a pointer points at the body it names
            /// rather than squinting at an eight-pixel triangle in a screenshot.
            "labels": placeLabels(
                labelInputs(aspect: 1206.0 / 2622.0),
                options: LabelOptions(viewportWidthPx: 402, viewportHeightPx: 874)
            ).map { placement -> [String: Any] in
                var entry: [String: Any] = [
                    "id": placement.id.rawValue,
                    "x": placement.x,
                    "y": placement.y,
                    "clamped": placement.clamped,
                ]
                // Omitted rather than filled with a sentinel. An on-screen label has no
                // bearing, and a "nan" or a 1000 in that field is a value every reader has
                // to know to ignore.
                if let bearing = placement.bearingRadians {
                    entry["bearingDeg"] = bearing * 180 / Double.pi
                }
                return entry
            },
            "tileNodes": tileNodes.count,
            "bodies": nodes.count,
            "bodyReport": bodyReport(),
        ]
    }

    /**
     Streams and draws surface tiles for the focused body.

     The level comes from SolarKit's ported arithmetic: the coarsest whose texel is still
     finer than a screen pixel. Tiles arrive asynchronously and the global normal map covers
     the gap, so a slow network degrades detail rather than leaving a hole.

     Throttled, because the selection is cheap but rebuilding geometry is not, and the camera
     moves every frame while the set of visible tiles changes far more slowly.
     */
    func refreshTiles(viewportHeightPx: Double) {
        guard let surface = terrain.surface(for: focus), focus != .sun else {
            return
        }
        guard Date().timeIntervalSince(lastTileRefresh) > 0.4 else { return }
        lastTileRefresh = Date()

        let fovRad = (cameraNode.camera?.fieldOfView ?? 55) * Double.pi / 180
        let altitude = altitudeM
        let level = levelFor(
            surface.manifest,
            altitudeM: altitude,
            verticalFovRadians: fovRad,
            viewportHeightPx: viewportHeightPx
        )

        let globalTexel = 2 * Double.pi * bodyContracts[focus]!.equatorialRadiusM
            / Double(surface.manifest.globalWidth)
        let screenTexel = metresPerPixel(
            altitudeM: altitude, verticalFovRadians: fovRad, viewportHeightPx: viewportHeightPx
        )
        guard globalTexel > screenTexel else {
            clearTiles()
            return
        }

        let centre = subCameraPoint()
        let cap = visibleCapAngle(
            radiusM: bodyContracts[focus]!.equatorialRadiusM, altitudeM: altitude
        )
        let wanted = tilesInView(level: level, centre: centre, capAngle: cap, budget: 16)
        let wantedSet = Set(wanted)

        for (id, node) in tileNodes where !wantedSet.contains(id) {
            node.removeFromParentNode()
            tileNodes.removeValue(forKey: id)
        }

        let root = tileRoot ?? {
            let node = SCNNode()
            nodes[focus]?.childNodes.first?.addChildNode(node)
            tileRoot = node
            return node
        }()

        for id in wanted where tileNodes[id] == nil {
            guard let image = terrain.tile(id, body: focus, onArrival: { [weak self] in
                self?.lastTileRefresh = .distantPast
            }) else { continue }

            let geometry = TilePatch.geometry(extent: tileExtent(level: level, tile: id))
            let material = SCNMaterial()
            // The body's own albedo on channel 0, sampled with global coordinates so the
            // imagery lines up with the sphere beneath. The streamed relief on channel 1.
            material.diffuse.contents = Self.texture(bodyContracts[focus]!.appearance.albedoTextureId)
                ?? Self.colour(bodyContracts[focus]!.appearance.tintHex)
            material.diffuse.mappingChannel = 0
            material.normal.contents = image
            material.normal.mappingChannel = 1
            material.normal.intensity = 1.0
            material.roughness.contents = 0.95
            material.metalness.contents = 0.0
            geometry.materials = [material]

            let node = SCNNode(geometry: geometry)
            root.addChildNode(node)
            tileNodes[id] = node
        }
    }

    private func clearTiles() {
        for (_, node) in tileNodes { node.removeFromParentNode() }
        tileNodes.removeAll()
        tileRoot?.removeFromParentNode()
        tileRoot = nil
    }

    /// Where the camera is looking down on the focused body, in its own body-fixed frame.
    private func subCameraPoint() -> SubCameraPoint {
        SubCameraPoint(latitude: cameraElevation, longitude: -cameraAzimuth)
    }

    /// Whether the focused body has elevation relief, and the altitude below which the data
    /// runs out. Both read from the manifest, not hardcoded.
    func reliefLimit(fovDegrees: Double, viewportHeightPx: Double) -> (has: Bool, smoothBelowM: Double?) {
        (
            terrain.hasTerrain(focus),
            terrain.smoothBelowM(
                for: focus,
                verticalFovRadians: fovDegrees * Double.pi / 180,
                viewportHeightPx: viewportHeightPx
            )
        )
    }

    // MARK: - Markers

    /// Which planet each moon's orbit path is anchored to, for the per-frame reposition.
    private var orbitAnchors: [BodyId: BodyId] = [:]
    private var markerNodes: [BodyId: SCNNode] = [:]
    /// Above this apparent radius the real sphere is resolvable and the marker fades out.
    /// Seven pixels, the same threshold the website uses, so the two look alike at a glance.
    private static let markerFadePx = 7.0
    private var viewportHeightPx: Double = 900

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

        // Keep the distance, change only where we stand. Choosing a lighting angle should
        // not undo a zoom.
        cameraAzimuth = atan2(Double(d.z), Double(d.x))
        cameraElevation = asin(max(-1, min(1, Double(d.y))))
        applyCamera()
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
        cameraDistanceM = systemRadius / tan(halfFovRad * fill)
        applyCamera()
    }
}
