import crypto from "node:crypto";
import { BaseDriver, type DriverExecutionContext, type DriverExecutionResult } from "./base-driver";
import { getMetisSystemPrompt } from "@/lib/agent-branding";

export class ClaudeDriver extends BaseDriver {
  key = "claude-code";
  displayName = "Claude Code";

  async execute(context: DriverExecutionContext): Promise<DriverExecutionResult> {
    const { query } = await import("@anthropic-ai/claude-agent-sdk");
    const abortController = new AbortController();
    const watcher = setInterval(() => {
      if (context.signal.aborted) abortController.abort();
    }, 100);

    const systemPrompt = context.systemPrompt || getMetisSystemPrompt({ cwd: context.cwd });
    const options: any = {
      cwd: context.cwd,
      model: context.modelId || "claude-3-7-sonnet-latest",
      permissionMode: "acceptEdits",
      includePartialMessages: true,
      env: {
        ...process.env,
        ...(context.secret ? { ANTHROPIC_API_KEY: context.secret } : {}),
        CLAUDE_AGENT_SDK_CLIENT_APP: "metis-ai",
      },
      abortController,
      systemPrompt,
      mcpServers: {
        metis: {
          url: context.mcpEndpoint,
          headers: {
            Authorization: `Bearer ${context.mcpToken}`,
          },
        },
      },
    };

    let sessionId: string | undefined;
    let fullText = "";
    let usage: DriverExecutionResult["usage"];
    const itemId = crypto.randomUUID();

    this.emit(context.sessionId, {
      type: "turn.started",
      turnId: context.turnId,
      timestamp: Date.now(),
    });

    try {
      const conversation = query({
        prompt: context.prompt,
        options,
      });

      for await (const message of conversation) {
        const record = message as Record<string, any>;
        sessionId ||= record.session_id;

        if (record.type === "stream_event") {
          const ev = record.event;
          if (ev?.delta?.type === "text_delta" && ev.delta.text) {
            fullText += ev.delta.text;
            this.emit(context.sessionId, {
              type: "content.delta",
              turnId: context.turnId,
              itemId,
              kind: "assistant_text",
              text: ev.delta.text,
              timestamp: Date.now(),
            });
          }
        } else if (record.type === "assistant" && !fullText) {
          const content = Array.isArray(record.message) ? record.message : [];
          for (const item of content) {
            if (item.type === "text" && item.text) {
              fullText += item.text;
              this.emit(context.sessionId, {
                type: "content.delta",
                turnId: context.turnId,
                itemId,
                kind: "assistant_text",
                text: item.text,
                timestamp: Date.now(),
              });
            }
          }
        } else if (record.type === "result") {
          if (record.usage) {
            usage = {
              inputTokens: record.usage.input_tokens,
              outputTokens: record.usage.output_tokens,
              totalTokens: (record.usage.input_tokens || 0) + (record.usage.output_tokens || 0),
            };
          }
        }
      }
    } finally {
      clearInterval(watcher);
    }

    this.emit(context.sessionId, {
      type: "turn.completed",
      turnId: context.turnId,
      usage,
      timestamp: Date.now(),
    });

    return {
      text: fullText,
      agentSessionId: sessionId ? `claude:${sessionId}` : undefined,
      usage,
    };
  }
}
