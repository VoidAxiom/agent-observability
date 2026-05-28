import SwiftUI

struct ContentView: View {
    @State private var spans: [SpanRow.Model] = []

    var body: some View {
        List(spans) { span in
            SpanRow(model: span)
        }
        .overlay {
            if spans.isEmpty {
                Text("No spans yet")
                    .foregroundStyle(.secondary)
            }
        }
        .task {
            await subscribe()
        }
    }

    @MainActor
    private func subscribe() async {
        let service = ClickHouseQueryService()
        let stream = await service.updates()

        for await rows in stream {
            spans = rows
        }
    }
}
