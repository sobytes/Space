import XCTest
@testable import SolarKit

/**
 Every demonstration must reproduce the value it names.

 The gate iterates the registry rather than listing cases, so adding a demonstration adds its
 gate and there is no second list to leave stale. Same structure as the engine's.
 */
final class DemonstrationTests: XCTestCase {

    func testEveryDemonstrationReproducesItsPublishedValue() {
        XCTAssertEqual(demonstrations.count, 4)

        for demonstration in demonstrations {
            let result = demonstration.run()
            let published = demonstration.published
            let error = abs(result.measured - published.value) / abs(published.value)

            // Plain interpolation, not String(format:). `%s` there expects a C string and
            // hands a Swift String straight to a segfault, which is a confusing way to lose
            // ten minutes in a test that is only printing.
            let measured = String(format: "%.4f", result.measured)
            let expected = String(format: "%.4f", published.value)
            let off = String(format: "%.3f", error * 100)
            print("  \(demonstration.id.padding(toLength: 22, withPad: " ", startingAt: 0))"
                + " measured \(measured)  published \(expected) \(published.unit)  (\(off)% off)")

            XCTAssertLessThanOrEqual(
                error, published.tolerance,
                "\(demonstration.id): measured \(result.measured) against "
                    + "\(published.value) \(published.unit)"
            )
        }
    }

    func testEveryDemonstrationIsProperlyDeclared() {
        for d in demonstrations {
            XCTAssertFalse(d.id.isEmpty)
            XCTAssertGreaterThan(d.title.count, 10, "\(d.id) title")
            // The question is the one a visitor actually has, which is what makes a
            // demonstration a demonstration rather than a readout.
            XCTAssertGreaterThan(d.question.count, 10, "\(d.id) question")
            XCTAssertGreaterThan(d.history.count, 80, "\(d.id) history")
            XCTAssertGreaterThan(d.published.source.count, 10, "\(d.id) source")
            XCTAssertGreaterThan(d.published.tolerance, 0, "\(d.id) tolerance")
            XCTAssertFalse(d.run().rows.isEmpty, "\(d.id) produced no rows")
        }
        XCTAssertEqual(Set(demonstrations.map(\.id)).count, demonstrations.count, "duplicate id")
    }

    /// The control is what makes the Mercury result mean something: with the relativistic term
    /// off the same measurement must give zero, or the integrator is inventing the effect.
    func testMercuryHasAWorkingControl() {
        let result = demonstration(id: "mercury-precession")!.run()
        XCTAssertNotNil(result.control)
        XCTAssertLessThan(abs(result.control!.value), 0.01, "the Newtonian arm precessed")
    }
}
