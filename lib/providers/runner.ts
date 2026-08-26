import {
  appendMessage,
  getChat,
  updateChat,
  upsertMessage,
  type Chat,
  type ToolPart,
} from "@/lib/db-store";
import type { MessagePart } from "@/lib/store";
import {
  findActiveConnection,
  getProviderConnection,
  getProviderConnectionSecret,
} from "@/lib/provider-connections";
import { getProviderDefinition } from "@/lib/providers/registry";
import { providerExecution } from "@/lib/providers/run-kind";
import { normalizeLegacyProviderModelId } from "@/lib/providers/model-aliases";
import { providerAdapterForExecution } from "@/lib/providers/adapters";
import type { ProviderResult } from "@/lib/providers/adapters/contract";
import {
  type ProviderContext,
  telemetryCategory,
  finalizeAlternativeTools,
  type CompactionEvent,
} from "@/lib/providers/adapters/provider-support";
import { modelKey, parseModelKey } from "@/lib/providers/types";
import type { AgentJob } from "@/lib/jobs";
import { appendRunEvent, getJob, updateJob } from "@/lib/db-jobs";
import { modeById } from "@/lib/modes";
import { estimateProviderInputTokens } from "@/lib/providers/adapters/provider-support";
import { logError } from "@/lib/error-logs";
import { persistToolsForMessage } from "@/lib/tool-persistence";
import { recordSignal } from "@/lib/model-telemetry";

async function runProvider(context: ProviderContext): Promise<ProviderResult> {
  const providerKey =
    context.connection.providerKey ||
    parseModelKey(context.job.modelId).providerKey;
  return providerAdapterForExecution(providerExecution(providerKey)).runTurn(context);
}

