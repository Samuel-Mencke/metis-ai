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

function numberField(record: Record<string, unknown> | undefined, key: string): number | undefined {
  const value = record?.[key];
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
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
  return name.replaceAll("_", " ");
}

function basenamePath(path: string): string {
  const trimmed = path.replace(/[\\/]+$/, "");
  const parts = trimmed.split(/[\\/]/).filter(Boolean);
  return parts.at(-1) || trimmed;
}

function extractLineRange(args: Record<string, unknown>): string | undefined {
  const start = numberField(args, "offset")
    ?? numberField(args, "startLine")
    ?? numberField(args, "start_line")
    ?? numberField(args, "line");
  const limit = numberField(args, "limit");
  const end = numberField(args, "endLine")
    ?? numberField(args, "end_line")
    ?? (start != null && limit != null ? start + Math.max(limit, 1) - 1 : undefined);
  if (start == null) return undefined;
  if (end != null && end !== start) return `L${start}-${end}`;
  return `L${start}`;
}

function extractSearchPattern(args: Record<string, unknown>): string | undefined {
  return stringField(args, "pattern")
    || stringField(args, "query")
    || stringField(args, "search_term")
    || stringField(args, "glob_pattern")
    || stringField(args, "regex");
}

export type ToolActionIcon =
  | "folder"
  | "search"
  | "read"
  | "edit"
  | "shell"
  | "mcp"
  | "browser"
  | "subagent"
  | "other";

export type ToolActionCategory = "file" | "search" | "edit" | "shell" | "browser" | "tool";

export function resolveToolAction(name?: string, kind?: string): {
  verb: string;
  icon: ToolActionIcon;
  category: ToolActionCategory;
} {
  const value = (name || "").toLowerCase();
  if (kind === "subagent" || /(subagent|delegate)/.test(value)) {
    return { verb: "Delegated", icon: "subagent", category: "tool" };
  }
  if (kind === "browser" || /(browser_|navigate|playwright|webfetch|web_fetch)/.test(value)) {
    return { verb: "Browsed", icon: "browser", category: "browser" };
  }
  if (kind === "shell" || SHELL_TOOL_NAMES.has(value) || /(execute_command|terminal)/.test(value)) {
    return { verb: "Ran", icon: "shell", category: "shell" };
  }
  if (kind === "edit" || /(write_file|edit_file|delete_file|apply_patch|strreplace)/.test(value)) {
    return { verb: /delete|remove|unlink/.test(value) ? "Deleted" : "Edited", icon: "edit", category: "edit" };
  }
  if (/(grep|ripgrep)/.test(value)) {
    return { verb: "Grepped", icon: "search", category: "search" };
  }
  if (/(search_tools|get_mcp_tools|list_mcp|search_registry)/.test(value)) {
    return { verb: "Searched", icon: "mcp", category: "search" };
  }
  if (/(web_search|context_search|exa_|github_search)/.test(value) || (kind === "mcp" && value.includes("search"))) {
    return { verb: "Searched", icon: "search", category: "search" };
  }
  if (/(list_directory|glob|listdir)/.test(value)) {
    return { verb: "Explored", icon: "folder", category: "file" };
  }
  if (kind === "read" || /(read_file|read_lints|^read$)/.test(value)) {
    return { verb: "Read", icon: "read", category: "file" };
  }
  if (kind === "mcp" || value.includes("mcp") || value === "call_mcp_tool") {
    return { verb: "Used", icon: "mcp", category: "tool" };
  }
  return { verb: "Used", icon: "other", category: "tool" };
}

