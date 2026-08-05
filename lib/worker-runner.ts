import { Agent } from "@cursor/sdk";
import {
  appendMessage,
  createChat,
  getChat,
  listMemories,
  updateChat,
  upsertMessage,
  type ToolPart,
  type WorkspaceItem,
} from "@/lib/db-store";
import { getAgentCwd, getMcpServers } from "@/lib/mcp";
import { appendRunEvent, enqueueJob, getJob, touchJob, updateJob } from "@/lib/db-jobs";
import type { AgentJob } from "@/lib/jobs";

function classifyTool(name: string): ToolPart["kind"] {
  const value = name.toLowerCase();
  if (/(subagent|delegate|agent|task)/.test(value)) return "subagent";
  if (/(todo)/.test(value)) return "todo";
  if (/(memory|remember)/.test(value)) return "memory";
  if (/(browser|navigate|playwright|webfetch)/.test(value)) return "browser";
  if (value.includes("plan")) return "plan";
  if (/(edit|write|patch|replace|create_file|delete_file)/.test(value)) return "edit";
  if (/(read|search|list|glob|grep)/.test(value)) return "read";
  if (/(shell|terminal|command|exec|run)/.test(value)) return "shell";
  if (/(mcp|connector|integration)/.test(value)) return "mcp";
  if (value.includes("canvas")) return "canvas";
  return "other";
}

