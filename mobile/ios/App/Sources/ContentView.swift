import SwiftUI

/**
 How often the overlay's root body is re-evaluated, in evaluations per second.

 Not a performance curiosity. A SwiftUI body that runs at the display's rate rebuilds every
 control beneath it, and a control recreated under a finger does not reliably receive the
 gesture that started on the previous instance. That has now been reported from the phone three
 times, each time as something different: a picker that opened and discarded every tap, sheet
 controls that were unreachable, and a time-rate slider that "gets stuck for a bit and looks
 like its crashed". All three were this.

 The cause is always the same shape, and it is easy to reintroduce by accident: read a property
 that changes every frame, anywhere in a view body, and `@Observable` correctly invalidates that
 whole view sixty times a second. Reading the clock's epoch to hand it to the label layer was
 enough to rebuild the entire overlay.

 So it is measured rather than commented on. `focus-probe.mjs` reads this out of the scene dump
 and fails if the overlay is rebuilding at anything like frame rate.
 */
@MainActor
enum OverlayRenders {
    private(set) static var perSecond: Int = 0
    private static var count = 0
    private static var windowStart = Date()

    static func recordBodyEvaluation() {
        count += 1
    }

    /// Called from the tick. Averages over a whole second rather than reporting an instant,
    /// so one slow frame cannot read as a regression and one fast one cannot hide it.
    static func sample(now: Date = Date()) {
        let elapsed = now.timeIntervalSince(windowStart)
        guard elapsed >= 1 else { return }
        perSecond = Int((Double(count) / elapsed).rounded())
        count = 0
        windowStart = now
    }
}
import SceneKit
import SolarKit

/**
 The app shell: the scene, the body panel, the view controls and the clock.

 Deliberately the same information architecture as the website, because the two are meant to
 be the same product and `contracts/feature-parity` says a feature on one platform is tracked
 on all of them. Every figure comes from SolarKit, and the ones that depend on the clock say
 what they mean at the current rate.
 */
struct ContentView: View {
    @State private var clock = Clock()
    @State private var scene = SolarScene()
    @State private var gravity = Gravity()
    /// `-focus <id>` lets a screenshot run start on a chosen body. Test hook, not a feature.
    @State private var focus: BodyId = {
        guard let index = CommandLine.arguments.firstIndex(of: "-focus"),
              index + 1 < CommandLine.arguments.count,
              let id = BodyId(rawValue: CommandLine.arguments[index + 1]) else { return .embary }
        return id
    }()
    @State private var lastTick = Date()
    @State private var lastDrag: CGSize = .zero
    @State private var lastMagnification: CGFloat = 1
    /// `-dumpScene` logs the scene's geometry once, a few seconds in, for the probes.
    @State private var dumpAt: Date? = CommandLine.arguments.contains("-dumpScene")
        ? Date().addingTimeInterval(8)
        : nil
    @State private var showingDemonstrations = false
    @State private var showingAsk = false
    /**
     Hides every panel so the scene is unobstructed.

     The panels are the point right up until you want to look at the planet, at which moment
     they are covering it. One small control stays visible, because an overlay with no way
     back is a trap rather than a decluttered view.
     */
    /// `-showHabitability` opens the panel at launch, so a screenshot probe can capture it
    /// without driving a tap. The same reason `-focus` exists.
    @State private var showingHabitability = CommandLine.arguments.contains("-showHabitability")
    @State private var showingSurface = CommandLine.arguments.contains("-showSurface")
    /**
     Labels on by default.

     Asked for because the Moon could not be found while focused on Earth, which is the
     off-screen case: there is nothing on screen to look harder at. Defaulting them off would
     leave that unsolved for anyone who does not go looking for a toggle, and the people most
     likely to need a name for something are the least likely to know the control exists.
     */
    @State private var showLabels = !CommandLine.arguments.contains("-noLabels")

    private var anySheetPresented: Bool {
        showingDemonstrations || showingAsk || showingHabitability || showingSurface
    }
    @State private var overlayHidden = CommandLine.arguments.contains("-startHidden")

    private let tick = Timer.publish(every: 1.0 / 60.0, on: .main, in: .common).autoconnect()

