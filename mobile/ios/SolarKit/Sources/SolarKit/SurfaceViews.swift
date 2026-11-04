import Foundation

/**
 Standing on another world, with real photographs.

 The content is generated from `engine/src/surface-views.ts` into `Generated/SurfaceContent.swift`
 for the same reason the habitability prose is: it is sourced text and transcribing it by hand
 would be transcription errors nothing could catch.

 The constraint that makes the feature worth having is that every image is real. Each is a
 specific NASA asset, curated rather than searched for, and `scripts/verify-imagery.mjs`
 re-resolves them all and rejects anything whose own description calls it a concept, an
 illustration or a perspective view. That last one matters: Magellan radar altimetry rendered
 as a landscape is the most convincing fake photograph of another world in existence, and NASA
 publishes it with no artist credit.
 */

public struct SurfaceImage: Sendable, Identifiable {
    public let nasaId: String
    public let title: String
    public let mission: String
    public let instrument: String
    public let captured: String
    public let whatYouAreSeeing: String
    public let credit: String
    public let url: String

    public var id: String { nasaId }

    public init(
        nasaId: String, title: String, mission: String, instrument: String,
        captured: String, whatYouAreSeeing: String, credit: String, url: String
    ) {
        self.nasaId = nasaId
        self.title = title
        self.mission = mission
        self.instrument = instrument
        self.captured = captured
        self.whatYouAreSeeing = whatYouAreSeeing
        self.credit = credit
        self.url = url
    }
}

public struct SurfaceView: Sendable {
    public let body: BodyId
    public let displayName: String
    public let images: [SurfaceImage]
    /// Why there is nothing to show, where there is nothing. Always worth reading: the reason
    /// Mercury has no surface photograph differs from the reason Jupiter has none.
    public let statement: String
    public let caveat: String?
    /// Where to see images this project links to rather than hosts. Venus is the only case.
    public let seeAlsoLabel: String?
    public let seeAlsoUrl: String?

    public init(
        body: BodyId, displayName: String, images: [SurfaceImage],
        statement: String, caveat: String?,
        seeAlsoLabel: String? = nil, seeAlsoUrl: String? = nil
    ) {
        self.body = body
        self.displayName = displayName
        self.images = images
        self.statement = statement
        self.caveat = caveat
        self.seeAlsoLabel = seeAlsoLabel
        self.seeAlsoUrl = seeAlsoUrl
    }
}

public func surfaceViewFor(_ id: BodyId) -> SurfaceView {
    surfaceViews[id]!
}
