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

    var body: some View {
        /**
         Read on purpose, and the whole subscription.

         This used to take the epoch as a parameter, which meant whoever built this view read
         the clock in their own body and was themselves rebuilt sixty times a second. That was
         `ContentView`, so the entire overlay went with it and a drag on the rate slider took
         two seconds to land. Reading the scene's own counter here subscribes this layer, and
         only this layer, to every frame.
         */
        let _ = scene.frameCounter

        GeometryReader { geometry in
            let size = geometry.size
            let placements = placeLabels(
                scene.labelInputs(aspect: Double(size.width / max(size.height, 1))),
                options: LabelOptions(
                    viewportWidthPx: Double(size.width),
                    viewportHeightPx: Double(size.height)
                )
            )
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
        return HStack(spacing: 3) {
            if placement.clamped, let bearing, !arrowTrails { arrow(bearing) }
            Text(contract.displayName)
                .font(.system(size: isFocus ? 12 : 10, weight: isFocus ? .semibold : .regular))
            if placement.clamped, let bearing, arrowTrails { arrow(bearing) }
        }
        .foregroundStyle(isFocus ? .white : .white.opacity(0.72))
        .padding(.horizontal, 5)
        .padding(.vertical, 2)
        // A plate behind the text, because white on a starfield is legible everywhere except
        // over a lit planet, which is exactly where the focused body's own label sits.
        .background(.black.opacity(placement.clamped ? 0.55 : 0.35), in: Capsule())
        .fixedSize()
    }
}