    var body: some View {
        // Counted, not just commented on. See `OverlayRenders`.
        let _ = OverlayRenders.recordBodyEvaluation()
        ZStack(alignment: .bottom) {
            /**
             No `.allowsCameraControl`.

             SceneKit's built-in controller builds its own camera and ignores the
             `pointOfView` it is handed, so every write to the scene's camera went somewhere
             invisible. It also holds its distance in scene units, and this scene rescales
             per focused body, so changing focus after a gesture left it either inside the
             body or billions of units out. The scene simply vanished, with no error.

             The gestures below drive the scene's own camera instead, in metres.

             No `autoenablesDefaultLighting` either: it adds an omni light at the camera,
             which lights the night side of every body and destroys the terminator.
             */
            SceneView(scene: scene.scene, pointOfView: scene.cameraNode, options: [])
                .ignoresSafeArea()
                .gesture(
                    DragGesture(minimumDistance: 1)
                        .onChanged { value in
                            let delta = CGSize(
                                width: value.translation.width - lastDrag.width,
                                height: value.translation.height - lastDrag.height
                            )
                            lastDrag = value.translation
                            scene.orbit(deltaX: delta.width, deltaY: delta.height)
                        }
                        .onEnded { _ in lastDrag = .zero }
                )
                .simultaneousGesture(
                    MagnifyGesture()
                        .onChanged { value in
                            // Relative to the last callback, so the zoom is smooth rather
                            // than snapping back to the gesture's start on every frame.
                            let step = value.magnification / lastMagnification
                            lastMagnification = value.magnification
                            scene.zoom(by: step)
                        }
                        .onEnded { _ in lastMagnification = 1 }
                )

            /**
             Suspended while a sheet covers the scene.

             Not an optimisation for its own sake. The label layer re-lays out on every frame
             of the clock, and with a sheet up that was enough to make the sheet's own
             controls unreachable: a picker inside a sheet went back to opening and discarding
             every tap. Measured through the interaction gate: 9.8 seconds with labels off
             against 251 seconds and a failure with them on.

             Nothing is lost, because a sheet covers the scene and the labels with it.
             */
            if showLabels && !anySheetPresented {
                LabelLayer(scene: scene)
                    .ignoresSafeArea()
            }

            if !overlayHidden {
                VStack(spacing: 10) {
                    BodyPanel(id: focus, clock: clock, scene: scene)
                    ViewControls(focus: focus, scene: scene, clock: clock)
                    GravityBar(gravity: gravity, clock: clock)
                    TimeBar(clock: clock)
                }
                .padding(14)
                .transition(.opacity.combined(with: .move(edge: .bottom)))
            }
        }
        .overlay(alignment: .top) {
            if !overlayHidden {
                BodyPicker(focus: $focus)
                    .padding(.top, 6)
                    .transition(.opacity)
            }
        }
        .overlay(alignment: .topTrailing) {
            /**
             The tool rail sits above the body panel in z-order and the panel used to grow up
             underneath it, so an expanded panel's own control ended up behind a rail button.
             The panel is height-capped now and the rail keeps its own row, so neither can
             reach the other.
             */
            VStack(alignment: .trailing, spacing: 6) {
                // Labelled, not a bare icon. Someone asked where the hide control was, which
                // is the only evidence that matters about whether an icon is discoverable.
                Button {
                    withAnimation(.easeInOut(duration: 0.2)) { overlayHidden.toggle() }
                } label: {
                    Label(
                        overlayHidden ? "Show panels" : "Hide panels",
                        systemImage: overlayHidden ? "eye" : "eye.slash"
                    )
                    .font(.system(size: 11))
                }
                .tint(overlayHidden ? .orange : .secondary)

                if !overlayHidden {
                    /**
                     Back out to the whole solar system.

                     Focusing the Sun has always been the system view, and nothing said so:
                     someone asked how to unfocus a planet, which is the only evidence that
                     matters. "The Sun" stays in the picker because it is also a body with
                     its own data; this is the obvious route to the same place.
                     */
                    Button { focus = .sun } label: {
                        Label("Solar system", systemImage: "circle.hexagongrid")
                            .font(.system(size: 11))
                    }
                    .tint(focus == .sun ? .orange : .secondary)

                    Button { showingDemonstrations = true } label: {
                        Image(systemName: "function")
                    }
                    .accessibilityIdentifier("tool.demonstrations")
                    Button { showingAsk = true } label: {
                        Image(systemName: "sparkles")
                    }
                    // Labelled, like the hide control, because an unlabelled tag icon is
                    // exactly the kind of thing someone asks about rather than finds.
                    Button {
                        withAnimation(.easeInOut(duration: 0.15)) { showLabels.toggle() }
                    } label: {
                        Label("Labels", systemImage: showLabels ? "tag.fill" : "tag")
                            .font(.system(size: 11))
                    }
                    .tint(showLabels ? .orange : .secondary)
                    .accessibilityIdentifier("tool.labels")

                    Button { showingSurface = true } label: {
                        Image(systemName: "camera.viewfinder")
                    }
                    .tint(.cyan)
                    .accessibilityIdentifier("tool.surface")

                    Button { showingHabitability = true } label: {
                        Image(systemName: "leaf")
                    }
                    .tint(.green)
                    .accessibilityIdentifier("tool.habitability")
                }
            }
            .buttonStyle(.bordered)
            .controlSize(.small)
            .padding(.trailing, 10)
            .padding(.top, overlayHidden ? 8 : 54)
        }
        .sheet(isPresented: $showingDemonstrations) { DemonstrationsView() }
        .sheet(isPresented: $showingAsk) { AskView() }
        // `focus`, not `clock`: the assessment is a pure function of the body and does
        // not move with time, so the sheet is rebuilt only when the focus changes.
        .sheet(isPresented: $showingHabitability) { HabitabilityView(body_: focus) }
        .sheet(isPresented: $showingSurface) { SurfacePhotographsView(body_: focus) }
        .task {
            /**
             `-focusAfter <id>` switches focus a moment after launch, so a probe can exercise
             the focus-change path rather than only the initial one. They are not the same
             path and have not had the same bugs: orbit geometry built against a stale origin
             is invisible when the first focus is the Sun, because the origin is zero there,
             and wrong by an astronomical unit when you arrive from Earth. Test hook.
             */
            guard let i = CommandLine.arguments.firstIndex(of: "-focusAfter"),
                  i + 1 < CommandLine.arguments.count,
                  let later = BodyId(rawValue: CommandLine.arguments[i + 1]) else { return }
            try? await Task.sleep(for: .seconds(3))
            focus = later
        }
        .task {
            // `-fitMoons` pulls back to frame the satellite system at launch, so a probe can
            // check that the moons are actually visible there. Test hook.
            guard CommandLine.arguments.contains("-fitMoons") else { return }
            try? await Task.sleep(for: .seconds(2))
            scene.frameMoons()
        }
        .onAppear {
            // onChange only fires on a change, so the scene would never be told about the
            // initial focus. It happens to match today because both default to Earth, which
            // is exactly the kind of coincidence that breaks the moment one of them moves.
            scene.setFocus(focus, at: clock.epoch)
            scene.update(to: clock.epoch, gravity: gravity)
        }
        .onChange(of: focus) { _, body in
            scene.setFocus(body, at: clock.epoch)
            scene.update(to: clock.epoch, gravity: gravity)
        }
        .onReceive(tick) { now in
            let delta = now.timeIntervalSince(lastTick)
            lastTick = now
            if dumpAt != nil, Date() > dumpAt! {
                dumpAt = nil
                /**
                 Written to a file, not logged.

                 `log show` wraps and truncates a long message, and the report grew past that
                 the moment it carried all 32 bodies. A truncated line parses as malformed
                 JSON, which at least fails loudly; a line truncated at a brace boundary would
                 not have. The probe reads this out of the app container.
                 */
                let url = URL.documentsDirectory.appendingPathComponent("scene-debug.json")
                var report = scene.debug()
                report["overlayRendersPerSecond"] = OverlayRenders.perSecond
                /**
                 Report a failed dump instead of swallowing it.

                 This was `try?` around both the encode and the write, so a report containing
                 a single NaN produced no file and no log line, and the probe that reads it
                 said "no scene debug output" rather than "the report is malformed". A
                 diagnostic that fails silently is worse than no diagnostic, because it
                 reports the absence of a problem.
                 */
                if !JSONSerialization.isValidJSONObject(report) {
                    for (key, value) in report where !JSONSerialization.isValidJSONObject([key: value]) {
                        NSLog("SCENEDEBUG unencodable key: %@", key)
                    }
                }
                do {
                    let data = try JSONSerialization.data(
                        withJSONObject: report, options: [.prettyPrinted, .sortedKeys]
                    )
                    try data.write(to: url)
                    NSLog("SCENEDEBUG written to %@", url.path)
                } catch {
                    NSLog("SCENEDEBUG failed: %@", String(describing: error))
                }
            }
            OverlayRenders.sample()
            clock.advance(realSeconds: delta)
            gravity.seek(to: clock.epoch)
            scene.update(to: clock.epoch, gravity: gravity)
            let heightPx = Double(UIScreen.main.bounds.height)
            scene.setViewportHeight(heightPx)
            scene.refreshTiles(viewportHeightPx: heightPx)
        }
    }
}

