import Testing
@testable import AgentObservability

@Test func emptyInputReturnsEmpty() {
    #expect(ClickHouseQueryService.computeTreeOrder([]).isEmpty)
}

@Test func allRootsAreSortedByTimestampAscending() {
    let rows = [
        span(spanId: "root-b", timestamp: "2026-01-01T00:00:02.000000000"),
        span(spanId: "root-a", timestamp: "2026-01-01T00:00:01.000000000")
    ]

    let ordered = ClickHouseQueryService.computeTreeOrder(rows)

    #expect(spanIds(ordered) == ["root-a", "root-b"])
    #expect(depths(ordered) == [0, 0])
}

@Test func linearChainGetsIncreasingDepth() {
    let rows = [
        span(spanId: "grandchild", parentSpanId: "child", timestamp: "2026-01-01T00:00:03.000000000"),
        span(spanId: "root", timestamp: "2026-01-01T00:00:01.000000000"),
        span(spanId: "child", parentSpanId: "root", timestamp: "2026-01-01T00:00:02.000000000")
    ]

    let ordered = ClickHouseQueryService.computeTreeOrder(rows)

    #expect(spanIds(ordered) == ["root", "child", "grandchild"])
    #expect(depths(ordered) == [0, 1, 2])
}

@Test func deepLinearChainBeyond50IsRenderedInFull() {
    let rows = (0..<75).reversed().map { index in
        let milliseconds = String(String(1000 + index).dropFirst())
        return span(
            spanId: "span-\(index)",
            parentSpanId: index == 0 ? "" : "span-\(index - 1)",
            timestamp: "2026-01-01T00:00:00.\(milliseconds)000000"
        )
    }

    let ordered = ClickHouseQueryService.computeTreeOrder(rows)

    #expect(spanIds(ordered) == (0..<75).map { "span-\($0)" })
    #expect(depths(ordered) == Array(0..<75))
}

@Test func multipleRootsUsePreorderWithSiblingsSortedByTimestamp() {
    let rows = [
        span(spanId: "root-a", timestamp: "2026-01-01T00:00:02.000000000"),
        span(spanId: "root-a-later-child", parentSpanId: "root-a", timestamp: "2026-01-01T00:00:04.000000000"),
        span(spanId: "root-b-child", parentSpanId: "root-b", timestamp: "2026-01-01T00:00:05.000000000"),
        span(spanId: "root-a-earlier-child", parentSpanId: "root-a", timestamp: "2026-01-01T00:00:03.000000000"),
        span(spanId: "root-b", timestamp: "2026-01-01T00:00:01.000000000")
    ]

    let ordered = ClickHouseQueryService.computeTreeOrder(rows)

    #expect(
        spanIds(ordered) == ["root-b", "root-b-child", "root-a", "root-a-earlier-child", "root-a-later-child"]
    )
    #expect(depths(ordered) == [0, 1, 0, 1, 1])
}

@Test func orphanWithMissingParentIsTreatedAsRoot() {
    let rows = [
        span(spanId: "orphan-child", parentSpanId: "orphan", timestamp: "2026-01-01T00:00:02.000000000"),
        span(spanId: "orphan", parentSpanId: "missing-parent", timestamp: "2026-01-01T00:00:01.000000000")
    ]

    let ordered = ClickHouseQueryService.computeTreeOrder(rows)

    #expect(spanIds(ordered) == ["orphan", "orphan-child"])
    #expect(depths(ordered) == [0, 1])
}

@Test func zeroParentSpanIdIsTreatedAsRoot() {
    let rows = [
        span(spanId: "child", parentSpanId: "root", timestamp: "2026-01-01T00:00:02.000000000"),
        span(
            spanId: "root",
            parentSpanId: "0000000000000000",
            timestamp: "2026-01-01T00:00:01.000000000"
        )
    ]

    let ordered = ClickHouseQueryService.computeTreeOrder(rows)

    #expect(spanIds(ordered) == ["root", "child"])
    #expect(depths(ordered) == [0, 1])
}

