import { readFileSync } from "node:fs";
import { Agent } from "@cursor/sdk";
import {
  appendMessage,
  createChat,
  getChat,
  getGlobalModelSettings,
  updateChat,
  upsertMessage,
  type ToolPart,
  type WorkspaceItem,
} from "@/lib/db-store";
import { getUserAgentCwd, getMcpServers } from "@/lib/mcp";
import { resolveAgentPath } from "@/lib/revert";
import { appendRunEvent, enqueueJob, getJob, touchJob, updateJob } from "@/lib/db-jobs";
import { isModelAllowed } from "@/lib/model-access";
import { buildAttachmentPrompt } from "@/lib/uploads";
import type { AgentJob } from "@/lib/jobs";
import {
  findActiveConnection,
  getProviderConnectionSecret,
} from "@/lib/provider-connections";
import { parseModelKey } from "@/lib/providers/types";
import { providerModelsForConnection } from "@/lib/providers/discovery";
import { routeModel, type RoutingModel } from "@/lib/model-routing";
import type { Chat } from "@/lib/store";
import { runAlternativeProviderJob } from "@/lib/providers/runner";
import { appendAgentTrace } from "@/lib/agent-trace";
import { snapshotInterruptedJob } from "@/lib/recovery";
import { createSnapshot } from "@/lib/shared-context";
import { allModes, modeById } from "@/lib/modes";
import type { AgentMode, MessagePart, ToolPermissionCategory } from "@/lib/store";
import { compress, type CompressionMode } from "@/lib/compression";

const AGENT_INIT_TIMEOUT_MS = 90_000;
const AGENT_INACTIVITY_TIMEOUT_MS = 5 * 60_000;
const AGENT_WAIT_TIMEOUT_MS = 90_000;

function nativeToolsForMode(mode: AgentMode): string[] | undefined {
  if (mode.id === "agent") return undefined;
  const tools = new Set<string>(["mcp"]);
  const categoryTools: Record<ToolPermissionCategory, string[]> = {
    read: ["read", "grep", "glob", "ls", "readLints", "readTodos"],
    write: ["edit", "delete", "applyAgentDiff"],
    terminal: ["shell"],
    browser: ["webSearch", "webFetch"],
    memory: ["mcp"],
    remote: ["mcp"],
    plan: ["updateTodos", "readTodos"],
    subagent: ["task"],
  };
  for (const category of mode.allowedCategories) {
    for (const tool of categoryTools[category]) tools.add(tool);
  }
  return [...tools];
}

const PERSISTED_CONTEXT_MAX_CHARS = 120_000;

function persistedConversationContext(
  chat: { messages: Array<{ id: string; role: string; content: string; createdAt?: string }> },
  currentMessageId?: string,
) {
  const messages = chat.messages
    .filter((message) =>
      message.id !== currentMessageId &&
      (message.role === "user" || message.role === "assistant") &&
      message.content.trim(),
    )
    .map((message) => {
      const speaker = message.role === "user" ? "User" : "Assistant";
      const timestamp = message.createdAt ? ` (${message.createdAt})` : "";
      return `${speaker}${timestamp}:\n${message.content.trim()}`;
    });

  if (!messages.length) return "";
  const context = messages.join("\n\n");
  if (context.length <= PERSISTED_CONTEXT_MAX_CHARS) return context;
  return `[Earlier persisted messages truncated to fit the model context]\n${context.slice(-PERSISTED_CONTEXT_MAX_CHARS)}`;
}

function classifyTool(name: string): ToolPart["kind"] {
  const value = name.toLowerCase();
  if (/(subagent|delegate|agent|task)/.test(value)) return "subagent";
  if (/(todo)/.test(value)) return "todo";
  if (/(note)/.test(value)) return "note";
  if (/(memory|remember)/.test(value)) return "memory";
  if (/(keyword|chat)/.test(value)) return "mcp";
  if (/(browser|navigate|playwright|webfetch)/.test(value)) return "browser";
  if (value.includes("edit_plan")) return "plan";
  if (value.includes("edit_canvas")) return "canvas";
  if (value.includes("plan")) return "plan";
  if (/(edit|write|patch|replace|create_file|delete|remove|unlink)/.test(value)) return "edit";
  if (/(read|search|list|glob|grep)/.test(value)) return "read";
  if (/(shell|terminal|command|exec|run)/.test(value)) return "shell";
  if (/(mcp|connector|integration)/.test(value)) return "mcp";
  if (value.includes("canvas")) return "canvas";
  return "other";
}

type ProvidedAttachment = {
  id: string;
  name: string;
  mimeType: string;
  kind: "image" | "file";
  storedName: string;
  size: number;
};

function extractProvidedAttachment(value: unknown): ProvidedAttachment | null {
  if (typeof value === "string") {
    try {
      return extractProvidedAttachment(JSON.parse(value));
    } catch {
      return null;
    }
  }
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if (record.attachment) return extractProvidedAttachment(record.attachment);
  if (
    typeof record.id === "string" &&
    typeof record.name === "string" &&
    typeof record.mimeType === "string" &&
    (record.kind === "image" || record.kind === "file") &&
    typeof record.storedName === "string" &&
    typeof record.size === "number"
  ) {
    return {
      id: record.id,
      name: record.name,
      mimeType: record.mimeType,
      kind: record.kind,
      storedName: record.storedName,
      size: record.size,
    };
  }
  if (Array.isArray(record.content)) {
    for (const item of record.content) {
      const attachment = extractProvidedAttachment(item);
      if (attachment) return attachment;
      if (item && typeof item === "object" && "text" in item) {
        const textAttachment = extractProvidedAttachment((item as { text?: unknown }).text);
        if (textAttachment) return textAttachment;
      }
    }
  }
  return null;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value) as unknown;
      return parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? parsed as Record<string, unknown>
        : {};
    } catch {
      return {};
    }
  }
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function asText(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    return value
      .map((item) => {
        const block = asRecord(item);
        return asText(block.text ?? block.content ?? block.message);
      })
      .filter(Boolean)
      .join("\n");
  }
  if (value && typeof value === "object") {
    const object = asRecord(value);
    return asText(object.text ?? object.content ?? object.message);
  }
  return value == null ? "" : String(value);
}

function readFileSnapshot(rawPath: string, agentCwd: string): string | undefined {
  const filePath = resolveAgentPath(rawPath, agentCwd);
  if (!filePath) return undefined;
  try {
    return readFileSync(filePath, "utf8");
  } catch {
    return undefined;
  }
}

function isDeleteTool(name: string) {
  return /(^|[._:/-])(delete|remove|unlink)(?=[._:/-]|$)/i.test(name);
}

function diffStats(before?: string, after?: string) {
  const beforeLines = (before ?? "").split("\n");
  const afterLines = (after ?? "").split("\n");
  let start = 0;
  while (start < beforeLines.length && start < afterLines.length && beforeLines[start] === afterLines[start]) start += 1;
  let beforeEnd = beforeLines.length;
  let afterEnd = afterLines.length;
  while (beforeEnd > start && afterEnd > start && beforeLines[beforeEnd - 1] === afterLines[afterEnd - 1]) {
    beforeEnd -= 1;
    afterEnd -= 1;
  }
  return {
    additions: Math.max(0, afterEnd - start),
    deletions: Math.max(0, beforeEnd - start),
  };
}

