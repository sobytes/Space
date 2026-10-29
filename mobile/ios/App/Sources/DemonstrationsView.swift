import SwiftUI
import SolarKit

/**
 The demonstrations, each run on demand against the value it names.

 Nothing is precomputed or hardcoded. Tapping one calls into SolarKit and shows what came
 back, including the control and the caveats, because a measurement without its control and
 its limits is a claim rather than evidence.
 */
struct DemonstrationsView: View {
    @Environment(\.dismiss) private var dismiss
    @State private var results: [String: DemonstrationResult] = [:]
    @State private var running: String?

    var body: some View {
        NavigationStack {
            List {
                ForEach(demonstrations, id: \.id) { demonstration in
                    Section {
                        Text(demonstration.question)
                            .font(.subheadline)
                            .foregroundStyle(.orange)

                        Text(demonstration.history)
                            .font(.caption)
                            .foregroundStyle(.secondary)

                        LabeledContent("Published") {
                            Text(String(format: "%.4g %@",
                                        demonstration.published.value, demonstration.published.unit))
                                .font(.caption.monospacedDigit())
                        }
                        Text(demonstration.published.source)
                            .font(.system(size: 10))
                            .foregroundStyle(.secondary)

                        if let result = results[demonstration.id] {
                            resultView(demonstration, result)
                        } else {
                            Button(running == demonstration.id ? "Running\u{2026}" : "Run it") {
                                running = demonstration.id
                                // Off the main thread: Mercury integrates 60 orbits.
                                Task.detached(priority: .userInitiated) {
                                    let result = demonstration.run()
                                    await MainActor.run {
                                        results[demonstration.id] = result
                                        running = nil
                                    }
                                }
                            }
                            .disabled(running != nil)
                        }
                    } header: {
                        Text(demonstration.title)
                    } footer: {
                        Text(demonstration.attribution)
                    }
                }
            }
            .navigationTitle("Demonstrations")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { dismiss() }
                }
            }
        }
    }

    @ViewBuilder
    private func resultView(_ d: Demonstration, _ result: DemonstrationResult) -> some View {
        let error = abs(result.measured - d.published.value) / abs(d.published.value)
        let passed = error <= d.published.tolerance

        LabeledContent("Measured") {
            Text(String(format: "%.4f", result.measured))
                .font(.caption.monospacedDigit())
                .foregroundStyle(passed ? .green : .red)
        }
        LabeledContent("Agreement") {
            Text(String(format: "%.3f%% from published", error * 100))
                .font(.caption.monospacedDigit())
        }

        if let control = result.control {
            LabeledContent(control.label) {
                Text(String(format: "%.4f", control.value))
                    .font(.caption.monospacedDigit())
                    .foregroundStyle(.secondary)
            }
        }

        ForEach(result.rows, id: \.label) { row in
            LabeledContent(row.label) {
                Text(row.value).font(.caption.monospacedDigit()).foregroundStyle(.secondary)
            }
        }

        ForEach(result.caveats, id: \.self) { caveat in
            Text("\u{2014}  " + caveat)
                .font(.system(size: 10))
                .foregroundStyle(.secondary)
        }
    }
}
