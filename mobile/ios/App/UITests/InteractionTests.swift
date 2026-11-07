import XCTest
import SolarKit

/**
 Can a person actually operate the controls?

 The existing iOS gates answer two questions: does the arithmetic match the engine
 (`swift test`), and does the right thing end up on screen (`scripts/focus-probe.mjs`). Neither
 can see a control that renders perfectly and ignores every tap, and two of those were
 reported from the phone rather than caught here: planets that would not focus on a tap, and a
 picker inside a sheet whose menu opened and then discarded the selection.

 Both had the same shape. The view is rebuilt faster than a touch completes, so the control is
 drawn correctly every frame and no gesture ever finishes on the instance that started it. A
 screenshot of that is indistinguishable from a screenshot of a working control, which is why
 it needs a test that touches things.
 */
@MainActor
final class InteractionTests: XCTestCase {
    private var app: XCUIApplication!

    override func setUp() {
        continueAfterFailure = false
        XCUIDevice.shared.orientation = .portrait
        app = XCUIApplication()
        // The scene animates continuously, so waiting for quiescence never returns.
        app.launchArguments = ["-uiTest"]
        app.launch()
    }

    /**
     A control inside a sheet responds to a tap, and its result lands.

     The sheet that prompted this is gone, but the failure it caught is a property of sheets
     over a scene that animates, not of that one feature: the sheet renders perfectly, every
     tap is discarded, and a screenshot cannot tell the two apart. Demonstrations is the
     remaining sheet with a control that does work and shows a result, so the coverage moves
     here rather than disappearing with the feature that first exposed it.

     The assertion is on the measured value appearing, not on the button changing, because a
     button that reverts to its idle label looks the same whether the work ran or never began.
     */
    func testSheetControlRunsAndShowsItsResult() {
        app.buttons["tool.demonstrations"].tap()

        let run = app.buttons["Run it"].firstMatch
        XCTAssertTrue(run.waitForExistence(timeout: 20), "the demonstrations sheet did not open")
        run.tap()

        // Mercury integrates 60 orbits off the main thread, so this is a real wait.
        XCTAssertTrue(
            app.staticTexts["Measured"].waitForExistence(timeout: 30),
            "tapped Run it and no measured value appeared"
        )
    }

    /**
     The time-rate slider takes effect, and the clock keeps running underneath it.

     Reported from the phone: "when i increase the time with the slider at the bottom it gets
     stuck for a bit and looks like its crashed before it updates."

     What this asserts is correctness, not speed. The first version of this test timed the
     whole interaction and failed at 2.03 seconds, which looked like the bug and was not: a
     probe measured the same 1.97 seconds with the clock paused, so it was XCUITest's own
     synthesized drag, and the app settled in 32 milliseconds either way. The stall is not
     reproducible on a simulator fast enough to rebuild the whole overlay sixty times a second
     without visibly suffering.

     The cost that actually caused it is measured where it can be seen, by
     `mobile/ios/scripts/focus-probe.mjs` reading `overlayRendersPerSecond`. This test covers
     the other half: that the control works at all, and that the rate reaching the clock does
     not stop the clock.
     */
    func testTimeRateSliderTakesEffect() {
        let slider = app.sliders["time.rate"]
        XCTAssertTrue(slider.waitForExistence(timeout: 20), "the time bar never appeared")

        let label = app.staticTexts["time.rateLabel"]
        XCTAssertEqual(label.label, "real time", "expected the clock to open at real time")

        // Read from the engine's own list, not typed here. Written as "10 years/s" once, and
        // adding a faster preset turned this red without anything in the app being wrong.
        let fastest = ratePresets.last!.label
        slider.adjust(toNormalizedSliderPosition: 1.0)
        XCTAssertTrue(
            settles(timeout: 5) { label.label == fastest },
            "dragged the rate to maximum and the label reads \(label.label), not \(fastest)"
        )

        /**
         The date must still be moving.

         The overlay now reads a throttled epoch rather than the live one, and the failure mode
         of getting that wrong is a clock that renders once and then never again: the scene
         keeps moving and the date sits still. That looks fine in a screenshot.
         */
        let date = app.staticTexts.matching(
            NSPredicate(format: "label ENDSWITH %@", "UTC")
        ).firstMatch
        XCTAssertTrue(date.waitForExistence(timeout: 5), "no date on screen")
        let first = date.label
        XCTAssertTrue(
            settles(timeout: 5) { date.label != first },
            "the rate is 10 years a second and the date is stuck at \(first)"
        )
    }