function extractEditMetadata(
  name: string,
  args: unknown,
  agentCwd: string,
  previousDiff?: ToolPart["diff"],
  captureAfter = true,
): Pick<ToolPart, "path" | "diff"> {
  if (classifyTool(name) !== "edit") return {};
  const input = asRecord(args);
  const rawPath = [input.path, input.filePath, input.filename]
    .find((value): value is string => typeof value === "string" && value.trim().length > 0);
  if (!rawPath) return {};

  const metadata: Pick<ToolPart, "path" | "diff"> = { path: rawPath };
  const filePath = resolveAgentPath(rawPath, agentCwd);
  if (!filePath) return metadata;
  const before = previousDiff?.before ?? readFileSnapshot(rawPath, agentCwd);
  if (!captureAfter) return { path: rawPath, diff: { before } };
  if (isDeleteTool(name)) {
    return { path: rawPath, diff: { before, after: undefined, ...diffStats(before, undefined) } };
  }

  const edits = Array.isArray(input.edits)
    ? input.edits
        .map(asRecord)
        .filter((edit) => typeof edit.oldText === "string" && typeof edit.newText === "string")
    : [];
  let after: string | undefined;
  try {
    after = readFileSync(filePath, "utf8");
  } catch {
    after = typeof input.content === "string" ? input.content : undefined;
  }
  if (typeof input.content === "string") after = input.content;

  if (edits.length && typeof after === "string") {
    let reconstructedBefore = after;
    for (let index = edits.length - 1; index >= 0; index -= 1) {
      const edit = edits[index];
      const newText = edit.newText as string;
      const oldText = edit.oldText as string;
      const position = reconstructedBefore.indexOf(newText);
      if (position < 0) break;
      reconstructedBefore = `${reconstructedBefore.slice(0, position)}${oldText}${reconstructedBefore.slice(position + newText.length)}`;
    }
    // A tool_call event can arrive after the SDK has already applied the edit.
    // In that case the snapshot captured from disk is the *after* state and
    // produces a misleading +0 -0 diff. Prefer it only when replaying the
    // declared edit actually produces the recorded result.
    const previousBefore = previousDiff?.before;
    const previousReplaysToAfter = (() => {
      if (typeof previousBefore !== "string") return false;
      let candidate = previousBefore;
      for (const edit of edits) {
        const oldText = edit.oldText as string;
        const newText = edit.newText as string;
        const position = candidate.indexOf(oldText);
        if (position < 0) return false;
        candidate = `${candidate.slice(0, position)}${newText}${candidate.slice(position + oldText.length)}`;
      }
      return candidate === after;
    })();
    const originalBefore = previousReplaysToAfter ? previousBefore : reconstructedBefore;
    return { path: rawPath, diff: { before: originalBefore, after, ...diffStats(originalBefore, after) } };
  }
  return { path: rawPath, diff: { before, after, ...diffStats(before, after) } };
}

function extractSubagent(
  name: string,
  args: unknown,
  result: unknown,
): ToolPart["subagent"] | undefined {
  if (classifyTool(name) !== "subagent") return undefined;
  const input = asRecord(args);
  const output = asRecord(result);
  const resultValue = asRecord(output.value);
  const steps = Array.isArray(resultValue.conversationSteps)
    ? resultValue.conversationSteps
    : Array.isArray(resultValue.messages)
      ? resultValue.messages
      : [];
  const nestedTools = steps
    .map((step) => asRecord(step))
    .flatMap((item) => {
      const candidates = Array.isArray(item.tools)
        ? item.tools
        : item.toolCall || item.tool_call
          ? [item.toolCall || item.tool_call]
          : item.tool
            ? [item.tool]
            : [];
      return candidates.map((candidate) => asRecord(candidate));
    })
    .map((item, index) => {
      const name = typeof item.name === "string" ? item.name : typeof item.toolName === "string" ? item.toolName : "tool";
      return {
        id: typeof item.id === "string" ? item.id : `${name}-${index}`,
        name,
        status: typeof item.status === "string" ? item.status : "completed",
        kind: classifyTool(name),
        ...(item.input !== undefined ? { input: JSON.stringify(item.input) } : {}),
        ...(item.result !== undefined ? { result: JSON.stringify(item.result) } : {}),
      } satisfies ToolPart;
    });
  let thinking = "";
  const messages = steps
    .map((step) => {
      const item = asRecord(step);
      const thinkingText = asText(item.thinkingMessage ?? item.thinking ?? item.reasoning);
      if (thinkingText) thinking += `${thinking ? "\n\n" : ""}${thinkingText}`;
      const role = typeof item.role === "string"
        ? item.role
        : typeof item.type === "string"
          ? item.type
          : "assistant";
      const text = asText(item.text ?? item.content ?? item.message ?? item.response ?? item.answer ?? item.result);
      return text ? { role, text } : null;
    })
    .filter((message): message is { role: string; text: string } => Boolean(message));
  const agentId = [input.agentId, resultValue.agentId].find(
    (value): value is string => typeof value === "string" && value.length > 0,
  );
  const title = [input.description, input.title].find(
    (value): value is string => typeof value === "string" && value.length > 0,
  );
  const prompt = typeof input.prompt === "string" ? input.prompt : undefined;
  const mode = typeof input.mode === "string" ? input.mode : undefined;
  const model = typeof input.model === "string" ? input.model : undefined;
  if (!agentId && !title && !prompt && !mode && !model && !messages.length) return undefined;
  return {
    agentId,
    title,
    mode,
    model,
    prompt,
    ...(thinking ? { thinking } : {}),
    ...(messages.length ? { messages } : {}),
    ...(nestedTools.length ? { tools: nestedTools } : {}),
  };
}

function normalizeToolId(value: string) {
  return value.trim().replace(/\s+/g, "");
}

function isFinishedToolStatus(value: string) {
  return ["completed", "success", "succeeded", "done"].includes(value.trim().toLowerCase());
}

function isActiveToolStatus(value: string) {
  return ["running", "in_progress", "pending", "started", "executing", "queued"].includes(value.trim().toLowerCase());
}

function closeRunningTools(tools: ToolPart[], status: string) {
  for (const tool of tools) {
    if (isActiveToolStatus(tool.status)) tool.status = status;
  }
}

function extractWorkspace(value: string) {
  const visit = (candidate: unknown, depth = 0): {
    type?: "plan" | "canvas";
    id?: string;
    workspaceLink?: string;
    title: string;
    content: string;
    version?: number;
    createdAt?: string;
    updatedAt?: string;
  } | null => {
    if (depth > 8 || candidate == null) return null;
    if (typeof candidate === "string") {
      const plain = candidate.trim();
      if (!plain) return null;
      try {
        return visit(JSON.parse(plain), depth + 1);
      } catch {
        return plain.startsWith("{") ? null : { title: "Plan", content: plain };
      }
    }
    if (Array.isArray(candidate)) {
      for (const item of candidate) {
        const result = visit(item, depth + 1);
        if (result) return result;
      }
      return null;
    }
    if (typeof candidate !== "object") return null;
    const parsed = candidate as Record<string, unknown>;
    const nested = parsed.value && typeof parsed.value === "object"
      ? parsed.value as Record<string, unknown>
      : {};
    const contentCandidate = [parsed.content, parsed.plan, nested.content, nested.plan]
      .find((item): item is string => typeof item === "string");
    if (contentCandidate !== undefined) {
      const type = [parsed.type, nested.type]
        .find((item): item is "plan" | "canvas" => item === "plan" || item === "canvas");
      const title = [parsed.title, parsed.name, nested.title, nested.name]
        .find((item): item is string => typeof item === "string" && item.trim().length > 0);
      const id = [parsed.id, nested.id]
        .find((item): item is string => typeof item === "string" && item.trim().length > 0);
      const workspaceLink = [parsed.workspaceLink, nested.workspaceLink]
        .find((item): item is string => typeof item === "string" && item.trim().length > 0);
      const version = [parsed.version, nested.version]
        .find((item): item is number => typeof item === "number" && Number.isFinite(item));
      const createdAt = [parsed.createdAt, nested.createdAt]
        .find((item): item is string => typeof item === "string" && item.trim().length > 0);
      const updatedAt = [parsed.updatedAt, nested.updatedAt]
        .find((item): item is string => typeof item === "string" && item.trim().length > 0);
      return {
        type,
        id,
        workspaceLink,
        title: title?.trim() || (type === "canvas" ? "Canvas" : "Plan"),
        content: contentCandidate,
        ...(version !== undefined ? { version: Math.max(1, Math.floor(version)) } : {}),
        ...(createdAt ? { createdAt } : {}),
        ...(updatedAt ? { updatedAt } : {}),
      };
    }
    for (const key of ["value", "content", "text", "result"]) {
      const result = visit(parsed[key], depth + 1);
      if (result) return result;
    }
    return null;
  };
  return visit(value);
}

