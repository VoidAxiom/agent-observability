import SwiftUI

struct SpanRow: View {
    let model: Model

    var body: some View {
        VStack(alignment: .leading) {
            HStack {
                Text(model.TraceId.prefix(8))
                Text(model.SpanName)
                    .font(.headline)
                Spacer()
                Text(model.ServiceName)
                    .foregroundStyle(.secondary)
                Text(model.Timestamp)
                    .foregroundStyle(.secondary)
                    .font(.caption)
            }

            if let provenanceText {
                Text(provenanceText)
                    .font(.system(.caption, design: .monospaced))
                    .foregroundStyle(.secondary)
            }
        }
    }

    private var provenanceText: String? {
        let values = [
            model.AgentProject,
            String(model.AgentSessionId.prefix(8)),
            model.AgentRunId
        ].filter { !$0.isEmpty }

        guard !values.isEmpty else {
            return nil
        }

        return values.joined(separator: " · ")
    }
}