/// Every body, with moons indented under their planet so 32 entries read as a system.
private struct BodyPicker: View {
    @Binding var focus: BodyId

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 5) {
                ForEach(bodyIds, id: \.self) { id in
                    let contract = bodyContracts[id]!
                    Button {
                        focus = id
                    } label: {
                        Text((contract.kind == .moon ? "\u{21b3} " : "") + contract.displayName)
                            .font(contract.kind == .moon ? .caption2 : .caption)
                    }
                    .padding(.horizontal, 9)
                    .padding(.vertical, 5)
                    .background(focus == id ? Color.orange.opacity(0.9) : Color.white.opacity(0.08))
                    .foregroundStyle(focus == id ? Color.black : Color.white.opacity(0.85))
                    .clipShape(Capsule())
                }
            }
            .padding(.horizontal, 14)
        }
    }
}

/**
 Everything the contract is willing to assert about a body, with its provenance.

 The same fields as the website's panel, including the declared discrepancies, because a
 conflict between sources is documentation rather than something to hide.
 */
private struct BodyPanel: View {
    /// Named `id`, not `body`: SwiftUI's View protocol already owns `body`.
    let id: BodyId
    let clock: Clock
    let scene: SolarScene
    @State private var expanded = false

    private var contract: BodyContract { bodyContracts[id]! }