export function toolCallHeadline(input: {
  name: string;
  kind?: string;
  input?: string;
  detail?: string;
  path?: string;
  hostnames?: Record<string, string>;
}): { title: string; preview?: string; remote?: boolean; icon: ToolActionIcon; verb: string } {
  const payload = parseJsonObject(input.input) || parseJsonObject(input.detail);
  const unwrapped = unwrapToolPayload(input.name, payload);
  const args = unwrapped.args;
  const toolName = unwrapped.toolName === "call_mcp_tool" ? input.name : unwrapped.toolName;
  const action = resolveToolAction(toolName, input.kind);
  const command = extractCommand(args, input.kind === "shell" ? input.input : undefined);
  const filePath = extractPath(args, input.path);
  const remote = isRemoteTool(toolName, args);
  const hostname = remote ? resolveHostname(args, input.hostnames) : undefined;
  const pattern = extractSearchPattern(args);
  const lineRange = extractLineRange(args);
  const fallbackName = humanToolName(toolName === "call_mcp_tool" ? input.name : toolName);
  const shortPath = filePath ? basenamePath(filePath) : undefined;

  let core: string;
  if (action.category === "shell") {
    core = command ? `${action.verb} ${command}` : action.verb;
  } else if (action.verb === "Grepped") {
    core = pattern ? `${action.verb} ${pattern}` : action.verb;
  } else if (action.verb === "Searched" && /(search_tools|get_mcp_tools|list_mcp)/i.test(toolName)) {
    core = "Searched MCP tools";
  } else if (action.verb === "Explored") {
    core = shortPath || pattern ? `${action.verb} ${shortPath || pattern}` : action.verb;
  } else if (action.category === "file" || action.category === "edit") {
    const target = shortPath || fallbackName;
    core = `${action.verb} ${target}${lineRange ? ` ${lineRange}` : ""}`;
  } else if (command || filePath) {
    core = `${action.verb} ${command || shortPath || filePath}`;
  } else if (pattern) {
    core = `${action.verb} ${pattern}`;
  } else {
    core = fallbackName === "tool" ? `${action.verb} tool` : fallbackName;
  }

  const title = remote && hostname ? `${hostname}: ${core}` : core;
  const previewSource = [
    action.verb === "Grepped" ? filePath : undefined,
    action.verb === "Searched" ? pattern : undefined,
    stringField(args, "description"),
    input.detail,
  ].find((value) => {
    if (!value) return false;
    if (value === command || value === filePath || value === core || value === shortPath) return false;
    if (pattern && value === pattern && core.includes(pattern)) return false;
    return true;
  });
  const preview = compactToolPreview(previewSource);
  return {
    title,
    icon: action.icon,
    verb: action.verb,
    ...(preview && preview !== title && preview !== core ? { preview } : {}),
    ...(remote ? { remote: true } : {}),
  };
}

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

function countedLabel(count: number, one: string, many: string): string {
  return count === 1 ? `1 ${one}` : `${count} ${many}`;
}

export function truncateToolText(value: string, max = 2400): string {
  if (value.length <= max) return value;
  const keepHead = Math.max(800, Math.floor(max * 0.7));
  const keepTail = Math.max(400, max - keepHead - 80);
  const omitted = value.length - keepHead - keepTail;
  return `${value.slice(0, keepHead)}\n… [${omitted} chars omitted]\n${value.slice(-keepTail)}`;
}

export function compactFileDiff(before?: string, after?: string, contextLines = 2): string {
  if (before == null && after == null) return "";
  if ((before ?? "") === (after ?? "")) return "(no line changes)";
  const beforeLines = (before ?? "").split("\n");
  const afterLines = (after ?? "").split("\n");
  let start = 0;
  while (start < beforeLines.length && start < afterLines.length && beforeLines[start] === afterLines[start]) {
    start += 1;
  }
  let beforeEnd = beforeLines.length;
  let afterEnd = afterLines.length;
  while (beforeEnd > start && afterEnd > start && beforeLines[beforeEnd - 1] === afterLines[afterEnd - 1]) {
    beforeEnd -= 1;
    afterEnd -= 1;
  }
  const from = Math.max(0, start - contextLines);
  const afterTo = Math.min(afterLines.length, afterEnd + contextLines);
  const lines = [`@@ -${from + 1},${Math.min(beforeLines.length, beforeEnd + contextLines) - from} +${from + 1},${afterTo - from} @@`];
  for (let index = from; index < start; index += 1) lines.push(` ${beforeLines[index]}`);
  for (let index = start; index < beforeEnd; index += 1) lines.push(`-${beforeLines[index]}`);
  for (let index = start; index < afterEnd; index += 1) lines.push(`+${afterLines[index]}`);
  for (let index = afterEnd; index < afterTo; index += 1) lines.push(` ${afterLines[index]}`);
  return truncateToolText(lines.join("\n"), 4000);
}

export function toolGroupLabel(tools: Array<{ name?: string; kind?: string }>): string {
  if (tools.length <= 0) return "Tools";
  if (tools.length === 1) return "Tool";

  const counts: Record<ToolActionCategory, number> = {
    file: 0,
    search: 0,
    edit: 0,
    shell: 0,
    browser: 0,
    tool: 0,
  };
  for (const tool of tools) {
    counts[resolveToolAction(tool.name, tool.kind).category] += 1;
  }

  const parts: string[] = [];
  if (counts.file) {
    parts.push(counts.file === 1 ? "Explored 1 file" : `Explored ${counts.file} files`);
  }
  if (counts.search) parts.push(countedLabel(counts.search, "search", "searches"));
  if (counts.edit) parts.push(countedLabel(counts.edit, "edit", "edits"));
  if (counts.shell) parts.push(countedLabel(counts.shell, "command", "commands"));
  if (counts.browser) parts.push(countedLabel(counts.browser, "browser tool", "browser tools"));
  if (counts.tool) parts.push(countedLabel(counts.tool, "tool", "tools"));
  return parts.join(", ") || "Tools";
}
