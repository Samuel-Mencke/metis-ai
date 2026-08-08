import { readFileSync } from "node:fs";
import { Agent } from "@cursor/sdk";
import {
  appendMessage,
  createChat,
  getChat,
  getGlobalModelSettings,
  listMemories,
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
import { runAlternativeProviderJob } from "@/lib/providers/runner";

const AGENT_INIT_TIMEOUT_MS = 90_000;
const AGENT_INACTIVITY_TIMEOUT_MS = 5 * 60_000;
const AGENT_WAIT_TIMEOUT_MS = 90_000;

function classifyTool(name: string): ToolPart["kind"] {
  const value = name.toLowerCase();
  if (/(subagent|delegate|agent|task)/.test(value)) return "subagent";
  if (/(todo)/.test(value)) return "todo";
  if (/(memory|remember)/.test(value)) return "memory";
  if (/(browser|navigate|playwright|webfetch)/.test(value)) return "browser";
  if (value.includes("edit_plan")) return "plan";
  if (value.includes("edit_canvas")) return "canvas";
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
  return /(^|[._:/-])(delete|remove|unlink)([._:/-]|$)/i.test(name);
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
    return { path: rawPath, diff: { before, after: undefined } };
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
    return { path: rawPath, diff: { before: previousDiff?.before ?? reconstructedBefore, after } };
  }
  return { path: rawPath, diff: { before, after } };
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

function isFinishedToolStatus(value: string) {
  return ["completed", "success", "succeeded", "done"].includes(value.trim().toLowerCase());
}

function isAskUserTool(tool: ToolPart) {
  const normalizedName = tool.name.trim().toLowerCase().replaceAll("-", "_");
  if (
    normalizedName === "ask_user" ||
    normalizedName.endsWith(".ask_user") ||
    normalizedName.endsWith("/ask_user") ||
    normalizedName.endsWith(":ask_user")
  ) {
    return true;
  }
  if (!tool.input) return false;
  try {
    const input = JSON.parse(tool.input) as {
      toolName?: unknown;
      name?: unknown;
      tool?: unknown;
      arguments?: { toolName?: unknown; name?: unknown; tool?: unknown };
    };
    return [
      input.toolName,
      input.name,
      input.tool,
      input.arguments?.toolName,
      input.arguments?.name,
      input.arguments?.tool,
    ].some(
      (name) =>
        typeof name === "string" &&
        name.trim().toLowerCase().replaceAll("-", "_") === "ask_user",
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

function closeRunningTools(tools: ToolPart[], status: string) {
  for (const tool of tools) {
    if (tool.status === "running") tool.status = status;
  }
}

function extractWorkspace(value: string) {
  const visit = (candidate: unknown, depth = 0): {
    type?: "plan" | "canvas";
    id?: string;
    workspaceLink?: string;
    title: string;
    content: string;
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
      return {
        type,
        id,
        workspaceLink,
        title: title?.trim() || (type === "canvas" ? "Canvas" : "Plan"),
        content: contentCandidate,
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

export async function runQueuedJob(job: AgentJob) {
  const chat = getChat(job.chatId, job.userId);
  if (!chat) {
    updateJob(job.id, { status: "error", error: "Chat not found or access denied." });
    return;
  }
  const requestedModelId = job.modelId || chat.modelId || "";
  if (!requestedModelId) {
    updateJob(job.id, { status: "error", error: "No model is selected for this chat." });
    return;
  }
  if (!isModelAllowed(job.userId, requestedModelId)) {
    updateJob(job.id, { status: "error", error: "This model is not available for your account." });
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
    updateJob(job.id, {
      status: "error",
      error: "No enabled Cursor SDK connection is configured for this user.",
    });
    return;
  }
  const agentCwd = getUserAgentCwd(job.userId);
  const assistantMessageId = crypto.randomUUID();
  appendMessage(job.chatId, { id: assistantMessageId, role: "assistant", content: "" });
  const emit = (event: string, data: unknown) => {
    const result = appendRunEvent(job.id, job.chatId, job.userId, event, data);
    const current = getChat(job.chatId, job.userId);
    const needsAttention = event === "question" || event === "workspace" || event === "canvas";
    const hasAssistantResponse = Boolean(
      current?.messages.some(
        (message) => message.role === "assistant" && message.content.trim(),
      ),
    );
    updateChat(
      job.chatId,
      {
        badge: needsAttention || current?.badge === "red"
          ? "red"
          : event === "done" && hasAssistantResponse
            ? "blue"
            : null,
      },
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
  const globalModelSettings = getGlobalModelSettings(job.userId);
  const configuredSubagentModel = globalModelSettings.subagentModelEnabled
    ? globalModelSettings.subagentModelId
    : undefined;
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
      ? await withTimeout(Agent.resume(job.agentId || chat.agentId!, {
          apiKey,
          model,
          local: { cwd: agentCwd, settingSources: ["project"] },
          mcpServers: getMcpServers(mcpContext),
          ...(customSubagentDefinitions ? { agents: customSubagentDefinitions } : {}),
        }), AGENT_INIT_TIMEOUT_MS, "The agent session could not be resumed within 90 seconds.")
      : await withTimeout(Agent.create({
          apiKey,
          model,
          local: { cwd: agentCwd, settingSources: ["project"] },
          mcpServers: getMcpServers(mcpContext),
          ...(customSubagentDefinitions ? { agents: customSubagentDefinitions } : {}),
        }), AGENT_INIT_TIMEOUT_MS, "The agent session could not be created within 90 seconds.");
    const prompt = [
      `Memories:\n${listMemories(job.userId).map((memory) => `- ${memory.content}`).join("\n") || "(none yet)"}`,
      `Existing workspaces:\n${chat.workspaces?.map((item) => `[${item.type}] ${item.name} (link: workspace://${item.type}/${item.id})\n${item.content}`).join("\n\n") || "(none)"}`,
      "When referring to an existing or newly created plan/canvas, include its exact Markdown link using workspace://plan/<id> or workspace://canvas/<id>.",
      "When you use browser results, selected references, or other verifiable web sources, cite the exact URL immediately after the sentence it supports using the format [Source: Website title](URL). At the end, put every source used in exactly one fenced block starting with ```sources, with one Markdown link per line. Never invent URLs; if no verifiable source is available, do not create a sources block.",
      "To create a plan or canvas, call the MCP tools create_plan or create_canvas with title and content. Use an empty content string for a blank workspace, and do not claim creation without a completed tool call.",
      "For memories, use list_memories to retrieve the current user's entries, add_memory only for useful durable facts or preferences, and edit_memory with the exact memory id to change an existing entry. Never claim a memory was changed without a completed tool call.",
      "To edit an existing workspace, call edit_plan or edit_canvas with its exact id and the changed title/content. Do not create a duplicate when the user asked to edit.",
      "Use delete_memory, delete_plan, and delete_canvas only for explicit user requests. Before destructive or external actions, use request_confirmation and continue only when the user chooses Confirm.",
      "Use list_workspaces before editing or deleting a workspace, and use git_status/git_diff to inspect project changes. Browser helpers include browser_extract_text, browser_fill_form, and browser_download.",
      "You can create a follow-up chat by outputting exactly one or more fenced blocks in this format:\n```chat title=\"Short title\"\nMessage to send in the new chat\n```\nThe block creates a new chat for the current user, sends the message there, and starts an agent run. Do not claim a chat was created without outputting this block.",
      "When useful, offer up to five concise follow-up questions at the end using exactly this UI-only format. Use `display text => prompt to insert` when the visible label should differ from the inserted prompt:\n```suggestions\nExplain this in more detail => Explain the database synchronization in more detail, with a concrete example.\nShow me an example\n```\nDo not mention or explain this format outside the block.",
      subagentModelInstruction,
      `Your private AI workspace is:\n${agentCwd}\nUse this directory as the working directory for project files and commands. Do not use another user's workspace.`,
      `User message:\n${job.message || "(see attachments)"}`,
      buildAttachmentPrompt(job.chatId, job.attachments, job.userId),
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
    let cancellationRequested = false;
    let activeRun: { cancel: () => Promise<unknown> } | null = null;
    let run: Awaited<ReturnType<typeof agent.send>>;
    let sendTimeout: ReturnType<typeof setTimeout> | undefined;
    let inactivityTimer: ReturnType<typeof setTimeout> | undefined;
    let inactivityTimedOut = false;
    const resetInactivityTimer = () => {
      if (inactivityTimer) clearTimeout(inactivityTimer);
      inactivityTimer = setTimeout(() => {
        inactivityTimedOut = true;
        void activeRun?.cancel().catch(() => undefined);
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
        } else if (event.type === "tool_call") {
        const toolEvent = event as { call_id?: string; name?: string; status?: string; args?: unknown; result?: unknown };
        const toolId = normalizeToolId(toolEvent.call_id || crypto.randomUUID());
        const toolName = toolEvent.name || "tool";
        const toolStatus = toolEvent.status || "running";
        const subagent = extractSubagent(toolName, toolEvent.args, toolEvent.result);
        const existingTool = tools.find((tool) => tool.id === toolId);
        let editArgs = toolEvent.args;
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
        const parsedWorkspace =
          extractWorkspace(toolResult) ||
          (toolEvent.args !== undefined ? extractWorkspace(JSON.stringify(toolEvent.args)) : null) ||
          (existingTool?.input ? extractWorkspace(existingTool.input) : null);
        if (isFinishedToolStatus(toolStatus) && (nextTool.kind === "plan" || nextTool.kind === "canvas") && parsedWorkspace) {
          const workspaceType: WorkspaceItem["type"] = nextTool.kind === "canvas" ? "canvas" : "plan";
          const workspace: WorkspaceItem | undefined = parsedWorkspace.id
            ? {
                id: parsedWorkspace.id,
                type: workspaceType,
                name: parsedWorkspace.title,
                content: parsedWorkspace.content,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
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
      if (inactivityTimer) clearTimeout(inactivityTimer);
    }
    if (inactivityTimedOut) {
      throw new Error("The agent stopped producing progress for 5 minutes.");
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
          ...(tool.input ? { input: tool.input } : {}),
          ...(tool.result ? { result: tool.result } : {}),
          ...(tool.subagent ? { subagent: tool.subagent } : {}),
        });
      }
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
    for (const tool of tools) {
      if (!isAskUserTool(tool)) continue;
      emit("tool", {
        callId: tool.id,
        name: tool.name,
        status: tool.status,
        kind: tool.kind,
        ...(tool.input ? { input: tool.input } : {}),
        ...(tool.result ? { result: tool.result } : {}),
      });
    }
    checkpoint();
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
    const extractedSuggestions = extractSuggestions(text);
    text = extractedSuggestions.text;
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
    if (text) emit("text", { text });
    updateChat(job.chatId, {
      agentId: agent.agentId,
      runStatus: resultError ? "error" : "completed",
      runUpdatedAt: new Date().toISOString(),
    }, job.userId);
    updateJob(job.id, {
      status: resultError ? "error" : "completed",
      agentId: agent.agentId,
      ...(resultError ? { error: resultError } : {}),
    });
    if (resultError) emit("error", { message: resultError });
    else emit("done", { status: result.status, agentId: agent.agentId });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Agent run failed.";
    if (getJob(job.id)?.status !== "cancelled") {
      upsertMessage(job.chatId, {
        id: assistantMessageId,
        role: "assistant",
        content: text,
        errorMessage: message,
        ...(tools.length ? { tools } : {}),
      });
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
