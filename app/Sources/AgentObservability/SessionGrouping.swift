import Foundation

enum ActivityStatus: Equatable {
    case active
    case idle
    case stale
}

struct TraceGroup: Equatable, Identifiable {
    let traceId: String
    let displayLabel: String
    let rootStart: Date
    let rootStartText: String
    let lastActivity: Date
    let lastActivityText: String
    let spanCount: Int
    let durationSeconds: Double
    let hasError: Bool
    let spans: [SpanRowModel]

    var id: String { traceId }
}

struct SessionGroup: Equatable, Identifiable {
    let sessionKey: String
    let displayLabel: String
    let serviceName: String
    let projectName: String
    let lastActivity: Date
    let lastActivityText: String
    let spanCount: Int
    let traceCount: Int
    let durationSeconds: Double
    let hasError: Bool
    let traces: [TraceGroup]

    var id: String { sessionKey }

    func activityStatus(now: Date) -> ActivityStatus {
        let ageSeconds = now.timeIntervalSince(lastActivity)
        if ageSeconds <= 5 * 60 {
            return .active
        }
        if ageSeconds <= 60 * 60 {
            return .idle
        }
        return .stale
    }
}

enum SessionGrouping {
    struct Selection: Equatable {
        let selectedSessionId: String?
        let selectedTraceId: String?
        let selectedSpanId: String?
    }

    static func groupSpans(_ rows: [SpanRowModel]) -> [SessionGroup] {
        guard !rows.isEmpty else {
            return []
        }

        let rowsBySession = Dictionary(grouping: rows, by: effectiveSessionKey(for:))
        let sessions = rowsBySession.map { sessionKey, sessionRows in
            let traces = traceGroups(from: sessionRows)
            let sortedTraces = traces.sorted { lhs, rhs in
                if lhs.rootStart == rhs.rootStart {
                    return lhs.traceId < rhs.traceId
                }
                return lhs.rootStart > rhs.rootStart
            }

            let projectName = firstSortedNonEmpty(sessionRows.map(\.ProjectName))
                ?? firstSortedNonEmpty(sessionRows.map(\.AgentProject))
                ?? ""
            let serviceName = firstSortedNonEmpty(sessionRows.map(\.ServiceName)) ?? "unknown service"
            let dates = datedRows(sessionRows)
            let lastDate = dates.max(by: { $0.date < $1.date })
            let duration = durationSeconds(from: dates)

            return SessionGroup(
                sessionKey: sessionKey,
                displayLabel: displayLabel(projectName: projectName, key: sessionKey),
                serviceName: serviceName,
                projectName: projectName,
                lastActivity: lastDate?.date ?? .distantPast,
                lastActivityText: lastDate?.row.Timestamp ?? "",
                spanCount: sortedTraces.reduce(0) { $0 + $1.spanCount },
                traceCount: sortedTraces.count,
                durationSeconds: duration,
                hasError: sortedTraces.contains(where: \.hasError),
                traces: sortedTraces
            )
        }

        return sessions.sorted { lhs, rhs in
            if lhs.lastActivity == rhs.lastActivity {
                return lhs.sessionKey < rhs.sessionKey
            }
            return lhs.lastActivity > rhs.lastActivity
        }
    }

    static func reconcileSelection(
        in sessions: [SessionGroup],
        selectedSessionId: String?,
        selectedTraceId: String?,
        selectedSpanId: String?
    ) -> Selection {
        let sessionIds = Set(sessions.map(\.id))
        let traceIds = Set(sessions.flatMap { $0.traces.map(\.id) })
        let spanIds = Set(sessions.flatMap { session in
            session.traces.flatMap { trace in
                trace.spans.map(\.id)
            }
        })

        return Selection(
            selectedSessionId: selectedSessionId.flatMap { sessionIds.contains($0) ? $0 : nil },
            selectedTraceId: selectedTraceId.flatMap { traceIds.contains($0) ? $0 : nil },
            selectedSpanId: selectedSpanId.flatMap { spanIds.contains($0) ? $0 : nil }
        )
    }

