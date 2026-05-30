import { describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { InspectorPane } from "../src/components/InspectorPane";
import type { SpanRow } from "../src/lib/grouping";

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
    Duration: 524_000_000, // 524ms
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

describe("InspectorPane groups", () => {
  it("renders 4 group cards + OTHER catch-all + hero numerals", () => {
    const s = span({
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
        // OTHER catch-all (no group matches):
        custom_marker: "yes",
        weird_unrelated_key: "1",
      },
    });

    render(<InspectorPane span={s} />);

    expect(screen.getByText("REQUEST")).toBeTruthy();
    expect(screen.getByText("RESPONSE")).toBeTruthy();
    expect(screen.getByText("IDENTITY")).toBeTruthy();
    expect(screen.getByText("ENVIRONMENT")).toBeTruthy();
    expect(screen.getByText("OTHER")).toBeTruthy();

    // Hero band with duration + tokens.
    const heroBand = screen.getByTestId("voi-hero-band");
    expect(heroBand.textContent).toContain("524ms");
    expect(heroBand.textContent).toContain("12.8k");
    expect(heroBand.textContent).toContain("847");
    // cache_read_tokens magnitude must show
    expect(heroBand.textContent).toContain("524.9k");
  });

  it("OTHER bucket only collects un-matched keys", () => {
    const s = span({
      SpanAttributesRaw: {
        model: "claude-sonnet-4-5",
        custom_marker: "yes",
        weird_unrelated_key: "1",
      },
    });
    const { container } = render(<InspectorPane span={s} />);

    const otherCard = container.querySelector('article[data-group="OTHER"]');
    expect(otherCard).not.toBeNull();
    const otherKeys = Array.from(
      otherCard!.querySelectorAll("dt"),
    ).map((dt) => dt.textContent);
    expect(otherKeys).toContain("custom_marker");
    expect(otherKeys).toContain("weird_unrelated_key");
    expect(otherKeys).not.toContain("model");
  });

  it("renders copy button only on IDENTITY rows", () => {
    const s = span({
      // TraceId/SpanId on the SpanRow itself contribute IDENTITY rows too
      // (spec requires them in the IDENTITY card).
      TraceId: "trace-abc",
      SpanId: "span-xyz",
      SpanAttributesRaw: {
        model: "claude-sonnet-4-5",
        request_id: "req_abc",
        "session.id": "sess_xyz",
      },
    });
    const { container } = render(<InspectorPane span={s} />);

    const identityCard = container.querySelector('article[data-group="IDENTITY"]');
    const identityCopyButtons = identityCard!.querySelectorAll(
      "button.voi-inspector-copy",
    );
    // request_id + session.id + TraceId + SpanId = 4 IDENTITY rows
    expect(identityCopyButtons.length).toBe(4);

    const identityKeys = Array.from(
      identityCard!.querySelectorAll("dt"),
    ).map((dt) => dt.textContent);
    expect(identityKeys).toContain("TraceId");
    expect(identityKeys).toContain("SpanId");

    const requestCard = container.querySelector('article[data-group="REQUEST"]');
    const requestCopyButtons = requestCard!.querySelectorAll(
      "button.voi-inspector-copy",
    );
    expect(requestCopyButtons.length).toBe(0);
  });

  it("clicking copy writes value to navigator.clipboard + shows toast", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(globalThis.navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });

    const s = span({
      SpanAttributesRaw: {
        request_id: "req_abc_123",
      },
    });
    render(<InspectorPane span={s} />);

    const button = screen.getByLabelText("copy request_id");
    await act(async () => {
      fireEvent.click(button);
      // drain microtasks for the async clipboard then-chain
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
    const { container } = render(<InspectorPane span={s} />);
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
    expect(requestKeys).not.toContain("gen_ai.usage.output_tokens");
    expect(responseKeys).not.toContain("gen_ai.usage.input_tokens");
  });

  it("copy without navigator.clipboard surfaces 'copy unavailable', no false success", async () => {
    Object.defineProperty(globalThis.navigator, "clipboard", {
      configurable: true,
      value: undefined,
    });

    const s = span({
      TraceId: "trace-no-clip",
      SpanId: "span-no-clip",
      SpanAttributesRaw: { request_id: "rq" },
    });
    render(<InspectorPane span={s} />);

    const button = screen.getByLabelText("copy request_id");
    await act(async () => {
      fireEvent.click(button);
      await Promise.resolve();
    });

    const status = await screen.findByRole("status");
    expect(status.textContent).toContain("copy unavailable");
    expect(status.textContent).not.toContain("copied request_id");
  });

  it("status pill shows UNSET (not OK) for empty StatusCode — matches waterfall running detection", () => {
    const s = span({ StatusCode: "" });
    render(<InspectorPane span={s} />);
    // The header text must include UNSET and must not include a bare OK
    // claim for the in-flight span.
    const header = screen.getByRole("heading", { level: 2 }).parentElement!;
    expect(header.textContent).toContain("UNSET");
    expect(header.textContent).not.toContain("OK");
  });

  it("never renders a dollar / $ figure anywhere in the inspector", () => {
    const s = span({
      SpanAttributesRaw: {
        model: "claude-sonnet-4-5",
        input_tokens: "12831",
        output_tokens: "847",
        cost_usd: "0.42", // intentionally try to slip a cost through — must land in OTHER as plain text only
      },
    });
    const { container } = render(<InspectorPane span={s} />);
    expect(container.textContent ?? "").not.toMatch(/\$/);
  });
});
