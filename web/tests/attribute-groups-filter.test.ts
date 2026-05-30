/*
 * attribute-groups-filter — pins the hidden-keys filter in groupAttributes.
 * The hidden set (`user.*` prefix + `project.path` exact) is dropped
 * BEFORE bucketing, so no group (including OTHER) ever renders the
 * filtered keys. Required by VOI-346 spec acceptance.
 */

import { describe, expect, it } from "vitest";
import {
  groupAttributes,
  isHiddenAttributeKey,
} from "../src/lib/attributeGroups";

describe("isHiddenAttributeKey", () => {
  it("hides all user.* keys", () => {
    expect(isHiddenAttributeKey("user.email")).toBe(true);
    expect(isHiddenAttributeKey("user.id")).toBe(true);
    expect(isHiddenAttributeKey("user.account_uuid")).toBe(true);
    expect(isHiddenAttributeKey("user.name")).toBe(true);
  });

  it("hides project.path exactly", () => {
    expect(isHiddenAttributeKey("project.path")).toBe(true);
    expect(isHiddenAttributeKey("project.name")).toBe(false);
    expect(isHiddenAttributeKey("project.path.subkey")).toBe(false);
  });

  it("leaves unrelated keys alone", () => {
    expect(isHiddenAttributeKey("gen_ai.request.model")).toBe(false);
    expect(isHiddenAttributeKey("request_id")).toBe(false);
    expect(isHiddenAttributeKey("session.id")).toBe(false);
  });
});

describe("groupAttributes — hidden-keys filter", () => {
  it("drops user.* and project.path; keeps other keys in their groups", () => {
    const attrs: Record<string, string> = {
      "user.email": "suresh@example.com",
      "user.name": "Suresh",
      "user.id": "u_123",
      "project.path": "/Users/sk/Projects/agent-observability",
      "gen_ai.request.model": "claude-sonnet-4-5",
      request_id: "req_abc",
      "session.id": "sess_xyz",
    };

    const grouped = groupAttributes(attrs);

    // Collect all rendered keys across every group bucket.
    const rendered = new Set<string>();
    for (const { entries } of grouped) {
      for (const [key] of entries) rendered.add(key);
    }

    // Hidden keys are absent from every group.
    expect(rendered.has("user.email")).toBe(false);
    expect(rendered.has("user.name")).toBe(false);
    expect(rendered.has("user.id")).toBe(false);
    expect(rendered.has("project.path")).toBe(false);

    // Non-hidden keys are kept and routed to the correct groups.
    expect(rendered.has("gen_ai.request.model")).toBe(true);
    expect(rendered.has("request_id")).toBe(true);
    expect(rendered.has("session.id")).toBe(true);

    const requestGroup = grouped.find((g) => g.group.name === "REQUEST");
    expect(requestGroup?.entries.some(([k]) => k === "gen_ai.request.model")).toBe(true);
    const identityGroup = grouped.find((g) => g.group.name === "IDENTITY");
    expect(identityGroup?.entries.some(([k]) => k === "request_id")).toBe(true);
    expect(identityGroup?.entries.some(([k]) => k === "session.id")).toBe(true);
  });

  it("does NOT push hidden keys into the OTHER catch-all", () => {
    const attrs: Record<string, string> = {
      "user.email": "x@y",
      "project.path": "/private/leak",
    };
    const grouped = groupAttributes(attrs);
    const otherGroup = grouped.find((g) => g.group.name === "OTHER");
    // OTHER should be entirely absent (no entries) since both inputs are
    // filtered upfront.
    expect(otherGroup).toBeUndefined();
  });
});