    private static func traceGroups(from rows: [SpanRowModel]) -> [TraceGroup] {
        let rowsByTrace = Dictionary(grouping: rows, by: \.TraceId)
        return rowsByTrace.map { traceId, traceRows in
            let orderedRows = ClickHouseQueryService.computeTreeOrder(traceRows)
            let dates = datedRows(traceRows)
            let firstDate = dates.min(by: { $0.date < $1.date })
            let lastDate = dates.max(by: { $0.date < $1.date })
            let label = firstNonEmpty([orderedRows.first?.SpanName ?? ""])
                ?? firstNonEmpty([traceRows.sorted { lhs, rhs in
                    if lhs.Timestamp == rhs.Timestamp {
                        return lhs.SpanId < rhs.SpanId
                    }
                    return lhs.Timestamp < rhs.Timestamp
                }.first?.SpanName ?? ""])
                ?? shortKey(traceId)

            return TraceGroup(
                traceId: traceId,
                displayLabel: label,
                rootStart: firstDate?.date ?? .distantPast,
                rootStartText: firstDate?.row.Timestamp ?? "",
                lastActivity: lastDate?.date ?? .distantPast,
                lastActivityText: lastDate?.row.Timestamp ?? "",
                spanCount: orderedRows.count,
                durationSeconds: durationSeconds(from: dates),
                hasError: traceRows.contains(where: rowHasError),
                spans: orderedRows
            )
        }
    }

    private static func effectiveSessionKey(for row: SpanRowModel) -> String {
        firstNonEmpty([
            row.AgentSessionId,
            row.SessionId,
            row.AgentRunId,
            row.TraceId
        ]) ?? row.id
    }

    private static func rowHasError(_ row: SpanRowModel) -> Bool {
        if row.StatusCode.uppercased() == "ERROR" {
            return true
        }

        let attributes = row.ResourceAttributesRaw.merging(row.SpanAttributesRaw) { _, spanValue in spanValue }
        let statusCode = attributes["otel.status_code"] ?? attributes["status.code"] ?? ""
        if statusCode.uppercased() == "ERROR" {
            return true
        }
        if (attributes["error"] ?? "").lowercased() == "true" {
            return true
        }
        return attributes.keys.contains { $0.hasPrefix("exception.") }
    }

    private static func datedRows(_ rows: [SpanRowModel]) -> [(row: SpanRowModel, date: Date)] {
        rows.map { row in
            (row, parseTimestamp(row.Timestamp) ?? .distantPast)
        }
    }

    private static func durationSeconds(from dates: [(row: SpanRowModel, date: Date)]) -> Double {
        guard
            let first = dates.min(by: { $0.date < $1.date })?.date,
            let last = dates.max(by: { $0.date < $1.date })?.date,
            first != .distantPast,
            last != .distantPast
        else {
            return 0
        }

        return max(0, last.timeIntervalSince(first))
    }

    private static func displayLabel(projectName: String, key: String) -> String {
        let shortSession = shortKey(key)
        guard !projectName.isEmpty else {
            return shortSession
        }
        return "\(projectName) · \(shortSession)"
    }

    private static func shortKey(_ value: String) -> String {
        String(value.prefix(12))
    }

    private static func firstNonEmpty(_ values: [String]) -> String? {
        values.first { !$0.isEmpty }
    }

    private static func firstSortedNonEmpty(_ values: [String]) -> String? {
        values.filter { !$0.isEmpty }.sorted().first
    }

    private static func parseTimestamp(_ value: String) -> Date? {
        let normalized = normalizedTimestamp(value)
        let formatter = DateFormatter()
        formatter.calendar = Calendar(identifier: .gregorian)
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = TimeZone(secondsFromGMT: 0)
        formatter.dateFormat = "yyyy-MM-dd'T'HH:mm:ss.SSSXXXXX"
        return formatter.date(from: normalized)
    }

    private static func normalizedTimestamp(_ value: String) -> String {
        var timestamp = value.replacingOccurrences(of: " ", with: "T")
        if let fractionalStart = timestamp.firstIndex(of: ".") {
            let suffixStart = timestamp.index(after: fractionalStart)
            var fractional = ""
            var cursor = suffixStart
            while cursor < timestamp.endIndex, timestamp[cursor].isNumber {
                fractional.append(timestamp[cursor])
                cursor = timestamp.index(after: cursor)
            }

            let milliseconds = String(fractional.prefix(3)).padding(toLength: 3, withPad: "0", startingAt: 0)
            timestamp = "\(timestamp[..<fractionalStart]).\(milliseconds)\(timestamp[cursor...])"
        } else {
            timestamp += ".000"
        }

        if timestamp.last?.isNumber == true {
            timestamp += "Z"
        }

        return timestamp
    }
}
