import SwiftUI
import SolarKit

/**
 The world as a flat map, with the zone meridians drawn on it and the night laid over the top.

 Asked for alongside the list: a graphic showing the time zones on the Earth. The list answers
 "what time is it there" and this answers "where is there", which is the half a child needs to
 connect a name to a place and a place to the lit limb of the globe behind.

 The map is the same equirectangular image the sphere is textured with, so the shapes here and
 the shapes on the planet are the same shapes. Longitude runs linearly across it, which is what
 makes a time zone drawable at all: every fifteen degrees is an hour.

 The night is computed, not drawn. For a given longitude the terminator sits at

     lat = atan(-cos(longitude - subsolar longitude) / tan(declination))

 which is the latitude where the Sun is exactly on the horizon, and the side of that curve the
 darkness falls on is decided by which pole is tilted sunward. It is the same sub-solar point
 the list reads and the same one the globe is lit by, so all three move together.
 */
struct ZoneMap: View {
    let epoch: JdTdb
    let places: [EarthPlace]

    /**
     The same image the sphere is textured with, found the same way.

     The first version looked only in the `Textures` subdirectory and silently drew a blue
     rectangle when it came back empty: a map with no coastlines on it, which is a graphic of
     nothing. `SolarScene` has always tried the bundle root as well, because whether a copied
     folder keeps its name in the built product is a build-setting detail rather than a
     promise, and the two lookups have to agree or one of them is wrong.
     */
    private static let map: UIImage? = {
        let url = Bundle.main.url(
            forResource: "earth-day", withExtension: "jpg", subdirectory: "Textures"
        ) ?? Bundle.main.url(forResource: "earth-day", withExtension: "jpg")
        return url.flatMap { UIImage(contentsOfFile: $0.path) }
    }()

    var body: some View {
        GeometryReader { geometry in
            let size = geometry.size
            ZStack(alignment: .topLeading) {
                if let map = Self.map {
                    Image(uiImage: map).resizable()
                } else {
                    Color.blue.opacity(0.25)
                }
                Canvas { context, canvas in draw(into: &context, size: canvas) }
            }
            .frame(width: size.width, height: size.height)
            .clipShape(RoundedRectangle(cornerRadius: 8))
        }
        .aspectRatio(2, contentMode: .fit)
        .accessibilityLabel("A world map with the time zone meridians marked and the night side "
                            + "shaded, for the moment the clock is showing.")
    }

    private func x(_ longitudeDeg: Double, _ size: CGSize) -> Double {
        (longitudeDeg + 180) / 360 * size.width
    }

    private func y(_ latitudeDeg: Double, _ size: CGSize) -> Double {
        (90 - latitudeDeg) / 180 * size.height
    }

    private func draw(into context: inout GraphicsContext, size: CGSize) {
        /**
         A line every fifteen degrees, which is one hour of the Earth turning.

         The lines are where the zones would be if they followed the Sun. They do not, and
         that is the point of drawing them: the countries beneath them are visibly not cut
         along them anywhere except at sea.
         */
        for hour in -12 ... 12 {
            let longitude = Double(hour) * 15
            var line = Path()
            line.move(to: CGPoint(x: x(longitude, size), y: 0))
            line.addLine(to: CGPoint(x: x(longitude, size), y: size.height))
            context.stroke(
                line,
                with: .color(.white.opacity(hour == 0 ? 0.75 : 0.25)),
                lineWidth: hour == 0 ? 1.2 : 0.5
            )
        }

        guard let subSolar = subSolarPoint(.embary, at: epoch) else { return }
        let declination = subSolar.latitudeDeg

        /**
         The night, as one filled shape.

         Walked a degree at a time rather than solved for the two crossings, because the curve
         leaves the top or bottom of the map at high declination and the shape has to follow
         the edge when it does. A degree is finer than a pixel at any width this is drawn at.
         */
        var night = Path()
        let dark = declination >= 0 ? size.height : 0.0
        night.move(to: CGPoint(x: 0, y: dark))
        for step in 0 ... 360 {
            let longitude = Double(step) - 180
            let delta = (longitude - subSolar.longitudeDeg) * .pi / 180
            // Flat on the equator when the Sun is: at an equinox every meridian's terminator
            // runs pole to pole, and the tangent below would divide by nothing.
            let terminator = abs(declination) < 0.05
                ? (cos(delta) >= 0 ? 90.0 : -90.0)
                : atan(-cos(delta) / tan(declination * .pi / 180)) * 180 / .pi
            night.addLine(to: CGPoint(x: x(longitude, size), y: y(terminator, size)))
        }
        night.addLine(to: CGPoint(x: size.width, y: dark))
        night.closeSubpath()
        context.fill(night, with: .color(.black.opacity(0.62)))

        // Where the Sun is overhead. The brightest point on the planet, and the one the whole
        // of the rest of this is measured from.
        let sun = CGPoint(x: x(subSolar.longitudeDeg, size), y: y(declination, size))
        context.fill(
            Path(ellipseIn: CGRect(x: sun.x - 4, y: sun.y - 4, width: 8, height: 8)),
            with: .color(.yellow)
        )

        /**
         A dot for every place in the list, lit or not.

         The join between the two halves of this screen: a row saying Tokyo is in darkness, and
         a dot in darkness where Tokyo is.
         */
        for place in places {
            let altitude = solarAltitudeDeg(
                .embary, at: epoch,
                latitudeDeg: place.latitudeDeg, longitudeDeg: place.longitudeDeg
            ) ?? -1
            let point = CGPoint(
                x: x(place.longitudeDeg, size), y: y(place.latitudeDeg, size)
            )
            context.fill(
                Path(ellipseIn: CGRect(x: point.x - 2, y: point.y - 2, width: 4, height: 4)),
                with: .color(altitude > 0 ? .orange : .white.opacity(0.75))
            )
        }
        /**
         The hour each meridian stands for, every third one.

         Without a number the lines are decoration. With one the map answers the question the
         screen is for: find the country, read up, and that is roughly its offset. Roughly,
         because the zone it actually keeps is a decision and the list below is where the real
         answer is. Every third, because twenty-five numbers across a phone is a smear.

         Drawn last. The first version drew them with the meridians and the night shading went
         over the top, which at this date is most of the width: the Arctic is dark from end to
         end in November, and that is exactly where the numbers sit.
         */
        for hour in stride(from: -12, through: 12, by: 3) {
            let label = hour == 0 ? "0" : String(format: "%+d", hour)
            context.draw(
                Text(label)
                    .font(.system(size: 9, weight: .semibold))
                    .foregroundColor(.white),
                at: CGPoint(x: x(Double(hour) * 15, size), y: 9)
            )
        }
    }
}