@Test func cycleDoesNotRecurseForever() {
    let rows = [
        span(spanId: "a", parentSpanId: "b", timestamp: "2026-01-01T00:00:01.000000000"),
        span(spanId: "b", parentSpanId: "a", timestamp: "2026-01-01T00:00:02.000000000")
    ]

    let ordered = ClickHouseQueryService.computeTreeOrder(rows)

    #expect(ordered.isEmpty)
}

@Test func cycleOnlyTraceReportsZeroSpanCount() {
    let sessions = SessionGrouping.groupSpans([
        span(spanId: "a", parentSpanId: "b", timestamp: "2026-01-01T00:00:01.000000000"),
        span(spanId: "b", parentSpanId: "a", timestamp: "2026-01-01T00:00:02.000000000")
    ])

    let trace = sessions.first?.traces.first

    // Cycle-only traces remain visible as trace shells, but counts match the empty ordered span list.
    #expect(trace?.spanCount == 0)
    #expect(trace?.spans.isEmpty == true)
}

@Test func stableIdUsesTraceAndSpanIdsAfterTreeOrdering() {
    let rows = [
        span(traceId: "trace-", spanId: "child", parentSpanId: "root", timestamp: "2026-01-01T00:00:02.000000000"),
        span(traceId: "trace-", spanId: "root", timestamp: "2026-01-01T00:00:01.000000000")
    ]

    let ordered = ClickHouseQueryService.computeTreeOrder(rows)

    #expect(ordered.map(\.id) == ["trace-root", "trace-child"])
}

@Test func treeBookkeepingIsScopedByTraceWhenSpanIdsCollide() {
    let rows = [
        span(traceId: "trace-b", spanId: "shared", timestamp: "2026-01-01T00:00:01.000000000"),
        span(traceId: "trace-a", spanId: "child", parentSpanId: "shared", timestamp: "2026-01-01T00:00:02.000000000"),
        span(traceId: "trace-a", spanId: "shared", timestamp: "2026-01-01T00:00:03.000000000")
    ]

    let ordered = ClickHouseQueryService.computeTreeOrder(rows)

    #expect(ordered.map { "\($0.TraceId):\($0.SpanId)" } == [
        "trace-b:shared",
        "trace-a:shared",
        "trace-a:child"
    ])
    #expect(depths(ordered) == [0, 0, 1])
}

@Test func spanModelDecodesSessionProjectAndRawAttributeMaps() {
    let json = """
    {
      "TraceId": "trace",
      "SpanId": "span",
      "ParentSpanId": "",
      "SpanName": "operation",
      "Timestamp": "2026-01-01T00:00:01.000000000",
      "ServiceName": "service",
      "StatusCode": "Ok",
      "Duration": "5000000000",
      "AgentProject": "agent-project",
      "AgentSessionId": "agent-session",
      "AgentRunId": "run",
      "SessionId": "span-session",
      "ProjectName": "project-name",
      "ResourceAttributesRaw": {"service.name": "service", "project.name": "project-name"},
      "SpanAttributesRaw": {"session.id": "span-session", "otel.status_code": "OK"}
    }
    """

    let rows = ClickHouseQueryService.decodeRows(fromText: json)
    #expect(rows.count == 1)
    let decoded = rows[0]

    #expect(decoded.SessionId == "span-session")
    #expect(decoded.Duration == 5_000_000_000)
    #expect(decoded.ProjectName == "project-name")
    #expect(decoded.ResourceAttributesRaw["project.name"] == "project-name")
    #expect(decoded.SpanAttributesRaw["session.id"] == "span-session")
    #expect(decoded.depth == 0)
}

