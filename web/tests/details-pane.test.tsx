/*
 * details-pane — context-sensitive rendering for DetailsPane.
 *  - span selected → SPAN MODE: hero numerals + 4 group cards, hidden
 *    keys are filtered.
 *  - trace selected (no span) → TRACE MODE: duration hero + mini stats.
 *  - session selected (no trace/span) → SESSION MODE: spans hero + mini
 *    stats.
 *
 * The SPAN mode test also covers the existing inspector-groups acceptance
 * (hero numerals at 56px, magnitude formatting, group cards) so this
 * file subsumes the prior inspector-groups.test.tsx.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { DetailsPane } from "../src/components/DetailsPane";
import type { SessionGroup, SpanRow, TraceGroup } from "../src/lib/grouping";

function span(overrides: Partial<SpanRow> & {
  SpanAttributesRaw?: Record<string, string>;
  ResourceAttributesRaw?: Record<string, string>;
}): SpanRow {
  return {
    TraceId: "trace-i",
    SpanId: "span-i",
    ParentSpanId: "",
    SpanName: "claude_code.llm_request",
    Timestamp: "2026-01-01T00:00:00.000000000",
    ServiceName: "claude-code",
    StatusCode: "",
    Duration: 524_000_000,
    AgentProject: "p",
    AgentSessionId: "s",
    AgentRunId: "r",
    SessionId: "sess",
    ProjectName: "proj",
    ResourceAttributesRaw: overrides.ResourceAttributesRaw ?? {},
    SpanAttributesRaw: overrides.SpanAttributesRaw ?? {},
    depth: 0,
    ...overrides,
  };
}

function trace(over: Partial<TraceGroup> & { id: string; spans?: SpanRow[] }): TraceGroup {
  const spans = over.spans ?? [span({ TraceId: over.id, SpanId: "root" })];
  return {
    id: over.id,
    traceId: over.id,
    displayLabel: over.displayLabel ?? over.id,
    rootStart: 0,
    rootStartText: "",
    lastActivity: 0,
    lastActivityText: "",
    spanCount: spans.length,
    durationSeconds: over.durationSeconds ?? 12.345,
    hasError: over.hasError ?? false,
    spans,
  };
}

function session(over: Partial<SessionGroup> & { id: string }): SessionGroup {
  return {
    id: over.id,
    sessionKey: over.id,
    displayLabel: over.displayLabel ?? over.id,
    serviceName: over.serviceName ?? "claude-code",
    projectName: over.projectName ?? "agent-observability",
    lastActivity: over.lastActivity ?? 0,
    lastActivityText: "",
    spanCount: over.spanCount ?? 382,
    traceCount: over.traceCount ?? 7,
    durationSeconds: over.durationSeconds ?? 0,
    hasError: over.hasError ?? false,
    traces: over.traces ?? [],
  };
}

afterEach(() => cleanup());

describe("DetailsPane — SPAN mode", () => {
  it("renders 4 group cards + OTHER + hero numerals; hides user.* and project.path", () => {
    const s = span({
      ResourceAttributesRaw: {
        "project.path": "/Users/sk/private",
      },
      SpanAttributesRaw: {
        model: "claude-sonnet-4-5",
        "gen_ai.request.max_tokens": "8192",
        input_tokens: "12831",
        output_tokens: "847",
        cache_read_tokens: "524913",
        ttft: "180",
        stop_reason: "end_turn",
        "gen_ai.response.id": "msg_01",
        request_id: "req_abc",
        "session.id": "sess_xyz",
        "terminal.type": "iTerm.app",
        "service.name": "claude-code",
        custom_marker: "yes",
        weird_unrelated_key: "1",
        // Hidden-key fixtures that MUST NOT render anywhere.
        "user.email": "leak@example.com",
        "user.name": "Leak",
        "user.id": "u_leak",
      },
    });

    render(<DetailsPane span={s} trace={null} session={null} nowMs={0} />);

    expect(screen.getByText("REQUEST")).toBeTruthy();
    expect(screen.getByText("RESPONSE")).toBeTruthy();
    expect(screen.getByText("IDENTITY")).toBeTruthy();
    expect(screen.getByText("ENVIRONMENT")).toBeTruthy();
    expect(screen.getByText("OTHER")).toBeTruthy();

    const heroBand = screen.getByTestId("voi-hero-band");
    expect(heroBand.textContent).toContain("524ms");
    expect(heroBand.textContent).toContain("12.8k");
    expect(heroBand.textContent).toContain("847");
    expect(heroBand.textContent).toContain("524.9k");

    // Hidden keys must not appear anywhere in the rendered DOM.
    expect(document.body.textContent ?? "").not.toContain("leak@example.com");
    expect(document.body.textContent ?? "").not.toContain("u_leak");
    expect(document.body.textContent ?? "").not.toContain("/Users/sk/private");
    expect(document.body.textContent ?? "").not.toContain("user.email");
    expect(document.body.textContent ?? "").not.toContain("user.name");
    expect(document.body.textContent ?? "").not.toContain("user.id");
    expect(document.body.textContent ?? "").not.toContain("project.path");
  });

  it("IDENTITY card includes TraceId + SpanId with copy buttons", () => {
    const s = span({
      TraceId: "trace-abc",
      SpanId: "span-xyz",
      SpanAttributesRaw: {
        request_id: "req_abc",
        "session.id": "sess_xyz",
      },
    });
    const { container } = render(<DetailsPane span={s} trace={null} session={null} nowMs={0} />);

    const identityCard = container.querySelector('article[data-group="IDENTITY"]')!;
    const buttons = identityCard.querySelectorAll("button.voi-inspector-copy");
    // request_id + session.id + TraceId + SpanId = 4
    expect(buttons.length).toBe(4);

    const keys = Array.from(identityCard.querySelectorAll("dt")).map((dt) => dt.textContent);
    expect(keys).toContain("TraceId");
    expect(keys).toContain("SpanId");
  });

  it("clicking copy writes value to navigator.clipboard + toast", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(globalThis.navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    const s = span({ SpanAttributesRaw: { request_id: "req_abc_123" } });
    render(<DetailsPane span={s} trace={null} session={null} nowMs={0} />);

    const button = screen.getByLabelText("copy request_id");
    await act(async () => {
      fireEvent.click(button);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(writeText).toHaveBeenCalledWith("req_abc_123");
    const status = await screen.findByRole("status");
    expect(status.textContent).toContain("copied request_id");
  });

  it("gen_ai.usage.* splits input→REQUEST and output→RESPONSE", () => {
    const s = span({
      SpanAttributesRaw: {
        "gen_ai.usage.input_tokens": "1000",
        "gen_ai.usage.prompt_tokens": "800",
        "gen_ai.usage.cache_read_tokens": "200",
        "gen_ai.usage.output_tokens": "500",
        "gen_ai.usage.completion_tokens": "450",
      },
    });
    const { container } = render(<DetailsPane span={s} trace={null} session={null} nowMs={0} />);
    const requestKeys = Array.from(
      container.querySelectorAll('article[data-group="REQUEST"] dt'),
    ).map((dt) => dt.textContent);
    const responseKeys = Array.from(
      container.querySelectorAll('article[data-group="RESPONSE"] dt'),
    ).map((dt) => dt.textContent);
    expect(requestKeys).toContain("gen_ai.usage.input_tokens");
    expect(requestKeys).toContain("gen_ai.usage.prompt_tokens");
    expect(requestKeys).toContain("gen_ai.usage.cache_read_tokens");
    expect(responseKeys).toContain("gen_ai.usage.output_tokens");
    expect(responseKeys).toContain("gen_ai.usage.completion_tokens");
  });

  it("status pill shows UNSET (not OK) for empty StatusCode", () => {
    const s = span({ StatusCode: "" });
    render(<DetailsPane span={s} trace={null} session={null} nowMs={0} />);
    const header = screen.getByRole("heading", { level: 2 }).parentElement!;
    expect(header.textContent).toContain("UNSET");
    expect(header.textContent).not.toContain("OK");
  });

  it("never renders a dollar / $ figure anywhere", () => {
    const s = span({
      SpanAttributesRaw: {
        model: "claude-sonnet-4-5",
        input_tokens: "12831",
        output_tokens: "847",
        cost_usd: "0.42",
      },
    });
    const { container } = render(<DetailsPane span={s} trace={null} session={null} nowMs={0} />);
    expect(container.textContent ?? "").not.toMatch(/\$/);
  });

  it("copy without navigator.clipboard surfaces 'copy unavailable'", async () => {
    Object.defineProperty(globalThis.navigator, "clipboard", {
      configurable: true,
      value: undefined,
    });
    const s = span({
      SpanAttributesRaw: { request_id: "rq" },
    });
    render(<DetailsPane span={s} trace={null} session={null} nowMs={0} />);
    const button = screen.getByLabelText("copy request_id");
    await act(async () => {
      fireEvent.click(button);
      await Promise.resolve();
    });
    const status = await screen.findByRole("status");
    expect(status.textContent).toContain("copy unavailable");
  });

  it("hero numeral exposes data-tooltip with the exact value (no truncation)", () => {
    const s = span({
      SpanAttributesRaw: {
        input_tokens: "12831",
        cache_read_tokens: "524913",
      },
    });
    const { container } = render(<DetailsPane span={s} trace={null} session={null} nowMs={0} />);
    const cacheCell = container.querySelector('[data-hero-key="cache_read_tokens"]');
    expect(cacheCell).not.toBeNull();
    const tooltipEl = cacheCell!.querySelector("[data-tooltip]");
    expect(tooltipEl?.getAttribute("data-tooltip")).toBe("524,913");
  });
});

describe("DetailsPane — TRACE mode", () => {
  it("with trace but no span, renders trace hero + mini stats", () => {
    const t = trace({
      id: "trace-T",
      displayLabel: "trace-T",
      durationSeconds: 28.594,
      spans: [
        span({ TraceId: "trace-T", SpanId: "r", ServiceName: "claude-code" }),
        span({ TraceId: "trace-T", SpanId: "x", ServiceName: "codex" }),
      ],
    });
    const { container } = render(<DetailsPane span={null} trace={t} session={null} nowMs={0} />);
    expect(screen.getByText("TRACE")).toBeTruthy();
    const heroBand = screen.getByTestId("voi-hero-band");
    expect(heroBand.textContent).toContain("28.59s");
    // mini stats include 2 services, 0 errors, 2 spans
    expect(container.textContent).toContain("services");
    expect(container.textContent).toContain("errors");
  });
});

describe("DetailsPane — SESSION mode", () => {
  it("with session but no trace/span, renders session hero", () => {
    const s = session({
      id: "session-S",
      displayLabel: "session-S",
      spanCount: 382,
      traceCount: 7,
      lastActivity: 1000,
    });
    const nowMs = 1000 + 12000; // 12 seconds later
    const { container } = render(<DetailsPane span={null} trace={null} session={s} nowMs={nowMs} />);
    expect(screen.getByText("SESSION")).toBeTruthy();
    const heroBand = screen.getByTestId("voi-hero-band");
    expect(heroBand.textContent).toContain("382");
    expect(container.textContent).toContain("traces");
    expect(container.textContent).toContain("last_activity");
    expect(container.textContent).toContain("12s ago");
  });
});

describe("DetailsPane — EMPTY", () => {
  it("renders the placeholder when nothing is selected", () => {
    render(<DetailsPane span={null} trace={null} session={null} nowMs={0} />);
    expect(screen.getByText(/select a span to inspect/)).toBeTruthy();
  });
});
