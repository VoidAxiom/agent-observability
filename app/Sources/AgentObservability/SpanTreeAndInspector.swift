import SwiftUI

struct SpanTreeAndInspector: View {
    let trace: TraceGroup?
    @Binding var selectedSpanId: String?

    var body: some View {
        HSplitView {
            List(selection: $selectedSpanId) {
                if let trace {
                    ForEach(trace.spans) { span in
                        SpanRow(model: span)
                            .tag(Optional(span.id))
                    }
                }
            }
            .frame(minWidth: 360)
            .navigationTitle("Spans")
            .overlay {
                if trace == nil {
                    Text("Select a trace")
                        .foregroundStyle(.secondary)
                } else if trace?.spans.isEmpty == true {
                    Text("No spans")
                        .foregroundStyle(.secondary)
                }
            }

            InspectorPane(span: selectedSpan)
                .frame(minWidth: 300, idealWidth: 360)
        }
    }

    private var selectedSpan: SpanRowModel? {
        trace?.spans.first { $0.id == selectedSpanId }
    }
}
