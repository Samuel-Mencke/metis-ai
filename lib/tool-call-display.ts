function joinAssistantText(left: string, right: string): string {
  if (!left) return right;
  if (!right) return left;
  if (/\s$/.test(left) || /^\s/.test(right)) return left + right;
  if (/[a-zäöüß]{3,}[.!?]$/.test(left) && /^[A-ZÄÖÜ]/.test(right)) {
    return `${left}\n\n${right}`;
  }
  return left + right;
}

const RUNNING_TOOL_STATUSES = new Set([
  "running",
  "in_progress",
  "pending",
  "started",
  "executing",
  "queued",
]);

export function isToolRunning(status?: string): boolean {
  return Boolean(status && RUNNING_TOOL_STATUSES.has(status.toLowerCase()));
}

export type AssistantViewBlock<TTool> =
  | { type: "thinking"; content: string; done?: boolean; durationMs?: number }
  | { type: "text"; content: string }
  | { type: "tools"; tools: TTool[] };

type LayoutPart<TTool> =
  | { type: "thinking"; content: string; done?: boolean; durationMs?: number }
  | { type: "text"; content: string }
  | ({ type: "tool" } & TTool);

const STANDALONE_TOOL_KINDS = new Set([
  "todo",
  "plan",
  "note",
  "memory",
  "canvas",
]);

export function isStandaloneToolKind(kind?: string): boolean {
  return Boolean(kind && STANDALONE_TOOL_KINDS.has(kind));
}

export function todosFromToolPayload(
  input?: string,
  result?: string,
): Array<{ id?: string; content: string; status?: string }> | undefined {
  for (const raw of [input, result]) {
    if (!raw) continue;
    try {
      const parsed: unknown = JSON.parse(raw);
      const record = parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? parsed as Record<string, unknown>
        : null;
      const list = record?.todos;
      if (!Array.isArray(list)) continue;
      const todos = list.flatMap((item) => {
        if (typeof item === "string" && item.trim()) return [{ content: item.trim() }];
        if (!item || typeof item !== "object" || Array.isArray(item)) return [];
        const entry = item as Record<string, unknown>;
        const content = [entry.content, entry.text, entry.title, entry.task]
          .find((value): value is string => typeof value === "string" && Boolean(value.trim()));
        if (!content) return [];
        return [{
          ...(typeof entry.id === "string" ? { id: entry.id } : {}),
          content,
          ...(typeof entry.status === "string" ? { status: entry.status } : {}),
        }];
      });
      if (todos.length) return todos;
    } catch {
      // Tool payloads are often plain text.
    }
  }
  return undefined;
}

export function layoutAssistantParts<TTool extends { kind?: string }>(
  parts: Array<LayoutPart<TTool>>,
): AssistantViewBlock<TTool>[] {
  const blocks: AssistantViewBlock<TTool>[] = [];
  let tools: TTool[] = [];

  const flushTools = () => {
    if (!tools.length) return;
    blocks.push({ type: "tools", tools });
    tools = [];
  };

  for (const part of parts) {
    if (part.type === "thinking") {
      flushTools();
      blocks.push({
        type: "thinking",
        content: part.content,
        done: part.done,
        durationMs: part.durationMs,
      });
      continue;
    }
    if (part.type === "text") {
      if (!part.content.trim()) continue;
      flushTools();
      const last = blocks.at(-1);
      if (last?.type === "text") last.content = joinAssistantText(last.content, part.content);
      else blocks.push({ type: "text", content: part.content });
      continue;
    }
    const { type: _type, ...tool } = part;
    void _type;
    const next = tool as unknown as TTool;
    if (isStandaloneToolKind(next.kind)) {
      flushTools();
      blocks.push({ type: "tools", tools: [next] });
      continue;
    }
    tools.push(next);
  }
  flushTools();
  return blocks;
}

export function looksLikeStructuredPayload(value: string): boolean {
  const trimmed = value.trim();
  return trimmed.startsWith("{") || trimmed.startsWith("[");
}

