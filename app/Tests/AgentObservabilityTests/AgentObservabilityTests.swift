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

@Test func stableIdUsesTraceAndSpanIdsAfterTreeOrdering() {
    let rows = [
        span(traceId: "trace-", spanId: "child", parentSpanId: "root", timestamp: "2026-01-01T00:00:02.000000000"),
        span(traceId: "trace-", spanId: "root", timestamp: "2026-01-01T00:00:01.000000000")
    ]

    let ordered = ClickHouseQueryService.computeTreeOrder(rows)

    #expect(ordered.map(\.id) == ["trace-root", "trace-child"])
}

private func span(
    traceId: String = "trace",
    spanId: String,
    parentSpanId: String = "",
    timestamp: String
) -> SpanRowModel {
    SpanRowModel(
        TraceId: traceId,
        SpanId: spanId,
        ParentSpanId: parentSpanId,
        SpanName: spanId,
        Timestamp: timestamp,
        ServiceName: "service",
        AgentProject: "project",
        AgentSessionId: "session",
        AgentRunId: "run"
    )
}

private func spanIds(_ rows: [SpanRowModel]) -> [String] {
    rows.map(\.SpanId)
}

private func depths(_ rows: [SpanRowModel]) -> [Int] {
    rows.map(\.depth)
}
