import SwiftUI
import SolarKit

/**
 Standing on another world, with real photographs.

 Every image is a specific NASA asset, curated rather than searched for, and re-checked by
 `scripts/verify-imagery.mjs`, which rejects anything whose own description calls it a
 concept, an illustration or a perspective view. Nothing here is generated.

 Panoramas are shown at their natural height and scrolled sideways rather than squeezed to
 fit. A 360-degree view of Jezero Crater letterboxed into a phone-width box is a stripe.
 */
struct SurfacePhotographsView: View {
    @Environment(\.dismiss) private var dismiss
    let body_: BodyId
    @State private var index = 0

    private var view: SolarKit.SurfaceView { surfaceViewFor(body_) }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    if view.images.isEmpty {
                        Text(view.statement)
                            .font(.system(size: 13))
                            .foregroundStyle(.primary.opacity(0.85))
                    } else {
                        photograph(view.images[min(index, view.images.count - 1)])
                    }
                    // Linking is not copying. Venus is the only case: the images exist and
                    // NASA's own archive says they are not necessarily public domain.
                    if let label = view.seeAlsoLabel,
                       let urlText = view.seeAlsoUrl,
                       let url = URL(string: urlText) {
                        Link(destination: url) {
                            HStack(spacing: 4) {
                                Text(label)
                                Image(systemName: "arrow.up.right.square")
                            }
                            .font(.system(size: 12))
                        }
                        .buttonStyle(.bordered)
                        .tint(.cyan)
                    }
                    if let caveat = view.caveat {
                        Text(caveat)
                            .font(.system(size: 11))
                            .foregroundStyle(.secondary)
                            .padding(12)
                            .background(.white.opacity(0.04), in: RoundedRectangle(cornerRadius: 12))
                    }
                }
                .padding(16)
            }
            .navigationTitle(view.displayName)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .topBarTrailing) { Button("Done") { dismiss() } } }
        }
    }

    @ViewBuilder
    private func photograph(_ image: SurfaceImage) -> some View {
        // Horizontal scroll at a fixed height, so a panorama stays a panorama.
        ScrollView(.horizontal, showsIndicators: true) {
            AsyncImage(url: URL(string: image.url)) { phase in
                switch phase {
                case let .success(loaded):
                    loaded.resizable().aspectRatio(contentMode: .fit).frame(height: 260)
                case .failure:
                    // Said out loud. A blank box reads as a broken app rather than as a
                    // network that is not available.
                    Text("Could not reach NASA's image library.")
                        .font(.system(size: 11))
                        .foregroundStyle(.secondary)
                        .frame(height: 260)
                default:
                    ProgressView().frame(width: 320, height: 260)
                }
            }
        }
        .background(.black)
        .clipShape(RoundedRectangle(cornerRadius: 12))

        if view.images.count > 1 {
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 6) {
                    ForEach(Array(view.images.enumerated()), id: \.element.nasaId) { i, candidate in
                        Button(candidate.mission) { index = i }
                            .font(.system(size: 11))
                            .buttonStyle(.bordered)
                            .controlSize(.mini)
                            .tint(i == index ? .orange : .secondary)
                    }
                }
            }
        }

        VStack(alignment: .leading, spacing: 8) {
            Text(image.title).font(.system(size: 14, weight: .medium))
            Text(image.whatYouAreSeeing).font(.system(size: 12)).foregroundStyle(.primary.opacity(0.8))
            ForEach([
                ("MISSION", image.mission), ("INSTRUMENT", image.instrument),
                ("TAKEN", image.captured), ("NASA ID", image.nasaId),
            ], id: \.0) { label, value in
                VStack(alignment: .leading, spacing: 1) {
                    Text(label).font(.system(size: 9)).foregroundStyle(.tertiary)
                    Text(value).font(.system(size: 11, design: .monospaced))
                }
                .padding(.leading, 8)
                .overlay(alignment: .leading) { Rectangle().fill(.white.opacity(0.12)).frame(width: 1) }
            }
            Text(image.credit).font(.system(size: 9)).foregroundStyle(.tertiary)
        }
    }
}