@Test func decodeToleratesNullForOptionalishFields() {
    let json = """
    {
      "TraceId": "trace",
      "SpanId": "span",
      "ParentSpanId": "",
      "SpanName": "operation",
      "Timestamp": "2026-01-01T00:00:01.000000000",
      "ServiceName": "service",
      "StatusCode": null,
      "Duration": null,
      "AgentProject": "agent-project",
      "AgentSessionId": "agent-session",
      "AgentRunId": "run",
      "SessionId": null,
      "ProjectName": null,
      "ResourceAttributesRaw": null,
      "SpanAttributesRaw": null
    }
    """

    let rows = ClickHouseQueryService.decodeRows(fromText: json)

    #expect(rows.count == 1)
    #expect(rows.first?.StatusCode == "")
    #expect(rows.first?.Duration == 0)
    #expect(rows.first?.SessionId == "")
    #expect(rows.first?.ProjectName == "")
    #expect(rows.first?.ResourceAttributesRaw == [:])
    #expect(rows.first?.SpanAttributesRaw == [:])
}

@Test func groupSpansUsesAgentSessionIdAsEffectiveSessionKey() {
    let sessions = SessionGrouping.groupSpans([
        span(
            spanId: "root",
            timestamp: "2026-01-01T00:00:01.000000000",
            agentSessionId: "agent-1",
            sessionId: "span-1",
            projectName: "project-name"
        )
    ])

    #expect(sessions.map(\.id) == ["agent-1"])
    #expect(sessions.first?.displayLabel == "project-name · agent-1")
}

@Test func groupSpansUsesSpanSessionIdWhenAgentSessionIdIsMissing() {
    let sessions = SessionGrouping.groupSpans([
        span(
            spanId: "root",
            timestamp: "2026-01-01T00:00:01.000000000",
            agentSessionId: "",
            sessionId: "span-session"
        )
    ])

    #expect(sessions.map(\.id) == ["span-session"])
}

@Test func groupSpansFallsBackToRunIdThenTraceIdForSessionKey() {
    let sessions = SessionGrouping.groupSpans([
        span(
            traceId: "trace-fallback",
            spanId: "trace-root",
            timestamp: "2026-01-01T00:00:02.000000000",
            agentSessionId: "",
            agentRunId: "",
            sessionId: ""
        ),
        span(
            traceId: "trace-run",
            spanId: "run-root",
            timestamp: "2026-01-01T00:00:01.000000000",
            agentSessionId: "",
            agentRunId: "run-1",
            sessionId: ""
        )
    ])

    #expect(sessions.map(\.id) == ["trace-fallback", "run-1"])
}

@Test func groupSpansComputesSessionRollupsFromRows() {
    let sessions = SessionGrouping.groupSpans([
        span(traceId: "trace-a", spanId: "a-root", timestamp: "2026-01-01T00:00:00.000000000"),
        span(
            traceId: "trace-a",
            spanId: "a-child",
            parentSpanId: "a-root",
            timestamp: "2026-01-01T00:00:03.000000000",
            spanAttributesRaw: ["otel.status_code": "ERROR"]
        ),
        span(traceId: "trace-b", spanId: "b-root", timestamp: "2026-01-01T00:00:07.000000000")
    ])

    let session = sessions.first

    #expect(sessions.count == 1)
    #expect(session?.spanCount == 3)
    #expect(session?.traceCount == 2)
    #expect(session?.hasError == true)
    #expect(session?.lastActivityText == "2026-01-01T00:00:07.000000000")
    #expect(session?.durationSeconds == 7) // 00:00:07 - 00:00:00 = 7s.
}

@Test func sessionSpanCountSumsAcrossTraces() {
    let sessions = SessionGrouping.groupSpans([
        span(traceId: "normal-trace", spanId: "root", timestamp: "2026-01-01T00:00:00.000000000"),
        span(
            traceId: "normal-trace",
            spanId: "child",
            parentSpanId: "root",
            timestamp: "2026-01-01T00:00:01.000000000"
        ),
        span(
            traceId: "normal-trace",
            spanId: "grandchild",
            parentSpanId: "child",
            timestamp: "2026-01-01T00:00:02.000000000"
        ),
        span(traceId: "cycle-trace", spanId: "a", parentSpanId: "b", timestamp: "2026-01-01T00:00:03.000000000"),
        span(traceId: "cycle-trace", spanId: "b", parentSpanId: "a", timestamp: "2026-01-01T00:00:04.000000000")
    ])

    let session = sessions.first

    #expect(sessions.count == 1)
    #expect(session?.traceCount == 2)
    #expect(session?.spanCount == 3)
}

