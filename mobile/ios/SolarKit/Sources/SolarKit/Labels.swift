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
    /// Centre of the label plate, in pixels from the top left of the viewport.
    public let x: Double
    public let y: Double
    /// True when the body is outside the viewport and this is an edge pointer.
    public let clamped: Bool
    /// Direction from the label towards the body, radians, screen space. Only when clamped.
    public let bearingRadians: Double?
    public let depth: Double
    /**
     Whether this label has room for its second line.

     The second line is the body's own date and time, three times the width of its name. In
     the system view five of them land inside a hundred points of the Sun and cannot all be
     drawn, which is how the inner planets came to be unlabelled entirely while edge pointers
     for Jupiter and Neptune had the screen to themselves. Dropping a line beats dropping a
     label: a name still says which planet that is.
     */
    public let detail: Bool
}

public struct LabelOptions: Sendable {
    public let viewportWidthPx: Double
    public let viewportHeightPx: Double
    /**
     Keep the whole label plate this far inside the viewport.

     Measured against the plate rather than its anchor, which is the fix for a real defect:
     the anchor was held 44 points in and the plate drawn centred on it, so a two-line edge
     pointer 124 points wide hung 18 points off the side of the screen and its date was sliced
     in half. On a phone the top strip is the status bar and the bottom the home indicator.
     */
    public let edgeInsetPx: Double
    public let maximumLabels: Int
    /**
     Text metrics, as the shared guess both clients are drawn with.

     Neither a browser nor SwiftUI will tell this module how wide a string renders, and asking
     either would make placement a client decision again, which is the thing this file exists
     to prevent. An estimate both clients share is wrong by a point or two everywhere and
     wrong in the same direction, which is all the packing needs.
     */
    public let charWidthPx: Double
    /// Horizontal padding of the plate behind the text, both sides together.
    public let platePaddingPx: Double
    public let lineHeightPx: Double
    /**
     Width of the second line, which is a date and much the same length for every body.

     Measured off both clients rather than guessed. Jupiter's "day 23,711 · 01:49" draws 86
     points wide on the phone; Earth's "2026-11-07 00:12 GMT+0", the longest line either client
     produces, draws a 131 point plate in the browser, whose font is the wider of the two. The
     default is that worst case with a few points over, because the costly direction is
     underestimating: a plate wider than its reservation overlaps its neighbour, which is the
     defect this module was rewritten to fix.
     */
    public let detailWidthPx: Double
    /**
     How close two bodies may be on screen before the second is left unlabelled.

     From the system view Jupiter's Galileans sit inside a pixel of Jupiter, and a label off to
     one side of that pixel names any of the five equally. Deliberately tiny: this tests for
     "the same pixel", not for "nearby". Mercury and the Sun are eleven pixels apart in the
     default system view, and a threshold generous enough to call that a collision takes the
     label off a planet anyone can plainly see.
     */
    public let coincidencePx: Double
    /**
     How far a label carrying its second line may sit from the body it names.

     Sixty points sits between a diagonal attachment at about 34 and the sideways and
     clamped-inwards cases at 75 to 95, with room on both sides.
     */
    public let detailReachPx: Double

    public init(
        viewportWidthPx: Double,
        viewportHeightPx: Double,
        edgeInsetPx: Double = 44,
        maximumLabels: Int = 12,
        charWidthPx: Double = 6,
        platePaddingPx: Double = 14,
        lineHeightPx: Double = 15,
        detailWidthPx: Double = 136,
        coincidencePx: Double = 4,
        detailReachPx: Double = 60
    ) {
        self.viewportWidthPx = viewportWidthPx
        self.viewportHeightPx = viewportHeightPx
        self.edgeInsetPx = edgeInsetPx
        self.maximumLabels = maximumLabels
        self.charWidthPx = charWidthPx
        self.platePaddingPx = platePaddingPx
        self.lineHeightPx = lineHeightPx
        self.detailWidthPx = detailWidthPx
        self.coincidencePx = coincidencePx
        self.detailReachPx = detailReachPx
    }
}

/**
 Where a label may sit relative to its body, in preference order.

 Up and to the right first, because that is where a reader looks for a caption and where every
 label sat when there was only one way to place one. The rest exist because the inner solar
 system puts four planets inside a hundred points of the Sun, and a label that cannot go
 up-right is far better placed down-left than not placed at all.
 */