    private var orbitDays: Double? {
        switch contract.ephemeris {
        case .fixedAtBarycentre: return nil
        case let .standishElements(planet):
            guard let e = shortSpan.elements[planet] else { return nil }
            return 360 / e.ratePerCentury.meanLongitudeDeg * Constants.daysPerJulianCentury
        case let .meanElementsAboutParent(source): return source.periodDays
        }
    }

    private var fromSun: Double { heliocentricPositionOf(id, at: clock.displayEpoch).length }

    private var fromEarth: Double {
        (heliocentricPositionOf(id, at: clock.displayEpoch)
            - heliocentricPositionOf(.embary, at: clock.displayEpoch)).length
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(contract.displayName).font(.headline)
                .accessibilityIdentifier("panel.title")
            Text(contract.education.oneLine)
                .font(.caption)
                .foregroundStyle(.orange.opacity(0.9))

            /**
             Three rows collapsed. The panel used to show everything always and covered most
             of the planet, which is a poor trade in an app whose whole point is looking at
             the planet. The rest is one tap away and scrolls, so it can never grow past half
             the screen however much a contract has to say.
             */
            Grid(alignment: .leading, horizontalSpacing: 14, verticalSpacing: 4) {
                row("From the Sun", distance(fromSun),
                    simulated: orbitDays.map { $0 * Constants.secondsPerDay }, label: "one orbit")
                row("Equatorial radius", "\(Int(contract.equatorialRadiusM / 1_000).formatted()) km")
                row("Rotation", rotationText,
                    simulated: abs(contract.siderealRotationDays) * Constants.secondsPerDay,
                    label: "one turn")
            }

            if expanded {
                ScrollView {
                    VStack(alignment: .leading, spacing: 6) {
                        Grid(alignment: .leading, horizontalSpacing: 14, verticalSpacing: 4) {
                            if id != .embary {
                                row("From Earth",
                                    "\(distance(fromEarth))  (\(lightTime(fromEarth)) of light)")
                            }
                            row("Axial tilt", String(
                                format: "%.2f\u{00b0}", obliquityToOrbitDeg(id, at: clock.displayEpoch)
                            ))
                            row("Mean temperature",
                                "\(Int(contract.meanTemperatureK)) K  "
                                    + "(\(Int(contract.meanTemperatureK - 273.15)) \u{00b0}C)")
                            if contract.confirmedMoons > 0 {
                                row("Confirmed moons", "\(contract.confirmedMoons)")
                            }
                            if let atmosphere = contract.atmosphere {
                                row("Atmosphere", atmosphere.composition
                                    .map { "\($0.0) \(String(format: "%.1f", $0.1 * 100))%" }
                                    .joined(separator: ", "))
                            }
                        }

                        Text(contract.education.whyItMatters).font(.caption).padding(.top, 2)

                        ForEach(contract.education.facts, id: \.self) { fact in
                            Text("\u{2014}  " + fact)
                                .font(.system(size: 11))
                                .foregroundStyle(.secondary)
                        }

                        if !contract.knownDiscrepancies.isEmpty {
                            VStack(alignment: .leading, spacing: 3) {
                                Text("SOURCES DISAGREE")
                                    .font(.system(size: 10, weight: .medium))
                                    .foregroundStyle(.orange.opacity(0.8))
                                ForEach(contract.knownDiscrepancies, id: \.field) { d in
                                    Text(d.summary).font(.system(size: 11))
                                    Text("Using: " + d.preferred)
                                        .font(.system(size: 10))
                                        .foregroundStyle(.orange.opacity(0.7))
                                }
                            }
                            .padding(8)
                            .background(.orange.opacity(0.08), in: RoundedRectangle(cornerRadius: 8))
                        }

                        Text(provenance)
                            .font(.system(size: 10))
                            .foregroundStyle(.secondary)
                    }
                }
                // Capped so a body with a lot to say cannot push the panel up into the tool
                // rail. Jupiter's contract alone runs past the top of the screen uncapped.
                /**
                 Capped so the panel's own header cannot slide under the tool rail.

                 240 was not enough. The panel is bottom-aligned, so expanding it grows the
                 top edge upwards, and at 240 the header reached y=208 on a 874 point screen
                 while the rail occupies roughly 54 to 292 on the same side. The More control
                 ended up underneath the rail's last button: still reported hittable by
                 accessibility, because nothing about the view hierarchy was wrong, and
                 untappable in practice because the rail is in front. Tapping it opened a
                 sheet instead of collapsing the panel, so the panel could be expanded and
                 not put away, which is what prompted the question about whether More toggles.

                 Sized from the window rather than from a second constant, so it stays right
                 on a device whose screen is a different height. `interactiveOverlaysDoNotOverlap`
                 in the UI tests is the gate; this number is just the fix.
                 */
                .frame(maxHeight: max(120, UIScreen.main.bounds.height * 0.5 - 240))
            }

            reliefNotice
            /**
             The expand control sits on the bottom edge, not in the header.

             The panel is bottom-aligned, so expanding it grows the top edge upwards into the
             tool rail. In the header, this control moved from y=418 to y=208 on a 874 point
             screen and came to rest underneath the rail's buttons: accessibility still
             reported it present and hittable, because nothing about the hierarchy was wrong,
             and a tap went to the rail instead. The panel could be expanded and then not put
             away, which is what prompted someone to ask whether More toggles at all.

             Capping the height was the first attempt and only shrank the overlap to twenty
             points, which is worse than either extreme: it usually works. The bottom edge
             does not move at all, so the control cannot collide with anything above it and
             the finger does not have to chase it between taps.
             */
            HStack {
                Spacer()
                Button(expanded ? "Less" : "More") { expanded.toggle() }
                    .font(.caption2)
                    .accessibilityIdentifier("panel.more")
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(12)
        .background(.black.opacity(0.68), in: RoundedRectangle(cornerRadius: 12))
    }

    /**
     Where the elevation data runs out.

     Said rather than left to be discovered. Below this altitude the screen resolves finer
     than LRO LOLA's 474 m per sample and the ground smooths out, which is the model running
     out and not a flat Moon. The threshold is derived from the manifest's finest level, so it
     tracks whatever data is actually shipped.
     */
    @ViewBuilder
    private var reliefNotice: some View {
        let limit = scene.reliefLimit(fovDegrees: 55, viewportHeightPx: 900)
        if limit.has, let smoothBelow = limit.smoothBelowM {
            Text("Surface relief is real LRO LOLA topography. Below about "
                 + "\(Int(smoothBelow / 1_000).formatted()) km the screen out-resolves the data "
                 + "and the ground smooths out. That is the elevation model running out, not a "
                 + "flat surface.")
                .font(.system(size: 10))
                .foregroundStyle(.cyan.opacity(0.75))
                .padding(.top, 2)
        }
    }

    private var provenance: String {
        switch contract.ephemeris {
        case .fixedAtBarycentre:
            return "Rotation from the IAU WGCCRE report."
        case .standishElements:
            return "Position from the JPL Standish element tables, rotation from the IAU WGCCRE report."
        case .meanElementsAboutParent:
            return "Position from JPL mean elements, good to roughly a degree, not an "
                + "eclipse-grade theory. Rotation from the IAU WGCCRE report."
        }
    }

    private var rotationText: String {
        let hours = abs(contract.siderealRotationDays) * 24
        let base = hours < 48
            ? String(format: "%.2f h", hours)
            : String(format: "%.4f d", abs(contract.siderealRotationDays))
        return contract.siderealRotationDays < 0 ? base + " retrograde" : base
    }

    private func distance(_ metres: Double) -> String {
        if metres < 1_000 { return String(format: "%.0f m", metres) }
        if metres < 1e9 { return "\(Int(metres / 1_000).formatted()) km" }
        return String(format: "%.3f au", metres / Constants.auInMetres)
    }

    private func lightTime(_ metres: Double) -> String {
        let seconds = metres / 299_792_458
        if seconds < 60 { return String(format: "%.1f s", seconds) }
        if seconds < 3_600 { return "\(Int(seconds / 60)) m \(Int(seconds.truncatingRemainder(dividingBy: 60))) s" }
        return "\(Int(seconds / 3_600)) h \(Int(seconds.truncatingRemainder(dividingBy: 3_600) / 60)) m"
    }

    @ViewBuilder
    private func row(
        _ name: String, _ value: String, simulated: Double? = nil, label: String = ""
    ) -> some View {
        GridRow {
            Text(name).font(.caption).foregroundStyle(.secondary)
            VStack(alignment: .leading, spacing: 1) {
                Text(value).font(.caption.monospacedDigit())
                if let simulated {
                    Text(onScreen(simulated, label))
                        .font(.system(size: 10))
                        .foregroundStyle(.secondary)
                }
            }
        }
    }

    private func onScreen(_ simulatedSeconds: Double, _ label: String) -> String {
        guard let real = clock.onScreenSeconds(forSimulated: simulatedSeconds) else {
            return "\(label) is too fast to see at this speed"
        }
        let formatted: String
        switch real {
        case ..<1: formatted = String(format: "%.2f s", real)
        case ..<90: formatted = String(format: "%.1f s", real)
        case ..<5_400: formatted = String(format: "%.1f min", real / 60)
        case ..<172_800: formatted = String(format: "%.1f h", real / 3_600)
        case ..<63_115_200: formatted = String(format: "%.1f days", real / 86_400)
        default: formatted = String(format: "%.1f years", real / 31_557_600)
        }
        return "\(label) every \(formatted) on screen at this speed"
    }
}

/**
 Where to stand relative to the Sun, and how far back.

 The lighting angles exist because the thing worth seeing on a body is usually the line
 between its day and its night, and arriving over the lit face hides it. "Fit moons" exists
 because framing a planet against its own radius crops its moons out entirely: Earth's Moon
 sits 60 Earth radii away, which is why the planet shrinks to a dot the moment the Moon fits
 on screen. That emptiness is the lesson, not a framing problem.
 */
private struct ViewControls: View {
    let focus: BodyId
    let scene: SolarScene
    let clock: Clock

