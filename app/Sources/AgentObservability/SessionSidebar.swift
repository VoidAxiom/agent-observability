import SwiftUI

struct SessionSidebar: View {
    let sessions: [SessionGroup]
    @Binding var selectedSessionId: String?
    let now: Date

    var body: some View {
        List(selection: $selectedSessionId) {
            ForEach(serviceNames, id: \.self) { serviceName in
                Section(serviceName) {
                    ForEach(sessionsByService[serviceName] ?? []) { session in
                        SessionSidebarRow(session: session, now: now)
                            .tag(Optional(session.id))
                    }
                }
            }
        }
        .navigationTitle("Sessions")
        .overlay {
            if sessions.isEmpty {
                Text("No sessions yet")
                    .foregroundStyle(.secondary)
            }
        }
    }

    private var sessionsByService: [String: [SessionGroup]] {
        Dictionary(grouping: sessions, by: \.serviceName)
    }

    private var serviceNames: [String] {
        let groupedSessions = sessionsByService

        return groupedSessions.keys.sorted(by: { lhs, rhs in
            let lhsLastActivity = groupedSessions[lhs]?.map(\.lastActivity).max()
            let rhsLastActivity = groupedSessions[rhs]?.map(\.lastActivity).max()

            switch (lhsLastActivity, rhsLastActivity) {
            case let (.some(lhsLastActivity), .some(rhsLastActivity)):
                if lhsLastActivity == rhsLastActivity {
                    return lhs < rhs
                }
                return lhsLastActivity > rhsLastActivity
            case (.some, .none):
                return true
            case (.none, .some):
                return false
            case (.none, .none):
                return lhs < rhs
            }
        })
    }
}

private struct SessionSidebarRow: View {
    let session: SessionGroup
    let now: Date

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 8) {
            Image(systemName: "circle.fill")
                .font(.caption2)
                .foregroundStyle(statusColor)

            VStack(alignment: .leading, spacing: 3) {
                Text(session.displayLabel)
                    .font(.headline)
                    .lineLimit(1)

                HStack(spacing: 8) {
                    Text("\(session.traceCount) traces")
                    Text("\(session.spanCount) spans")
                    if session.hasError {
                        Image(systemName: "exclamationmark.circle.fill")
                            .foregroundStyle(.red)
                    }
                }
                .font(.caption)
                .foregroundStyle(.secondary)

                Text(session.lastActivityText)
                    .font(.system(.caption2, design: .monospaced))
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }
        }
    }

    private var statusColor: Color {
        switch session.activityStatus(now: now) {
        case .active:
            .green
        case .idle:
            .yellow
        case .stale:
            .secondary
        }
    }
}
