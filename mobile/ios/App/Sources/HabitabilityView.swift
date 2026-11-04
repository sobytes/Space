import SwiftUI
import SolarKit

/**
 What would it take to live here?

 The same panel as the website's, from the same source: every figure and every sentence comes
 out of SolarKit's habitability assessment, which is generated from the TypeScript engine. The
 two clients cannot quote a different mirror area or a different citation for the same body,
 and the feature contract records that this is why.
 */
struct HabitabilityView: View {
    @Environment(\.dismiss) private var dismiss
    let body_: BodyId

    private var assessment: HabitabilityAssessment { habitabilityFor(body_) }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 22) {
                    // Under the title rather than in the navigation bar's leading slot, where
                    // "Warm it and thicken it" rendered as "War...".
                    Text(assessment.strategy.label)
                        .font(.system(size: 11, weight: .medium))
                        .padding(.horizontal, 7).padding(.vertical, 3)
                        .background(.white.opacity(0.07), in: Capsule())
                        .foregroundStyle(.secondary)
                    Text(assessment.headline)
                        .font(.system(size: 13))
                        .foregroundStyle(.primary.opacity(0.85))

                    againstEarth
                    if !assessment.barriers.isEmpty { barriers }
                    ladder
                    caveats
                }
                .padding(16)
            }
            .navigationTitle(assessment.displayName)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Done") { dismiss() }
                }
            }
        }
    }

    // MARK: Against Earth

    private struct Comparison: Identifiable {
        let label: String
        let ratio: Double
        let value: String
        var id: String { label }
    }

    private var comparisons: [Comparison] {
        let s = assessment.state
        var rows = [
            Comparison(label: "Sunlight", ratio: s.solarConstantRelativeToEarth,
                       value: String(format: "%.0f W/m\u{00b2}", s.solarConstantWPerM2)),
            Comparison(label: "Gravity", ratio: s.gravityRelativeToEarth,
                       value: String(format: "%.2f m/s\u{00b2}", s.surfaceGravityMS2)),
            Comparison(label: "Surface temperature",
                       ratio: s.measuredSurfaceTemperatureK / Habitability.targetSurfaceTemperatureK,
                       value: String(format: "%.0f K", s.measuredSurfaceTemperatureK)),
            Comparison(label: "Surface pressure",
                       ratio: s.surfacePressurePa / Habitability.targetSurfacePressurePa,
                       value: s.surfacePressurePa > 0
                           ? formatQuantity(Quantity(label: "", value: s.surfacePressurePa, unit: "Pa"))
                           : "none"),
        ]
        if let dose = s.surfaceDoseSvPerYear, let relative = s.doseRelativeToEarth {
            rows.append(Comparison(
                label: "Radiation at the surface", ratio: relative,
                value: formatQuantity(Quantity(label: "", value: dose, unit: "Sv/yr"))
            ))
        }
        return rows
    }

    private var againstEarth: some View {
        VStack(alignment: .leading, spacing: 12) {
            sectionTitle("Where it stands, against Earth")
            ForEach(comparisons) { row in
                earthBar(row)
            }
            Text(standingNote)
                .font(.system(size: 11))
                .foregroundStyle(.secondary)
        }
    }

    private var standingNote: String {
        let zone = assessment.state.insideHabitableZone
            ? "This orbit is inside the conservative habitable zone."
            : "This orbit is outside the conservative habitable zone."
        return assessment.state.greenhouseSummary + " " + zone
    }

    /**
     A comparison against Earth, on a log scale.

     These quantities run from 0.14 of Earth's gravity to five million times its radiation. On
     a linear bar everything except the largest is indistinguishable from zero, which is the
     opposite of what a comparison is for. Earth sits at the centre and four decades either
     side covers every body in the registry.
     */
    private func earthBar(_ row: Comparison) -> some View {
        let clamped = min(max(row.ratio, 1e-4), 1e6)
        let fraction = log10(clamped) / 4
        let above = row.ratio > 1
        return VStack(alignment: .leading, spacing: 4) {
            HStack(alignment: .firstTextBaseline) {
                Text(row.label).font(.system(size: 11)).foregroundStyle(.secondary)
                Spacer()
                Text(row.value).font(.system(size: 11, design: .monospaced))
            }
            GeometryReader { geometry in
                let half = geometry.size.width / 2
                let width = max(1, abs(fraction) * half)
                ZStack(alignment: .leading) {
                    Capsule().fill(.white.opacity(0.07))
                    Rectangle().fill(.white.opacity(0.25)).frame(width: 1).offset(x: half)
                    Capsule()
                        .fill(above ? Color.orange.opacity(0.7) : Color.cyan.opacity(0.7))
                        .frame(width: width)
                        .offset(x: above ? half : half - width)
                }
            }
            .frame(height: 6)
            Text(ratioText(row.ratio))
                .font(.system(size: 10))
                .foregroundStyle(.tertiary)
        }
    }

    private func ratioText(_ ratio: Double) -> String {
        if ratio == 1 { return "same as Earth" }
        guard ratio.isFinite else { return "unbounded vs Earth" }
        if ratio >= 1000 || ratio <= 0.001 {
            return formatQuantity(Quantity(label: "", value: ratio, unit: "")) + "x Earth"
        }
        return String(format: ratio >= 10 ? "%.0fx Earth" : "%.2fx Earth", ratio)
    }

    // MARK: Barriers

    private func severityColour(_ severity: Severity) -> Color {
        switch severity {
        case .fatal: return .pink
        case .severe: return .orange
        case .manageable: return .cyan
        case .none: return .green
        }
    }

    private func severityLabel(_ severity: Severity) -> String {
        switch severity {
        case .fatal: return "No way round it"
        case .severe: return "Planetary scale"
        case .manageable: return "Buildable"
        case .none: return "Fine as it is"
        }
    }

    private var barriers: some View {
        VStack(alignment: .leading, spacing: 10) {
            sectionTitle("What stands in the way")
            ForEach(assessment.barriers, id: \.id) { barrier in
                let colour = severityColour(barrier.severity)
                VStack(alignment: .leading, spacing: 7) {
                    HStack(spacing: 6) {
                        Circle().fill(colour).frame(width: 6, height: 6)
                        Text(barrier.title).font(.system(size: 13, weight: .medium))
                        Spacer()
                        Text(severityLabel(barrier.severity))
                            .font(.system(size: 10))
                            .foregroundStyle(colour)
                    }
                    Text(barrier.statement)
                        .font(.system(size: 11))
                        .foregroundStyle(.secondary)
                    quantities(barrier.quantities)
                }
                .padding(12)
                .background(colour.opacity(0.06), in: RoundedRectangle(cornerRadius: 12))
                .overlay(
                    RoundedRectangle(cornerRadius: 12).stroke(colour.opacity(0.3), lineWidth: 1)
                )
            }
        }
    }

    // MARK: The ladder

    private func maturityLabel(_ maturity: Maturity) -> (String, Color) {
        switch maturity {
        case .demonstrated: return ("Demonstrated", .green)
        case .engineeringExtrapolation: return ("Extrapolated from built hardware", .cyan)
        case .speculative: return ("Speculative", .purple)
        }
    }

    private var ladder: some View {
        VStack(alignment: .leading, spacing: 20) {
            sectionTitle("How it could be done")
            ForEach(assessment.ladder, id: \.order) { step in
                let (label, colour) = maturityLabel(step.maturity)
                HStack(alignment: .top, spacing: 11) {
                    Text("\(step.order)")
                        .font(.system(size: 11, design: .monospaced))
                        .frame(width: 24, height: 24)
                        .overlay(Circle().stroke(.white.opacity(0.2), lineWidth: 1))
                    VStack(alignment: .leading, spacing: 7) {
                        Text(step.title).font(.system(size: 13, weight: .medium))
                        HStack(spacing: 6) {
                            Text(label)
                                .font(.system(size: 10))
                                .padding(.horizontal, 5).padding(.vertical, 2)
                                .background(colour.opacity(0.15), in: Capsule())
                                .foregroundStyle(colour)
                            Text(step.timescale)
                                .font(.system(size: 10))
                                .foregroundStyle(.tertiary)
                        }
                        Text(step.mechanism)
                            .font(.system(size: 12))
                            .foregroundStyle(.primary.opacity(0.8))
                        quantities(step.quantities)
                        Text(step.source)
                            .font(.system(size: 10))
                            .foregroundStyle(.tertiary)
                    }
                }
            }
        }
    }

    // MARK: Shared

    private func quantities(_ items: [Quantity]) -> some View {
        VStack(alignment: .leading, spacing: 5) {
            ForEach(items, id: \.label) { q in
                VStack(alignment: .leading, spacing: 1) {
                    Text(q.label.uppercased())
                        .font(.system(size: 9))
                        .foregroundStyle(.tertiary)
                    Text(formatQuantity(q)).font(.system(size: 11, design: .monospaced))
                    if let note = q.note {
                        Text(note).font(.system(size: 9)).foregroundStyle(.tertiary)
                    }
                }
                .padding(.leading, 8)
                .overlay(alignment: .leading) {
                    Rectangle().fill(.white.opacity(0.12)).frame(width: 1)
                }
            }
        }
        .padding(.top, 2)
    }

    private var caveats: some View {
        VStack(alignment: .leading, spacing: 6) {
            sectionTitle("What is not certain here")
            ForEach(assessment.caveats, id: \.self) { caveat in
                Text(caveat).font(.system(size: 11)).foregroundStyle(.secondary)
            }
        }
        .padding(12)
        .background(.white.opacity(0.03), in: RoundedRectangle(cornerRadius: 12))
    }

    private func sectionTitle(_ text: String) -> some View {
        Text(text.uppercased())
            .font(.system(size: 10, weight: .medium))
            .tracking(1.1)
            .foregroundStyle(.tertiary)
    }
}
