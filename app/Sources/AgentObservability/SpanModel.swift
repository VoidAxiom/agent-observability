import Foundation

struct SpanRowModel: Codable, Equatable, Identifiable {
    let TraceId: String
    let SpanId: String
    let ParentSpanId: String
    let SpanName: String
    let Timestamp: String
    let ServiceName: String
    let StatusCode: String
    let AgentProject: String
    let AgentSessionId: String
    let AgentRunId: String
    let SessionId: String
    let ProjectName: String
    let ResourceAttributesRaw: [String: String]
    let SpanAttributesRaw: [String: String]
    var depth = 0

    var id: String { TraceId + SpanId }

    private enum CodingKeys: String, CodingKey {
        case TraceId
        case SpanId
        case ParentSpanId
        case SpanName
        case Timestamp
        case ServiceName
        case StatusCode
        case AgentProject
        case AgentSessionId
        case AgentRunId
        case SessionId
        case ProjectName
        case ResourceAttributesRaw
        case SpanAttributesRaw
    }
}

extension SpanRow {
    typealias Model = SpanRowModel
}

extension SpanRowModel {
    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        TraceId = try container.decodeIfPresent(String.self, forKey: .TraceId) ?? ""
        SpanId = try container.decodeIfPresent(String.self, forKey: .SpanId) ?? ""
        ParentSpanId = try container.decodeIfPresent(String.self, forKey: .ParentSpanId) ?? ""
        SpanName = try container.decodeIfPresent(String.self, forKey: .SpanName) ?? ""
        Timestamp = try container.decodeIfPresent(String.self, forKey: .Timestamp) ?? ""
        ServiceName = try container.decodeIfPresent(String.self, forKey: .ServiceName) ?? ""
        StatusCode = try container.decodeIfPresent(String.self, forKey: .StatusCode) ?? ""
        AgentProject = try container.decodeIfPresent(String.self, forKey: .AgentProject) ?? ""
        AgentSessionId = try container.decodeIfPresent(String.self, forKey: .AgentSessionId) ?? ""
        AgentRunId = try container.decodeIfPresent(String.self, forKey: .AgentRunId) ?? ""
        SessionId = try container.decodeIfPresent(String.self, forKey: .SessionId) ?? ""
        ProjectName = try container.decodeIfPresent(String.self, forKey: .ProjectName) ?? ""
        ResourceAttributesRaw = try container.decodeIfPresent([String: String].self, forKey: .ResourceAttributesRaw) ?? [:]
        SpanAttributesRaw = try container.decodeIfPresent([String: String].self, forKey: .SpanAttributesRaw) ?? [:]
    }
}
