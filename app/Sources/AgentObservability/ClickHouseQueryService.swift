import Foundation

actor ClickHouseQueryService {
    private static let query = """
    SELECT
      TraceId, SpanId, ParentSpanId, SpanName, Timestamp, ServiceName,
      ResourceAttributes['agent.project']    AS AgentProject,
      ResourceAttributes['agent.session.id'] AS AgentSessionId,
      SpanAttributes['agent.run.id']         AS AgentRunId
    FROM otel_traces
    ORDER BY Timestamp DESC
    LIMIT 50
    FORMAT JSONEachRow
    """

    private let endpointURL: URL?
    private let authorizationHeader: String

    init() {
        let environment = ProcessInfo.processInfo.environment
        let host = environment["CH_HOST"] ?? "localhost"
        let port = Int(environment["CH_HTTP_PORT"] ?? "") ?? 8123
        let database = environment["CH_DATABASE"] ?? "default"
        let username = environment["CH_USERNAME"] ?? "default"
        let password = environment["CH_PASSWORD"] ?? ""

        var components = URLComponents()
        components.scheme = "http"
        components.host = host
        components.port = port
        components.path = "/"
        components.queryItems = [
            URLQueryItem(name: "database", value: database)
        ]
        self.endpointURL = components.url

        let credentials = "\(username):\(password)"
        self.authorizationHeader = "Basic \(Data(credentials.utf8).base64EncodedString())"
    }

    func updates() -> AsyncStream<[SpanRow.Model]> {
        AsyncStream { continuation in
            let task = Task {
                while !Task.isCancelled {
                    do {
                        let rows = try await self.fetchOnce()
                        continuation.yield(rows)
                    } catch {
                        // Deliberate per spec § 5: yield([]) on error to keep UI responsive;
                        // flicker > stale-with-no-signal for M0 (operator must never
                        // mistake stale data for fresh). Revisit in M4 polish with a
                        // stale-bit or error banner.
                        print("[ClickHouseQueryService] \(error)")
                        continuation.yield([])
                    }

                    try? await Task.sleep(nanoseconds: 5_000_000_000)
                }
            }

            continuation.onTermination = { _ in
                task.cancel()
            }
        }
    }

    private func fetchOnce() async throws -> [SpanRow.Model] {
        guard let endpointURL else {
            throw ClickHouseQueryServiceError.invalidURL
        }

        var request = URLRequest(url: endpointURL)
        request.httpMethod = "POST"
        request.httpBody = Data(Self.query.utf8)
        request.setValue("text/plain; charset=UTF-8", forHTTPHeaderField: "Content-Type")
        request.setValue(authorizationHeader, forHTTPHeaderField: "Authorization")

        let (data, response) = try await URLSession.shared.data(for: request)
        guard let httpResponse = response as? HTTPURLResponse else {
            throw ClickHouseQueryServiceError.invalidResponse
        }

        guard (200..<300).contains(httpResponse.statusCode) else {
            throw ClickHouseQueryServiceError.httpStatus(httpResponse.statusCode)
        }

        return Self.decodeRows(from: data)
    }

    private static func decodeRows(from data: Data) -> [SpanRow.Model] {
        let decoder = JSONDecoder()
        let responseText = String(decoding: data, as: UTF8.self)

        let rows = responseText
            .split(separator: "\n", omittingEmptySubsequences: true)
            .compactMap { line in
                do {
                    return try decoder.decode(SpanRow.Model.self, from: Data(line.utf8))
                } catch {
                    print("[ClickHouseQueryService] \(error)")
                    return nil
                }
            }

        return computeTreeOrder(rows)
    }

    internal static func computeTreeOrder(_ rows: [SpanRowModel]) -> [SpanRowModel] {
        guard !rows.isEmpty else {
            return []
        }

        var childrenByParent: [SpanTreeIdentity: [SpanRowModel]] = [:]
        for row in rows {
            childrenByParent[SpanTreeIdentity(traceId: row.TraceId, spanId: row.ParentSpanId), default: []].append(row)
        }

        let spanIds = Set(rows.map(SpanTreeIdentity.init(row:)))
        func sortedByTimestamp(_ rows: [SpanRowModel]) -> [SpanRowModel] {
            rows.enumerated()
                .sorted { lhs, rhs in
                    if lhs.element.Timestamp == rhs.element.Timestamp {
                        return lhs.offset < rhs.offset
                    }
                    return lhs.element.Timestamp < rhs.element.Timestamp
                }
                .map(\.element)
        }

        let roots = sortedByTimestamp(rows
            .filter { row in
                let parentIdentity = SpanTreeIdentity(traceId: row.TraceId, spanId: row.ParentSpanId)
                return row.ParentSpanId.isEmpty
                    || row.ParentSpanId == "0000000000000000"
                    || !spanIds.contains(parentIdentity)
            })

        let maxDepth = min(50, rows.count)
        var visitedSpanIds = Set<SpanTreeIdentity>()
        var orderedRows: [SpanRowModel] = []
        orderedRows.reserveCapacity(rows.count)

        func visit(_ node: SpanRowModel, depth: Int) {
            guard depth < maxDepth else {
                return
            }

            let nodeIdentity = SpanTreeIdentity(row: node)
            guard !visitedSpanIds.contains(nodeIdentity) else {
                return
            }
            visitedSpanIds.insert(nodeIdentity)

            var row = node
            row.depth = depth
            orderedRows.append(row)

            let children = sortedByTimestamp(childrenByParent[nodeIdentity] ?? [])
            for child in children {
                visit(child, depth: depth + 1)
            }
        }

        for root in roots {
            visit(root, depth: 0)
        }

        return orderedRows
    }

    private struct SpanTreeIdentity: Hashable {
        let traceId: String
        let spanId: String

        init(traceId: String, spanId: String) {
            self.traceId = traceId
            self.spanId = spanId
        }

        init(row: SpanRowModel) {
            self.init(traceId: row.TraceId, spanId: row.SpanId)
        }
    }
}

private enum ClickHouseQueryServiceError: Error, CustomStringConvertible {
    case invalidURL
    case invalidResponse
    case httpStatus(Int)

    var description: String {
        switch self {
        case .invalidURL:
            "invalid ClickHouse URL"
        case .invalidResponse:
            "invalid ClickHouse HTTP response"
        case .httpStatus(let statusCode):
            "ClickHouse HTTP status \(statusCode)"
        }
    }
}