export async function runAlternativeProviderJob(
  job: AgentJob,
  initialChat: Chat,
) {
  const runStartedAt = Date.now();
  let completionCommitted = false;
  const rawParsed = parseModelKey(job.modelId || initialChat.modelId || "");
  const normalizedModelId = normalizeLegacyProviderModelId(
    rawParsed.providerKey,
    rawParsed.modelId,
  );
  const parsed = { ...rawParsed, modelId: normalizedModelId };
  if (normalizedModelId !== rawParsed.modelId) {
    const canonicalKey = modelKey(
      rawParsed.providerKey,
      normalizedModelId,
      rawParsed.connectionId,
    );
    updateJob(job.id, { modelId: canonicalKey });
    updateChat(job.chatId, { modelId: canonicalKey }, job.userId);
  }
  const definition = getProviderDefinition(parsed.providerKey);
  if (!definition || parsed.providerKey === "cursor") return false;
  if (!job.userId)
    throw new Error("A user account is required for provider connections.");
  const connection = parsed.connectionId
    ? getProviderConnection(parsed.connectionId, job.userId)
    : findActiveConnection(job.userId, parsed.providerKey);
  if (
    !connection ||
    !connection.enabled ||
    connection.providerKey !== parsed.providerKey
  ) {
    throw new Error(`No enabled ${definition.name} connection is configured.`);
  }
  if (!definition.authTypes.includes(connection.authType)) {
    throw new Error(
      `${definition.name} no longer supports ${connection.authType} authentication.`,
    );
  }
  const credential = getProviderConnectionSecret(connection.id, job.userId);
  if (!credential) throw new Error("Provider connection not found.");
  if (
    definition.kind !== "compatible" &&
    definition.kind !== "antigravity-agent" &&
    definition.kind !== "codex-agent" &&
    !credential.secret
  ) {
    throw new Error(`${definition.name} requires a configured credential.`);
  }

  const assistantMessageId = crypto.randomUUID();
  let chat = getChat(job.chatId, job.userId) || initialChat;
  let text = "";
  const tools: ToolPart[] = [];
  const parts: MessagePart[] = [];
  const controller = new AbortController();
  let modelSwitchTarget: {
    modelId: string;
    modelParams?: Array<{ id: string; value: string }>;
  } | null = null;
  const cancellationWatcher = setInterval(() => {
    const currentJob = getJob(job.id);
    const pendingModelId = currentJob?.pendingModelId?.trim();
    if (pendingModelId && pendingModelId !== job.modelId) {
      modelSwitchTarget = {
        modelId: pendingModelId,
        modelParams: currentJob?.pendingModelParams,
      };
      controller.abort();
      return;
    }
    if (currentJob?.status === "cancelled") controller.abort();
  }, 250);
  const emit = (event: string, data: unknown) =>
    appendRunEvent(job.id, job.chatId, job.userId, event, data);
  let checkpointTimer: ReturnType<typeof setTimeout> | undefined;
  let checkpointDirty = false;
  const checkpointNow = () => {
    upsertMessage(job.chatId, {
      id: assistantMessageId,
      role: "assistant",
      content: text,
      ...(tools.length
        ? {
            tools: persistToolsForMessage(
              job.chatId,
              assistantMessageId,
              tools,
            ),
          }
        : {}),
      ...(parts.length ? { parts } : {}),
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
    checkpointTimer = setTimeout(() => {
      checkpointTimer = undefined;
      if (checkpointDirty) checkpointNow();
    }, 500);
  };
  const handoffModelSwitch = () => {
    if (!modelSwitchTarget) return false;
    checkpoint(true);
    const target = modelSwitchTarget;
    const switchedAt = new Date().toISOString();
    updateJob(job.id, {
      status: "switching",
      error: undefined,
      agentId: undefined,
      modelId: target.modelId,
      modelParams: target.modelParams,
      pendingModelId: undefined,
      pendingModelParams: undefined,
      modelSwitchRequestedAt: undefined,
      resumePrompt: `The user switched the active model to ${target.modelId}. Continue the in-progress task from the saved chat/tool/browser state. Do not repeat completed work.`,
      resumeRequestedAt: switchedAt,
    });
    updateChat(
      job.chatId,
      {
        modelId: target.modelId,
        modelParams: target.modelParams || [],
        agentId: null,
        runStatus: "running",
        runUpdatedAt: switchedAt,
        queueMessage: null,
        badge: null,
      },
      job.userId,
    );
    emit("status", { status: "switching_model", modelId: target.modelId });
    return true;
  };

  const onText = (value: string) => {
    if (!value) return;
    text += value;
    checkpoint();
    emit("text", { text: value });
  };
  const onTool = (tool: ToolPart) => {
    // write_todos is a state surface, not an append-only tool history. Give it
    // one stable id per run so every update replaces the same Tasks card in
    // persistence and in the live SSE UI instead of creating ghost checklists.
    const normalizedTool =
      tool.kind === "todo" ? { ...tool, id: `todo-${job.id}` } : tool;
    let existingIndex = tools.findIndex(
      (item) => item.id === normalizedTool.id,
    );
    if (existingIndex < 0 && normalizedTool.status !== "running") {
      existingIndex = tools.findLastIndex(
        (item) =>
          item.status === "running" && item.name === normalizedTool.name,
      );
      if (existingIndex >= 0) {
        normalizedTool.id = tools[existingIndex].id;
      }
    }
    if (existingIndex >= 0) {
      tools[existingIndex] = { ...tools[existingIndex], ...normalizedTool };
    } else {
      tools.push(normalizedTool);
    }
    checkpoint(true);
    emit("tool", {
      callId: normalizedTool.id,
      name: normalizedTool.name,
      status: normalizedTool.status,
      kind: normalizedTool.kind,
      ...(normalizedTool.input ? { input: normalizedTool.input } : {}),
      ...(normalizedTool.result ? { result: normalizedTool.result } : {}),
      ...(normalizedTool.todos?.length ? { todos: normalizedTool.todos } : {}),
      ...(normalizedTool.subagent ? { subagent: normalizedTool.subagent } : {}),
    });
  };
  const onCompaction = (event: CompactionEvent) => {
    const part: MessagePart = { ...event };
    parts.push(part);
    checkpoint(true);
    emit("compaction", event);
  };
  const onThinking = (data: {
    text?: string;
    replace?: boolean;
    done?: boolean;
    durationMs?: number;
  }) => {
    emit("thinking", data);
    if (data.done !== true) {
      emit("status", { status: "running", message: "Thinking…" });
    }
  };

  appendMessage(job.chatId, {
    id: assistantMessageId,
    role: "assistant",
    content: "",
  });
  emit("assistantId", { messageId: assistantMessageId });
  emit("status", { status: "running", message: "Starting model…" });
  updateChat(
    job.chatId,
    {
      runStatus: "running",
      runUpdatedAt: new Date().toISOString(),
      queueMessage: null,
    },
    job.userId,
  );

  try {
    const result = await runProvider({
      job,
      chat,
      connection: credential,
      modelId: parsed.modelId,
      signal: controller.signal,
      onText,
      onTool,
      onCompaction,
      onThinking: (data) => emit("thinking", data),
      onStream: (data) =>
        emit(data.type === "compaction" ? "compaction" : "stream", data),
    });
    if (modelSwitchTarget && handoffModelSwitch()) return true;
    const durableStatus = getJob(job.id)?.status;
    if (durableStatus === "interrupted") {
      checkpoint();
      emit("status", {
        status: "interrupted",
        message: "Run was interrupted before the provider finished.",
      });
      return true;
    }
    const cancelled =
      controller.signal.aborted || durableStatus === "cancelled";
    if (cancelled) {
      updateChat(
        job.chatId,
        {
          runStatus: "cancelled",
          runUpdatedAt: new Date().toISOString(),
          queueMessage: null,
          pendingApproval: null,
        },
        job.userId,
      );
      updateJob(job.id, { status: "cancelled" });
      emit("done", { status: "cancelled", provider: definition.key });
      return true;
    }
    if (!text.trim())
      text = "The provider completed without returning a textual response.";
    finalizeAlternativeTools(tools);
    if (
      modeById(job.modeId || chat.sessionState?.modeId).id === "plan" &&
      text.trim()
    ) {
      const current = getChat(job.chatId, job.userId);
      const existingPlan = current?.workspaces?.find(
        (workspace) => workspace.type === "plan",
      );
      if (!existingPlan && current) {
        const timestamp = new Date().toISOString();
        const workspace = {
          id: crypto.randomUUID(),
          type: "plan" as const,
          name: "Plan",
          content: text.trim().slice(0, 100_000),
          createdAt: timestamp,
          updatedAt: timestamp,
          version: 1,
        };
        updateChat(
          job.chatId,
          {
            workspaces: [...(current.workspaces || []), workspace].slice(-20),
          },
          job.userId,
        );
        text = `${text.trim()}\n\n[Plan: ${workspace.name}](workspace://plan/${workspace.id})`;
        appendRunEvent(job.id, job.chatId, job.userId, "workspace", {
          workspace,
        });
      }
    }
    recordSignal({
      modelId: parsed.modelId,
      category: telemetryCategory(job.message),
      success: true,
      totalLatencyMs: Math.max(0, Date.now() - runStartedAt),
      inputTokens: result.usage?.inputTokens,
      outputTokens: result.usage?.outputTokens,
      toolCallCount: tools.length,
      toolFailures: tools.some((tool) => tool.status === "error"),
      createdAt: new Date().toISOString(),
    });
    checkpoint();
    const measuredInputTokens = result.usage?.inputTokens;
    const inputTokens =
      measuredInputTokens ??
      estimateProviderInputTokens(chat, job, parsed.modelId);
    // Persist the durable answer before publishing terminal run state. If a
    // later event append fails, a successful model/tool run must not regress
    // from completed -> error.
    upsertMessage(job.chatId, {
      id: assistantMessageId,
      role: "assistant",
      content: text,
      ...(tools.length
        ? {
            tools: persistToolsForMessage(
              job.chatId,
              assistantMessageId,
              tools,
            ),
          }
        : {}),
      ...(parts.length ? { parts } : {}),
      runMetadata: {
        providerId: definition.key,
        modelId: parsed.modelId,
        inputTokens,
        ...(measuredInputTokens === undefined
          ? { inputTokensEstimated: true }
          : {}),
        ...(result.usage?.outputTokens !== undefined
          ? { outputTokens: result.usage.outputTokens }
          : {}),
        ...(result.usage?.totalTokens !== undefined
          ? { totalTokens: result.usage.totalTokens }
          : {}),
        completedAt: new Date().toISOString(),
      },
    });
    updateJob(job.id, {
      status: "completed",
      ...(result.agentId ? { agentId: result.agentId } : {}),
    });
    chat =
      updateChat(
        job.chatId,
        {
          ...(result.agentId ? { agentId: result.agentId } : {}),
          runStatus: "completed",
          runUpdatedAt: new Date().toISOString(),
          queueMessage: null,
          pendingApproval: null,
        },
        job.userId,
      ) || chat;
    completionCommitted = true;
    emit("done", {
      status: "finished",
      provider: definition.key,
      modelId: parsed.modelId,
      ...(result.agentId ? { agentId: result.agentId } : {}),
    });
  } catch (error) {
    if (modelSwitchTarget && handoffModelSwitch()) return true;
    if (completionCommitted) {
      const message = error instanceof Error ? error.message : String(error);
      void logError({
        level: "warn",
        source: "worker",
        chatId: job.chatId,
        userId: job.userId || undefined,
        message: `Post-completion provider bookkeeping failed (${definition.key}): ${message}`,
        stack: error instanceof Error ? error.stack : undefined,
        context: { jobId: job.id, provider: definition.key, modelId: parsed.modelId },
      });
      return true;
    }
    const durableStatus = getJob(job.id)?.status;
    const interrupted = durableStatus === "interrupted";
    const cancelled =
      controller.signal.aborted || durableStatus === "cancelled";
    const message = cancelled
      ? "Provider run cancelled."
      : interrupted
        ? "Provider run interrupted."
        : error instanceof Error
          ? error.message
          : "Provider run failed.";
    finalizeAlternativeTools(tools);
    recordSignal({
      modelId: parsed.modelId,
      category: telemetryCategory(job.message),
      success: false,
      totalLatencyMs: Math.max(0, Date.now() - runStartedAt),
      toolCallCount: tools.length,
      toolFailures: true,
      createdAt: new Date().toISOString(),
    });
    if (!cancelled && !interrupted) {
      void logError({
        level: "error",
        source: "worker",
        chatId: job.chatId,
        userId: job.userId || undefined,
        message: `Provider run failed (${definition.key}): ${message}`,
        stack: error instanceof Error ? error.stack : undefined,
        context: {
          jobId: job.id,
          provider: definition.key,
          modelId: parsed.modelId,
        },
      });
    }
    if (interrupted) {
      checkpoint();
      emit("status", { status: "interrupted", message });
    } else if (cancelled) {
      updateChat(
        job.chatId,
        { runStatus: "cancelled", runUpdatedAt: new Date().toISOString() },
        job.userId,
      );
      updateJob(job.id, { status: "cancelled", error: message });
      emit("done", { status: "cancelled", provider: definition.key });
    } else {
      upsertMessage(job.chatId, {
        id: assistantMessageId,
        role: "assistant",
        content: text,
        errorMessage: message,
        ...(tools.length
          ? {
              tools: persistToolsForMessage(
                job.chatId,
                assistantMessageId,
                tools,
              ),
            }
          : {}),
        ...(parts.length ? { parts } : {}),
      });
      updateChat(
        job.chatId,
        {
          runStatus: "error",
          runUpdatedAt: new Date().toISOString(),
          queueMessage: null,
          badge: "red",
        },
        job.userId,
      );
      updateJob(job.id, { status: "error", error: message });
      emit("error", { message });
    }
  } finally {
    if (checkpointTimer) clearTimeout(checkpointTimer);
    if (checkpointDirty) checkpointNow();
    clearInterval(cancellationWatcher);
  }
  return true;
}

export {
  COMPACTION_MARKER,
  compactChatHistoryForPrompt,
  compactProviderMessages,
  codexReasoningEffortForSelection,
  aiReasoningForSelection,
  anthropicProviderOptionsForSelection,
} from "@/lib/providers/adapters/provider-support";
export { codexTool } from "@/lib/providers/adapters/codex";
export type { CompactionEvent } from "@/lib/providers/adapters/provider-support";