private let labelDirections: [(Double, Double)] = {
    let d = 2.0.squareRoot() / 2
    return [(d, -d), (-d, -d), (d, d), (-d, d), (0, -1), (0, 1), (1, 0), (-1, 0)]
}()

private struct LabelBox {
    /// Centre.
    var x: Double
    var y: Double
    var w: Double
    var h: Double
}

private func overlaps(_ a: LabelBox, _ b: LabelBox) -> Bool {
    abs(a.x - b.x) * 2 < a.w + b.w && abs(a.y - b.y) * 2 < a.h + b.h
}

/**
 Whether a plate would be drawn over some other body's disc, which reads as naming it.

 The disc counts for at most twenty pixels. A focused planet fills the screen, and taking its
 full apparent radius here would mark every position on the viewport as blocked, which is both
 useless and false: nobody reads a label at the edge as naming the planet filling the frame.
 What this guards is the small bright dot a nearby plate really can be mistaken for.
 */
private func covers(_ box: LabelBox, _ pointX: Double, _ pointY: Double, _ radiusPx: Double) -> Bool {
    let disc = Swift.min(radiusPx, 20)
    return abs(box.x - pointX) < box.w / 2 + disc && abs(box.y - pointY) < box.h / 2 + disc
}

/// How far the plate's own edge lies from its centre along a unit direction.
private func extentAlong(_ w: Double, _ h: Double, _ dx: Double, _ dy: Double) -> Double {
    let horizontal = abs(dx) < 1e-9 ? Double.infinity : w / 2 / abs(dx)
    let vertical = abs(dy) < 1e-9 ? Double.infinity : h / 2 / abs(dy)
    return Swift.min(horizontal, vertical)
}

/**
 Hold the whole plate inside the safe area.

 A plate wider than the band is centred rather than pushed off one side, because half a date
 on the left reads no better than half of it on the right.
 */
