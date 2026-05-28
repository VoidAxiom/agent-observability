import SwiftUI

struct SpanRow: View {
    let model: Model

    var body: some View {
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
    }
}