function asRecord(value: unknown): Record<string, unknown> {
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
  const messages = steps
    .map((step) => {
      const item = asRecord(step);
      const role = typeof item.role === "string"
        ? item.role
        : typeof item.type === "string"
          ? item.type
          : "assistant";
      const text = asText(item.text ?? item.content ?? item.message ?? item.result);
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
    ...(messages.length ? { messages } : {}),
  };
}

function normalizeToolId(value: string) {
  return value.trim().replace(/\s+/g, "");
}

function isAskUserTool(tool: ToolPart) {
  if (tool.name.trim().toLowerCase() === "ask_user") return true;
  if (!tool.input) return false;
  try {
    const input = JSON.parse(tool.input) as {
      toolName?: unknown;
      name?: unknown;
    };
    return [input.toolName, input.name].some(
      (name) => typeof name === "string" && name.trim().toLowerCase() === "ask_user",
    );
  } catch {
    return false;
  }
}

function closeAskUserTools(tools: ToolPart[], status: string) {
  for (const tool of tools) {
    if (isAskUserTool(tool) && tool.status === "running") {
      tool.status = status;
    }
  }
}

function extractPlan(value: string) {
  const plain = value.trim();
  if (!plain) return null;
  try {
    const parsed = JSON.parse(plain) as Record<string, unknown>;
    const nested = parsed.value && typeof parsed.value === "object"
      ? parsed.value as Record<string, unknown>
      : {};
    const content = [parsed.plan, parsed.content, nested.plan, nested.content]
      .find((candidate): candidate is string => typeof candidate === "string" && candidate.trim().length > 0);
    if (!content) return null;
    const title = [parsed.title, parsed.name, nested.title, nested.name]
      .find((candidate): candidate is string => typeof candidate === "string" && candidate.trim().length > 0);
    return { title: title?.trim() || "Plan", content: content.trim() };
  } catch {
    return plain.startsWith("{") ? null : { title: "Plan", content: plain };
  }
}

export async function runQueuedJob(job: AgentJob) {
  const chat = getChat(job.chatId, job.userId);
  if (!chat) {
    updateJob(job.id, { status: "error", error: "Chat not found or access denied." });
    return;
  }
  const apiKey = process.env.CURSOR_API_KEY?.trim();
  if (!apiKey) {
    updateJob(job.id, { status: "error", error: "CURSOR_API_KEY is not configured." });
    return;
  }
  const assistantMessageId = crypto.randomUUID();
  appendMessage(job.chatId, { id: assistantMessageId, role: "assistant", content: "" });
  const emit = (event: string, data: unknown) => {
    const result = appendRunEvent(job.id, job.chatId, job.userId, event, data);
    const current = getChat(job.chatId, job.userId);
    const needsAttention = event === "question" || event === "workspace" || event === "canvas";
    updateChat(
      job.chatId,
      { badge: needsAttention || current?.badge === "red" ? "red" : "blue" },
      job.userId,
    );
    return result;
  };
  emit("assistantId", { messageId: assistantMessageId });
  updateChat(job.chatId, { runStatus: "running", runUpdatedAt: new Date().toISOString() });
  emit("status", { status: "running" });
  let agent: Awaited<ReturnType<typeof Agent.create>> | undefined;
  let text = "";
  const tools: ToolPart[] = [];
  const createdWorkspaces: WorkspaceItem[] = [];
  const createdChats: Array<{ id: string; title: string }> = [];
  const mcpContext = { chatId: job.chatId, userId: job.userId, jobId: job.id };
  const heartbeat = setInterval(() => {
    touchJob(job.id);
  }, 30_000);
  const checkpoint = () => {
    upsertMessage(job.chatId, {
      id: assistantMessageId,
      role: "assistant",
      content: text,
      ...(tools.length ? { tools: [...tools] } : {}),
    });
  };
  const persistWorkspace = (type: WorkspaceItem["type"], content: string, name = type === "plan" ? "Plan" : "Canvas") => {
    const current = getChat(job.chatId, job.userId);
    if (!current || !content.trim()) return;
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
  const persistPlan = (content: string, name = "Plan") =>
    persistWorkspace("plan", content, name);
  try {
    const modelParams = job.modelParams?.length
      ? job.modelParams
      : chat.modelParams;
    const model = {
      id: job.modelId || chat.modelId || "composer-2.5",
      ...(modelParams?.length ? { params: modelParams } : {}),
    };
    agent = job.agentId || chat.agentId
      ? await Agent.resume(job.agentId || chat.agentId!, {
          apiKey,
          model,
          local: { cwd: getAgentCwd(), settingSources: ["project"] },
          mcpServers: getMcpServers(mcpContext),
        })
      : await Agent.create({
          apiKey,
          model,
          local: { cwd: getAgentCwd(), settingSources: ["project"] },
          mcpServers: getMcpServers(mcpContext),
        });
    const prompt = [
      `Memories:\n${listMemories().map((memory) => `- ${memory.content}`).join("\n") || "(none yet)"}`,
      `Existing workspaces:\n${chat.workspaces?.map((item) => `[${item.type}] ${item.name} (link: workspace://${item.type}/${item.id})\n${item.content}`).join("\n\n") || "(none)"}`,
      "When referring to an existing or newly created plan/canvas, include its exact Markdown link using workspace://plan/<id> or workspace://canvas/<id>.",
      "You can create a follow-up chat by outputting exactly one or more fenced blocks in this format:\n```chat title=\"Short title\"\nMessage to send in the new chat\n```\nThe block creates a new chat for the current user, sends the message there, and starts an agent run. Do not claim a chat was created without outputting this block.",
      `User message:\n${job.message || "(see attachments)"}`,
      job.references?.length
        ? `Selected references:\n${job.references.map((reference) => [
            `- [${reference.kind}] ${reference.label}`,
            reference.detail ? `  Detail: ${reference.detail}` : "",
            reference.path ? `  Path/URL: ${reference.path}` : "",
            reference.content ? `  Context:\n${reference.content}` : "",
          ].filter(Boolean).join("\n")).join("\n")}`
        : "",
      job.referenceText ? `Referenced plan:\n${job.referenceText}` : "",
    ].filter(Boolean).join("\n\n");
    let receivedTextDelta = false;
    const run = await agent.send(prompt, {
      mcpServers: getMcpServers(mcpContext),
      onDelta: ({ update }) => {
        if (update.type !== "text-delta") return;
        const delta = String((update as { text?: string }).text || "");
        if (!delta) return;
        receivedTextDelta = true;
        text += delta;
        checkpoint();
        emit("text", { text: delta });
      },
    });
    let cancellationRequested = false;
    const cancellationWatcher = setInterval(() => {
      if (getJob(job.id)?.status === "cancelled") {
        cancellationRequested = true;
        void run.cancel().catch(() => undefined);
      }
    }, 250);
    try {
      for await (const event of run.stream()) {
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
        } else if (event.type === "tool_call") {
        const toolEvent = event as { call_id?: string; name?: string; status?: string; args?: unknown; result?: unknown };
        const toolId = normalizeToolId(toolEvent.call_id || crypto.randomUUID());
        const toolName = toolEvent.name || "tool";
        const toolStatus = toolEvent.status || "running";
        const subagent = extractSubagent(toolName, toolEvent.args, toolEvent.result);
        const existingTool = tools.find((tool) => tool.id === toolId);
        const nextTool: ToolPart = {
          id: toolId,
          name: toolName,
          status: toolStatus,
          kind: classifyTool(toolName),
          ...(toolEvent.args !== undefined ? { input: JSON.stringify(toolEvent.args) } : {}),
          ...(toolEvent.result !== undefined ? { result: JSON.stringify(toolEvent.result) } : {}),
          ...(subagent ? { subagent } : {}),
        };
        const existingToolIndex = tools.findIndex((tool) => tool.id === toolId);
        if (existingToolIndex >= 0) {
          tools[existingToolIndex] = { ...tools[existingToolIndex], ...nextTool };
        } else {
          tools.push(nextTool);
        }
        checkpoint();
        const toolResult = typeof toolEvent.result === "string"
          ? toolEvent.result
          : toolEvent.result ? JSON.stringify(toolEvent.result) : "";
        const parsedPlan =
          extractPlan(toolResult) ||
          (toolEvent.args !== undefined ? extractPlan(JSON.stringify(toolEvent.args)) : null) ||
          (existingTool?.input ? extractPlan(existingTool.input) : null);
        if (toolStatus === "completed" && nextTool.kind === "plan" && parsedPlan) {
          persistPlan(parsedPlan.content, parsedPlan.title);
        }
        emit("tool", {
          callId: toolId,
          name: toolName,
          status: toolStatus,
          kind: nextTool.kind,
          ...(nextTool.input ? { input: nextTool.input } : {}),
          ...(nextTool.result ? { result: nextTool.result } : {}),
          ...(nextTool.subagent ? { subagent: nextTool.subagent } : {}),
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
        checkpoint();
        emit("text", { text });
        }
      }
    } finally {
      clearInterval(cancellationWatcher);
    }
    const result = await run.wait();
    const wasCancelled =
      cancellationRequested ||
      getJob(job.id)?.status === "cancelled" ||
      result.status === "cancelled";
    if (wasCancelled) {
      closeAskUserTools(tools, "cancelled");
      updateChat(job.chatId, {
        runStatus: "cancelled",
        runUpdatedAt: new Date().toISOString(),
      }, job.userId);
      updateJob(job.id, { status: "cancelled" });
      emit("done", { status: "cancelled", agentId: agent.agentId });
      return;
    }
    // The Cursor SDK can leave the outer MCP tool event in "running" even
    // after ask_user returned and the agent continued. Finalize that event
    // before persisting the assistant message so the UI reflects the actual
    // completed run.
    closeAskUserTools(tools, result.status === "error" ? "error" : "completed");
    if (!text && result.result) text = String(result.result);
    if (text) {
      const chatBlocks = [...text.matchAll(/```chat(?:\s+title=(?:"([^"]+)"|'([^']+)'|([^\s]+)))?\s*\n([\s\S]*?)```/gi)];
      for (const block of chatBlocks) {
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
          modelId: job.modelId,
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
      const plan = fenced ? persistPlan(fenced[4], fenced[1] || fenced[2] || fenced[3] || "Plan") : null;
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
    const completedAt = new Date().toISOString();
    const usage = result.usage;
    upsertMessage(job.chatId, {
      id: assistantMessageId,
      role: "assistant",
      content: text,
      ...(tools.length ? { tools } : {}),
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
    if (receivedTextDelta) {
      emit("text-reset", {});
    }
    emit("text", { text });
    updateChat(job.chatId, {
      agentId: agent.agentId,
      runStatus: result.status === "error" ? "error" : "completed",
      runUpdatedAt: new Date().toISOString(),
    }, job.userId);
    updateJob(job.id, {
      status: result.status === "error" ? "error" : "completed",
      agentId: agent.agentId,
      ...(result.status === "error" ? { error: result.error?.message || "Agent run failed." } : {}),
    });
    emit("done", { status: result.status, agentId: agent.agentId });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Agent run failed.";
    if (getJob(job.id)?.status !== "cancelled") {
      upsertMessage(job.chatId, { id: assistantMessageId, role: "assistant", content: text, ...(tools.length ? { tools } : {}) });
      updateChat(job.chatId, { runStatus: "error", runUpdatedAt: new Date().toISOString() });
      updateJob(job.id, { status: "error", error: message });
      emit("error", { message });
    }
  } finally {
    clearInterval(heartbeat);
    if (agent) await agent[Symbol.asyncDispose]().catch(() => undefined);
  }
}

export async function runJobById(id: string) {
  const job = getJob(id);
  if (job && job.status === "running") await runQueuedJob(job);
}
