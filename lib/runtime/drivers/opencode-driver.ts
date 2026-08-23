import crypto from "node:crypto";
import { BaseDriver, type DriverExecutionContext, type DriverExecutionResult } from "./base-driver";
import { getMetisSystemPrompt } from "@/lib/agent-branding";

export class OpenCodeDriver extends BaseDriver {
  key = "opencode";
  displayName = "OpenCode";

  async execute(context: DriverExecutionContext): Promise<DriverExecutionResult> {
    this.emit(context.sessionId, {
      type: "turn.started",
      turnId: context.turnId,
      timestamp: Date.now(),
    });

    const itemId = crypto.randomUUID();
    const fullText = "OpenCode session active.";

    this.emit(context.sessionId, {
      type: "content.delta",
      turnId: context.turnId,
      itemId,
      kind: "assistant_text",
      text: fullText,
      timestamp: Date.now(),
    });

    this.emit(context.sessionId, {
      type: "turn.completed",
      turnId: context.turnId,
      timestamp: Date.now(),
    });

    return { text: fullText, agentSessionId: `opencode:${context.turnId}` };
  }
}