private func clampBox(_ box: LabelBox, _ width: Double, _ height: Double, _ inset: Double) -> LabelBox {
    func clampAxis(_ value: Double, _ size: Double, _ limit: Double) -> Double {
        let low = inset + size / 2
        let high = limit - inset - size / 2
        if low > high { return limit / 2 }
        return Swift.min(high, Swift.max(low, value))
    }
    var clamped = box
    clamped.x = clampAxis(box.x, box.w, width)
    clamped.y = clampAxis(box.y, box.h, height)
    return clamped
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

/**
 Turn projected bodies into label positions.

 Ordered by significance, then by what is actually visible, then nearest first; packed so two
 plates never overlap; and capped.
 */
public func placeLabels(_ inputs: [LabelInput], options: LabelOptions) -> [LabelPlacement] {
    let width = options.viewportWidthPx
    let height = options.viewportHeightPx

    /**
     Screen point of every body, labelled or not.

     Collected before anything is placed because a plate must not be dropped over a planet it
     does not name, and the planet in the way is frequently one never labelled itself.
     */
    struct Point { var x: Double; var y: Double; var radiusPx: Double; var onScreen: Bool }
    var points: [BodyId: Point] = [:]
    for input in inputs {
        let ndcX = input.behindCamera ? -input.ndcX : input.ndcX
        let ndcY = input.behindCamera ? -input.ndcY : input.ndcY
        points[input.id] = Point(
            x: ((ndcX + 1) / 2) * width,
            y: ((1 - ndcY) / 2) * height,
            radiusPx: input.radiusPx,
            onScreen: isOnScreen(input)
        )
    }

    let candidates = inputs.filter(worthLabelling).sorted { a, b in
        if rank(a) != rank(b) { return rank(a) < rank(b) }
        let visibleA = isOnScreen(a) ? 0 : 1
        let visibleB = isOnScreen(b) ? 0 : 1
        if visibleA != visibleB { return visibleA < visibleB }
        return a.distance < b.distance
    }

    typealias Size = (w: Double, h: Double, detail: Bool)

    /// A label under construction: everything needed to re-place it at a different size.
    struct Slot {
        let input: LabelInput
        let point: Point
        let bearingRadians: Double?
        let directions: [(Double, Double)]
        let originX: Double
        let originY: Double
        let reach: ((Double, Double), Double, Double) -> Double
        let sizes: [Size]
        var box: LabelBox
        var detail: Bool
    }

    /**
     First box that neither covers another body nor collides with a label already taken.

     Two sweeps. The first refuses to drop a plate across another body; the second accepts that
     rather than leave a visible planet unnamed, which is the worse of the two.
     */
    func fit(
        id: BodyId,
        attachedTo: Point?,
        directions: [(Double, Double)],
        originX: Double,
        originY: Double,
        reach: ((Double, Double), Double, Double) -> Double,
        sizes: [Size],
        taken: [LabelBox]
    ) -> (box: LabelBox, detail: Bool)? {
        for strict in [true, false] {
            for direction in directions {
                for size in sizes {
                    let distance = reach(direction, size.w, size.h)
                    let box = clampBox(
                        LabelBox(
                            x: originX + direction.0 * distance,
                            y: originY + direction.1 * distance,
                            w: size.w, h: size.h
                        ),
                        width, height, options.edgeInsetPx
                    )
                    /**
                     A second line is only worth having where the label still reads as attached.

                     The anchor puts the plate's nearest edge against the body, but the text
                     inside it is centred, so a plate 136 points wide placed directly to one
                     side leaves 68 points of plate and then the words. Near the edge of the
                     screen it is worse: the clamp pushes a wide plate inwards off its body
                     entirely, and Mars came out 92 points from its own name while Mercury
                     beside it was fine.

                     Measured against the centre rather than the edge, because the centre is
                     where the words are. Only for labels attached to something: an edge
                     pointer's body is off screen and an arrow carries the direction, so there
                     is no gap to misread. Capping it there took the clock off the Moon while
                     it was framed with Earth, which is what the second line exists for.
                     */
                    if size.detail, attachedTo != nil,
                       let p = attachedTo,
                       ((box.x - p.x) * (box.x - p.x) + (box.y - p.y) * (box.y - p.y))
                        .squareRoot() > options.detailReachPx { continue }
                    /**
                     A label nearer another planet than its own names that planet, whatever it
                     says.

                     The strict sweep refuses to drop a plate across another body and the
                     relaxed sweep accepts it rather than leave a visible planet unnamed. That
                     trade is right for a plate that merely overlaps a disc and wrong once the
                     label is closer to the other body than to its own: measured in the system
                     view, Venus's name landed 34 points from Venus and 13 from Earth, which
                     is not a cosmetic problem, it is a label that says the wrong thing.
                     Reported once already, as the times being attached to the wrong bodies.

                     So this holds in both sweeps, and a label with nowhere satisfying it is
                     not drawn. Silence is recoverable by tapping the planet; a confident wrong
                     name is not. Clamped labels are exempt: their body is off screen and the
                     arrow is what carries the meaning.
                     */
                    if let own = attachedTo {
                        let mine = ((box.x - own.x) * (box.x - own.x)
                            + (box.y - own.y) * (box.y - own.y)).squareRoot()
                        let stolen = inputs.contains { other in
                            guard other.id != id, let p = points[other.id],
                                  p.onScreen, p.radiusPx >= 1 else { return false }
                            return ((box.x - p.x) * (box.x - p.x)
                                + (box.y - p.y) * (box.y - p.y)).squareRoot() < mine
                        }
                        if stolen { continue }
                    }
                    if taken.contains(where: { overlaps(box, $0) }) { continue }
                    if strict {
                        let blocked = inputs.contains { other in
                            guard other.id != id, let p = points[other.id] else { return false }
                            return p.onScreen && covers(box, p.x, p.y, p.radiusPx)
                        }
                        if blocked { continue }
                    }
                    return (box, size.detail)
                }
            }
        }
        return nil
    }

    /**
     Two passes: every name first, then the dates that still fit.

     One greedy pass let an early body take a plate three times the width of its own name and
     starve a later one of a label entirely. Measured in the default system view: Mercury took
     a date and Earth, right next to it, came out unnamed. A name for every visible planet
     beats a clock for one of them, so nothing claims the wider plate until every label that
     can be placed has been.
     */
    var slots: [Slot] = []
    var claimed: [(x: Double, y: Double)] = []

    for input in candidates {
        if slots.count >= options.maximumLabels { break }
        guard let point = points[input.id] else { continue }

        // A second name on the same pixel names neither body. See `coincidencePx`.
        let coincides = claimed.contains { c in
            ((c.x - point.x) * (c.x - point.x) + (c.y - point.y) * (c.y - point.y)).squareRoot()
                < options.coincidencePx
        }
        if coincides { continue }

        let nameWidth = Double((bodyContracts[input.id]?.displayName ?? "").count)
            * options.charWidthPx + options.platePaddingPx
        let compact: Size = (nameWidth, options.lineHeightPx + 6, false)
        /**
         A star never asks for the second line, because it has no local time to put there.

         The detail line is the body's own date read off its prime meridian, and `solarClock`
         returns nothing for the Sun: a sub-solar point on the Sun is a division by zero, which
         is what crashed the system view once already. Letting it reserve a plate three times
         the width of "The Sun" and then draw nothing in the lower half held a hole open at the
         busiest part of the screen and pushed a planet's clock out of it.
         */
        let sizes: [Size] = bodyContracts[input.id]?.kind == .star
            ? [compact]
            : [
                (Swift.max(nameWidth, options.detailWidthPx), options.lineHeightPx * 2 + 6, true),
                compact,
            ]

        var bearingRadians: Double?
        let directions: [(Double, Double)]
        let originX: Double
        let originY: Double
        let reach: ((Double, Double), Double, Double) -> Double

        if point.onScreen {
            directions = labelDirections
            originX = point.x
            originY = point.y
            /**
             Far enough out that the plate's near edge clears the disc, not its centre.

             The old rule offset the centre by a little more than the radius, so half the plate
             lay back across the body it named and the name floated at a diagonal from it.
             Solving for the plate's own extent along the chosen direction attaches its corner
             to the limb instead, which is what was asked for.

             The body term caps at 40 pixels, so a body larger than that is labelled across its
             own disc. Deliberate: a focused planet fills the screen, there is no outside to
             use, and a label flung to its limb would read as naming something else.
             */
            let bodyTerm = Swift.min(40, Swift.max(8, point.radiusPx + 8))
            reach = { direction, w, h in
                bodyTerm + extentAlong(w, h, direction.0, direction.1)
            }
        } else {
            let centreX = width / 2
            let centreY = height / 2
            let dx = point.x - centreX
            let dy = point.y - centreY
            let length = (dx * dx + dy * dy).squareRoot()
            bearingRadians = atan2(dy, dx)
            originX = centreX
            originY = centreY
            directions = [length < 1e-9 ? (1, 0) : (dx / length, dy / length)]
            /**
             Scale the whole vector down until the plate touches the safe area, rather than
             clamping each axis. Independent clamping drags a pointer into the nearest corner,
             where it aims at nothing. The band shrinks by the plate's own half-size, so a wide
             two-line pointer stops with its edge on the inset instead of off the screen.
             */
            reach = { _, w, h in
                let halfW = Swift.max(1, centreX - options.edgeInsetPx - w / 2)
                let halfH = Swift.max(1, centreY - options.edgeInsetPx - h / 2)
                let scale = Swift.max(Swift.max(abs(dx) / halfW, abs(dy) / halfH), 1e-9)
                return length / scale
            }
        }

        guard let name = fit(
            id: input.id, attachedTo: point.onScreen ? point : nil,
            directions: directions, originX: originX,
            originY: originY, reach: reach, sizes: [compact], taken: slots.map(\.box)
        ) else { continue }

        slots.append(
            Slot(
                input: input, point: point, bearingRadians: bearingRadians,
                directions: directions, originX: originX, originY: originY, reach: reach,
                sizes: sizes, box: name.box, detail: false
            )
        )
        claimed.append((point.x, point.y))
    }

    // Grow the ones with room, most significant first, against everything already settled.
    for i in slots.indices {
        let slot = slots[i]
        let wider = slot.sizes.filter(\.detail)
        if wider.isEmpty { continue }
        let others = slots.indices.filter { $0 != i }.map { slots[$0].box }
        guard let grown = fit(
            id: slot.input.id, attachedTo: slot.point.onScreen ? slot.point : nil,
            directions: slot.directions,
            originX: slot.originX, originY: slot.originY, reach: slot.reach,
            sizes: wider, taken: others
        ) else { continue }
        slots[i].box = grown.box
        slots[i].detail = true
    }

    return slots.map { slot in
        LabelPlacement(
            id: slot.input.id, x: slot.box.x, y: slot.box.y, clamped: !slot.point.onScreen,
            bearingRadians: slot.bearingRadians, depth: slot.input.distance, detail: slot.detail
        )
    }
}