function extractSuggestions(value: string) {
  const match = value.match(/```suggestions\s*\n([\s\S]*?)```/i);
  if (!match) return { text: value, suggestions: [] as string[] };
  const suggestions = match[1]
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, "").trim())
    .filter(Boolean)
    .map((line) => {
      const separator = line.indexOf("=>");
      if (separator <= 0) return line;
      const label = line.slice(0, separator).trim();
      const prompt = line.slice(separator + 2).trim();
      return label && prompt ? { label, prompt } : line;
    })
    .slice(0, 5);
  return {
    text: value.replace(match[0], "").replace(/\n{3,}/g, "\n\n").trim(),
    suggestions,
  };
}

function ensureRecommendationSuggestions(value: string) {
  if (/```suggestions\s*\n/i.test(value)) return value;
  if (!/(demo|stub|noch nicht|nicht produktiv|nicht angebunden|nicht konfiguriert|nicht implementiert|mock|placeholder)/i.test(value)) {
    return value;
  }
  return `${value.trim()}\n\n\`\`\`suggestions\nResend anbinden => Resend konfigurieren und eine manuelle E-Mail-Vorschau implementieren.\nEchte Recherche anbinden => Die Demo-Daten durch eine echte Websuche mit Quellen und Fehlerbehandlung ersetzen.\nDatenbank migrieren => Die JSON-Speicherung durch eine persistente Datenbank mit Migration ersetzen.\n\`\`\``;
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(message)), timeoutMs);
    }),
  ]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

function markJobError(job: AgentJob, message: string) {
  updateJob(job.id, { status: "error", error: message });
  updateChat(job.chatId, {
    runStatus: "error",
    runUpdatedAt: new Date().toISOString(),
    queueMessage: null,
    badge: "red",
  }, job.userId);
  appendRunEvent(job.id, job.chatId, job.userId, "error", { message });
  appendAgentTrace(job, "error", { message });
}

/**
 * Resolve the "auto" model key for a job. Gathers candidates from every
 * enabled provider connection (any provider kind), pulls passive telemetry
 * when the model_signals table exists, and delegates the actual choice to the
 * pure `routeModel` function in lib/model-routing.ts.
 */
async function resolveAutoModel(job: AgentJob, chat: Chat): Promise<string | null> {
  if (!job.userId) return null;
  try {
    const { listProviderConnections } = await import("@/lib/provider-connections");
    const connections = listProviderConnections(job.userId, false);
    const candidates: RoutingModel[] = [];
    for (const connection of connections) {
      if (connection.providerKey === "cursor") continue;
      try {
        for (const model of providerModelsForConnection(connection)) {
          candidates.push({
            key: model.key,
            id: model.id,
            displayName: model.displayName,
            contextWindow: model.contextWindow,
            tags: "tags" in model && Array.isArray(model.tags) ? model.tags : undefined,
          });
        }
      } catch {
        // A broken connection should not break routing for the others.
      }
    }
    if (!candidates.length) return null;

    // Approximate the working context: current prompt + recent history.
    const historyTokens = Math.ceil(
      chat.messages.slice(-20).reduce((total: number, message: { content: string }) => total + message.content.length, 0) / 4,
    );
    const promptTokens = Math.ceil((job.message || "").length / 4);
    const description = [
      job.message || "",
      job.referenceText ? `context: ${job.referenceText.slice(0, 400)}` : "",
    ].filter(Boolean).join("\n");

    let signals;
    try {
      const { getAllModelPerformance } = await import("@/lib/model-telemetry");
      const known = new Set(candidates.map((model) => model.key));
      const summaries = getAllModelPerformance({ sinceDays: 30 })
        .filter((summary) => known.has(summary.modelId));
      if (summaries.length) {
        signals = {
          byModel: Object.fromEntries(summaries.map((summary) => [summary.modelId, {
            compositeScore: summary.compositeScore,
            successRate: summary.successRate,
            avgTimeToFirstTokenMs: summary.avgTimeToFirstTokenMs,
            avgLatencyMs: summary.avgLatencyMs,
            totalRuns: summary.totalRuns,
          }])),
        };
      }
    } catch {
      // model_signals is created lazily; absence is a normal first-run state.
    }

    const routed = routeModel(description, candidates, signals) ||
      routeModel(description + "\n", candidates) ||
      candidates[0].key;
    return isModelAllowed(job.userId, routed) ? routed : candidates.find((model) => isModelAllowed(job.userId, model.key))?.key || null;
  } catch {
    return null;
  }
}

