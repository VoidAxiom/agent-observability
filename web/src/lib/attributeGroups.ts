/*
 * attributeGroups — bucket span attribute keys into the 4 inspector cards
 * (REQUEST / RESPONSE / IDENTITY / ENVIRONMENT) + an OTHER catch-all so
 * we never silently drop attributes.
 *
 * Matchers are functions (not regexes) so we can mix exact-key, prefix,
 * and substring rules cleanly. Order is significant: groups are checked
 * top-down via groupForKey(); the FIRST match wins so a key in two groups'
 * regex sets lands in the higher-priority bucket.
 *
 * Group priority (top wins): REQUEST > RESPONSE > IDENTITY > ENVIRONMENT.
 * Anything unmatched goes to OTHER.
 *
 * Family colors per docs/web-ui-cyberpunk-discipline.md § "Inspector":
 *  REQUEST     — cyan dot      (--accent-3 in neon)
 *  RESPONSE    — purple dot    (--accent-2)
 *  IDENTITY    — dim cyan dot  (--accent-3 at reduced opacity)
 *  ENVIRONMENT — dim purple dot(--accent-2 at reduced opacity)
 *  OTHER       — muted text dot
 */

export type AttributeGroupName =
  | "REQUEST"
  | "RESPONSE"
  | "IDENTITY"
  | "ENVIRONMENT"
  | "OTHER";

export interface AttributeGroup {
  name: AttributeGroupName;
  // CSS custom property the dot + label color should reference.
  dotVar: string;
  // Opacity to apply to the dot (so "dim" groups use the same hue at lower
  // intensity instead of inventing a second color token).
  dotOpacity: number;
  matches: (key: string) => boolean;
}

const REQUEST_EXACT = new Set([
  "model",
  "ttft",
  "duration",
  "input_tokens",
  "output_tokens",
  "total_tokens",
  "cache_read_tokens",
  "cache_creation_tokens",
]);

const RESPONSE_EXACT = new Set([
  "stop_reason",
  "finish_reasons",
  "finish_reason",
  "response.id",
  "response_id",
]);

const IDENTITY_EXACT = new Set([
  "request_id",
  "session.id",
  "organization.id",
  "TraceId",
  "SpanId",
  "user.id",
]);

const ENVIRONMENT_EXACT = new Set([
  "terminal.type",
  "gen_ai.system",
  "service.name",
  "app.entrypoint",
  "host.name",
  "os.type",
]);

export const ATTRIBUTE_GROUPS: AttributeGroup[] = [
  {
    name: "REQUEST",
    dotVar: "var(--accent-3)",
    dotOpacity: 1,
    // gen_ai.usage.* is split: input/prompt → REQUEST; output/completion →
    // RESPONSE. The plain prefix used to swallow both — keeping the
    // 4-bucket discipline the file docstring promises.
    matches: (key) =>
      REQUEST_EXACT.has(key) ||
      key.startsWith("gen_ai.request.") ||
      key.startsWith("llm.request.") ||
      isUsageRequestKey(key),
  },
  {
    name: "RESPONSE",
    dotVar: "var(--accent-2)",
    dotOpacity: 1,
    matches: (key) =>
      RESPONSE_EXACT.has(key) ||
      key.startsWith("gen_ai.response.") ||
      key.startsWith("llm.response.") ||
      isUsageResponseKey(key),
  },
  {
    name: "IDENTITY",
    dotVar: "var(--accent-3)",
    dotOpacity: 0.55,
    matches: (key) =>
      IDENTITY_EXACT.has(key) ||
      key.endsWith(".session.id") ||
      key.endsWith(".organization.id") ||
      key.endsWith(".request_id"),
  },
  {
    name: "ENVIRONMENT",
    dotVar: "var(--accent-2)",
    dotOpacity: 0.55,
    matches: (key) =>
      ENVIRONMENT_EXACT.has(key) ||
      key.startsWith("service.") ||
      key.startsWith("terminal.") ||
      key.startsWith("host.") ||
      key.startsWith("os.") ||
      key.startsWith("process.") ||
      key.startsWith("app."),
  },
];

export const OTHER_GROUP: AttributeGroup = {
  name: "OTHER",
  dotVar: "var(--text-muted)",
  dotOpacity: 0.7,
  matches: () => true,
};

function isUsageRequestKey(key: string): boolean {
  // gen_ai.usage.input_tokens / .prompt_tokens / .cache_read_tokens etc.
  // Anything that's clearly REQUEST-side input consumption.
  if (!key.startsWith("gen_ai.usage.") && !key.startsWith("llm.usage.")) {
    return false;
  }
  const tail = key.split(".").pop() ?? "";
  return (
    tail.includes("input") ||
    tail.includes("prompt") ||
    tail.includes("cache")
  );
}

function isUsageResponseKey(key: string): boolean {
  if (!key.startsWith("gen_ai.usage.") && !key.startsWith("llm.usage.")) {
    return false;
  }
  const tail = key.split(".").pop() ?? "";
  return tail.includes("output") || tail.includes("completion");
}

export function groupForKey(key: string): AttributeGroupName {
  for (const group of ATTRIBUTE_GROUPS) {
    if (group.matches(key)) return group.name;
  }
  return OTHER_GROUP.name;
}

export interface GroupedAttributes {
  group: AttributeGroup;
  entries: Array<[string, string]>;
}

/*
 * groupAttributes — partition a flat record into ordered group buckets.
 * Entries inside each group are sorted alphabetically by key for stable
 * rendering (the UI must not reshuffle between renders of the same span).
 * OTHER is always last and is included only when non-empty.
 */
export function groupAttributes(
  attributes: Record<string, string>,
): GroupedAttributes[] {
  const buckets = new Map<AttributeGroupName, Array<[string, string]>>();
  for (const group of ATTRIBUTE_GROUPS) {
    buckets.set(group.name, []);
  }
  buckets.set(OTHER_GROUP.name, []);

  const sortedKeys = Object.keys(attributes).sort();
  for (const key of sortedKeys) {
    const name = groupForKey(key);
    buckets.get(name)!.push([key, attributes[key]!]);
  }

  const result: GroupedAttributes[] = [];
  for (const group of ATTRIBUTE_GROUPS) {
    const entries = buckets.get(group.name)!;
    if (entries.length > 0) {
      result.push({ group, entries });
    }
  }
  const otherEntries = buckets.get(OTHER_GROUP.name)!;
  if (otherEntries.length > 0) {
    result.push({ group: OTHER_GROUP, entries: otherEntries });
  }
  return result;
}
