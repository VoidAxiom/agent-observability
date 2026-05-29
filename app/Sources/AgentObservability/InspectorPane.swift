import SwiftUI

struct InspectorPane: View {
    let span: SpanRowModel?

    var body: some View {
        ScrollView {
            if let span {
                VStack(alignment: .leading, spacing: 16) {
                    VStack(alignment: .leading, spacing: 4) {
                        Text(span.SpanName)
                            .font(.title3)
                            .fontWeight(.semibold)
                        Text(span.ServiceName)
                            .foregroundStyle(.secondary)
                    }

                    AttributeSection(title: "Resource Attributes", attributes: span.ResourceAttributesRaw)
                    AttributeSection(title: "Span Attributes", attributes: span.SpanAttributesRaw)

                    VStack(alignment: .leading, spacing: 6) {
                        Text("Identity")
                            .font(.headline)
                        IdentityRow(label: "TraceId", value: span.TraceId)
                        IdentityRow(label: "SpanId", value: span.SpanId)
                        IdentityRow(label: "ParentSpanId", value: span.ParentSpanId)
                    }
                    .font(.system(.caption, design: .monospaced))
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding()
            } else {
                Text("Select a span")
                    .foregroundStyle(.secondary)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .padding()
            }
        }
    }
}

private struct AttributeSection: View {
    let title: String
    let attributes: [String: String]

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(title)
                .font(.headline)

            if attributes.isEmpty {
                Text("None")
                    .foregroundStyle(.secondary)
            } else {
                Grid(alignment: .leading, horizontalSpacing: 12, verticalSpacing: 6) {
                    ForEach(attributes.keys.sorted(), id: \.self) { key in
                        GridRow(alignment: .firstTextBaseline) {
                            Text(key)
                                .font(.system(.caption, design: .monospaced))
                                .foregroundStyle(.secondary)
                            Text(attributes[key] ?? "")
                                .font(.caption)
                                .textSelection(.enabled)
                        }
                    }
                }
            }
        }
    }
}

private struct IdentityRow: View {
    let label: String
    let value: String

    var body: some View {
        Grid(alignment: .leading, horizontalSpacing: 12, verticalSpacing: 6) {
            GridRow(alignment: .firstTextBaseline) {
                Text(label)
                    .foregroundStyle(.secondary)
                Text(value)
                    .textSelection(.enabled)
            }
        }
    }
}
