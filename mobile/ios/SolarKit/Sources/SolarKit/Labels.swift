import Foundation

/**
 Where a body's name goes on screen, and whether it goes there at all.

 Ported from `engine/src/labels.ts` and gated by the conformance suite. Labels exist because
 the honest rendering of this system is mostly empty space with things in it too small to
 identify: a marker says something is here, and only a label says what.

 The case worth the code is the off-screen one. Focused on Earth at six radii, the Moon is
 sixty radii away and not in frame at all, so neither the sphere nor its marker can help. A
 label clamped to the edge nearest it, with a bearing, turns "it is missing" into "it is that
 way".
 */

public enum LabelRelevance: String, Sendable {
    case focus
    case satelliteOfFocus = "satellite-of-focus"
    case other
}

public struct LabelInput: Sendable {
    public let id: BodyId
    /// Normalised device coordinates, -1 to 1, x right and y up.
    public let ndcX: Double
    public let ndcY: Double
    /// Apparent radius of the body in pixels. Decides how far the label sits from it.
    public let radiusPx: Double
    /// True camera distance in metres. Used only to order labels front to back.
    public let distance: Double
    public let behindCamera: Bool
    public let relevance: LabelRelevance

    public init(
        id: BodyId, ndcX: Double, ndcY: Double, radiusPx: Double,
        distance: Double, behindCamera: Bool, relevance: LabelRelevance
    ) {
        self.id = id
        self.ndcX = ndcX
        self.ndcY = ndcY
        self.radiusPx = radiusPx
        self.distance = distance
        self.behindCamera = behindCamera
        self.relevance = relevance
    }
}

public struct LabelPlacement: Sendable, Identifiable {
    public let id: BodyId
    /// Pixels from the top left of the viewport.
    public let x: Double
    public let y: Double
    /// True when the body is outside the viewport and this is an edge pointer.
    public let clamped: Bool
    /// Direction from the label towards the body, radians, screen space. Only when clamped.
    public let bearingRadians: Double?
    public let depth: Double
}

public struct LabelOptions: Sendable {
    public let viewportWidthPx: Double
    public let viewportHeightPx: Double
    /// Keep an edge-clamped label this far inside the viewport. Not cosmetic: a label pinned
    /// to the edge is half off it, and on a phone that strip is status bar and home indicator.
    public let edgeInsetPx: Double
    public let minimumSeparationPx: Double
    public let maximumLabels: Int

    public init(
        viewportWidthPx: Double,
        viewportHeightPx: Double,
        edgeInsetPx: Double = 44,
        minimumSeparationPx: Double = 46,
        maximumLabels: Int = 12
    ) {
        self.viewportWidthPx = viewportWidthPx
        self.viewportHeightPx = viewportHeightPx
        self.edgeInsetPx = edgeInsetPx
        self.minimumSeparationPx = minimumSeparationPx
        self.maximumLabels = maximumLabels
    }
}

/// Everything at once is 32 labels over a black screen, which identifies nothing. The focus
/// and its satellites are always worth naming; anything else only while it is on screen.
private func worthLabelling(_ input: LabelInput) -> Bool {
    if input.behindCamera { return input.relevance != .other }
    if input.relevance != .other { return true }
    return abs(input.ndcX) <= 1 && abs(input.ndcY) <= 1
}

/**
 Which label wins when two sit on top of each other.

 Distance alone was the tie-break, and from the system view a moon is at its planet's position
 to within a pixel, so whichever happened to be nearer the camera took the label. The result
 was a solar system labelled Callisto, Iapetus and Oberon with Jupiter, Saturn and Uranus
 unnamed: accurate about where things are, and useless as a map.
 */
private func rank(_ input: LabelInput) -> Int {
    if input.relevance == .focus { return 0 }
    if input.relevance == .satelliteOfFocus { return 1 }
    switch bodyContracts[input.id]?.kind {
    case .star: return 2
    case .planet: return 3
    default: return 4
    }
}

private func isOnScreen(_ input: LabelInput) -> Bool {
    !input.behindCamera && abs(input.ndcX) <= 1 && abs(input.ndcY) <= 1
}

public func placeLabels(_ inputs: [LabelInput], options: LabelOptions) -> [LabelPlacement] {
    let width = options.viewportWidthPx
    let height = options.viewportHeightPx
    let candidates = inputs.filter(worthLabelling).sorted {
        rank($0) != rank($1) ? rank($0) < rank($1) : $0.distance < $1.distance
    }

    var placed: [LabelPlacement] = []
    for input in candidates {
        if placed.count >= options.maximumLabels { break }

        /**
         A body behind the camera projects to a point that is mathematically correct and
         visually a lie: the perspective divide by a negative depth mirrors it through the
         origin, so something directly behind appears dead ahead. Negating both axes puts the
         pointer on the side you would actually turn towards.
         */
        let ndcX = input.behindCamera ? -input.ndcX : input.ndcX
        let ndcY = input.behindCamera ? -input.ndcY : input.ndcY

        let screenX = ((ndcX + 1) / 2) * width
        let screenY = ((1 - ndcY) / 2) * height
        let onScreen = isOnScreen(input)

        var x: Double
        var y: Double
        var bearingRadians: Double?

        if onScreen {
            /**
             Up and to the right of the body's centre, by a little more than its radius.

             Capped at 40 pixels, so a body larger than that is labelled across its own disc.
             Deliberate: a focused planet fills the screen and has no outside to use, and a
             label flung to the edge would read as naming something else.
             */
            let offset = Swift.min(40, Swift.max(10, input.radiusPx + 10))
            x = screenX + offset * 0.7
            y = screenY - offset * 0.7
        } else {
            /**
             Clamp along the line of sight, not per axis. Clamping each axis independently
             drags the label into a corner and leaves it pointing at nothing.
             */
            let centreX = width / 2
            let centreY = height / 2
            let dx = screenX - centreX
            let dy = screenY - centreY
            let halfW = Swift.max(1, centreX - options.edgeInsetPx)
            let halfH = Swift.max(1, centreY - options.edgeInsetPx)
            let scale = Swift.max(Swift.max(abs(dx) / halfW, abs(dy) / halfH), 1e-9)
            x = centreX + dx / scale
            y = centreY + dy / scale
            bearingRadians = atan2(dy, dx)
        }

        x = Swift.min(width - options.edgeInsetPx, Swift.max(options.edgeInsetPx, x))
        y = Swift.min(height - options.edgeInsetPx, Swift.max(options.edgeInsetPx, y))

        // Thin collisions, keeping whichever the sort put first: the more significant
        // body, and between equals the nearer one.
        let collides = placed.contains { other in
            (pow(other.x - x, 2) + pow(other.y - y, 2)).squareRoot() < options.minimumSeparationPx
        }
        if collides { continue }

        placed.append(
            LabelPlacement(
                id: input.id, x: x, y: y, clamped: !onScreen,
                bearingRadians: bearingRadians, depth: input.distance
            )
        )
    }
    return placed
}
