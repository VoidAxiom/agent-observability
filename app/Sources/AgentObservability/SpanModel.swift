import Foundation

struct SpanRowModel: Codable, Identifiable {
    let TraceId: String
    let SpanId: String
    let SpanName: String
    let Timestamp: String
    let ServiceName: String
    let AgentProject: String
    let AgentSessionId: String
    let AgentRunId: String
    var id: String { TraceId + SpanId }
}

extension SpanRow {
    typealias Model = SpanRowModel
}
