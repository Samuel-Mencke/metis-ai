import crypto from "node:crypto";
import { spawn } from "node:child_process";
import { BaseDriver, type DriverExecutionContext, type DriverExecutionResult } from "./base-driver";
import { getMetisSystemPrompt } from "@/lib/agent-branding";

export class AntigravityDriver extends BaseDriver {
  key = "antigravity";
  displayName = "Google Antigravity";

  async execute(context: DriverExecutionContext): Promise<DriverExecutionResult> {
    this.emit(context.sessionId, {
      type: "turn.started",
      turnId: context.turnId,
      timestamp: Date.now(),
    });

    const effortParam = context.parameters?.find((p) => p.id === "effort")?.value || "medium";
    const systemPrompt = context.systemPrompt || getMetisSystemPrompt({ cwd: context.cwd });
    const fullPrompt = `${systemPrompt}\n\nUser request:\n${context.prompt}`;
    const itemId = crypto.randomUUID();

    let fullText = "";

    return new Promise<DriverExecutionResult>((resolve) => {
      const child = spawn("agy", ["run", "--model", context.modelId || "gemini-3.7-flash", "--prompt", fullPrompt], {
        cwd: context.cwd,
        env: {
          ...process.env,
          ...(context.secret ? { GEMINI_API_KEY: context.secret } : {}),
        },
      });

      child.stdout.on("data", (chunk: Buffer) => {
        const text = chunk.toString("utf8");
        fullText += text;
        this.emit(context.sessionId, {
          type: "content.delta",
          turnId: context.turnId,
          itemId,
          kind: "assistant_text",
          text,
          timestamp: Date.now(),
        });
      });

      child.on("close", () => {
        this.emit(context.sessionId, {
          type: "turn.completed",
          turnId: context.turnId,
          timestamp: Date.now(),
        });

        resolve({
          text: fullText,
          agentSessionId: `antigravity:${context.turnId}`,
        });
      });

      child.on("error", () => {
        this.emit(context.sessionId, {
          type: "turn.completed",
          turnId: context.turnId,
          timestamp: Date.now(),
        });
        resolve({
          text: fullText,
          agentSessionId: `antigravity:${context.turnId}`,
        });
      });
    });
  }
}