    /**
     Go to date moves the clock to the instant you asked for.

     Asked for as working out the time from a specific date or a Unix timestamp. The assertion
     is on the clock's own readout afterwards, because the sheet showing the right date proves
     only that the conversion ran, not that anything was told about it.

     1712600220 is the 2024 North American total solar eclipse, which is a date worth being
     able to reach and an obvious one to check against.
     */
    func testGoToDateMovesTheClock() {
        app.buttons["time.goTo"].tap()

        let field = app.textFields["goTo.stamp"]
        XCTAssertTrue(field.waitForExistence(timeout: 20), "the go-to-date sheet did not open")
        field.tap()
        // Clear whatever the sheet seeded itself with before typing.
        field.press(forDuration: 1.2)
        if app.menuItems["Select All"].waitForExistence(timeout: 3) {
            app.menuItems["Select All"].tap()
        }
        field.typeText("1712600220")

        app.buttons["Go"].tap()

        let date = app.staticTexts.matching(
            NSPredicate(format: "label ENDSWITH %@", "UTC")
        ).firstMatch
        XCTAssertTrue(date.waitForExistence(timeout: 10), "no date on screen")
        XCTAssertTrue(
            settles(timeout: 10) { date.label.hasPrefix("2024-04-08") },
            "asked for the 2024 eclipse and the clock reads \(date.label)"
        )
    }

    /**
     Solar system does not kill the app.

     Reported as "i click solar system and it crashes", and it did. Focusing the Sun computed
     a solar clock for it, and there is no sub-solar point on the Sun: the direction from it to
     itself is zero over zero, so the clock came out NaN and Swift trapped converting that to
     an Int. The website printed nonsense instead of dying, and the conformance generator had
     skipped the Sun, so nothing anywhere caught it.

     Every other gate here watches a control do something. This one only watches the app stay
     alive through the single most-used button in it, which no other test did.
     */
    func testSystemViewDoesNotCrash() {
        let systemView = app.buttons["tool.systemView"]
        XCTAssertTrue(systemView.waitForExistence(timeout: 20), "the tool rail never appeared")
        systemView.tap()

        // Focus read off the More info button, which names the body it would open. The panel
        // that used to carry the title is a screen away now.
        let opener = app.buttons["panel.open"]
        XCTAssertTrue(
            settles(timeout: 10) { opener.exists && opener.label == "More info about The Sun" },
            "tapped Solar system and More info says \(opener.label)"
        )
        // Still responding afterwards, not merely not yet reported dead.
        XCTAssertEqual(app.state, .runningForeground, "the app is not in the foreground")
        XCTAssertTrue(app.buttons["tool.systemView"].isHittable, "the app stopped responding")
    }

    /**
     Deep time opens, and moving to the giant changes what it says.

     The panel's whole point is that the figures move with the slider, so a test that only
     opened it would pass against a panel showing four and a half billion years of nothing. The
     assertion is on Earth's verdict flipping from habitable to destroyed, which is the single
     fact the model exists to deliver and cannot be produced by a static label.
     */
    func testDeepTimePanelRespondsToTheSlider() {
        app.buttons["tool.deepTime"].tap()

        let earthHabitable = app.staticTexts["in the habitable zone"]
        XCTAssertTrue(earthHabitable.waitForExistence(timeout: 20), "deep time did not open")

        // Jump to the red giant tip rather than dragging: a slider over thirteen billion years
        // is not something a synthesized drag lands precisely on.
        app.buttons["giant"].tap()

        XCTAssertTrue(
            settles(timeout: 10) { app.staticTexts["inside the Sun"].exists },
            "moved to the red giant and nothing was engulfed"
        )
        // The phase and its confidence are one label, "Red giant · interpolated between
        // published points", so this matches the start of it rather than the whole string.
        let phase = app.staticTexts.matching(
            NSPredicate(format: "label BEGINSWITH %@", "Red giant")
        ).firstMatch
        XCTAssertTrue(phase.exists, "the Sun is not called a red giant")
    }

