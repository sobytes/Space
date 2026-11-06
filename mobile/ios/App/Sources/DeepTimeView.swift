import SwiftUI
import SolarKit

/**
 The Sun's whole life, and what it does to the planets.

 The same panel as the website's, from the same source: every figure and every caption comes
 out of SolarKit's deep-time model, which is the TypeScript engine's ported line for line and
 gated by the `deep-time` conformance domain down to the wording of the milestones. The two
 clients cannot disagree about when Earth's oceans go.

 A separate mode because it is a separate scale. The rest of the app runs on element tables
 fitted for a few thousand years either side of now, where a planet's position means something.
 Here positions are irrelevant and the star is the variable.
 */
struct DeepTimeView: View {
    @Environment(\.dismiss) private var dismiss
    let scene: SolarScene

    /// Starts at today, which is the only point on this slider anyone has intuition for.
    /**
     Starts at today, which is the only point on this slider anyone has intuition for.

     `-deepTimeAge <gyr>` starts it elsewhere, so a screenshot probe can reach the giant
     without driving the slider. Test hook, not a feature.
     */
    @State private var ageGyr: Double = {
        guard let i = CommandLine.arguments.firstIndex(of: "-deepTimeAge"),
              i + 1 < CommandLine.arguments.count,
              let value = Double(CommandLine.arguments[i + 1]) else { return solarAgeNowGyr }
        return value
    }()

    /// The four whose fate the Sun's evolution actually decides.
    private let inner: [BodyId] = [.mercury, .venus, .embary, .mars]

    private var sun: SolarState { solarStateAt(ageGyr) }
    private var zone: HabitableZoneSpan { habitableZoneAt(ageGyr) }
    private var event: DeepTimeEvent { deepTimeEventAt(ageGyr) }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    Text("The Sun is not a fixed lamp. It shone at 71% of today's brightness "
                         + "when Earth formed and has risen ever since, so the habitable zone "
                         + "has been sweeping outwards for four and a half billion years.")
                        .font(.system(size: 13))
                        .foregroundStyle(.orange.opacity(0.9))