export async function runQueuedJob(job: AgentJob) {
  const chat = getChat(job.chatId, job.userId);
  if (!chat) {
    markJobError(job, "Chat not found or access denied.");
    return;
  }
  let requestedModelId = job.modelId || chat.modelId || "";
  // Context-aware auto routing: "auto" resolves to a concrete model based on
  // the task shape (simple → fast, complex/code → high tier, big context →
  // largest window) across ALL enabled provider connections, not just one
  // provider kind. Passive model_signals telemetry nudges the choice when
  // available. Falls back to the first allowed model when routing cannot
  // decide.
  if (requestedModelId === "auto" && job.userId) {
    const routed = await resolveAutoModel(job, chat);
    if (routed) {
      requestedModelId = routed;
      appendAgentTrace(job, "info", { message: `Auto routing selected ${routed}.` });
    } else {
      markJobError(job, "No model is available for automatic routing. Select a model first.");
      return;
    }
  }
  if (!requestedModelId) {
    markJobError(job, "No model is selected for this chat.");
    return;
  }
  if (!isModelAllowed(job.userId, requestedModelId)) {
    markJobError(job, "This model is not available for your account.");
    return;
  }
  const modelReference = parseModelKey(requestedModelId);
  if (modelReference.providerKey !== "cursor") {
    await runAlternativeProviderJob(job, chat);
    return;
  }
  const cursorConnection = job.userId
    ? findActiveConnection(job.userId, "cursor")
    : null;
  const cursorCredential = cursorConnection && job.userId
    ? getProviderConnectionSecret(cursorConnection.id, job.userId)
    : null;
  const apiKey = cursorCredential?.secret;
  if (!cursorConnection || !apiKey) {
    markJobError(job, "No enabled Cursor SDK connection is configured for this user.");
    return;
  }
  const agentCwd = getUserAgentCwd(job.userId);
  const assistantMessageId = crypto.randomUUID();
  appendMessage(job.chatId, { id: assistantMessageId, role: "assistant", content: "" });
  const emit = (event: string, data: unknown) => {
    appendAgentTrace(job, event, data);
    const result = appendRunEvent(job.id, job.chatId, job.userId, event, data);
    const needsAttention = event === "question" || event === "error";
    if (needsAttention) {
      updateChat(job.chatId, { badge: "red" }, job.userId);
    } else if (event === "done") {
      updateChat(job.chatId, { badge: "blue" }, job.userId);
    }
    return result;
  };
  emit("assistantId", { messageId: assistantMessageId });
  updateChat(job.chatId, {
    runStatus: "running",
    runUpdatedAt: new Date().toISOString(),
    queueMessage: null,
  });
  createSnapshot({
    chatId: job.chatId,
    ...(job.userId ? { ownerId: job.userId } : {}),
    checkpoint: "important",
    runStatus: "running",
    resumeMarker: { jobId: job.id, runId: job.runId || job.id, safe: false, reason: "Agent run was active at checkpoint." },
    availability: "available",
  });
  emit("status", { status: "running" });
  let agent: Awaited<ReturnType<typeof Agent.create>> | undefined;
  let text = "";
  const tools: ToolPart[] = [];
  const parts: MessagePart[] = [];
  const providedAttachments: ProvidedAttachment[] = [];
  const createdWorkspaces: WorkspaceItem[] = [];
  const createdChats: Array<{ id: string; title: string }> = [];
  const globalModelSettings = getGlobalModelSettings(job.userId);
  const compressionSettings = globalModelSettings.compression;
  const compressionEnabled = Boolean(compressionSettings?.enabled) && !job.incognito && !chat.incognito;
  const compressionMode: CompressionMode = compressionSettings?.mode || "stacked";
  const compressContext = (value: string, enabled: boolean) =>
    compressionEnabled && enabled ? compress(value, compressionMode).text : value;
  const activeMode = modeById(job.modeId || chat.sessionState?.modeId, globalModelSettings.customModes || []);
  const nativeTools = nativeToolsForMode(activeMode);
  const availableModes = allModes(globalModelSettings.customModes || [])
    .map((mode) => `${mode.id} (${mode.name})`)
    .join(", ");
  const mcpContext = {
    chatId: job.chatId,
    userId: job.userId,
    jobId: job.id,
    incognito: Boolean(job.incognito || chat.incognito),
    automation: Boolean(job.automationId),
    modeId: activeMode.id,
    modePolicy: JSON.stringify({
      allowedCategories: activeMode.allowedCategories,
      toolOverrides: activeMode.toolOverrides || {},
    }),
    compressionEnabled,
    compressionMode,
    compressionToolResults: Boolean(compressionSettings?.compressToolResults ?? true),
  };
  const configuredSubagentModel = job.extendedModelId ||
    (globalModelSettings.subagentModelEnabled ? globalModelSettings.subagentModelId : undefined);
  const configuredSubagentModelParams = configuredSubagentModel
    ? globalModelSettings.modelParamsByModel?.[configuredSubagentModel] || []
    : [];
  const customSubagentDefinitions = configuredSubagentModel
    ? Object.fromEntries(
        ["generalPurpose", "explore", "shell", "browser-use", "bugbot", "security-review", "best-of-n-runner"]
          .map((name) => [
            name,
            {
              description: `Delegate work to a ${name} subagent using the configured standard model.`,
              prompt: `Use the configured standard subagent model (${configuredSubagentModel}) for this task.`,
              model: {
                id: configuredSubagentModel,
                ...(configuredSubagentModelParams.length
                  ? { params: configuredSubagentModelParams }
                  : {}),
              },
            },
          ]),
      )
    : undefined;
  const subagentModelInstruction =
    configuredSubagentModel
      ? `Subagent model policy: whenever you delegate work to a subagent, use model "${configuredSubagentModel}". Do not override this configured model with another model.`
      : "Subagent model policy: no standard subagent model is configured. Choose the subagent model yourself.";
  const heartbeat = setInterval(() => {
    touchJob(job.id);
    const active = tools.filter((tool) => isActiveToolStatus(tool.status));
    appendAgentTrace(job, "heartbeat", {
      textChars: text.length,
      toolCount: tools.length,
      activeTools: active.map((tool) => ({ id: tool.id, name: tool.name, status: tool.status })),
    });
  }, 30_000);
  appendAgentTrace(job, "start", {
    modelId: job.modelId,
    modeId: activeMode.id,
    cwd: agentCwd,
    resume: Boolean(job.resumePrompt),
    tracePath: `${job.createdAt.slice(0, 10)}/${job.id}.jsonl`,
  });
  let checkpointTimer: ReturnType<typeof setTimeout> | undefined;
  let checkpointDirty = false;
  const checkpointNow = () => {
    upsertMessage(job.chatId, {
      id: assistantMessageId,
      role: "assistant",
      content: text,
      ...(tools.length ? { tools: [...tools] } : {}),
      ...(parts.length ? { parts: [...parts] } : {}),
      ...(providedAttachments.length ? { attachments: [...providedAttachments] } : {}),
    });
    checkpointDirty = false;
  };
  const checkpoint = (immediate = false) => {
    checkpointDirty = true;
    if (immediate) {
      if (checkpointTimer) clearTimeout(checkpointTimer);
      checkpointTimer = undefined;
      checkpointNow();
      return;
    }
    if (checkpointTimer) return;
    // Chat persistence uses synchronous SQLite writes. Keep live text durable
    // without blocking the HTTP/WebSocket event loop on every token.
    checkpointTimer = setTimeout(() => {
      checkpointTimer = undefined;
      if (checkpointDirty) checkpointNow();
    }, 1500);
  };
  const persistWorkspace = (type: WorkspaceItem["type"], content: string, name = type === "plan" ? "Plan" : "Canvas") => {
    const current = getChat(job.chatId, job.userId);
    if (!current) return;
    const timestamp = new Date().toISOString();
    const heading = content.match(/^\s{0,3}#\s+(.+?)\s*$/m)?.[1]?.trim();
    const requestedName = name.trim();
    let resolvedName = (
      (!requestedName || /^(create\s+)?(plan|canvas)$/i.test(requestedName)) && heading
        ? heading
        : requestedName
    ).slice(0, 200) || (type === "plan" ? "Plan" : "Canvas");
    const names = new Set(
      (current.workspaces || [])
        .filter((item) => item.type === type)
        .map((item) => item.name.trim().toLocaleLowerCase()),
    );
    if (names.has(resolvedName.toLocaleLowerCase())) {
      let suffix = 2;
      const baseName = resolvedName;
      while (names.has(`${baseName} (${suffix})`.toLocaleLowerCase())) suffix += 1;
      resolvedName = `${baseName} (${suffix})`.slice(0, 200);
    }
    const workspace: WorkspaceItem = {
      id: crypto.randomUUID(),
      type,
      name: resolvedName,
      content: content.trim().slice(0, 100_000),
      createdAt: timestamp,
      updatedAt: timestamp,
      version: 1,
    };
    updateChat(job.chatId, {
      workspaces: [
        ...(current.workspaces || []).filter((item) => item.id !== workspace.id),
        workspace,
      ].slice(-20),
    }, job.userId);
    if (!createdWorkspaces.some((item) => item.id === workspace.id)) {
      createdWorkspaces.push(workspace);
    }
    return workspace;
  };
  try {
    const modelParams = job.modelParams?.length
      ? job.modelParams
      : chat.modelParams;
    const model = {
      id: requestedModelId,
      ...(modelParams?.length ? { params: modelParams } : {}),
    };
    agent = job.agentId || chat.agentId
      ? await (async () => {
          try {
            return await withTimeout(Agent.resume(job.agentId || chat.agentId!, {
              apiKey,
              model,
              local: { cwd: agentCwd, settingSources: ["project"] },
              ...(nativeTools ? { tools: nativeTools } : {}),
              mcpServers: getMcpServers(mcpContext),
              ...(customSubagentDefinitions ? { agents: customSubagentDefinitions } : {}),
            }), AGENT_INIT_TIMEOUT_MS, "The agent session could not be resumed within 90 seconds.");
          } catch (resumeError) {
            const messageText = resumeError instanceof Error ? resumeError.message : String(resumeError);
            if (/not found|no such|does not exist|unknown agent/i.test(messageText)) {
              // Stale agent id (server restart, expired session): fall back to a
              // fresh agent instead of failing the whole job.
              appendRunEvent(job.id, job.chatId, job.userId, "info", {
                message: "Previous agent session was not found; started a new session.",
              });
              updateChat(job.chatId, { agentId: null }, job.userId);
              return await withTimeout(Agent.create({
                apiKey,
                model,
                local: { cwd: agentCwd, settingSources: ["project"] },
                ...(nativeTools ? { tools: nativeTools } : {}),
                mcpServers: getMcpServers(mcpContext),
                ...(customSubagentDefinitions ? { agents: customSubagentDefinitions } : {}),
              }), AGENT_INIT_TIMEOUT_MS, "The agent session could not be created within 90 seconds.");
            }
            if (/already has active run|InvalidRunStateTransition/i.test(messageText)) {
              // The persisted agent still has a live/locked run (crashed worker,
              // concurrent send). Retry resume once after a short grace period,
              // then start a fresh session instead of failing the job.
              appendRunEvent(job.id, job.chatId, job.userId, "info", {
                message: "Agent session still had an active run; retrying once before starting a new session.",
              });
              await new Promise((resolve) => setTimeout(resolve, 3_000));
              try {
                return await withTimeout(Agent.resume(job.agentId || chat.agentId!, {
                  apiKey,
                  model,
                  local: { cwd: agentCwd, settingSources: ["project"] },
                  ...(nativeTools ? { tools: nativeTools } : {}),
                  mcpServers: getMcpServers(mcpContext),
                  ...(customSubagentDefinitions ? { agents: customSubagentDefinitions } : {}),
                }), AGENT_INIT_TIMEOUT_MS, "The agent session could not be resumed within 90 seconds.");
              } catch (retryError) {
                appendRunEvent(job.id, job.chatId, job.userId, "info", {
                  message: "Active run did not clear; starting a new agent session.",
                });
                updateChat(job.chatId, { agentId: null }, job.userId);
                return await withTimeout(Agent.create({
                  apiKey,
                  model,
                  local: { cwd: agentCwd, settingSources: ["project"] },
                  ...(nativeTools ? { tools: nativeTools } : {}),
                  mcpServers: getMcpServers(mcpContext),
                  ...(customSubagentDefinitions ? { agents: customSubagentDefinitions } : {}),
                }), AGENT_INIT_TIMEOUT_MS, "The agent session could not be created within 90 seconds.");
              }
            }
            throw resumeError;
          }
        })()
      : await withTimeout(Agent.create({
          apiKey,
          model,
          local: { cwd: agentCwd, settingSources: ["project"] },
          ...(nativeTools ? { tools: nativeTools } : {}),
          mcpServers: getMcpServers(mcpContext),
          ...(customSubagentDefinitions ? { agents: customSubagentDefinitions } : {}),
        }), AGENT_INIT_TIMEOUT_MS, "The agent session could not be created within 90 seconds.");
    updateJob(job.id, { agentId: agent.agentId, runId: job.id });
    updateChat(job.chatId, { agentId: agent.agentId }, job.userId);
    const prompt = [
      `Current agent mode: ${activeMode.name}\n${activeMode.instructions}`,
      "Working style: precise, technically fluent, proactive. Act with your tools instead of describing steps. Reply in the user's language — German in, German out. No filler phrases. On clear orders decide and act yourself; ask back only when genuinely ambiguous or destructive.",
      "Tool discipline: Call known tools directly. Do not begin a task with gateway_status or search_tools. search_tools is only for unknown child-MCP capabilities; gateway_status is only for diagnosing the gateway. Skip write_todos unless the task has 3+ distinct steps — never rewrite a finished checklist. File edits must pass the smallest unique snippet, never the whole file. read_file must use offset+limit around the relevant region. Use context_profile or context_search, not both. Do not narrate tool-by-tool progress in the user-visible reply.",
      `Available mode IDs for request_mode_change: ${availableModes || "agent (Agent), plan (Plan), ask (Ask)"}. Use the exact ID before the parentheses; never invent values such as "Code". For implementation or file changes, request modeId "agent".`,
      "Response recommendation rule: when the result is incomplete, uses demo/stub endpoints, or still lacks real integrations, clearly say what is and is not implemented, then always provide 1–3 concise, concrete next-step recommendations in exactly one ```suggestions fenced block so the UI can render clickable actions. End by asking whether to implement the recommended next step. Do not present demo functionality as production-ready.",
      ...(activeMode.id !== "agent"
        ? [
            "Mode transition rule: if the user's request requires a tool category this mode does not allow, you MUST call the request_mode_change MCP tool and ask for confirmation. Do not merely tell the user to switch modes manually. After confirmation, continue the original request in this same run using the newly allowed MCP tools (for example write_file); do not wait for a second user message.",
          ]
        : []),
      ...(job.incognito || chat.incognito
        ? ["Incognito mode: do not use or mention personal context, memories, chat metadata, notes, or workspaces. Incognito-only tool restrictions are enforced server-side."]
        : job.automationId
          ? [
              "Automation run: execute autonomously without waiting for the user. Never call ask_user, request_mode_change, wait, subagent_status, or any confirmation/user-approval tool. If information is missing, make a safe reasonable assumption and continue; if the task cannot be completed safely, explain that in the final response.",
            ]
        : [
            "Personal context: the context_search / context_profile / context_remember MCP tools access the owner's shared context hub (devices, services, projects, preferences). When a task touches the owner's infrastructure, projects, or devices, consult them FIRST instead of asking the user. Do not dump contents unprompted; cite only what the query returned. Store newly learned durable preferences (how the owner wants things) via context_remember. list_memories/add_memory manage lightweight in-app memories the same way.",
            `Current chat keywords: ${chat.keywords?.join(", ") || "(none)"}`,
            `Existing workspaces:\n${chat.workspaces?.map((item) => `[${item.type}] ${item.name} (workspace://${item.type}/${item.id})`).join("\n") || "(none)"}`,
          ]),
      ...(job.incognito || chat.incognito ? [] : [
      "When referring to an existing or newly created plan/canvas, include its exact Markdown link using workspace://plan/<id> or workspace://canvas/<id>.",
      "When referring to an existing or newly created note, include its exact Markdown link using note://<id>, for example [Note title](note://note-id). Notes must be clickable links, not only bold text.",
      "Use list_notes or search_notes when you need note IDs before linking them.",
      "When you use browser results, selected references, or other verifiable web sources, cite the exact URL immediately after the sentence it supports using the format [Source: Website title](URL). At the end, put every source used in exactly one fenced block starting with ```sources, with one Markdown link per line. Never invent URLs; if no verifiable source is available, do not create a sources block.",
      "To create a plan or canvas, call the MCP tools create_plan or create_canvas with title and content. Use an empty content string for a blank workspace, and do not claim creation without a completed tool call.",
      "Progress tracking: call write_todos only for multi-step work (3+ steps) and keep statuses updated so it renders in the chat. In Agent mode do not call create_plan unless the user asked for a plan document or you are in Plan mode.",
      "For memories, use list_memories to retrieve the current user's entries, add_memory only for useful durable facts or preferences, and edit_memory with the exact memory id to change an existing entry. Never claim a memory was changed without a completed tool call.",
      "To edit an existing workspace, call edit_plan or edit_canvas with its exact id and the changed title/content. Do not create a duplicate when the user asked to edit.",
      "When the chat topic is clear or changes, silently call update_chat_keywords with 3-8 concise, non-sensitive search terms using mode=add. Do not mention this metadata maintenance in the main response. Use search_chats when you need to locate an earlier chat by title, keyword, or message content.",
      "Use delete_memory, delete_plan, and delete_canvas only for explicit user requests. Before destructive or external actions, use request_confirmation and continue only when the user chooses Confirm.",
      "Use list_workspaces before editing or deleting a workspace, and use git_status/git_diff to inspect project changes. Browser helpers include browser_extract_text, browser_fill_form, and browser_download.",
      ]),
      "You can create a follow-up chat by outputting exactly one or more fenced blocks in this format:\n```chat title=\"Short title\"\nMessage to send in the new chat\n```\nThe block creates a new chat for the current user, sends the message there, and starts an agent run. Do not claim a chat was created without outputting this block.",
      "When useful, offer up to five concise follow-up questions at the end using exactly this UI-only format. Use `display text => prompt to insert` when the visible label should differ from the inserted prompt:\n```suggestions\nExplain this in more detail => Explain the database synchronization in more detail, with a concrete example.\nShow me an example\n```\nDo not mention or explain this format outside the block.",
      subagentModelInstruction,
      `Your private AI workspace is:\n${agentCwd}\nUse this directory as the working directory for project files and commands. Do not use another user's workspace.`,
      ...(job.incognito || chat.incognito
        ? []
        : (() => {
            const persistedContext = compressContext(
              persistedConversationContext(chat, job.messageId),
              Boolean(compressionSettings?.compressChatHistory ?? true),
            );
            return persistedContext
              ? [
                  "Persisted conversation context:\n" +
                    "This transcript comes from durable chat storage and must remain available after service or agent restarts. " +
                    "Use it as the authoritative prior conversation. Do not ask the user to repeat information that is already present here.\n\n" +
                    persistedContext,
                ]
              : [];
          })()),
      job.resumePrompt
        ? `Resume the paused agent run. Do not repeat earlier tool calls or user-facing work. Continue only from the saved pause point using this answer/context:\n${compressContext(job.resumePrompt, Boolean(compressionSettings?.compressToolResults ?? true))}`
        : `User message:\n${job.message || "(see attachments)"}`,
      buildAttachmentPrompt(job.chatId, job.attachments, job.userId),
      !job.incognito && !chat.incognito && job.references?.length
        ? `Selected references:\n${job.references.map((reference) => [
            `- [${reference.kind}] ${reference.label}`,
            reference.detail ? `  Detail: ${reference.detail}` : "",
            reference.path ? `  Path/URL: ${reference.path}` : "",
            reference.content ? `  Context:\n${reference.content}` : "",
          ].filter(Boolean).join("\n")).join("\n")}`
        : "",
      !job.incognito && !chat.incognito && job.referenceText ? `Referenced plan:\n${job.referenceText}` : "",
    ].filter(Boolean).join("\n\n");
    let receivedTextDelta = false;
    let cancellationRequested = false;
    let activeRun: { cancel: () => Promise<unknown> } | null = null;
    let run: Awaited<ReturnType<typeof agent.send>>;
    let sendTimeout: ReturnType<typeof setTimeout> | undefined;
    let inactivityTimer: ReturnType<typeof setTimeout> | undefined;
    const resetInactivityTimer = () => {
      if (inactivityTimer) clearTimeout(inactivityTimer);
      inactivityTimer = setTimeout(() => {
        const active = tools.filter((tool) => isActiveToolStatus(tool.status));
        const payload = {
          reason: active.length ? "active_tool" : "stream_gap",
          activeTools: active.map((tool) => ({ id: tool.id, name: tool.name, status: tool.status })),
          textChars: text.length,
        };
        appendAgentTrace(job, "inactivity", payload);
        emit("status", {
          status: "running",
          message: active.length
            ? `Waiting on ${active.map((tool) => tool.name).join(", ")}.`
            : "No new tokens for 5 minutes; continuing instead of aborting.",
        });
        resetInactivityTimer();
      }, AGENT_INACTIVITY_TIMEOUT_MS);
    };
    const cancellationWatcher = setInterval(() => {
      if (getJob(job.id)?.status === "cancelled") {
        cancellationRequested = true;
        void activeRun?.cancel().catch(() => undefined);
      }
    }, 250);
    try {
      run = await Promise.race([
        agent.send(prompt, {
          mcpServers: getMcpServers(mcpContext),
          onDelta: ({ update }) => {
            if (cancellationRequested || update.type !== "text-delta") return;
            resetInactivityTimer();
            const delta = String((update as { text?: string }).text || "");
            if (!delta) return;
            receivedTextDelta = true;
            text += delta;
            const lastPart = parts.at(-1);
            if (lastPart?.type === "text") lastPart.content += delta;
            else parts.push({ type: "text", content: delta });
            checkpoint();
            emit("text", { text: delta });
          },
        }),
        new Promise<never>((_, reject) => {
          sendTimeout = setTimeout(
            () => reject(new Error("The agent did not start responding within 90 seconds.")),
            90_000,
          );
        }),
      ]).finally(() => {
        if (sendTimeout) clearTimeout(sendTimeout);
      });
      activeRun = run;
      resetInactivityTimer();
      for await (const event of run.stream()) {
        resetInactivityTimer();
        if (getJob(job.id)?.status === "cancelled") {
          cancellationRequested = true;
          await run.cancel().catch(() => undefined);
          break;
        }
        if (event.type === "status") {
        emit("status", {
          status: String((event as { status?: string }).status || "running"),
          message: (event as { message?: string }).message,
        });
        } else if (["tool_call", "tool_use", "tool_result"].includes(String((event as { type?: unknown }).type))) {
        const eventType = String((event as { type?: unknown }).type);
        const rawToolEvent = event as unknown as Record<string, unknown>;
        const rawCallId =
          rawToolEvent.call_id ||
          rawToolEvent.callId ||
          rawToolEvent.tool_call_id;
        const toolId = normalizeToolId(typeof rawCallId === "string" ? rawCallId : crypto.randomUUID());
        const existingTool = tools.find((tool) => tool.id === toolId);
        const toolName =
          (typeof rawToolEvent.name === "string" && rawToolEvent.name) ||
          (typeof rawToolEvent.tool_name === "string" && rawToolEvent.tool_name) ||
          (typeof rawToolEvent.toolName === "string" && rawToolEvent.toolName) ||
          existingTool?.name ||
          "tool";
        const toolStatus =
          (typeof rawToolEvent.status === "string" && rawToolEvent.status) ||
          (eventType === "tool_result" ? "completed" : "running");
        const toolArgs = rawToolEvent.args ?? rawToolEvent.input ?? rawToolEvent.arguments;
        const toolResult = rawToolEvent.result ?? rawToolEvent.output ?? rawToolEvent.content;
        const subagent = extractSubagent(toolName, toolArgs, toolResult);
        let editArgs = toolArgs;
        if (editArgs === undefined && existingTool?.input) {
          try {
            editArgs = JSON.parse(existingTool.input);
          } catch {
            editArgs = undefined;
          }
        }
        const editMetadata =
          toolStatus === "running" || isFinishedToolStatus(toolStatus)
            ? extractEditMetadata(
                toolName,
                editArgs,
                agentCwd,
                existingTool?.diff,
                isFinishedToolStatus(toolStatus),
              )
            : {};
        const nextTool: ToolPart = {
          id: toolId,
          name: toolName,
          status: toolStatus,
          kind: classifyTool(toolName),
          ...(editMetadata.path ? { path: editMetadata.path } : {}),
          ...(editMetadata.diff ? { diff: editMetadata.diff } : {}),
          ...(editArgs !== undefined ? { input: JSON.stringify(editArgs) } : {}),
          ...(toolResult !== undefined ? { result: JSON.stringify(toolResult) } : {}),
          ...(subagent ? { subagent } : {}),
        };
        const existingToolIndex = tools.findIndex((tool) => tool.id === toolId);
        if (existingToolIndex >= 0) {
          tools[existingToolIndex] = { ...tools[existingToolIndex], ...nextTool };
        } else {
          tools.push(nextTool);
        }
        const existingPartIndex = parts.findIndex((part) => part.type === "tool" && part.id === toolId);
        if (existingPartIndex >= 0) {
          const previousPart = parts[existingPartIndex];
          if (previousPart.type === "tool") parts[existingPartIndex] = { ...previousPart, ...nextTool };
        } else {
          parts.push({ type: "tool", ...nextTool });
        }
        checkpoint(true);
        const toolResultText = typeof toolResult === "string"
          ? toolResult
          : toolResult ? JSON.stringify(toolResult) : "";
        const providedAttachment =
          toolName === "provide_file" && isFinishedToolStatus(toolStatus)
            ? extractProvidedAttachment(toolResult)
            : null;
        if (providedAttachment && !providedAttachments.some((item) => item.id === providedAttachment.id)) {
          providedAttachments.push(providedAttachment);
        }
        const parsedWorkspace =
          extractWorkspace(toolResultText) ||
          (toolArgs !== undefined ? extractWorkspace(JSON.stringify(toolArgs)) : null) ||
          (existingTool?.input ? extractWorkspace(existingTool.input) : null);
        if (isFinishedToolStatus(toolStatus) && (nextTool.kind === "plan" || nextTool.kind === "canvas") && parsedWorkspace) {
          const workspaceType: WorkspaceItem["type"] = nextTool.kind === "canvas" ? "canvas" : "plan";
          const workspace: WorkspaceItem | undefined = parsedWorkspace.id
            ? {
                id: parsedWorkspace.id,
                type: workspaceType,
                name: parsedWorkspace.title,
                content: parsedWorkspace.content,
                createdAt: parsedWorkspace.createdAt || new Date().toISOString(),
                updatedAt: parsedWorkspace.updatedAt || new Date().toISOString(),
                version: parsedWorkspace.version || 1,
              }
            : persistWorkspace(workspaceType, parsedWorkspace.content, parsedWorkspace.title);
          if (workspace) {
            if (parsedWorkspace.id && !createdWorkspaces.some((item) => item.id === workspace.id)) {
              createdWorkspaces.push(workspace);
            }
            emit("workspace", { workspace });
            nextTool.result = JSON.stringify({
              ...parsedWorkspace,
              id: workspace.id,
              workspaceLink: `workspace://${workspace.type}/${workspace.id}`,
            });
          }
        }
        emit("tool", {
          callId: toolId,
          name: toolName,
          status: toolStatus,
          kind: nextTool.kind,
          ...(nextTool.path ? { path: nextTool.path } : {}),
          ...(nextTool.diff ? { diff: nextTool.diff } : {}),
          ...(nextTool.input ? { input: nextTool.input } : {}),
          ...(nextTool.result ? { result: nextTool.result } : {}),
          ...(nextTool.subagent ? { subagent: nextTool.subagent } : {}),
          ...(providedAttachment ? { attachment: providedAttachment } : {}),
        });
        } else if (event.type === "assistant") {
        if (receivedTextDelta) continue;
        const content = (event as { message?: { content?: Array<{ type: string; text?: string }> } }).message?.content;
        for (const block of content || []) {
          if (block.type === "text" && block.text) {
            receivedTextDelta = true;
            text += block.text;
          }
        }
        checkpoint(true);
        emit("text", { text });
        } else {
          appendAgentTrace(job, "sdk_event", {
            type: String((event as { type?: unknown }).type || "unknown"),
          });
        }
      }
    } finally {
      clearInterval(cancellationWatcher);
      if (inactivityTimer) clearTimeout(inactivityTimer);
    }
    const result = await withTimeout(
      run.wait(),
      AGENT_WAIT_TIMEOUT_MS,
      "The agent did not finish within 90 seconds after its stream ended.",
    );
    const wasCancelled =
      cancellationRequested ||
      getJob(job.id)?.status === "cancelled" ||
      result.status === "cancelled";
    if (wasCancelled) {
      closeRunningTools(tools, "cancelled");
      checkpoint();
      for (const tool of tools) {
        emit("tool", {
          callId: tool.id,
          name: tool.name,
          status: tool.status,
          kind: tool.kind,
          ...(tool.path ? { path: tool.path } : {}),
          ...(tool.diff ? { diff: tool.diff } : {}),
          ...(tool.input ? { input: tool.input } : {}),
          ...(tool.result ? { result: tool.result } : {}),
          ...(tool.subagent ? { subagent: tool.subagent } : {}),
        });
      }
      updateChat(job.chatId, {
        runStatus: "cancelled",
        runUpdatedAt: new Date().toISOString(),
        queueMessage: null,
      }, job.userId);
      updateJob(job.id, { status: "cancelled" });
      emit("done", { status: "cancelled", agentId: agent.agentId });
      return;
    }
    // The Cursor SDK can leave the outer MCP tool event in "running" even
    // after ask_user returned and the agent continued. Finalize that event
    // before persisting the assistant message so the UI reflects the actual
    // completed run.
    closeRunningTools(tools, result.status === "error" ? "error" : "completed");
    for (const tool of tools) {
      emit("tool", {
        callId: tool.id,
        name: tool.name,
        status: tool.status,
        kind: tool.kind,
        ...(tool.path ? { path: tool.path } : {}),
        ...(tool.diff ? { diff: tool.diff } : {}),
        ...(tool.input ? { input: tool.input } : {}),
        ...(tool.result ? { result: tool.result } : {}),
        ...(tool.subagent ? { subagent: tool.subagent } : {}),
      });
    }
    checkpoint(true);
    const resultError = result.status === "error"
      ? result.error?.message || "Agent run failed."
      : undefined;
    if (!text && result.result && !resultError) text = String(result.result);
    if (!text && !resultError) {
      text =
        result.error?.message ||
        "The agent completed without returning a textual response.";
    }
    if (text) {
      const chatBlocks = [...text.matchAll(/```chat(?:\s+title=(?:"([^"]+)"|'([^']+)'|([^\s]+)))?\s*\n([\s\S]*?)```/gi)];
      for (const block of job.incognito || chat.incognito ? [] : chatBlocks) {
        const message = block[4]?.trim();
        if (!message) continue;
        const title = (block[1] || block[2] || block[3] || message).trim().slice(0, 200);
        const child = createChat(title, undefined, job.userId);
        const messageId = crypto.randomUUID();
        appendMessage(child.id, {
          id: messageId,
          role: "user",
          content: message.slice(0, 100_000),
        });
        enqueueJob({
          chatId: child.id,
          userId: job.userId,
          message: message.slice(0, 100_000),
          messageId,
          agentId: job.agentId,
          modeId: job.modeId,
          modelId: job.modelId,
          extendedModelId: job.extendedModelId,
          modelParams: job.modelParams,
        });
        createdChats.push({ id: child.id, title: child.title });
        emit("chat", {
          chatId: child.id,
          title: child.title,
          url: `/?c=${encodeURIComponent(child.id)}`,
        });
      }
      if (chatBlocks.length) {
        text = text.replace(/```chat(?:\s+title=(?:"([^"]+)"|'([^']+)'|([^\s]+)))?\s*\n([\s\S]*?)```/gi, "").trim();
      }
      const fenced = text.match(/```plan(?:\s+name=(?:"([^"]+)"|'([^']+)'|(\S+)))?\s*\n([\s\S]*?)```/i);
      const plan = fenced
        ? persistWorkspace("plan", fenced[4], fenced[1] || fenced[2] || fenced[3] || "Plan")
        : null;
      const canvasFence = text.match(/```canvas(?:\s+name=(?:"([^"]+)"|'([^']+)'|(\S+)))?\s*\n([\s\S]*?)```/i);
      const canvas = canvasFence
        ? persistWorkspace("canvas", canvasFence[4], canvasFence[1] || canvasFence[2] || canvasFence[3] || "Canvas")
        : null;
      const links = [...createdWorkspaces, plan, canvas].filter((item, index, items): item is WorkspaceItem =>
        Boolean(item) && items.findIndex((candidate) => candidate?.id === item?.id) === index,
      )
        .map((item) => `[${item.type === "plan" ? "Plan" : "Canvas"}: ${item.name}](workspace://${item.type}/${item.id})`);
      const chatLinks = createdChats.map(
        (chat) => `[Chat: ${chat.title}](/?c=${encodeURIComponent(chat.id)})`,
      );
      const allLinks = [...links, ...chatLinks];
      if (allLinks.length && !/(workspace:\/\/(plan|canvas)\/|\/\?c=)/i.test(text)) {
        text = `${text.trim()}\n\n${allLinks.join(" · ")}`;
      }
    }
    if (!text && (createdWorkspaces.length || createdChats.length)) {
      const workspaceLinks = createdWorkspaces
        .map((item) => `${item.type === "plan" ? "Plan" : "Canvas"} created: [${item.name}](workspace://${item.type}/${item.id})`)
        .join("\n");
      const chatLinks = createdChats
        .map((chat) => `Chat created: [${chat.title}](/?c=${encodeURIComponent(chat.id)})`)
        .join("\n");
      text = [workspaceLinks, chatLinks].filter(Boolean).join("\n");
    }
    const extractedSuggestions = extractSuggestions(ensureRecommendationSuggestions(text));
    text = extractedSuggestions.text;
    if (!receivedTextDelta && text) {
      const lastPart = parts.at(-1);
      if (lastPart?.type === "text") lastPart.content += text;
      else parts.push({ type: "text", content: text });
    }
    if (extractedSuggestions.suggestions.length) {
      emit("suggestions", { suggestions: extractedSuggestions.suggestions });
    }
    const completedAt = new Date().toISOString();
    const usage = result.usage;
    upsertMessage(job.chatId, {
      id: assistantMessageId,
      role: "assistant",
      content: text,
      ...(resultError ? { errorMessage: resultError } : {}),
      ...(extractedSuggestions.suggestions.length
        ? { suggestions: extractedSuggestions.suggestions }
        : {}),
      ...(tools.length ? { tools } : {}),
      ...(parts.length ? { parts: [...parts] } : {}),
      ...(providedAttachments.length ? { attachments: providedAttachments } : {}),
      ...(result.status === "finished"
        ? {
            runMetadata: {
              modelId: result.model?.id || job.modelId || chat.modelId,
              ...(typeof usage?.outputTokens === "number" ? { outputTokens: usage.outputTokens } : {}),
              ...(typeof usage?.inputTokens === "number" ? { inputTokens: usage.inputTokens } : {}),
              completedAt,
            },
          }
        : {}),
    });
    if (!receivedTextDelta && text) emit("text", { text });
    updateChat(job.chatId, {
      agentId: agent.agentId,
      runStatus: resultError ? "error" : "completed",
      runUpdatedAt: new Date().toISOString(),
      queueMessage: null,
      pendingQuestion: null,
      ...(resultError ? { badge: "red" as const } : {}),
    }, job.userId);
    updateJob(job.id, {
      status: resultError ? "error" : "completed",
      agentId: agent.agentId,
      ...(resultError ? { error: resultError } : {}),
    });
  if (!job.incognito && !chat.incognito) createSnapshot({
      chatId: job.chatId,
      ...(job.userId ? { ownerId: job.userId } : {}),
      checkpoint: "important",
      runStatus: resultError ? "failed" : "completed",
      resumeMarker: { jobId: job.id, runId: job.runId || job.id, safe: true },
      availability: "available",
  });
    if (resultError) emit("error", { message: resultError });
    else emit("done", { status: result.status, agentId: agent.agentId });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Agent run failed.";
    const finalJob = getJob(job.id);
    if (finalJob?.status !== "cancelled" && finalJob?.status !== "interrupted") {
      upsertMessage(job.chatId, {
        id: assistantMessageId,
        role: "assistant",
        content: text,
        errorMessage: message,
        ...(tools.length ? { tools } : {}),
        ...(parts.length ? { parts: [...parts] } : {}),
      });
      updateChat(job.chatId, {
        runStatus: "error",
        runUpdatedAt: new Date().toISOString(),
        queueMessage: null,
        badge: "red",
      }, job.userId);
      updateJob(job.id, { status: "error", error: message });
      createSnapshot({
        chatId: job.chatId,
        ...(job.userId ? { ownerId: job.userId } : {}),
        checkpoint: "recovery",
        runStatus: "failed",
        resumeMarker: { jobId: job.id, runId: job.runId || job.id, safe: true, reason: message },
        availability: "needs_attention",
      });
      emit("error", { message });
    } else if (finalJob?.status === "interrupted") {
      snapshotInterruptedJob(finalJob);
      emit("status", { status: "interrupted", message });
    }
  } finally {
    if (checkpointTimer) clearTimeout(checkpointTimer);
    if (checkpointDirty) checkpointNow();
    clearInterval(heartbeat);
    if (agent) await agent[Symbol.asyncDispose]().catch(() => undefined);
  }
}

export async function runJobById(id: string) {
  const job = getJob(id);
  if (job && job.status === "running") await runQueuedJob(job);
}