    var body: some View {
        HStack(spacing: 6) {
            Text("VIEW")
                .font(.system(size: 10))
                .foregroundStyle(.secondary)

            if focus != .sun {
                ForEach([("Day", 0.0), ("Terminator", 90.0), ("Night", 180.0)], id: \.0) { item in
                    Button(item.0) { scene.setSunAngle(item.1, at: clock.epoch) }
                        .font(.system(size: 11))
                        .buttonStyle(.bordered)
                        .controlSize(.mini)
                }
            }

            if scene.focusHasMoons {
                Button("Fit moons") { scene.frameMoons() }
                    .font(.system(size: 11))
                    .buttonStyle(.bordered)
                    .controlSize(.mini)
                    .tint(.cyan)
            }
            Spacer()
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
        .background(.black.opacity(0.68), in: RoundedRectangle(cornerRadius: 12))
    }
}

/**
 The gravity switch, with the integration's own health on screen.

 A viewer who cannot tell which mode they are in cannot trust either, so the numbers for all
 three failure modes from `contracts/gravity-modes` are shown rather than hidden: how far the
 integration has run, how much energy it has lost, and how far behind the clock it is.
 */
private struct GravityBar: View {
    @Bindable var gravity: Gravity
    let clock: Clock

    private var mutual: Bool { gravity.mode == .mutual }

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 6) {
                Button("On rails") { gravity.setMode(.analytic, at: clock.epoch) }
                    .buttonStyle(.bordered)
                    .controlSize(.mini)
                    .tint(mutual ? .gray : .orange)
                Button("Mutual gravity") { gravity.setMode(.mutual, at: clock.epoch) }
                    .buttonStyle(.bordered)
                    .controlSize(.mini)
                    .tint(mutual ? .orange : .gray)

                if mutual {
                    Toggle("Moons", isOn: Binding(
                        get: { gravity.includeMoons },
                        set: { gravity.setMode(.mutual, at: clock.epoch, includeMoons: $0) }
                    ))
                    .toggleStyle(.button)
                    .controlSize(.mini)
                    .font(.system(size: 10))
                }
                Spacer()
            }