    /**
     Tapping a planet in the top picker focuses it.

     The other reported interaction failure, and the same cause. Focus is observable from the
     outside through the body panel's title, so the test does not need to reach into the scene.
     */
    func testBodyPickerFocusesOnTap() {
        let venus = app.buttons["Venus"]
        XCTAssertTrue(venus.waitForExistence(timeout: 5), "the body picker never appeared")
        venus.tap()

        /**
         Focus is read off the More info button, which names the body it would open.

         It used to be read off the body panel's title. The panel is a screen away now, so
         the title is not on the scene to be read, and this is the observation that replaced
         it rather than a weaker one: the button is the thing that knows which body is in
         focus, and VoiceOver reads the same string.
         */
        let opener = app.buttons["panel.open"]
        XCTAssertTrue(
            settles(timeout: 5) { opener.exists && opener.label == "More info about Venus" },
            "tapped Venus and More info still says \(opener.label)"
        )
    }

    /**
     The body panel's More control expands and collapses again.

     Asked from the phone as whether More toggles. It does, and the useful thing is a test
     saying so rather than a reading of the source: the control is one tap in a panel that is
     height-capped and scrolls, so "it expanded and I could not get back" and "it did not
     expand" look identical from the outside, and neither is what the code appears to do.
     */
    func testBodyPanelMoreTogglesBothWays() {
        let more = openBodyDetails()
        XCTAssertEqual(more.label, "More", "the panel should start collapsed")

        more.tap()
        XCTAssertTrue(
            settles(timeout: 5) { more.label == "Less" },
            "tapped More and the control still reads \(more.label)"
        )
        /**
         The extra detail is what More is for, so its absence is the real failure.

         "Axial tilt" rather than "From Earth", which is the row this first reached for and
         which Earth deliberately does not have: a body does not report its distance from
         itself. Axial tilt is on every body's expanded panel.
         */
        XCTAssertTrue(
            app.staticTexts["Axial tilt"].waitForExistence(timeout: 3),
            "expanded, and the extra rows did not appear"
        )

        more.tap()
        XCTAssertTrue(
            settles(timeout: 5) { more.label == "More" },
            "tapped Less and the control still reads \(more.label)"
        )
    }

    /**
     No overlay control may sit underneath another one.

     This is the general form of a bug that has now happened twice in the same place. The body
     panel is bottom-aligned, so expanding it grows upwards into the tool rail, and a control
     that ends up behind the rail is still a perfectly valid view: accessibility reports it as
     present and hittable, the layout engine is content, and the only thing wrong is that
     touches go somewhere else. A screenshot cannot see it and a unit test cannot reach it.

     Comparing frames can. Every pair of interactive elements in the overlay must be disjoint,
     which is a property of the design rather than of any one control, so it keeps holding as
     controls are added.
     */
    func testInteractiveOverlaysDoNotOverlap() {
        /**
         The resting overlay, which is now the whole of it.

         This used to expand the body panel first, because the panel growing upwards into the
         tool rail was the bug it was written for. The panel is not over the scene any more,
         so the state worth checking is the one a person actually sees: the picker, the
         summary line, the rail and the clock, all at once.
         */
        XCTAssertTrue(
            app.buttons["panel.open"].waitForExistence(timeout: 15),
            "the overlay never appeared"
        )

        /**
         Filtered by frame, not by `isHittable`.

         `isHittable` throws on an element scrolled out of its container rather than returning
         false: the horizontal body picker holds every body in the registry, and asking about
         Uranus while it is off the right-hand edge fails the test for the wrong reason. A
         frame inside the window is the question actually being asked anyway.
         */
        let window = app.windows.firstMatch.frame
        let buttons = app.buttons.allElementsBoundByIndex.filter { button in
            guard button.exists else { return false }
            let frame = button.frame
            return frame.width > 1 && frame.height > 1 && window.intersects(frame)
        }
        XCTAssertGreaterThan(buttons.count, 5, "found almost no controls; the query is wrong")

        var collisions: [String] = []
        for i in buttons.indices {
            for j in (i + 1) ..< buttons.count {
                let a = buttons[i]
                let b = buttons[j]
                let overlap = a.frame.intersection(b.frame)
                guard !overlap.isNull, overlap.width > 2, overlap.height > 2 else { continue }
                collisions.append(
                    "\(describe(a)) over \(describe(b)) by \(Int(overlap.width))x\(Int(overlap.height))"
                )
            }
        }
        XCTAssertEqual(collisions, [], "controls are stacked on top of each other")
    }

