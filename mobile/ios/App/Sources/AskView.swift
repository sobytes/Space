import SwiftUI
import SolarKit

/**
 Ask about the solar system.

 Calls the website's `/api/ask` rather than embedding a model key in a shipped binary, which
 is the only responsible option: a key in an app bundle is a key published to everyone who
 downloads it. That also means the phone inherits the tool surface the website already has,
 so `contracts/numbers-come-from-the-engine` holds here for free: the model narrates, the
 engine owns every figure, and the phone cannot route around it.

 The host defaults to a local dev server and is overridable, because this has no deployment
 yet and pretending otherwise would be the wrong kind of convenient.
 */
struct AskView: View {
    @Environment(\.dismiss) private var dismiss
    @AppStorage("solar.apiHost") private var host = "http://localhost:3000"
    @State private var question = ""
    @State private var answer = ""
    @State private var failure: String?
    @State private var asking = false

    var body: some View {
        NavigationStack {
            VStack(alignment: .leading, spacing: 12) {
                Text("Answers come from the same engine-backed tools the website uses. "
                     + "The model explains; it never produces a number.")
                    .font(.caption)
                    .foregroundStyle(.secondary)

                TextField("How far is Neptune right now?", text: $question, axis: .vertical)
                    .textFieldStyle(.roundedBorder)
                    .lineLimit(1 ... 3)
                    .onSubmit(ask)

                HStack {
                    Button(asking ? "Asking\u{2026}" : "Ask") { ask() }
                        .buttonStyle(.borderedProminent)
                        .disabled(asking || question.trimmingCharacters(in: .whitespaces).isEmpty)
                    Spacer()
                }

                if let failure {
                    VStack(alignment: .leading, spacing: 4) {
                        Text("Could not reach the engine").font(.caption.bold())
                        Text(failure).font(.caption).foregroundStyle(.secondary)
                        // Said plainly rather than silently answering from the model alone,
                        // which would break the rule this whole screen exists to keep.
                        Text("No answer is better than one the engine did not compute.")
                            .font(.caption)
                            .foregroundStyle(.orange)
                    }
                    .padding(10)
                    .background(.orange.opacity(0.1), in: RoundedRectangle(cornerRadius: 10))
                }

                ScrollView {
                    Text(answer)
                        .font(.callout)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .textSelection(.enabled)
                }

                Spacer()

                LabeledContent("Engine host") {
                    TextField("http://localhost:3000", text: $host)
                        .textFieldStyle(.roundedBorder)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .font(.caption)
                }
            }
            .padding()
            .navigationTitle("Ask")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { dismiss() }
                }
            }
        }
    }

    private func ask() {
        guard let url = URL(string: host.trimmingCharacters(in: .whitespaces) + "/api/ask") else {
            failure = "\(host) is not a URL I can use."
            return
        }
        asking = true
        answer = ""
        failure = nil
        let prompt = question

        Task {
            do {
                var request = URLRequest(url: url)
                request.httpMethod = "POST"
                request.setValue("application/json", forHTTPHeaderField: "Content-Type")
                request.httpBody = try JSONSerialization.data(
                    withJSONObject: ["messages": [["role": "user", "content": prompt]]]
                )
                request.timeoutInterval = 120

                // The route streams NDJSON, one JSON object per line.
                let (bytes, response) = try await URLSession.shared.bytes(for: request)
                if let http = response as? HTTPURLResponse, http.statusCode != 200 {
                    throw URLError(.badServerResponse, userInfo: [
                        NSLocalizedDescriptionKey: "The engine returned \(http.statusCode)."
                    ])
                }
                for try await line in bytes.lines {
                    guard let data = line.data(using: .utf8),
                          let object = try? JSONSerialization.jsonObject(with: data)
                            as? [String: Any] else { continue }
                    if let text = object["text"] as? String {
                        await MainActor.run { answer += text }
                    } else if let delta = object["delta"] as? String {
                        await MainActor.run { answer += delta }
                    }
                }
            } catch {
                await MainActor.run { failure = error.localizedDescription }
            }
            await MainActor.run { asking = false }
        }
    }
}
