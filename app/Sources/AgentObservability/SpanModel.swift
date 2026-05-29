import Foundation

struct SpanRowModel: Codable, Identifiable {
    let TraceId: String
    let SpanId: String
    let ParentSpanId: String
    let SpanName: String
    let Timestamp: String
    let ServiceName: String
    let AgentProject: String
    let AgentSessionId: String
    let AgentRunId: String
    var depth = 0

    var id: String { TraceId + SpanId }

    private enum CodingKeys: String, CodingKey {
        case TraceId
        case SpanId
        case ParentSpanId
        case SpanName
        case Timestamp
        case ServiceName
        case AgentProject
        case AgentSessionId
        case AgentRunId
    }
}

extension SpanRow {
    typealias Model = SpanRowModel
}