export function compactToolPreview(value?: string, max = 88): string | undefined {
  if (!value) return undefined;
  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized || looksLikeStructuredPayload(normalized)) return undefined;
  return normalized.length > max ? `${normalized.slice(0, max - 1)}…` : normalized;
}

const LOCAL_TARGETS = new Set(["server", "local", "laptop"]);
const SHELL_TOOL_NAMES = new Set([
  "execute_command",
  "remote_client_terminal",
  "shell",
  "bash",
  "run_terminal_cmd",
]);
const PATH_TOOL_NAMES = new Set([
  "read_file",
  "write_file",
  "edit_file",
  "delete_file",
  "list_directory",
  "read",
  "edit",
  "write",
  "grep",
]);

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}

function parseJsonObject(raw?: string): Record<string, unknown> | undefined {
  if (!raw) return undefined;
  try {
    return asRecord(JSON.parse(raw));
  } catch {
    return undefined;
  }
}

function stringField(record: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = record?.[key];
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function looksLikeShellCommand(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed || looksLikeStructuredPayload(trimmed)) return false;
  return /\s/.test(trimmed) || /^[A-Za-z0-9_./\\:-]+$/.test(trimmed);
}

function parseNestedArgs(value: unknown): Record<string, unknown> | undefined {
  if (typeof value === "string") return parseJsonObject(value);
  return asRecord(value);
}

function unwrapToolPayload(name: string, payload: Record<string, unknown> | undefined) {
  const nestedTool = stringField(payload, "tool") || stringField(payload, "toolName");
  const nested = parseNestedArgs(payload?.arguments) || parseNestedArgs(payload?.args);
  const isWrapper = name === "call_mcp_tool" || Boolean(nested && nestedTool);
  if (isWrapper && nested) {
    return {
      toolName: nestedTool || name,
      args: { ...payload, ...nested },
    };
  }
  return { toolName: name, args: payload ?? {} };
}

function extractCommand(args: Record<string, unknown>, fallback?: string): string | undefined {
  const command = stringField(args, "command") || stringField(args, "cmd") || stringField(args, "script");
  if (command) return command.replace(/\s+/g, " ").trim();
  const data = stringField(args, "data");
  if (data && looksLikeShellCommand(data)) return data.replace(/\s+/g, " ").trim();
  if (fallback && !looksLikeStructuredPayload(fallback) && looksLikeShellCommand(fallback)) {
    return fallback.replace(/\s+/g, " ").trim();
  }
  return undefined;
}

function extractPath(args: Record<string, unknown>, fallback?: string): string | undefined {
  return fallback?.trim()
    || stringField(args, "path")
    || stringField(args, "file")
    || stringField(args, "filePath")
    || stringField(args, "filename");
}

function clientIdFromTarget(target?: string): string | undefined {
  if (!target?.startsWith("client:")) return undefined;
  const id = target.slice("client:".length).trim();
  return id || undefined;
}

function isRemoteTool(toolName: string, args: Record<string, unknown>): boolean {
  const target = stringField(args, "target");
  const clientId = stringField(args, "client_id") || stringField(args, "clientId") || clientIdFromTarget(target);
  if (target?.startsWith("client:")) return true;
  if (clientId) return true;
  if (toolName === "remote_client_terminal") return true;
  if (target && (toolName === "execute_command" || SHELL_TOOL_NAMES.has(toolName))) {
    return !LOCAL_TARGETS.has(target.toLowerCase());
  }
  return false;
}

function shortClientId(id: string): string {
  return id.length > 12 ? id.slice(0, 8) : id;
}