    /**
     The body picker survives a rotation into landscape.

     Reported from a phone held sideways: the planet and moon buttons were not there at all.
     They were drawn, and they were above the top of the window. The overlay stack of panels
     is bottom-aligned inside the root `ZStack`, and in landscape the four of them came to
     about 480 points against 402 of screen. A `ZStack` grows to fit its children, so the
     root grew, and `.overlay(alignment: .top)` dutifully pinned the picker to the top of a
     stack that now began off screen. The panel's own title was clipped by the same amount,
     which is the other half of what the screenshot showed.

     Checked by frame rather than by existence, because existence was never the problem: the
     picker was present, hittable as far as accessibility was concerned, and invisible.
     */
    func testBodyPickerStaysVisibleInLandscape() {
        XCUIDevice.shared.orientation = .landscapeLeft
        // Back to portrait whatever happens, or every test after this one inherits it.
        defer { XCUIDevice.shared.orientation = .portrait }

        let picker = app.scrollViews["bodyPicker"]
        XCTAssertTrue(picker.waitForExistence(timeout: 20), "the body picker never appeared")

        let window = app.windows.firstMatch.frame
        XCTAssertTrue(
            settles(timeout: 5) { picker.frame.minY >= window.minY && picker.frame.height > 0 },
            "the picker sits at y \(picker.frame.minY) with the window starting at "
                + "\(window.minY), so it is above the top of the screen"
        )
        XCTAssertTrue(
            window.contains(picker.frame.origin),
            "the picker's origin \(picker.frame.origin) is outside the window \(window)"
        )

        // And the controls it was being pushed off by have to be on screen themselves.
        let opener = app.buttons["panel.open"]
        XCTAssertTrue(opener.waitForExistence(timeout: 10), "no controls in landscape")
        XCTAssertTrue(
            window.contains(opener.frame),
            "the control row at \(opener.frame) is outside the window \(window)"
        )
    }

    /**
     Opens the focused body's page, which is where the panel's controls now live.

     They used to be over the scene. The opening view carried the panel, the view controls and
     the gravity switch stacked above the clock, which was reported as cluttered twice, so the
     detail moved behind the summary line and the scene got its screen back.
     */
    @discardableResult
    private func openBodyDetails() -> XCUIElement {
        let summary = app.buttons["panel.open"]
        XCTAssertTrue(summary.waitForExistence(timeout: 15), "no body summary line to open")
        summary.tap()
        let more = app.buttons["panel.more"]
        XCTAssertTrue(more.waitForExistence(timeout: 10), "the body page never opened")
        return more
    }

    private func describe(_ element: XCUIElement) -> String {
        let id = element.identifier
        return id.isEmpty ? "\"\(element.label)\"" : id
    }

    /// Polls rather than using `expectation(for:evaluatedWith:)`, which Swift 6 rejects for
    /// sending a non-Sendable test case across actors.
    private func settles(timeout: TimeInterval, until: () -> Bool) -> Bool {
        let deadline = Date().addingTimeInterval(timeout)
        while Date() < deadline {
            if until() { return true }
            RunLoop.current.run(until: Date().addingTimeInterval(0.1))
        }
        return until()
    }
}