@Test func hasErrorWhenStatusCodeIsError() {
    let sessions = SessionGrouping.groupSpans([
        span(
            spanId: "root",
            timestamp: "2026-01-01T00:00:00.000000000",
            statusCode: "Error"
        )
    ])

    let session = sessions.first
    let trace = session?.traces.first

    #expect(sessions.count == 1)
    #expect(trace?.hasError == true)
    #expect(session?.hasError == true)
}

@Test func groupSpansComputesTraceRollupsAndOrderedSpans() {
    let sessions = SessionGrouping.groupSpans([
        span(
            spanId: "child",
            parentSpanId: "root",
            timestamp: "2026-01-01T00:00:03.000000000"
        ),
        span(spanId: "root", timestamp: "2026-01-01T00:00:01.000000000")
    ])

    let trace = sessions.first?.traces.first

    #expect(trace?.displayLabel == "root")
    #expect(trace?.spanCount == 2)
    #expect(trace?.durationSeconds == 2) // 00:00:03 - 00:00:01 = 2s.
    #expect(trace?.spans.map(\.SpanId) == ["root", "child"])
    #expect(trace?.spans.map(\.depth) == [0, 1])
}

@Test func traceDurationUsesSpanDurationForSingleLongSpan() {
    let sessions = SessionGrouping.groupSpans([
        span(
            spanId: "root",
            timestamp: "2026-01-01T00:00:00.000000000",
            duration: 5_000_000_000
        )
    ])

    let trace = sessions.first?.traces.first

    #expect(abs((trace?.durationSeconds ?? 0) - 5.0) < 0.001)
}

@Test func traceDurationAccountsForLongChildStartingBeforeLastChild() {
    let sessions = SessionGrouping.groupSpans([
        span(
            spanId: "root",
            timestamp: "2026-01-01T00:00:00.000000000",
            duration: 0
        ),
        span(
            spanId: "child-a",
            parentSpanId: "root",
            timestamp: "2026-01-01T00:00:01.000000000",
            duration: 10_000_000_000
        ),
        span(
            spanId: "child-b",
            parentSpanId: "root",
            timestamp: "2026-01-01T00:00:02.000000000",
            duration: 1_000_000_000
        )
    ])

    let trace = sessions.first?.traces.first

    #expect(abs((trace?.durationSeconds ?? 0) - 11.0) < 0.001)
}

@Test func traceDisplayLabelFallsBackWhenSpanNameIsEmpty() {
    let traceId = "trace-empty-name"
    let sessions = SessionGrouping.groupSpans([
        span(
            traceId: traceId,
            spanId: "root",
            spanName: "",
            timestamp: "2026-01-01T00:00:01.000000000"
        )
    ])

    let trace = sessions.first?.traces.first

    #expect(trace?.displayLabel == String(traceId.prefix(12)))
}

@Test func groupSpansSortsSessionsAndTracesDeterministically() {
    let rows = [
        span(traceId: "trace-z", spanId: "z-root", timestamp: "2026-01-01T00:00:05.000000000", agentSessionId: "session-b"),
        span(traceId: "trace-b", spanId: "b-root", timestamp: "2026-01-01T00:00:03.000000000", agentSessionId: "session-a"),
        span(traceId: "trace-a", spanId: "a-root", timestamp: "2026-01-01T00:00:03.000000000", agentSessionId: "session-a"),
        span(traceId: "trace-late", spanId: "late-root", timestamp: "2026-01-01T00:00:10.000000000", agentSessionId: "session-c")
    ]

    let sessions = SessionGrouping.groupSpans(rows)

    #expect(sessions.map(\.id) == ["session-c", "session-b", "session-a"])
    #expect(sessions.last?.traces.map(\.id) == ["trace-a", "trace-b"])
}

