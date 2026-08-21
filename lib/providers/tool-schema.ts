export function sanitizeJsonSchema(input: unknown, depth = 0): Record<string, unknown> {
  if (depth > 8) {
    return { type: "object", properties: {}, additionalProperties: false };
  }
  const raw = asRecord(input);
  const type = typeof raw.type === "string" ? raw.type : undefined;
  if (Array.isArray(raw.anyOf)) {
    return { anyOf: raw.anyOf.map((item) => sanitizeJsonSchema(item, depth + 1)) };
  }
  if (Array.isArray(raw.oneOf)) {
    return { oneOf: raw.oneOf.map((item) => sanitizeJsonSchema(item, depth + 1)) };
  }
  if (type === "array" || raw.items) {
    return {
      type: "array",
      items: sanitizeJsonSchema(raw.items ?? { type: "string" }, depth + 1),
    };
  }
  if (type && type !== "object" && !raw.properties) {
    const primitive: Record<string, unknown> = { type };
    if (typeof raw.description === "string") primitive.description = raw.description.slice(0, 500);
    if (Array.isArray(raw.enum)) primitive.enum = raw.enum;
    if (typeof raw.default !== "undefined") primitive.default = raw.default;
    return primitive;
  }
  const propertiesInput = asRecord(raw.properties);
  const properties: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(propertiesInput)) {
    properties[key] = sanitizeJsonSchema(value, depth + 1);
  }
  const required = Array.isArray(raw.required)
    ? raw.required.filter((item): item is string => typeof item === "string" && item in properties)
    : [];
  const next: Record<string, unknown> = {
    type: "object",
    properties,
    additionalProperties: false,
  };
  if (required.length) next.required = required;
  if (typeof raw.description === "string" && raw.description.trim()) {
    next.description = raw.description.slice(0, 500);
  }
  return next;
}

export function stripRawToolMarkup(text: string) {
  return text
    .replace(/<tool_call>[\s\S]*?<\/tool_call>/gi, "")
    .replace(/<\|tool_call_begin\|>[\s\S]*?<\|tool_call_end\|>/gi, "")
    .replace(/```(?:json)?\s*\{\s*"name"\s*:\s*"[^"]+"[\s\S]*?```/gi, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export type EmbeddedToolCall = { name: string; args: Record<string, unknown> };

type EmbeddedToolHit = EmbeddedToolCall & { index: number; kind: "markup" | "json" };

export function extractEmbeddedToolCalls(text: string): EmbeddedToolCall[] {
  const hits: EmbeddedToolHit[] = [];

  for (const match of text.matchAll(/<tool_call>([\s\S]*?)<\/tool_call>/gi)) {
    const call = parseTaggedToolBody(match[1] || "");
    if (call) hits.push({ ...call, index: match.index ?? 0, kind: "markup" });
  }
  for (const match of text.matchAll(/<\|tool_call_begin\|>([\s\S]*?)<\|tool_call_end\|>/gi)) {
    const call = parseTaggedToolBody(match[1] || "");
    if (call) hits.push({ ...call, index: match.index ?? 0, kind: "markup" });
  }
  for (const match of text.matchAll(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/g)) {
    const call = parseJsonToolObject(match[1] || "");
    if (call) hits.push({ ...call, index: match.index ?? 0, kind: "json" });
  }

  hits.sort((a, b) => a.index - b.index || (a.kind === "markup" ? -1 : 1));
  const markupFingerprints = new Set(
    hits.filter((hit) => hit.kind === "markup").map((hit) => toolCallFingerprint(hit)),
  );
  const calls: EmbeddedToolCall[] = [];
  for (const hit of hits) {
    if (hit.kind === "json" && markupFingerprints.has(toolCallFingerprint(hit))) continue;
    calls.push({ name: hit.name, args: hit.args });
  }
  return calls;
}

function parseTaggedToolBody(body: string): EmbeddedToolCall | undefined {
  const trimmed = body.trim();
  if (!trimmed) return undefined;

  const kimi = trimmed.match(
    /^(?:functions\.)?([A-Za-z0-9_./-]+)(?::\d+)?\s*(?:<\|tool_call_argument_begin\|>|<\|tool_sep\|>)\s*([\s\S]+)$/i,
  );
  if (kimi) return { name: kimi[1], args: parseToolArgs(kimi[2]) };

  if (trimmed.startsWith("{")) {
    const fromJson = parseJsonToolObject(trimmed);
    if (fromJson) return fromJson;
  }

  const named = trimmed.match(/^([A-Za-z0-9_./-]+)\s*([\s\S]*)$/);
  if (!named) return undefined;
  const name = named[1];
  const rest = (named[2] || "").trim();
  const xmlArgs = parseXmlArgPairs(rest);
  if (xmlArgs) return { name, args: xmlArgs };
  if (!rest) return { name, args: {} };
  if (rest.startsWith("{")) return { name, args: parseToolArgs(rest) };
  return { name, args: {} };
}

function parseJsonToolObject(raw: string): EmbeddedToolCall | undefined {
  try {
    const parsed = JSON.parse(raw) as { name?: unknown; arguments?: unknown; input?: unknown };
    if (typeof parsed.name !== "string" || !parsed.name) return undefined;
    return { name: parsed.name, args: parseToolArgs(parsed.arguments ?? parsed.input ?? {}) };
  } catch {
    return undefined;
  }
}

function parseXmlArgPairs(body: string): Record<string, unknown> | undefined {
  const pairs = [...body.matchAll(/<arg_key>([^<]+)<\/arg_key>\s*<arg_value>([\s\S]*?)<\/arg_value>/gi)];
  if (!pairs.length) return undefined;
  const args: Record<string, unknown> = {};
  for (const pair of pairs) args[pair[1].trim()] = pair[2].trim();
  return args;
}

function parseToolArgs(raw: unknown): Record<string, unknown> {
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (!trimmed) return {};
    try {
      return asRecord(JSON.parse(trimmed));
    } catch {
      return {};
    }
  }
  return asRecord(raw);
}

function toolCallFingerprint(call: EmbeddedToolCall) {
  return `${call.name}:${stableJson(call.args)}`;
}

function stableJson(value: unknown): string {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const rec = value as Record<string, unknown>;
    return `{${Object.keys(rec).sort().map((key) => `${JSON.stringify(key)}:${stableJson(rec[key])}`).join(",")}}`;
  }
  if (Array.isArray(value)) return `[${value.map((item) => stableJson(item)).join(",")}]`;
  return JSON.stringify(value) ?? "null";
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}
