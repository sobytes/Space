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
    /// Parses `-at`. Gregorian and UTC explicitly, because the probe passes a year a
    /// thousand out and a device calendar is nobody's idea of a stable test input.
    private static let isoDay: DateFormatter = {
        let formatter = DateFormatter()
        formatter.dateFormat = "yyyy-MM-dd"
        formatter.timeZone = TimeZone(identifier: "UTC")
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.calendar = Calendar(identifier: .gregorian)
        return formatter
    }()

    @State private var lastTick = Date()
    @State private var lastDrag: CGSize = .zero
    @State private var lastMagnification: CGFloat = 1
    /// `-dumpScene` logs the scene's geometry once, a few seconds in, for the probes.
    @State private var dumpAt: Date? = CommandLine.arguments.contains("-dumpScene")
        ? Date().addingTimeInterval(8)
        : nil
    /**
     Compact when the window is short, which on a phone means landscape.

     Read rather than measured: the only question here is whether there is room to stack
     things down the side, and that is exactly what the size class answers.
     */
    @Environment(\.verticalSizeClass) private var verticalSize

    /// Everything about the focused body, on its own screen. See `BodyDetails`.
    @State private var showingDetails = false
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
    /// `-showDeepTime` opens the panel at launch, for a screenshot probe. Test hook.
    @State private var showingDeepTime = CommandLine.arguments.contains("-showDeepTime")
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
            || showingDeepTime || showingDetails
    }
    @State private var overlayHidden = CommandLine.arguments.contains("-startHidden")

    /**
     One control in the tool rail.

     A list rather than eight buttons written out twice, because the rail is drawn two ways
     and the previous arrangement is exactly how it came to be inconsistent: buttons were
     added over time, three picked up labels when somebody could not find them, and nothing
     held the set together.
     */
    private struct RailItem: Identifiable {
        let id: String
        let title: String
        let icon: String
        let tint: Color
        let action: () -> Void
    }

    private var railItems: [RailItem] {
        var items: [RailItem] = [
            // Always present. An overlay with no way back is a trap rather than a
            // decluttered view, so the one control that returns it never goes away.
            RailItem(
                id: "tool.hide",
                title: overlayHidden ? "Show panels" : "Hide panels",
                icon: overlayHidden ? "eye" : "eye.slash",
                tint: overlayHidden ? .orange : .secondary
            ) { withAnimation(.easeInOut(duration: 0.2)) { overlayHidden.toggle() } }
        ]
        guard !overlayHidden else { return items }
        items += [
            /**
             Back out to the whole solar system.

             Focusing the Sun has always been the system view and nothing said so: someone
             asked how to unfocus a planet, which is the only evidence that matters. "The
             Sun" stays in the picker because it is also a body with its own data.
             */
            RailItem(
                id: "tool.systemView", title: "Solar system", icon: "circle.hexagongrid",
                tint: focus == .sun ? .orange : .secondary
            ) { focus = .sun },
            RailItem(
                id: "tool.demonstrations", title: "Demonstrations", icon: "function",
                tint: .secondary
            ) { showingDemonstrations = true },
            RailItem(id: "tool.ask", title: "Ask", icon: "sparkles", tint: .secondary) {
                showingAsk = true
            },
            RailItem(
                id: "tool.labels", title: "Labels", icon: showLabels ? "tag.fill" : "tag",
                tint: showLabels ? .orange : .secondary
            ) { withAnimation(.easeInOut(duration: 0.15)) { showLabels.toggle() } },
            RailItem(
                id: "tool.surface", title: "Surface", icon: "camera.viewfinder", tint: .cyan
            ) { showingSurface = true },
            RailItem(
                id: "tool.habitability", title: "Habitability", icon: "leaf", tint: .green
            ) { showingHabitability = true },
            RailItem(id: "tool.deepTime", title: "Deep time", icon: "hourglass", tint: .orange) {
                showingDeepTime = true
            }
        ]
        return items
    }

    /**
     A rail button, named or not depending on the room there is for it.

     The name is attached either way. Dropping a label in landscape must not drop it for
     VoiceOver too, where "button" and nothing else is the worst of both arrangements.
     */
    private func railButton(_ item: RailItem, showsTitle: Bool) -> some View {
        Button(action: item.action) {
            if showsTitle {
                Label(item.title, systemImage: item.icon)
                    .font(.system(size: 11))
                    .lineLimit(1)
                    // Shrink rather than truncate if the type size grows: a rail of names
                    // where one reads "Demonstrati..." is worse than one a point smaller.
                    .minimumScaleFactor(0.7)
                    /**
                     One width for all of them, so the rail has a straight edge.

                     Set here rather than left to each button's own text, which is what made
                     the rail ragged: three names and five icons produced eight different
                     widths trailing down the right-hand side. A `Grid` sizing its column to
                     the widest cell is the tidier answer and could not be used, because a
                     cell asking for infinite width makes the whole grid greedy and it took
                     the full screen, dragging the rail away from the edge it is aligned to.
                     The number is the longest name, "Demonstrations", and no more: the rail
                     is over the planet, and every point of it is a point of the thing the
                     app is for. At 140 it took a third of the width of a phone.
                     */
                    .frame(width: 112, alignment: .leading)
            } else {
                Image(systemName: item.icon)
            }
        }
        .tint(item.tint)
        .accessibilityLabel(item.title)
        .accessibilityIdentifier(item.id)
    }

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
            // Deep time is excluded from the suspension below: it is a half-height sheet
            // whose whole point is the scene above it, and the labels are how you tell which
            // planet has just been swallowed.
            if showLabels && (!anySheetPresented || showingDeepTime) {
                LabelLayer(scene: scene)
                    .ignoresSafeArea()
            }

            if !overlayHidden {
                /**
                 Controls over the scene, and nothing that reads.

                 This carried the whole body panel for a long time: the facts, a paragraph,
                 the lighting angles, the gravity switch and the clock, five rows deep across
                 the planet they described. Reported as cluttered three times, the last with
                 the design: strip it back to the buttons that change the view, plus one that
                 opens everything else on its own screen.

                 So what is left here is what acts on the scene. Anything that is read rather
                 than pressed is in `BodyDetails`, behind More info.
                 */
                VStack(spacing: 8) {
                    ViewControls(focus: focus, scene: scene, clock: clock) {
                        showingDetails = true
                    }
                    TimeBar(clock: clock)
                }
                .padding(.horizontal, 12)
                .padding(.bottom, 10)
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
             A column when there is height for one, a row when there is not.

             Eight buttons stacked down the right edge reach about 280 points, which is most
             of the 402 a phone has in landscape: the rail ran from under the picker almost to
             the clock, so the controls at the bottom right ended up beneath it. Measured by
             the overlap gate rather than noticed, which reported `panel.open over
             tool.surface by 26x11`. It was also sitting on top of the scene's own labels,
             which is the clutter half of the same fact.

             One list of buttons for both, so there is no way for the two to drift.
             */
            if verticalSize == .compact {
                /**
                 Icons only, and all of them.

                 Eight names side by side come to about 900 points against the 874 a phone
                 has sideways. Since they cannot all be named here, none is: a row where
                 some have words and some do not is the thing that was asked about, and the
                 answer has to hold in both orientations. Every one keeps its name for
                 VoiceOver, and the column in portrait is where they are learned.
                 */
                HStack(spacing: 6) {
                    ForEach(railItems) { item in railButton(item, showsTitle: false) }
                }
                .buttonStyle(.bordered)
                .controlSize(.small)
                .padding(.trailing, 10)
                .padding(.top, overlayHidden ? 8 : 54)
            } else {
                /**
                 Named, equal width, flush left edge.

                 Asked directly: why do some of these have labels and some do not. There was
                 no reason. Three were given words one at a time, each after somebody could
                 not find a control, and the other five never were, so the rail ended up with
                 three wide buttons and five narrow ones trailing a ragged edge down the
                 right. A `Grid` of one column sizes every cell to the widest, which is what
                 makes the edge straight rather than a width guessed and kept in step by hand.
                 */
                VStack(alignment: .leading, spacing: 6) {
                    ForEach(railItems) { item in railButton(item, showsTitle: true) }
                }
                .buttonStyle(.bordered)
                .controlSize(.small)
                .padding(.trailing, 10)
                .padding(.top, overlayHidden ? 8 : 54)
            }
        }
        .sheet(isPresented: $showingDetails) {
            BodyDetails(id: focus, clock: clock, scene: scene, gravity: gravity)
        }
        .sheet(isPresented: $showingDemonstrations) { DemonstrationsView() }
        .sheet(isPresented: $showingAsk) { AskView() }
        // `focus`, not `clock`: the assessment is a pure function of the body and does
        // not move with time, so the sheet is rebuilt only when the focus changes.
        .sheet(isPresented: $showingHabitability) { HabitabilityView(body_: focus) }
        .sheet(isPresented: $showingSurface) { SurfacePhotographsView(body_: focus) }
        // No body argument: this panel is about the Sun and everything orbiting it.
        .sheet(isPresented: $showingDeepTime) {
            DeepTimeView(scene: scene)
                /**
                 Two fifths, not a half.

                 The system view puts the Sun at the centre of the screen and a medium sheet's
                 top edge lands almost exactly there, so the one thing this panel changes was
                 behind it. Two fifths leaves the Sun and the inner orbits in view, which is
                 the whole reason the sheet is not full height.
                 */
                .presentationDetents([.fraction(0.4), .large])
                .presentationBackgroundInteraction(.enabled(upThrough: .fraction(0.4)))
        }
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
        .task {
            /**
             `-rate <index>` starts the clock at a chosen speed preset, so a probe can observe
             the scene with time running fast. Labels detaching from their bodies was reported
             from a screenshot whose clock had run months ahead, and no gate here had ever
             looked at the scene at anything but real time. Test hook.
             */
            /**
             `-paused` stops the clock at launch, which is what makes an overlay probe mean
             anything.

             The scene dump is written three seconds before the screenshot is taken, so at any
             rate above real time the two describe different frames. An overlay built from
             them showed label boxes sitting away from their text and was read, twice, as the
             app placing labels wrongly. It was the instrument. Paused, the dump and the
             picture are the same instant and a disagreement between them is real.
             */
            if CommandLine.arguments.contains("-paused") { clock.running = false }

            /**
             `-at <YYYY-MM-DD>` opens the clock on a chosen date.

             Every probe this app has ever had looked at the scene at today's date, which is
             one instant out of the ten thousand years the ephemeris covers and is the one
             instant the element tables are most comfortable with. A defect that only appears
             a thousand years out is invisible to all of them. Test hook, not a feature: the
             app already has "Go to date" for a person.
             */
            if let i = CommandLine.arguments.firstIndex(of: "-at"),
               i + 1 < CommandLine.arguments.count,
               let parsed = Self.isoDay.date(from: CommandLine.arguments[i + 1]) {
                clock.setEpoch(epochFromUnixTimestamp(parsed.timeIntervalSince1970))
            }

            guard let i = CommandLine.arguments.firstIndex(of: "-rate"),
                  i + 1 < CommandLine.arguments.count,
                  let index = Int(CommandLine.arguments[i + 1]) else { return }
            clock.rateIndex = max(0, min(Clock.presets.count - 1, index))
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
            scene.viewportWidthPx = Double(UIScreen.main.bounds.width)
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
        .accessibilityIdentifier("bodyPicker")
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
        // No scroll view and no ceiling of its own: this is inside the body's own screen,
        // which scrolls, and a scroll view inside a scroll view fights every drag.
        content
    }

    private var content: some View {
        VStack(alignment: .leading, spacing: 5) {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Text(contract.displayName).font(.subheadline.weight(.semibold))
                    .accessibilityIdentifier("panel.title")
                // On the title's own line: it is one sentence and it was costing a whole row
                // of its own above a panel that is mostly rows.
                Text(contract.education.oneLine)
                    .font(.system(size: 11))
                    .foregroundStyle(.orange.opacity(0.9))
                    .fixedSize(horizontal: false, vertical: true)
            }

            /**
             Three rows collapsed. The panel used to show everything always and covered most
             of the planet, which is a poor trade in an app whose whole point is looking at
             the planet. The rest is one tap away and scrolls, so it can never grow past half
             the screen however much a contract has to say.
             */
            Grid(alignment: .leading, horizontalSpacing: 12, verticalSpacing: 2) {
                row("From the Sun", distance(fromSun),
                    simulated: orbitDays.map { $0 * Constants.secondsPerDay }, label: "one orbit",
                    // Only a planet's orbit carries marks, so only a planet's panel says so.
                    marksForPeriodDays: isPlanet ? orbitDays : nil)
                row("Equatorial radius", "\(Int(contract.equatorialRadiusM / 1_000).formatted()) km")
                row("Rotation", rotationText,
                    simulated: abs(contract.siderealRotationDays) * Constants.secondsPerDay,
                    label: "one turn")
                // Nil on the Sun, which has no sub-solar point and so no clock.
                if let sunClock { row("Clock there", sunClock.formatted, note: clockNote(sunClock)) }
                row("A day here", dayText)
                row("A year here", yearText)
                if let monthText { row("A month here", monthText) }
            }

            /**
             The one paragraph a child would actually read, and the reason this exists.

             Asked for after the orbit marks turned out to answer a different question: not
             "where will it be in nine days" but how a spin, a month and a year relate to each
             other and to ours. Every number in it is computed, none is written into the
             sentence, and the wording is shared with the website and gated as an exact string.
             */
            Text(timeHeadline(id))
                .font(.system(size: 11))
                .foregroundStyle(.white.opacity(0.75))
                .fixedSize(horizontal: false, vertical: true)
                .padding(6)
                .background(Color.cyan.opacity(0.08), in: RoundedRectangle(cornerRadius: 7))

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
                // No cap of its own any more: the whole panel scrolls inside the ceiling
                // the window gives it, and a second scroll view inside the first one
                // fought the outer gesture for every drag.
                
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

    private var isPlanet: Bool {
        if case .standishElements = contract.ephemeris { return true }
        return false
    }

    private var time: TimeSense { timeSense(id) }

    /**
     The body's own Greenwich clock.

     There is no universal civil time and there cannot be one, but the construction behind GMT
     generalises: the IAU fixes a prime meridian for every body here, so the Sun's hour angle
     from it is a real local time. Read from the throttled epoch like everything else on this
     panel; a sundial does not need sixty readings a second.
     */
    private var sunClock: SolarClock? { solarClock(id, at: clock.displayEpoch) }

    private func clockNote(_ sunClock: SolarClock) -> String {
        let ratio = sunClock.hourInEarthSeconds / 3600
        return "sundial time at its prime meridian, day \(sunClock.dayNumber.formatted()) since "
            + String(format: "J2000. One of its hours is %.3f of ours.", ratio)
    }

    private var dayText: String {
        let base = formatDuration(days: time.dayInEarthDays) + ", sunrise to sunrise"
        return time.spinsBackwards ? base + ", Sun rises in the west" : base
    }

    private var yearText: String {
        let days = time.solarDaysPerYear
        // Two decimals right up to a thousand, because the fraction is the point: the Moon
        // fits 12.37 of its days into a year, not 12, and Venus 1.92 rather than 2.
        let count = days < 1000
            ? String(format: "%.2f", days)
            : Int(days.rounded()).formatted()
        return formatDuration(days: time.yearDays) + " = \(count) of its own days"
    }

    private var monthText: String? {
        guard let month = time.monthDays, let synodic = time.synodicMonthDays,
              let parent = contract.parent else { return nil }
        return String(format: "%.2f days round ", month) + bodyContracts[parent]!.displayName
            + String(format: " \u{00b7} %.2f full phase to full phase", synodic)
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
        _ name: String, _ value: String, simulated: Double? = nil, label: String = "",
        marksForPeriodDays: Double? = nil, note: String? = nil
    ) -> some View {
        GridRow {
            Text(name).font(.caption).foregroundStyle(.secondary)
            VStack(alignment: .leading, spacing: 1) {
                Text(value).font(.caption.monospacedDigit())
                if let note {
                    Text(note)
                        .font(.system(size: 10))
                        .foregroundStyle(.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
                if let simulated {
                    Text(onScreen(simulated, label))
                        .font(.system(size: 10))
                        .foregroundStyle(.secondary)
                }
                /**
                 What the dots on this body's orbit are worth.

                 Without this they are decoration: a mark only means something once you can
                 say how far apart in time two of them are.
                 */
                if let marksForPeriodDays {
                    let interval = markIntervalFor(periodDays: marksForPeriodDays)
                    Text("marked every \(interval.label) in the system view, crowding where it moves fastest")
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
    /// Opens the body's own screen. See `BodyDetails`.
    let open: () -> Void

    /**
     Nothing to offer on the Sun, which has no terminator to stand at and no moons to fit.

     The bar drew itself anyway, so the system view carried a labelled strip containing one
     word and a stretch of empty plate. A heading with nothing under it is the clearest case
     of clutter there is: it costs a row, and a reader has to look at it to find out it is
     empty.
     */
    var body: some View {
        HStack(spacing: 6) {
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
            /**
             Beside the view buttons, not pushed to the far edge.

             A trailing `Spacer` reads fine on a narrow phone and falls apart on a wide one:
             in landscape it left the four view buttons at one side of the window and More
             info five hundred points away at the other, so they stopped looking like one row
             of controls. Grouped left, the row is the same shape at any width.
             */
            /**
             The way to everything that is read rather than pressed.

             Named rather than an icon, and placed with the controls rather than in the tool
             rail, because it is the answer to a question someone is already asking about the
             body they just tapped. The rail is where the modes live; this is where the body
             lives.
             */
            Button {
                open()
            } label: {
                HStack(spacing: 3) {
                    Text("More info")
                    Image(systemName: "chevron.right").font(.system(size: 9, weight: .semibold))
                }
                .font(.system(size: 11, weight: .medium))
                // Never wrapped. Squeezed between four view buttons on a narrow phone it
                // broke across two lines and made the whole row twice as tall as the clock
                // under it, which is the opposite of the point.
                .fixedSize()
            }
            .buttonStyle(.bordered)
            .controlSize(.mini)
            .tint(.orange)
            /**
             Named for the body it opens, not just "More info".

             Correct for VoiceOver, where a button called "More info" on a screen of other
             controls says nothing about what it will show. It is also how a test can tell
             which body has focus now that the panel bearing that name is a screen away:
             focus used to be observable through the panel's title, and moving the panel took
             the observation with it.
             */
            .accessibilityLabel("More info about \(bodyContracts[focus]?.displayName ?? "")")
            .accessibilityIdentifier("panel.open")
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 6)
        .background(.black.opacity(0.72), in: RoundedRectangle(cornerRadius: 12))
    }
}

/**
 Everything about the focused body, on its own screen.

 Three things used to sit over the scene and now live here: the facts and the paragraph from
 the body panel, and the gravity mode. They are together because they are all answers to "tell
 me more about this", and away from the scene because none of them is needed while simply
 looking at it. The lighting angles stayed behind, because those act on the view.

 A sheet rather than a push, so the planet is still there behind it and a swipe down is the way
 out. It opens at half height for the same reason: the paragraph about a body's day and year is
 worth reading against the body it describes.
 */
private struct BodyDetails: View {
    let id: BodyId
    let clock: Clock
    let scene: SolarScene
    let gravity: Gravity

    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    BodyPanel(id: id, clock: clock, scene: scene)
                    GravityBar(gravity: gravity, clock: clock)
                }
                .padding(14)
            }
            .navigationTitle(bodyContracts[id]?.displayName ?? "")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { dismiss() }
                        .accessibilityIdentifier("details.done")
                }
            }
        }
        .presentationDetents([.medium, .large])
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
                // The two buttons give no hint that one of them cannot be perturbed by a
                // mass you add, which is the whole reason the other exists.
                Text("On rails: JPL Standish fits, reversible, but an added mass moves nothing.")
                    .font(.system(size: 10))
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 6)
        .background(.black.opacity(0.72), in: RoundedRectangle(cornerRadius: 12))
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
    @State private var showingGoTo = false

    var body: some View {
        VStack(spacing: 8) {
            Text(clock.formattedEpoch).font(.system(.caption, design: .monospaced))

            /**
             How much to trust what is on screen, said where the planets are.

             Positions come from element tables fitted for 3000 BC to 3000 AD. The clock used
             to stop at that edge; it now runs on, and the honesty has to come from saying so
             instead. At a hundred years a second the edge is about ten seconds away.

             The wording is the engine's own, not a second copy written here. `ephemerisStanding`
             already explains which table is answering and what that costs, it is already gated
             by the conformance suite, and prose duplicated across two clients is how they come
             to disagree. The accuracy panel says the same thing, and the panel is the first
             thing anyone hides to look at the planets, which is why this line exists.
             */
            let standing = ephemerisStandingAt(clock.displayEpoch)
            if !standing.inside {
                /**
                 And where to go for the timescales this clock cannot reach.

                 Asked directly, on seeing the clock run past the tables: "what will happen if
                 it runs for ages, should the sun swallow the other planets". It will not, and
                 that is worth saying plainly. At a hundred years a second the end of the Sun's
                 main sequence is 1.7 years of real running away and the red giant tip 2.4, and
                 this clock does not model the Sun's life in any case.

                 Deep time does, and it is a different model rather than a faster clock: out
                 there the element tables mean nothing and the orbits come from the Sun's mass
                 loss instead. Two models, because one would be a lie at one end or the other.
                 */
                Text(standing.note + " The Sun's own life is in Deep time, which models those "
                     + "orbits from its mass loss rather than from these tables.")
                    .font(.system(size: 10))
                    .foregroundStyle(.orange)
                    .multilineTextAlignment(.center)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.horizontal, 24)
                    .accessibilityIdentifier("time.atEdge")
            }

            HStack(spacing: 8) {
                Button(clock.running ? "Pause" : "Play") { clock.running.toggle() }
                Button("Reverse") { clock.direction *= -1 }
                Button("Now") { clock.resetToNow() }
                Button("Go to date") { showingGoTo = true }
                    .accessibilityIdentifier("time.goTo")
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
        .sheet(isPresented: $showingGoTo) { GoToDateView(clock: clock) }
    }
}

/**
 Go to a date, by calendar or by Unix timestamp.

 Asked for as "can we work out time from a specific date like a unix timestamp". The whole
 simulation is a pure function of one epoch, so this only has to produce that epoch; SolarKit's
 `when` does the conversion and says which fitted table answers for it.

 Both ways in, because they are the two ways people hold a moment. A calendar is how someone
 thinks about a birthday or an eclipse; a raw timestamp is how a log file holds the same
 instant. The resolved date is shown back either way, which is also what makes the seconds
 against milliseconds guess safe to make.

 Handed the `Clock` rather than its epoch. A sheet given a value that changes sixty times a
 second is rebuilt under the finger and discards every tap, which is the failure this app has
 now had three times.
 */
private struct GoToDateView: View {
    let clock: Clock
    @Environment(\.dismiss) private var dismiss

    @State private var date = Date()
    @State private var stamp = ""
    /// Which field the Go button should believe. Typing in one wins until the other is used.
    @State private var usingStamp = false

    private var parsed: JdTdb? {
        if usingStamp {
            let trimmed = stamp.trimmingCharacters(in: .whitespaces)
            guard let value = Double(trimmed) else { return nil }
            return epochFromUnixTimestamp(value)
        }
        return epochFromUnixTimestamp(date.timeIntervalSince1970)
    }

    var body: some View {
        NavigationStack {
            Form {
                Section("Date and time, UTC") {
                    DatePicker(
                        "Go to", selection: $date,
                        displayedComponents: [.date, .hourAndMinute]
                    )
                    .environment(\.timeZone, TimeZone(identifier: "UTC")!)
                    .onChange(of: date) { _, _ in usingStamp = false }
                }

                Section("or a Unix timestamp") {
                    TextField("seconds, or milliseconds", text: $stamp)
                        .keyboardType(.numbersAndPunctuation)
                        .font(.system(.body, design: .monospaced))
                        .onChange(of: stamp) { _, _ in usingStamp = true }
                        .accessibilityIdentifier("goTo.stamp")
                }

                Section {
                    if let parsed {
                        Text(Self.formatted(parsed))
                            .font(.system(.footnote, design: .monospaced))
                        let standing = ephemerisStandingAt(parsed)
                        Text(standing.note)
                            .font(.caption2)
                            .foregroundStyle(standing.inside ? .secondary : Color.orange)
                    } else {
                        Text("Not a date this can read.")
                            .font(.caption)
                            .foregroundStyle(.orange)
                    }
                }
            }
            .navigationTitle("Go to date")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Go") {
                        if let parsed { clock.setEpoch(parsed) }
                        dismiss()
                    }
                    .disabled(parsed == nil)
                }
            }
            .onAppear {
                // Seeded from the clock, so it starts where you already are.
                date = Date(timeIntervalSince1970: unixSecondsFromEpoch(clock.epoch))
                stamp = String(Int(unixSecondsFromEpoch(clock.epoch).rounded()))
                usingStamp = false
            }
        }
    }

    private static func formatted(_ epoch: JdTdb) -> String {
        let ms = unixMillisecondsFromJdUtc(utcFromTdb(epoch))
        let formatter = DateFormatter()
        formatter.dateFormat = "yyyy-MM-dd HH:mm:ss"
        formatter.timeZone = TimeZone(identifier: "UTC")
        formatter.locale = Locale(identifier: "en_US_POSIX")
        return formatter.string(from: Date(timeIntervalSince1970: ms / 1_000)) + " UTC"
    }
}