                    slider
                    slice
                    figures
                    fates
                    milestone
                    earthsDeadline
                }
                .padding(16)
            }
            .navigationTitle("Deep time")
            .navigationBarTitleDisplayMode(.inline)
            /**
             The scene behind this sheet is drawn at the chosen age while it is open.

             A medium detent and background interaction, because the scene is now the other
             half of the panel: the Sun swells, the orbits widen and planets vanish as the
             slider moves, and a full-height sheet would hide exactly that.

             Cleared on the way out, so closing it puts the solar system back where it is
             rather than leaving it stranded in the year ten billion.
             */
            .onAppear { scene.setDeepTime(ageGyr) }
            .onChange(of: ageGyr) { _, age in scene.setDeepTime(age) }
            .onDisappear { scene.setDeepTime(nil) }
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Done") { dismiss() }
                }
            }
        }
    }

    private var slider: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack {
                Text("Age of the Sun").font(.caption).foregroundStyle(.secondary)
                Spacer()
                Text(String(format: "%.2f billion years · ", ageGyr) + fromNowText)
                    .font(.caption.monospacedDigit())
            }
            Slider(value: $ageGyr, in: 0 ... 13)
                .accessibilityIdentifier("deepTime.age")
            // The three moments worth being able to jump to, since a slider over thirteen
            // billion years is hard to land on a particular one by hand.
            HStack(spacing: 8) {
                marker("now", solarAgeNowGyr)
                marker("main sequence ends", mainSequenceEndGyr)
                marker("giant", redGiantTipGyr)
            }
        }
    }

    private func marker(_ label: String, _ at: Double) -> some View {
        Button(label) { ageGyr = at }
            .font(.system(size: 10))
            .buttonStyle(.bordered)
            .controlSize(.mini)
    }

    private var fromNowText: String {
        let fromNow = ageGyr - solarAgeNowGyr
        if abs(fromNow) < 0.005 { return "today" }
        let magnitude = abs(fromNow)
        let amount = magnitude < 1
            ? String(format: "%.0f million", magnitude * 1000)
            : String(format: "%.2f billion", magnitude)
        return fromNow < 0 ? "\(amount) years ago" : "in \(amount) years"
    }

    /** The widest the slice shows, in au. */
    private let sliceAu = 3.0

    /**
     A slice of the inner solar system, to scale, at this age.

     Horizontal rather than concentric, because the thing to watch is a distance changing and
     rings hide that: every orbit expands by the same factor under mass loss, so rings merely
     zoom while a ruler shows the Sun's edge crossing each planet in turn.

     Three au wide and fixed, which holds the photosphere at its largest, 1.19 au, and Mars at
     2.28. The habitable zone runs to 85 au by then and simply leaves, which the caption says
     in words rather than squeezing onto the scale.
     */
    private var slice: some View {
        let zone = habitableZoneAt(ageGyr)
        let photosphereAu = bodyContracts[.sun]!.equatorialRadiusM * sun.radius
            / Constants.auInMetres

        return VStack(alignment: .leading, spacing: 2) {
            Text(zone.innerAu >= sliceAu
                 ? String(format: "habitable zone now %.0f to %.0f au, off this scale",
                          zone.innerAu, zone.outerAu)
                 : String(format: "0 to %.0f au", sliceAu))
                .font(.system(size: 9))
                .foregroundStyle(.tertiary)
                .frame(maxWidth: .infinity, alignment: .trailing)

            GeometryReader { geometry in
                let w = geometry.size.width
                let axis = 42.0
                let x = { (au: Double) in min(au, self.sliceAu) / self.sliceAu * w }

                ZStack(alignment: .topLeading) {
                    if zone.innerAu < sliceAu {
                        Rectangle()
                            .fill(Color.green.opacity(0.16))
                            .frame(width: max(2, x(zone.outerAu) - x(zone.innerAu)), height: 40)
                            .offset(x: x(zone.innerAu), y: axis - 20)
                    }
                    Rectangle()
                        .fill(Color.white.opacity(0.15))
                        .frame(height: 1)
                        .offset(y: axis)
                    // The Sun at its real radius, on the same scale as the orbits.
                    RoundedRectangle(cornerRadius: 3)
                        .fill(Color.orange.opacity(0.85))
                        .frame(width: max(3, x(photosphereAu)), height: 28)
                        .offset(y: axis - 14)

                    ForEach(inner, id: \.self) { id in
                        let au = semiMajorAxisAt(id, ageGyr: ageGyr)
                        let gone = engulfedAt(id, ageGyr: ageGyr)
                        let at = x(au)
                        Circle()
                            .fill(gone ? Color.red.opacity(0.6) : Color.white)
                            .frame(width: 8, height: 8)
                            .offset(x: at - 4, y: axis - 4)
                        Text(bodyContracts[id]!.displayName)
                            .font(.system(size: 9))
                            .foregroundStyle(gone ? Color.red.opacity(0.8) : .secondary)
                            .fixedSize()
                            .offset(x: at - 24, y: axis - 34)
                        Text(String(format: "%.2f", au))
                            .font(.system(size: 8))
                            .foregroundStyle(.tertiary)
                            .fixedSize()
                            .offset(x: at - 12, y: axis + 12)
                    }
                }
            }
            .frame(height: 74)
        }
    }

    private var figures: some View {
        Grid(alignment: .leading, horizontalSpacing: 14, verticalSpacing: 4) {
            row("The Sun", phaseLabel + " · " + confidenceLabel)
            row("Brightness", sun.luminosity < 10
                ? String(format: "%.0f%% of today's", sun.luminosity * 100)
                : "\(Int(sun.luminosity.rounded()).formatted())x of today's")
            row("Size", (sun.radius < 10
                ? String(format: "%.2fx", sun.radius)
                : "\(Int(sun.radius.rounded()))x")
                + String(format: " today's radius, %@ K surface",
                         Int(sun.effectiveTemperatureK.rounded()).formatted()))
            row("Habitable zone", String(format: "%.2f to %.2f au", zone.innerAu, zone.outerAu))
        }
    }

    private var phaseLabel: String {
        switch sun.phase {
        case .mainSequence: return "Main sequence"
        case .subgiant: return "Subgiant"
        case .redGiant: return "Red giant"
        case .heliumBurning: return "Burning helium"
        case .whiteDwarf: return "White dwarf"
        }
    }

    /// Said out loud, because a model that interpolates and one that solves are different
    /// claims and a panel that presents them identically is overstating one of them.
    private var confidenceLabel: String {
        switch sun.confidence {
        case .modelled: return "modelled"
        case .interpolated: return "interpolated between published points"
        case .endState: return "end state, the phases before it are not modelled"
        }
    }

    private func row(_ name: String, _ value: String) -> some View {
        GridRow {
            Text(name).font(.caption).foregroundStyle(.secondary)
            Text(value).font(.caption.monospacedDigit())
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    private var fates: some View {
        VStack(spacing: 5) {
            ForEach(inner, id: \.self) { id in
                let fate = bodyFateAt(id, ageGyr: ageGyr)
                HStack {
                    Text(bodyContracts[id]!.displayName).font(.caption)
                    Spacer()
                    // The orbit and the year at that age, both moved by the Sun's mass loss.
                    Text(String(format: "%.2f au · %.2f yr",
                                semiMajorAxisAt(id, ageGyr: ageGyr),
                                orbitalPeriodAt(id, ageGyr: ageGyr)))
                        .font(.system(size: 10).monospacedDigit())
                        .foregroundStyle(.tertiary)
                    Text(fateText(fate)).font(.caption).foregroundStyle(fateColour(fate))
                }
                .padding(.horizontal, 10).padding(.vertical, 7)
                .background(.white.opacity(0.05), in: RoundedRectangle(cornerRadius: 8))
            }
        }
    }

    private func fateText(_ fate: BodyFate) -> String {
        switch fate {
        case .engulfed: return "inside the Sun"
        case .habitableZone: return "in the habitable zone"
        case .tooHot: return "too hot, inside the zone's inner edge"
        case .tooCold: return "too cold, beyond the outer edge"
        }
    }

    private func fateColour(_ fate: BodyFate) -> Color {
        switch fate {
        case .engulfed: return .red
        case .habitableZone: return .green
        default: return .secondary
        }
    }

    private var milestone: some View {
        VStack(alignment: .leading, spacing: 5) {
            Text(event.title).font(.system(size: 14, weight: .medium))
            Text(event.detail).font(.system(size: 12)).foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
            Text(event.source).font(.system(size: 10)).foregroundStyle(.tertiary)
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(.white.opacity(0.05), in: RoundedRectangle(cornerRadius: 10))
    }

    /**
     The number this panel exists for.

     Earth's oceans go about a billion years from now, and the Sun has five billion years of
     main sequence left after that. The red giant is the famous ending and it is not the one
     that matters to anything living here.
     */
    @ViewBuilder
    private var earthsDeadline: some View {
        if case let .crosses(fromNowGyr, _) = runawayGreenhouseCrossing(.embary) {
            let amount = fromNowGyr < 1
                ? String(format: "%.0f million", fromNowGyr * 1000)
                : String(format: "%.1f billion", fromNowGyr)
            Text("Earth leaves the habitable zone in about \(amount) years, and the Sun stays "
                 + String(format: "on the main sequence for %.1f billion years after that. ",
                          mainSequenceEndGyr - solarAgeNowGyr)
                 + "The oceans go first and the red giant is not what takes them.")
                .font(.system(size: 12))
                .foregroundStyle(.red.opacity(0.85))
                .fixedSize(horizontal: false, vertical: true)
        }
    }
}
