import XCTest
@testable import SolarKit

/**
 The ascent model, gated the same inverted way the engine gates it.

 Predicting payload directly would need the loss budget to about 310 m/s, and the published
 loss terms disagree by over a kilometre per second, so that gate would fail on the literature
 rather than on the model. Instead ULA's own masses and ULA's own published payload go in and
 the **implied** losses come out, which must land in the 2 to 3 km/s band real vehicles need.
 */
final class AscentTests: XCTestCase {

    /// ULA's published figures. Two orbits, two sites, so the rotation term is exercised in
    /// both directions: 28.5 degrees from Florida borrows Earth's spin, 90 degrees does not.
    private let fixtures: [(name: String, payloadKg: Double, altitudeKm: Double,
                            inclinationDeg: Double, site: String)] = [
        ("Atlas V 401", 9_797, 200, 28.5, "ksc-lc39a"),
        ("Atlas V 401 polar", 8_080, 200, 90, "vandenberg-slc4e"),
    ]

    func testImpliedLossesLandInTheRealBand() throws {
        let atlas = vehicle(id: "atlas-v-401")!

        for fixture in fixtures {
            let site = launchSite(id: fixture.site)!
            let target = AscentTarget(
                altitudeKm: fixture.altitudeKm,
                inclinationDeg: fixture.inclinationDeg,
                site: site
            )
            let budget = try ascentBudget(target)
            let delivered = deliveredDeltaV(atlas, payloadKg: fixture.payloadKg).total

            // What the vehicle must overcome beyond orbital energy and the rotation bonus.
            let impliedLosses = delivered - budget.circularSpeedMS - budget.potentialMS
                + budget.earthRotationMS

            print("  \(fixture.name): implied losses "
                  + String(format: "%.0f m/s", impliedLosses))

            XCTAssertGreaterThan(impliedLosses, 2_000, "\(fixture.name) lower bound")
            XCTAssertLessThan(impliedLosses, 3_000, "\(fixture.name) upper bound")
        }
    }

    /// A higher orbit must cost more. An earlier version of this model had a 2,000 km orbit
    /// come out cheaper than a 200 km one, because circular speed falls with altitude faster
    /// than a separate potential term rose. The Hohmann form fixes it; this keeps it fixed.
    func testHigherOrbitsCostMore() throws {
        let site = launchSite(id: "ksc-lc39a")!
        var previous = 0.0
        for altitude in [200.0, 500, 1_000, 2_000, 10_000] {
            let budget = try ascentBudget(
                AscentTarget(altitudeKm: altitude, inclinationDeg: 28.5, site: site)
            )
            XCTAssertGreaterThan(
                budget.requiredMS, previous,
                "\(altitude) km should cost more than the orbit below it"
            )
            previous = budget.requiredMS
        }
    }

    /**
     The rotation bonus is signed, and that sign is the commonest error in this area.

     Due east from Florida borrows Earth's spin. A polar launch gets nothing. Anything
     retrograde has to cancel part of it.
     */
    func testRotationBonusHasTheRightSign() throws {
        let florida = launchSite(id: "ksc-lc39a")!
        let east = try earthRotationBonus(site: florida, inclinationDeg: florida.latitudeDeg)
        let polar = try earthRotationBonus(site: florida, inclinationDeg: 90)
        let retrograde = try earthRotationBonus(site: florida, inclinationDeg: 120)

        XCTAssertGreaterThan(east, 400, "due east from Florida should be worth over 400 m/s")
        XCTAssertLessThan(abs(polar), 1, "a polar launch borrows nothing")
        XCTAssertLessThan(retrograde, 0, "a retrograde launch must cancel part of the spin")
    }

    /// An inclination below the site's latitude cannot be reached directly, and the model
    /// refuses rather than returning a number.
    func testRefusesAnUnreachableInclination() {
        let vandenberg = launchSite(id: "vandenberg-slc4e")!
        XCTAssertThrowsError(try earthRotationBonus(site: vandenberg, inclinationDeg: 10))
    }

    /// Apollo 8 flew 32.509 degrees, which implies an azimuth of 72 to 108 degrees, the range
    /// pad 39A was designed for. Checking the inverse is the honest direction for this.
    func testApolloEightAzimuth() {
        let site = launchSite(id: "ksc-lc39a")!
        let azimuth = azimuthFor(site: site, inclinationDeg: 32.509)
        XCTAssertGreaterThan(azimuth, 72)
        XCTAssertLessThan(azimuth, 108)
    }

    func testAtlasHasItsKnownLowLiftoffThrustToWeight() {
        let twr = launchTWR(vehicle(id: "atlas-v-401")!, payloadKg: 9_797)
        XCTAssertGreaterThan(twr, 1.05)
        XCTAssertLessThan(twr, 1.25)
    }
}