            if mutual {
                HStack(spacing: 12) {
                    label("Integrated", gravity.integratedDays < 365
                        ? String(format: "%.0f d", gravity.integratedDays)
                        : String(format: "%.1f yr", gravity.integratedDays / 365.25))
                    label("Bodies", "\(gravity.bodyCount)")
                    label("Energy drift", String(format: "%.1e", gravity.energyDrift))
                    if abs(gravity.lagDays) > 1 {
                        label("Behind by", String(format: "%.0f d", abs(gravity.lagDays)))
                            .foregroundStyle(.orange)
                    }
                }
            } else {
                Text("Planets follow the JPL Standish fits. Accurate and reversible, "
                     + "but a mass you add cannot move them.")
                    .font(.system(size: 10))
                    .foregroundStyle(.secondary)
            }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
        .background(.black.opacity(0.68), in: RoundedRectangle(cornerRadius: 12))
    }

    private func label(_ name: String, _ value: String) -> some View {
        HStack(spacing: 4) {
            Text(name).font(.system(size: 10)).foregroundStyle(.secondary)
            Text(value).font(.system(size: 10).monospacedDigit())
        }
    }
}

private struct TimeBar: View {
    @Bindable var clock: Clock

    var body: some View {
        VStack(spacing: 8) {
            Text(clock.formattedEpoch).font(.system(.caption, design: .monospaced))

            HStack(spacing: 8) {
                Button(clock.running ? "Pause" : "Play") { clock.running.toggle() }
                Button("Reverse") { clock.direction *= -1 }
                Button("Now") { clock.resetToNow() }
            }
            .buttonStyle(.bordered)
            .controlSize(.small)

            HStack {
                Slider(
                    value: Binding(
                        get: { Double(clock.rateIndex) },
                        set: { clock.rateIndex = Int($0.rounded()) }
                    ),
                    in: 0 ... Double(Clock.presets.count - 1),
                    step: 1
                )
                .accessibilityIdentifier("time.rate")
                Text(clock.direction < 0 ? "\(clock.rate.label), reversed" : clock.rate.label)
                    .font(.caption2.monospacedDigit())
                    .frame(width: 112, alignment: .trailing)
                    .accessibilityIdentifier("time.rateLabel")
            }
        }
        .padding(12)
        .background(.black.opacity(0.68), in: RoundedRectangle(cornerRadius: 12))
    }
}