function resolveHostname(
  args: Record<string, unknown>,
  hostnames?: Record<string, string>,
): string | undefined {
  const payloadHostname = stringField(args, "hostname");
  if (payloadHostname) return payloadHostname;
  const target = stringField(args, "target");
  const fromClientId = stringField(args, "client_id") || stringField(args, "clientId");
  const fromTarget = clientIdFromTarget(target);
  if (fromClientId && hostnames?.[fromClientId]) return hostnames[fromClientId];
  if (fromTarget && hostnames?.[fromTarget]) return hostnames[fromTarget];
  const clientName = stringField(args, "client")
    || stringField(args, "client_name")
    || stringField(args, "clientName");
  if (clientName) return clientName;
  if (fromClientId) return shortClientId(fromClientId);
  if (fromTarget) return shortClientId(fromTarget);
  if (target && !LOCAL_TARGETS.has(target.toLowerCase())) {
    return hostnames?.[target] || target;
  }
  return undefined;
}

function humanToolName(name: string): string {
  if (name === "call_mcp_tool") return "tool";
  return name;
}

export function toolCallHeadline(input: {
  name: string;
  kind?: string;
  input?: string;
  detail?: string;
  path?: string;
  hostnames?: Record<string, string>;
}): { title: string; preview?: string; remote?: boolean } {
  const payload = parseJsonObject(input.input) || parseJsonObject(input.detail);
  const unwrapped = unwrapToolPayload(input.name, payload);
  const args = unwrapped.args;
  const toolName = unwrapped.toolName === "call_mcp_tool" ? input.name : unwrapped.toolName;
  const command = extractCommand(args, input.kind === "shell" ? input.input : undefined);
  const filePath = extractPath(args, input.path);
  const remote = isRemoteTool(toolName, args);
  const hostname = remote ? resolveHostname(args, input.hostnames) : undefined;
  const commandOrPath = command || filePath;
  const fallbackName = humanToolName(toolName === "call_mcp_tool" ? input.name : toolName);

  let core: string;
  if (input.kind === "shell" || SHELL_TOOL_NAMES.has(toolName) || (command && (toolName === "execute_command" || input.name === "execute_command"))) {
    core = command || fallbackName;
  } else if (input.kind === "read" || input.kind === "edit" || PATH_TOOL_NAMES.has(toolName)) {
    core = filePath || fallbackName;
  } else if (commandOrPath && (remote || input.kind === "mcp")) {
    core = commandOrPath;
  } else {
    core = fallbackName;
  }

  const title = remote && hostname ? `${hostname}: ${core}` : core;
  const previewSource = [
    stringField(args, "description"),
    stringField(args, "query"),
    input.detail,
  ].find((value) => value && value !== command && value !== filePath && value !== core);
  const preview = compactToolPreview(previewSource);
  return {
    title,
    ...(preview && preview !== title && preview !== core ? { preview } : {}),
    ...(remote ? { remote: true } : {}),
  };
}

const KIND_GROUP_LABELS: Record<string, string> = {
  mcp: "MCP tools",
  read: "reads",
  edit: "edits",
  shell: "commands",
  browser: "browser tools",
  subagent: "subagents",
  memory: "memory updates",
  todo: "tasks",
  other: "tools",
};

export function remoteClientHostnameMap(
  clients: Array<{ id: string; hostname?: string; name?: string; os?: string }>,
): Record<string, string> {
  const map: Record<string, string> = {};
  for (const client of clients) {
    const host = client.hostname?.trim() || client.name?.trim();
    if (!host) continue;
    map[client.id] = host;
    const os = (client.os || "").toLowerCase();
    if (os.includes("win") || os.includes("pc")) map.pc ??= host;
  }
  return map;
}

export function toolGroupLabel(count: number, kinds: Array<string | undefined>): string {
  if (count <= 0) return "Tools";
  if (count === 1) return "Tool";
  const normalized = kinds.map((kind) => kind || "other");
  const unique = new Set(normalized);
  if (unique.size === 1) {
    const kind = normalized[0];
    return `Used ${count} ${KIND_GROUP_LABELS[kind] ?? "tools"}`;
  }
  return `Used ${count} tools`;
}
