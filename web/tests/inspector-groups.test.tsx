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
    expect(identityCopyButtons.length).toBe(2);

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
