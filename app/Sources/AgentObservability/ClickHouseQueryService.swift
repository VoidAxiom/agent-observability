import Foundation

actor ClickHouseQueryService {
    private static let query = "SELECT TraceId, SpanId, SpanName, Timestamp, ServiceName FROM otel_traces ORDER BY Timestamp DESC LIMIT 50 FORMAT JSONEachRow"

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

        return responseText
            .split(separator: "\n", omittingEmptySubsequences: true)
            .compactMap { line in
                do {
                    return try decoder.decode(SpanRow.Model.self, from: Data(line.utf8))
                } catch {
                    print("[ClickHouseQueryService] \(error)")
                    return nil
                }
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
