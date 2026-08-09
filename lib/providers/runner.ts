import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createInterface } from "node:readline";
import { spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { streamText, type LanguageModel, type ModelMessage } from "ai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogle } from "@ai-sdk/google";
import { createGoogleVertex } from "@ai-sdk/google-vertex";
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { createXai } from "@ai-sdk/xai";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import {
  appendMessage,
  getChat,
  listMemories,
  updateChat,
  upsertMessage,
  type Chat,
  type ToolPart,
} from "@/lib/db-store";
import { getJob, appendRunEvent, updateJob } from "@/lib/db-jobs";
import { buildAttachmentPrompt } from "@/lib/uploads";
import { config } from "@/lib/config";
import {
  findActiveConnection,
  getProviderConnection,
  getProviderConnectionSecret,
  updateProviderConnection,
  type ProviderConnectionWithSecret,
} from "@/lib/provider-connections";
import { getProviderDefinition } from "@/lib/providers/registry";
import { parseModelKey } from "@/lib/providers/types";
import {
  createOAuthProvider,
  ensureAntigravityProjectId,
  type OAuthProviderKey,
} from "@/lib/providers/oauth";
import { runOfficialAntigravityJob } from "@/lib/providers/official-antigravity";
import type { AgentJob } from "@/lib/jobs";

type Usage = {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  costUsd?: number;
};

type ProviderResult = {
  agentId?: string;
  usage?: Usage;
};

type ProviderContext = {
  job: AgentJob;
  chat: Chat;
  connection: ProviderConnectionWithSecret;
  modelId: string;
  signal: AbortSignal;
  onText: (value: string) => void;
  onTool: (tool: ToolPart) => void;
  onStream: (data: Record<string, unknown>) => void;
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function asString(value: unknown) {
  return typeof value === "string" ? value : "";
}

function inheritedEnv(extra: Record<string, string | undefined> = {}) {
  return Object.fromEntries(
    Object.entries({ ...process.env, ...extra })
      .filter((entry): entry is [string, string] => typeof entry[1] === "string"),
  );
}

function providerPrompt(job: AgentJob) {
  const memories = job.userId
    ? listMemories(job.userId).map((memory) => `- ${memory.content}`).join("\n")
    : "";
  const references = job.references?.length
    ? job.references.map((reference) => [
        `- [${reference.kind}] ${reference.label}`,
        reference.detail ? `  Detail: ${reference.detail}` : "",
        reference.path ? `  Path/URL: ${reference.path}` : "",
        reference.content ? `  Context:\n${reference.content}` : "",
      ].filter(Boolean).join("\n")).join("\n")
    : "";
  return [
    "You are a provider inside a private AI chat application.",
    "Answer the user directly and do not claim to have used tools you were not given.",
    "When you use browser results, selected references, or other verifiable web sources, cite the exact URL immediately after the sentence it supports using the format [Source: Website title](URL). At the end, put every source used in exactly one fenced block starting with ```sources, with one Markdown link per line. Never invent URLs; if no verifiable source is available, do not create a sources block.",
    memories ? `Durable user memories:\n${memories}` : "",
    references ? `Selected references:\n${references}` : "",
    job.referenceText ? `Referenced context:\n${job.referenceText}` : "",
    buildAttachmentPrompt(job.chatId, job.attachments),
  ].filter(Boolean).join("\n\n");
}

function modelMessages(chat: Chat, job: AgentJob): ModelMessage[] {
  const messages: ModelMessage[] = [];
  for (const message of chat.messages) {
    const content = message.content.trim();
    if (!content || (message.role !== "user" && message.role !== "assistant")) continue;
    messages.push({ role: message.role, content });
  }
  if (!messages.some((message) => message.role === "user")) {
    messages.push({ role: "user", content: job.message || "Please respond." });
  }
  return messages;
}

function aiModel(
  providerKey: string,
  modelId: string,
  connection: ProviderConnectionWithSecret,
): LanguageModel {
  const secret = connection.secret;
  const baseURL = connection.baseUrl;
  if (providerKey === "openai") {
    return createOpenAI({ apiKey: secret, ...(baseURL ? { baseURL } : {}) }).chat(modelId);
  }
  if (providerKey === "anthropic") {
    return createAnthropic({ apiKey: secret, ...(baseURL ? { baseURL } : {}) }).messages(modelId);
  }
  if (providerKey === "google") {
    if (connection.authType === "vertex_adc") {
      return createGoogleVertex({
        project: typeof connection.config.project === "string"
          ? connection.config.project
          : undefined,
        location: typeof connection.config.location === "string"
          ? connection.config.location
          : undefined,
      }).languageModel(modelId);
    }
    return createGoogle({ apiKey: secret, ...(baseURL ? { baseURL } : {}) }).chat(modelId);
  }
  if (providerKey === "xai") {
    return createXai({ apiKey: secret, ...(baseURL ? { baseURL } : {}) }).chat(modelId);
  }
  if (providerKey === "openrouter") {
    return createOpenRouter({
      apiKey: secret,
      ...(baseURL ? { baseUrl: baseURL } : {}),
    }).chat(modelId);
  }
  if (providerKey === "ollama" || providerKey === "compatible") {
    if (!baseURL) throw new Error("An OpenAI-compatible connection requires a base URL.");
    return createOpenAICompatible({
      name: `${providerKey}-${connection.id}`,
      baseURL,
      ...(secret ? { apiKey: secret } : {}),
    }).chatModel(modelId);
  }
  throw new Error(`Provider ${providerKey} is not a chat API provider.`);
}

function streamErrorText(value: unknown) {
  if (value instanceof Error) return value.message;
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

async function consumeAiStream(
  result: ReturnType<typeof streamText>,
  context: ProviderContext,
) {
  let textProduced = false;
  let finishReason = "";
  let providerError = "";
  try {
    for await (const part of result.stream) {
      context.onStream({
        type: part.type,
        ...(part.type === "text-delta" || part.type === "reasoning-delta"
          ? { text: part.text }
          : {}),
        ...(part.type === "tool-call"
          ? {
              toolCallId: part.toolCallId,
              toolName: part.toolName,
            }
          : {}),
        ...(part.type === "error"
          ? { error: streamErrorText(part.error) }
          : {}),
      });
      if (part.type === "text-delta") {
        textProduced = true;
        context.onText(part.text);
      } else if (part.type === "error") {
        providerError = streamErrorText(part.error);
      } else if (part.type === "finish") {
        finishReason = part.finishReason;
      } else if (part.type === "tool-call") {
        context.onTool({
          id: part.toolCallId,
          name: part.toolName,
          status: "completed",
          kind: "other",
        });
      }
    }
  } catch (error) {
    const message = streamErrorText(error);
    context.onStream({ type: "error", error: message });
    throw new Error(message);
  }
  let usage;
  try {
    usage = await result.usage;
  } catch (error) {
    const message = streamErrorText(error);
    context.onStream({ type: "error", error: message });
    throw new Error(providerError || message);
  }
  if (providerError) throw new Error(providerError);
  if (!textProduced) {
    const suffix = finishReason ? ` (finish reason: ${finishReason})` : "";
    throw new Error(`Provider returned no text output${suffix}.`);
  }
  return {
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    totalTokens: usage.totalTokens,
  } satisfies Usage;
}

async function runAiSdk(context: ProviderContext): Promise<ProviderResult> {
  const result = streamText({
    model: aiModel(context.connection.providerKey, context.modelId, context.connection),
    instructions: providerPrompt(context.job),
    messages: modelMessages(context.chat, context.job),
    abortSignal: context.signal,
  });
  return {
    usage: await consumeAiStream(result, context),
  };
}

async function runOAuthAiSdk(
  context: ProviderContext,
  providerKey: OAuthProviderKey,
): Promise<ProviderResult> {
  if (!context.connection.secret) {
    throw new Error("OAuth connection is not completed yet. Connect the provider first.");
  }
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "ai-chat-oauth-run-"));
  const authFile = path.join(tempDir, "oauth.json");
  await writeFile(authFile, context.connection.secret, { encoding: "utf8", mode: 0o600 });
  try {
    if (providerKey === "antigravity") {
      await ensureAntigravityProjectId(
        authFile,
        typeof context.connection.config.project === "string"
          ? context.connection.config.project
          : undefined,
      );
    }
    const provider = await createOAuthProvider(providerKey, authFile);
    const oauthModelId =
      providerKey === "codex" &&
      ["gpt-5.4", "gpt-5-codex", "gpt-5.6-sol"].includes(context.modelId)
        ? "gpt-5.6-terra"
        : context.modelId;
    const result = streamText({
      model: provider.languageModel(oauthModelId),
      instructions: providerPrompt(context.job),
      messages: modelMessages(context.chat, context.job),
      abortSignal: context.signal,
    });
    const usage = await consumeAiStream(result, context);
    const refreshedAuth = await readFile(authFile, "utf8").catch(() => context.connection.secret);
    if (refreshedAuth !== context.connection.secret && context.job.userId) {
      updateProviderConnection(context.connection.id, context.job.userId, {
        secret: refreshedAuth,
        enabled: true,
      });
    }
    return {
      usage: {
        ...usage,
      },
    };
  } finally {
    await rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

async function createCodexHome(
  secret: string | undefined,
  authType: "account" | "oauth",
  persistentHome?: string,
) {
  if (!secret?.trim()) return undefined;
  let auth: unknown;
  try {
    auth = JSON.parse(secret);
  } catch {
    throw new Error("Codex credentials are not valid JSON.");
  }
  if (!auth || typeof auth !== "object" || Array.isArray(auth)) {
    throw new Error("Codex credentials are not a valid JSON object.");
  }
  const home = persistentHome || await mkdtemp(path.join(os.tmpdir(), "ai-chat-codex-"));
  await mkdir(home, { recursive: true, mode: 0o700 });
  const authFile = path.join(home, "auth.json");
  const authObject = authType === "oauth"
    ? (() => {
        const record = (auth as Record<string, unknown>)["openai-codex"];
        const oauth = record && typeof record === "object"
          ? record as Record<string, unknown>
          : {};
        if (typeof oauth.access !== "string" || typeof oauth.refresh !== "string") {
          throw new Error("Codex OAuth credentials are incomplete.");
        }
        return {
          auth_mode: "chatgpt",
          OPENAI_API_KEY: null,
          tokens: {
            access_token: oauth.access,
            refresh_token: oauth.refresh,
            ...(typeof oauth.accountId === "string" ? { account_id: oauth.accountId } : {}),
          },
          last_refresh: new Date().toISOString(),
        };
      })()
    : auth;
  await writeFile(authFile, `${JSON.stringify(authObject)}\n`, { encoding: "utf8", mode: 0o600 });
  return { home, authFile, temporary: !persistentHome };
}

function codexTool(item: Record<string, unknown>): ToolPart | null {
  const type = asString(item.type);
  if (!type || type === "agent_message" || type === "reasoning") return null;
  const name =
    type === "command_execution"
      ? "Codex command"
      : type === "file_change"
        ? "Codex file change"
        : type === "mcp_tool_call"
          ? "Codex MCP tool"
          : `Codex ${type.replaceAll("_", " ")}`;
  return {
    id: asString(item.id) || crypto.randomUUID(),
    name,
    status: "completed",
    kind: type === "file_change" ? "edit" : type.includes("command") ? "shell" : "other",
    ...(item.command ? { input: JSON.stringify(item.command) } : {}),
    ...(item.output ? { result: asString(item.output) } : {}),
  };
}

async function persistCodexOAuthHome(context: ProviderContext, home: {
  authFile: string;
}) {
  if (context.connection.authType !== "oauth" || !context.job.userId) return;
  try {
    const official = JSON.parse(await readFile(home.authFile, "utf8")) as {
      tokens?: {
        access_token?: string;
        refresh_token?: string;
        account_id?: string;
      };
    };
    const tokens = official.tokens;
    if (!tokens?.access_token || !tokens.refresh_token) return;
    const existing = JSON.parse(context.connection.secret || "{}") as Record<string, unknown>;
    const previous = existing["openai-codex"] && typeof existing["openai-codex"] === "object"
      ? existing["openai-codex"] as Record<string, unknown>
      : {};
    updateProviderConnection(context.connection.id, context.job.userId, {
      secret: JSON.stringify({
        ...existing,
        "openai-codex": {
          ...previous,
          type: "oauth",
          access: tokens.access_token,
          refresh: tokens.refresh_token,
          ...(tokens.account_id || previous.accountId
            ? { accountId: tokens.account_id || previous.accountId }
            : {}),
          expires: Date.now() + 3_600_000,
        },
      }),
      enabled: true,
    });
  } catch {
    // Keep the previous encrypted credentials if the CLI did not write a refresh.
  }
}

async function runCodex(context: ProviderContext): Promise<ProviderResult> {
  const { Codex } = await import("@openai/codex-sdk");
  const codexModel =
    context.connection.authType === "oauth" &&
    ["gpt-5.4", "gpt-5-codex"].includes(context.modelId)
      ? "gpt-5.6-sol"
      : context.modelId;
  const persistentHome = context.connection.authType === "oauth" && context.job.userId
    ? path.join(config.dataDir, "provider-sessions", "codex", context.job.userId, context.connection.id)
    : undefined;
  const codexHome = context.connection.authType === "account" || context.connection.authType === "oauth"
    ? await createCodexHome(context.connection.secret, context.connection.authType, persistentHome)
    : undefined;
  const env = inheritedEnv(codexHome ? { CODEX_HOME: codexHome.home } : {});
  const codex = new Codex({
    ...(context.connection.authType === "api_key" && context.connection.secret
      ? { apiKey: context.connection.secret }
      : {}),
    ...(codexHome
      ? { config: { cli_auth_credentials_store: "file" as const } }
      : {}),
    env,
  });
  const previousId = context.chat.agentId?.startsWith("codex:")
    ? context.chat.agentId.slice("codex:".length)
    : undefined;
  const threadOptions = {
    model: codexModel,
    workingDirectory: config.agentCwd,
    skipGitRepoCheck: true,
    sandboxMode: "workspace-write" as const,
    approvalPolicy: "never" as const,
  };
  const thread = previousId
    ? codex.resumeThread(previousId, threadOptions)
    : codex.startThread(threadOptions);
  try {
    const prompt = [providerPrompt(context.job), context.job.message || "Continue the current task."]
      .filter(Boolean)
      .join("\n\nUser request:\n");
    const streamed = await thread.runStreamed(
      prompt,
      { signal: context.signal },
    );
    let usage: Usage | undefined;
    for await (const event of streamed.events) {
      context.onStream({
        type: event.type,
        ...("item" in event ? { item: event.item } : {}),
        ...("usage" in event ? { usage: event.usage } : {}),
        ...("message" in event ? { message: event.message } : {}),
        ...("error" in event ? { error: event.error } : {}),
      });
      if (event.type === "turn.completed") {
        usage = {
          inputTokens: event.usage.input_tokens,
          outputTokens: event.usage.output_tokens,
          totalTokens: event.usage.input_tokens + event.usage.output_tokens,
        };
      } else if (event.type === "turn.failed") {
        throw new Error(event.error.message);
      } else if (event.type === "error") {
        throw new Error(event.message);
      } else if (event.type === "item.completed") {
        const item = asRecord(event.item);
        if (asString(item.type) === "agent_message") {
          const text = asString(item.text);
          if (text) context.onText(text);
        } else {
          const tool = codexTool(item);
          if (tool) context.onTool(tool);
        }
      }
    }
    return {
      agentId: thread.id ? `codex:${thread.id}` : undefined,
      usage,
    };
  } finally {
    if (codexHome) {
      await persistCodexOAuthHome(context, codexHome);
      if (codexHome.temporary) {
        await rm(codexHome.home, { recursive: true, force: true }).catch(() => undefined);
      } else {
        await rm(codexHome.authFile, { force: true }).catch(() => undefined);
      }
    }
  }
}

function extractClaudeText(message: Record<string, unknown>) {
  const content = message.message;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => {
      const item = asRecord(part);
      return item.type === "text" ? asString(item.text) : "";
    })
    .filter(Boolean)
    .join("");
}

function claudeTool(message: Record<string, unknown>): ToolPart | null {
  const content = message.message;
  if (!Array.isArray(content)) return null;
  const tool = content.map(asRecord).find((item) => item.type === "tool_use");
  if (!tool) return null;
  return {
    id: asString(tool.id) || crypto.randomUUID(),
    name: asString(tool.name) || "Claude tool",
    status: "completed",
    kind: "other",
    ...(tool.input ? { input: JSON.stringify(tool.input) } : {}),
  };
}

async function runClaude(context: ProviderContext): Promise<ProviderResult> {
  const { query } = await import("@anthropic-ai/claude-agent-sdk");
  const abortController = new AbortController();
  const cancellationWatcher = setInterval(() => {
    if (context.signal.aborted) abortController.abort();
  }, 100);
  const previousId = context.chat.agentId?.startsWith("claude:")
    ? context.chat.agentId.slice("claude:".length)
    : undefined;
  const options = {
    cwd: config.agentCwd,
    model: context.modelId,
    tools: { type: "preset", preset: "claude_code" } as const,
    permissionMode: "acceptEdits" as const,
    includePartialMessages: true,
    ...(previousId ? { resume: previousId } : {}),
    env: inheritedEnv({
      ...(context.connection.secret ? { ANTHROPIC_API_KEY: context.connection.secret } : {}),
      CLAUDE_AGENT_SDK_CLIENT_APP: "metis-ai",
    }),
    abortController,
  };
  let sessionId: string | undefined;
  let receivedText = false;
  let usage: Usage | undefined;
  const conversation = query({
    prompt: [providerPrompt(context.job), context.job.message || "Continue the current task"]
      .filter(Boolean)
      .join("\n\nUser request:\n"),
    options,
  });
  try {
    for await (const message of conversation) {
      const record = asRecord(message);
      sessionId ||= asString(record.session_id);
      if (record.type === "stream_event") {
        const event = asRecord(record.event);
        const delta = asRecord(event.delta);
        if (delta.type === "text_delta") {
          const text = asString(delta.text);
          if (text) {
            receivedText = true;
            context.onText(text);
          }
        }
      } else if (record.type === "assistant") {
        if (!receivedText) {
          const text = extractClaudeText(record);
          if (text) context.onText(text);
        }
        const tool = claudeTool(record);
        if (tool) context.onTool(tool);
      } else if (record.type === "result") {
        const result = asString(record.result);
        if (!receivedText && result) context.onText(result);
        const recordUsage = asRecord(record.usage);
        usage = {
          inputTokens: typeof recordUsage.input_tokens === "number" ? recordUsage.input_tokens : undefined,
          outputTokens: typeof recordUsage.output_tokens === "number" ? recordUsage.output_tokens : undefined,
        };
      }
    }
  } finally {
    clearInterval(cancellationWatcher);
    conversation.close();
  }
  return {
    agentId: sessionId ? `claude:${sessionId}` : undefined,
    usage,
  };
}

async function runAntigravity(context: ProviderContext): Promise<ProviderResult> {
  const bridge = path.join(config.root, "scripts", "antigravity_bridge.py");
  const env = inheritedEnv({
    ...(context.connection.secret ? { GEMINI_API_KEY: context.connection.secret } : {}),
    ...(context.connection.authType === "vertex_adc"
      ? {
          GOOGLE_GENAI_USE_VERTEXAI: "true",
          ...(typeof context.connection.config.project === "string"
            ? { GOOGLE_CLOUD_PROJECT: context.connection.config.project }
            : {}),
          ...(typeof context.connection.config.location === "string"
            ? { GOOGLE_CLOUD_LOCATION: context.connection.config.location }
            : {}),
        }
      : {}),
  });
  const child = spawn(process.env.ANTIGRAVITY_PYTHON || "python3", [bridge], {
    cwd: config.agentCwd,
    env: env as NodeJS.ProcessEnv,
    stdio: "pipe",
  });
  const abortChild = () => child.kill("SIGTERM");
  if (context.signal.aborted) abortChild();
  else context.signal.addEventListener("abort", abortChild, { once: true });
  let stderr = "";
  child.stderr.on("data", (chunk: Buffer) => {
    stderr += chunk.toString();
  });
  child.stdin.write(`${JSON.stringify({
    prompt: [providerPrompt(context.job), context.job.message || "Continue the current task"]
      .filter(Boolean)
      .join("\n\nUser request:\n"),
    model: context.modelId,
    cwd: config.agentCwd,
  })}\n`);
  child.stdin.end();
  const lines = createInterface({ input: child.stdout });
  for await (const line of lines) {
    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(line) as Record<string, unknown>;
    } catch {
      continue;
    }
    if (payload.type === "text") context.onText(asString(payload.text));
    if (payload.type === "tool") {
      context.onTool({
        id: asString(payload.id) || crypto.randomUUID(),
        name: asString(payload.name) || "Antigravity tool",
        status: "completed",
        kind: "other",
      });
    }
    if (payload.type === "error") throw new Error(asString(payload.message) || "Antigravity bridge failed.");
  }
  const exitCode = await new Promise<number | null>((resolve) => {
    child.once("exit", (code: number | null) => resolve(code));
  });
  context.signal.removeEventListener("abort", abortChild);
  if (context.signal.aborted) throw new Error("Provider run cancelled.");
  if (exitCode !== 0) {
    throw new Error(stderr.trim() || "Antigravity bridge exited unsuccessfully.");
  }
  return {};
}

async function runProvider(context: ProviderContext): Promise<ProviderResult> {
  const providerKey = parseModelKey(context.job.modelId).providerKey;
  if (
    context.connection.authType === "oauth" &&
    (providerKey === "codex" || providerKey === "claude-code" || providerKey === "antigravity")
  ) {
    if (providerKey === "antigravity") {
      const effortValue = [
        ...(context.job.modelParams || []),
        ...(context.chat.modelParams || []),
      ].find((param) => param.id === "effort")?.value;
      const legacyVariant = context.modelId.match(/^(gemini-\d+\.\d+-flash|gemini-\d+\.\d+-pro)-(low|medium|high)$/);
      const effort = effortValue || legacyVariant?.[2] || "medium";
      const antigravityModel =
        legacyVariant?.[1] || context.modelId;
      await runOfficialAntigravityJob({
        userId: context.job.userId!,
        connectionId: context.connection.id,
        secret: context.connection.secret || "",
        modelId: antigravityModel,
        effort,
        prompt: [providerPrompt(context.job), context.job.message || "Continue the current task."]
          .filter(Boolean)
          .join("\n\nUser request:\n"),
        signal: context.signal,
        onText: context.onText,
        onStream: context.onStream,
      });
      return {};
    }
    return runOAuthAiSdk(context, providerKey);
  }
  if (providerKey === "codex") return runCodex(context);
  if (providerKey === "claude-code") return runClaude(context);
  if (providerKey === "antigravity") return runAntigravity(context);
  return runAiSdk(context);
}

export async function runAlternativeProviderJob(job: AgentJob, initialChat: Chat) {
  const parsed = parseModelKey(job.modelId || initialChat.modelId || "");
  const definition = getProviderDefinition(parsed.providerKey);
  if (!definition || parsed.providerKey === "cursor") return false;
  if (!job.userId) throw new Error("A user account is required for provider connections.");
  const connection = parsed.connectionId
    ? getProviderConnection(parsed.connectionId, job.userId)
    : findActiveConnection(job.userId, parsed.providerKey);
  if (!connection || !connection.enabled || connection.providerKey !== parsed.providerKey) {
    throw new Error(`No enabled ${definition.name} connection is configured.`);
  }
  if (!definition.authTypes.includes(connection.authType)) {
    throw new Error(`${definition.name} no longer supports ${connection.authType} authentication.`);
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
  const controller = new AbortController();
  const cancellationWatcher = setInterval(() => {
    if (getJob(job.id)?.status === "cancelled") controller.abort();
  }, 250);
  const emit = (event: string, data: unknown) => appendRunEvent(
    job.id,
    job.chatId,
    job.userId,
    event,
    data,
  );
  let checkpointTimer: ReturnType<typeof setTimeout> | undefined;
  let checkpointDirty = false;
  const checkpointNow = () => {
    upsertMessage(job.chatId, {
      id: assistantMessageId,
      role: "assistant",
      content: text,
      ...(tools.length ? { tools: [...tools] } : {}),
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
  const onText = (value: string) => {
    if (!value) return;
    text += value;
    checkpoint();
    emit("text", { text: value });
  };
  const onTool = (tool: ToolPart) => {
    tools.push(tool);
    checkpoint(true);
    emit("tool", {
      callId: tool.id,
      name: tool.name,
      status: tool.status,
      kind: tool.kind,
      ...(tool.input ? { input: tool.input } : {}),
      ...(tool.result ? { result: tool.result } : {}),
    });
  };

  appendMessage(job.chatId, { id: assistantMessageId, role: "assistant", content: "" });
  emit("assistantId", { messageId: assistantMessageId });
  emit("status", { status: "running", provider: definition.key });
  updateChat(job.chatId, {
    runStatus: "running",
    runUpdatedAt: new Date().toISOString(),
    queueMessage: null,
  }, job.userId);

  try {
    const result = await runProvider({
      job,
      chat,
      connection: credential,
      modelId: parsed.modelId,
      signal: controller.signal,
      onText,
      onTool,
      onStream: (data) => emit("stream", data),
    });
    const cancelled = controller.signal.aborted || getJob(job.id)?.status === "cancelled";
    if (cancelled) {
      updateChat(job.chatId, {
        runStatus: "cancelled",
        runUpdatedAt: new Date().toISOString(),
        queueMessage: null,
      }, job.userId);
      updateJob(job.id, { status: "cancelled" });
      emit("done", { status: "cancelled", provider: definition.key });
      return true;
    }
    if (!text.trim()) text = "The provider completed without returning a textual response.";
    checkpoint();
    chat = updateChat(job.chatId, {
      ...(result.agentId ? { agentId: result.agentId } : {}),
      runStatus: "completed",
      runUpdatedAt: new Date().toISOString(),
      queueMessage: null,
    }, job.userId) || chat;
    upsertMessage(job.chatId, {
      id: assistantMessageId,
      role: "assistant",
      content: text,
      ...(tools.length ? { tools } : {}),
      runMetadata: {
        providerId: definition.key,
        modelId: parsed.modelId,
        ...(result.usage?.inputTokens !== undefined ? { inputTokens: result.usage.inputTokens } : {}),
        ...(result.usage?.outputTokens !== undefined ? { outputTokens: result.usage.outputTokens } : {}),
        ...(result.usage?.totalTokens !== undefined ? { totalTokens: result.usage.totalTokens } : {}),
        completedAt: new Date().toISOString(),
      },
    });
    updateJob(job.id, {
      status: "completed",
      ...(result.agentId ? { agentId: result.agentId } : {}),
    });
    emit("done", {
      status: "finished",
      provider: definition.key,
      modelId: parsed.modelId,
      ...(result.agentId ? { agentId: result.agentId } : {}),
    });
  } catch (error) {
    const cancelled = controller.signal.aborted || getJob(job.id)?.status === "cancelled";
    const message = cancelled
      ? "Provider run cancelled."
      : error instanceof Error
        ? error.message
        : "Provider run failed.";
    if (cancelled) {
      updateChat(job.chatId, { runStatus: "cancelled", runUpdatedAt: new Date().toISOString() }, job.userId);
      updateJob(job.id, { status: "cancelled", error: message });
      emit("done", { status: "cancelled", provider: definition.key });
    } else {
      upsertMessage(job.chatId, {
        id: assistantMessageId,
        role: "assistant",
        content: text,
        errorMessage: message,
        ...(tools.length ? { tools } : {}),
      });
      updateChat(job.chatId, {
        runStatus: "error",
        runUpdatedAt: new Date().toISOString(),
        queueMessage: null,
      }, job.userId);
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