@Test func activityStatusUsesCallerSuppliedNow() {
    let sessions = SessionGrouping.groupSpans([
        span(spanId: "root", timestamp: "2026-01-01T00:00:00.000000000")
    ])
    let session = sessions[0]

    #expect(session.activityStatus(now: session.lastActivity.addingTimeInterval(4 * 60)) == .active)
    #expect(session.activityStatus(now: session.lastActivity.addingTimeInterval(30 * 60)) == .idle)
    #expect(session.activityStatus(now: session.lastActivity.addingTimeInterval(2 * 60 * 60)) == .stale)
}

@Test func reconcileSelectionKeepsOnlyPresentIds() {
    let sessions = SessionGrouping.groupSpans([
        span(traceId: "trace-a", spanId: "root", timestamp: "2026-01-01T00:00:00.000000000")
    ])

    let kept = SessionGrouping.reconcileSelection(
        in: sessions,
        selectedSessionId: "session",
        selectedTraceId: "trace-a",
        selectedSpanId: "trace-aroot"
    )
    let cleared = SessionGrouping.reconcileSelection(
        in: sessions,
        selectedSessionId: "missing-session",
        selectedTraceId: "missing-trace",
        selectedSpanId: "missing-span"
    )

    #expect(kept.selectedSessionId == "session")
    #expect(kept.selectedTraceId == "trace-a")
    #expect(kept.selectedSpanId == "trace-aroot")
    #expect(cleared.selectedSessionId == nil)
    #expect(cleared.selectedTraceId == nil)
    #expect(cleared.selectedSpanId == nil)
}

@Test func groupSpansPreservesRawAttributesForInspectorRows() {
    let sessions = SessionGrouping.groupSpans([
        span(
            spanId: "root",
            timestamp: "2026-01-01T00:00:00.000000000",
            resourceAttributesRaw: ["b": "resource-b", "a": "resource-a"],
            spanAttributesRaw: ["d": "span-d", "c": "span-c"]
        )
    ])

    let groupedSpan = sessions.first?.traces.first?.spans.first

    #expect(groupedSpan?.ResourceAttributesRaw == ["b": "resource-b", "a": "resource-a"])
    #expect(groupedSpan?.SpanAttributesRaw == ["d": "span-d", "c": "span-c"])
}

private func span(
    traceId: String = "trace",
    spanId: String,
    parentSpanId: String = "",
    spanName: String? = nil,
    timestamp: String,
    serviceName: String = "service",
    statusCode: String = "",
    duration: UInt64 = 0,
    agentProject: String = "project",
    agentSessionId: String = "session",
    agentRunId: String = "run",
    sessionId: String = "",
    projectName: String = "",
    resourceAttributesRaw: [String: String] = [:],
    spanAttributesRaw: [String: String] = [:]
) -> SpanRowModel {
    SpanRowModel(
        TraceId: traceId,
        SpanId: spanId,
        ParentSpanId: parentSpanId,
        SpanName: spanName ?? spanId,
        Timestamp: timestamp,
        ServiceName: serviceName,
        StatusCode: statusCode,
        Duration: duration,
        AgentProject: agentProject,
        AgentSessionId: agentSessionId,
        AgentRunId: agentRunId,
        SessionId: sessionId,
        ProjectName: projectName,
        ResourceAttributesRaw: resourceAttributesRaw,
        SpanAttributesRaw: spanAttributesRaw
    )
}

private func spanIds(_ rows: [SpanRowModel]) -> [String] {
    rows.map(\.SpanId)
}

private func depths(_ rows: [SpanRowModel]) -> [Int] {
    rows.map(\.depth)
}
