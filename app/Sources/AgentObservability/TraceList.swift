import SwiftUI

struct TraceList: View {
    let session: SessionGroup?
    @Binding var selectedTraceId: String?

    var body: some View {
        List(selection: $selectedTraceId) {
            if let session {
                ForEach(session.traces) { trace in
                    TraceListRow(trace: trace)
                        .tag(Optional(trace.id))
                }
            }
        }
        .navigationTitle("Traces")
        .overlay {
            if session == nil {
                Text("Select a session")
                    .foregroundStyle(.secondary)
            } else if session?.traces.isEmpty == true {
                Text("No traces")
                    .foregroundStyle(.secondary)
            }
        }
    }
}

private struct TraceListRow: View {
    let trace: TraceGroup

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 8) {
            Image(systemName: trace.hasError ? "exclamationmark.circle.fill" : "checkmark.circle")
                .foregroundStyle(trace.hasError ? .red : .green)

            VStack(alignment: .leading, spacing: 3) {
                Text(trace.displayLabel)
                    .font(.headline)
                    .lineLimit(1)

                HStack(spacing: 8) {
                    Text("\(trace.spanCount) spans")
                    Text(durationText)
                }
                .font(.caption)
                .foregroundStyle(.secondary)

                Text(trace.traceId)
                    .font(.system(.caption2, design: .monospaced))
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }
        }
    }

    private var durationText: String {
        String(format: "%.3fs", trace.durationSeconds)
    }
}
