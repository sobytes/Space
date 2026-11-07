import SwiftUI
import SolarKit

/**
 Names over the scene, including for things that are not on screen.

 Drawn in SwiftUI rather than as geometry in SceneKit. Text as a billboarded texture has to be
 rasterised per body and rescaled every frame to stay a constant size, and it still cannot
 reach a body that is outside the frustum, which is the case this feature exists for: focused
 on Earth, the Moon is sixty radii away and simply not in frame. A view layer can draw a
 pointer at the edge instead, and gets crisp text for free.

 Placement comes from SolarKit's `placeLabels`, shared with the website and gated by the
 conformance suite, so the two clients clamp and thin labels identically.
 */
struct LabelLayer: View {
    let scene: SolarScene

    /// The size of this layer, reported by the measuring `GeometryReader` below.
    @State private var viewport: CGSize = .zero

    var body: some View {
        /**
         Placement is computed here, in `body`, and the viewport size comes from state.

         It used to be computed inside a `GeometryReader`'s closure, with the frame counter
         read out here to subscribe to it, and that arrangement silently stopped working. A
         `GeometryReader` re-runs its content when its geometry changes or when something the
         content itself reads changes. The content called `scene.labelInputs(...)`, which is a
         method, and `placeLabels`, which is pure: neither touches an observable property, so
         the closure had no dependency on the frame counter this body was carefully subscribing
         to. It was evaluated once, at the first layout, and never again.

         What that looked like was every label frozen where it had been at launch while the
         planets went round, which at real time is a fraction of a pixel and at a year a second
         is the whole sky. The names drifted away from the bodies and stayed there. Reported as
         the labels being independent of the planets, and the times under them kept ticking the
         whole while, because each `Text` reads `scene.localTimes` and had its own subscription.

         Both halves now live in `body`, which does read the counter, so the positions and the
         times are refreshed by the same thing. `mobile/ios/App/UITests/InteractionTests.swift`
         gates it by reading where the labels actually landed with the clock running, which is
         the only arrangement that can see this.
         */
        let _ = scene.frameCounter
        let placements = viewport.width > 1 && viewport.height > 1
            ? placeLabels(
                scene.labelInputs(aspect: Double(viewport.width / viewport.height)),
                options: LabelOptions(
                    viewportWidthPx: Double(viewport.width),
                    viewportHeightPx: Double(viewport.height)
                )
            )
            : []

        ZStack(alignment: .topLeading) {
            // Measures the layer, and nothing else. Reporting the size into state keeps the
            // placement itself in `body`, where the per-frame subscription lives.
            GeometryReader { geometry in
                Color.clear
                    .onAppear { viewport = geometry.size }
                    .onChange(of: geometry.size) { _, size in viewport = size }
            }
            ForEach(placements) { placement in
                label(for: placement)
                    .position(x: placement.x, y: placement.y)
            }
        }
        // The scene underneath owns every gesture. Labels are something to read, and a label
        // that swallowed a drag would break the camera wherever one happened to be.
        .allowsHitTesting(false)
    }

    /// Points at the body, not at the label. The bearing is screen space with y downwards,
    /// which is the direction SwiftUI rotates in too, so it needs no sign flip.
    private func arrow(_ bearing: Double) -> some View {
        Image(systemName: "arrowtriangle.right.fill")
            .font(.system(size: 7))
            .rotationEffect(.radians(bearing))
    }

    private func label(for placement: LabelPlacement) -> some View {
        let contract = bodyContracts[placement.id]!
        let isFocus = placement.id == scene.focus
        /**
         The arrow goes on the side the body is on.

         Always placing it before the text put a pointer on the left of "Deimos" while Deimos
         was off to the upper right, so the glyph aimed correctly and sat on the wrong side of
         the word, which reads as pointing at the text. Bearings within a right angle of
         horizontal-right put it after.
         */
        let bearing = placement.bearingRadians
        let arrowTrails = bearing.map { abs($0) < .pi / 2 } ?? false
        return VStack(spacing: 0) {
            HStack(spacing: 3) {
                if placement.clamped, let bearing, !arrowTrails { arrow(bearing) }
                Text(contract.displayName)
                    .font(.system(size: isFocus ? 12 : 10, weight: isFocus ? .semibold : .regular))
                    .foregroundStyle(isFocus ? .white : .white.opacity(0.72))
                if placement.clamped, let bearing, arrowTrails { arrow(bearing) }
            }
            /**
             The day and the orbit, under the name.

             The panel was the wrong place for this. It is the first thing anyone hides to
             look at the planets, and with it hidden there was no time anywhere on screen,
             which is what was reported. Here the labels sit side by side, so Earth's year and
             the Moon's month can be compared rather than remembered.

             On clamped labels too, which was not the first instinct. An edge pointer is
             exactly where the Moon's label usually ends up while framed with Earth, so
             suppressing it there removed the one comparison most worth having. The clamp
             keeps labels 44 points inside the viewport, which is room enough for a second
             line.
             */
            /**
             Whether this label carries a clock is `placeLabels`' decision, not this view's.

             It was this view's, twice, and both rules were wrong because they were guesses
             about crowding made without knowing where anything had landed: first "the focus
             and its satellites", which in the system view is the Sun and all eight planets,
             then a rank rule that silenced the comparison it existed for. The module that
             places the plates is the only thing that knows whether there is room for a
             second line.
             */
            /**
             The date and time where that body is, now, ticking with the clock.

             This showed how long a day and a year last there, which is a fact about the body
             rather than a clock, and was asked to be the reading instead: "i expect it to say
             year 2026 and month etc and increase by the time setting". Earth gets the
             calendar because Earth has one; everywhere else gets a count of its own days and
             the time at its prime meridian, which is what Mars missions actually run on.

             Read from the scene's cache rather than computed here, because this view redraws
             every frame and each of these is an ephemeris evaluation.

             Drawn only where `placeLabels` found room for it. A date is three times the width
             of a name, and five of them will not fit across the inner solar system at any
             arrangement; the previous answer was to drop whole labels until they did, which
             left Mercury, Venus, Earth and Mars unnamed in the system view with edge pointers
             to off-screen giants as the only labels on the screen. Reported as the labels
             being nowhere near the planets, which is what it looked like.
             */
            if placement.detail, let local = scene.localTimes[placement.id] {
                Text(local)
                    .font(.system(size: 9).monospacedDigit())
                    .foregroundStyle(.white.opacity(0.5))
            }
        }
        .foregroundStyle(isFocus ? .white : .white.opacity(0.72))
        .padding(.horizontal, 5)
        .padding(.vertical, 2)
        // A plate behind the text, because white on a starfield is legible everywhere except
        // over a lit planet, which is exactly where the focused body's own label sits.
        .background(
            .black.opacity(placement.clamped ? 0.55 : 0.35),
            in: RoundedRectangle(cornerRadius: 8)
        )
        .fixedSize()
    }
}
