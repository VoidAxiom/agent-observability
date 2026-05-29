import SwiftUI

struct ContentView: View {
    @State private var sessions: [SessionGroup] = []
    @State private var selectedSessionId: String?
    @State private var selectedTraceId: String?
    @State private var selectedSpanId: String?
    @State private var activityNow = Date()

    var body: some View {
        NavigationSplitView {
            SessionSidebar(
                sessions: sessions,
                selectedSessionId: $selectedSessionId,
                now: activityNow
            )
        } content: {
            TraceList(
                session: selectedSession,
                selectedTraceId: $selectedTraceId
            )
        } detail: {
            SpanTreeAndInspector(
                trace: selectedTrace,
                selectedSpanId: $selectedSpanId
            )
        }
        .onChange(of: sessions) { _, newSessions in
            guard !newSessions.isEmpty else {
                return
            }

            let selection = SessionGrouping.reconcileSelection(
                in: newSessions,
                selectedSessionId: selectedSessionId,
                selectedTraceId: selectedTraceId,
                selectedSpanId: selectedSpanId
            )
            selectedSessionId = selection.selectedSessionId
            selectedTraceId = selection.selectedTraceId
            selectedSpanId = selection.selectedSpanId
        }
        .onChange(of: selectedSessionId) {
            selectedTraceId = nil
            selectedSpanId = nil
        }
        .onChange(of: selectedTraceId) {
            selectedSpanId = nil
        }
        .task {
            await subscribe()
        }
    }

    private var selectedSession: SessionGroup? {
        sessions.first { $0.id == selectedSessionId }
    }

    private var selectedTrace: TraceGroup? {
        selectedSession?.traces.first { $0.id == selectedTraceId }
    }

    @MainActor
    private func subscribe() async {
        let service = ClickHouseQueryService()
        let stream = await service.updates()

        for await rows in stream {
            activityNow = Date()
            sessions = SessionGrouping.groupSpans(rows)
        }
    }
}
