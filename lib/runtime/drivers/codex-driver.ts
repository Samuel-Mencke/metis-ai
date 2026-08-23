import crypto from "node:crypto";
import { BaseDriver, type DriverExecutionContext, type DriverExecutionResult } from "./base-driver";
import { getMetisSystemPrompt } from "@/lib/agent-branding";

export class CodexDriver extends BaseDriver {
  key = "codex";
  displayName = "OpenAI Codex";

  async execute(context: DriverExecutionContext): Promise<DriverExecutionResult> {
    const codexSdk = await import("@openai/codex-sdk").catch(() => null);
    const effortParam = context.parameters?.find((p) => p.id === "effort")?.value;

    const threadOptions: any = {
      model: context.modelId || "gpt-5.4",
      ...(effortParam ? { modelReasoningEffort: effortParam } : {}),
      workingDirectory: context.cwd,
      skipGitRepoCheck: true,
      sandboxMode: "workspace-write",
      approvalPolicy: "never",
    };

    this.emit(context.sessionId, {
      type: "turn.started",
      turnId: context.turnId,
      timestamp: Date.now(),
    });

    let fullText = "";
    let usage: DriverExecutionResult["usage"];
    let threadId: string | undefined;

    if (codexSdk && codexSdk.Codex) {
      const codex = new codexSdk.Codex({
        ...(context.secret ? { apiKey: context.secret } : {}),
      });

      const thread = codex.startThread(threadOptions);
      threadId = thread.id;

      const systemPrompt = context.systemPrompt || getMetisSystemPrompt({ cwd: context.cwd });
      const prompt = `${systemPrompt}\n\nUser request:\n${context.prompt}`;

      const streamed = await thread.runStreamed(prompt, { signal: context.signal });
      const itemId = crypto.randomUUID();

      for await (const event of streamed.events) {
        if (event.type === "turn.completed") {
          if (event.usage) {
            usage = {
              inputTokens: event.usage.input_tokens,
              outputTokens: event.usage.output_tokens,
              totalTokens: (event.usage.input_tokens || 0) + (event.usage.output_tokens || 0),
            };
          }
        } else if (
          event.type === "item.started" ||
          event.type === "item.updated" ||
          event.type === "item.completed"
        ) {
          const item = (event as any).item;
          if (item?.type === "agent_message" && item.text) {
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
      }
    }

    this.emit(context.sessionId, {
      type: "turn.completed",
      turnId: context.turnId,
      usage,
      timestamp: Date.now(),
    });

    return {
      text: fullText,
      agentSessionId: threadId ? `codex:${threadId}` : undefined,
      usage,
    };
  }
}
