import crypto from "node:crypto";
import { BaseDriver, type DriverExecutionContext, type DriverExecutionResult } from "./base-driver";

export class GrokDriver extends BaseDriver {
  key = "xai";
  displayName = "xAI Grok";

  async execute(context: DriverExecutionContext): Promise<DriverExecutionResult> {
    this.emit(context.sessionId, {
      type: "turn.started",
      turnId: context.turnId,
      timestamp: Date.now(),
    });

    const itemId = crypto.randomUUID();
    const fullText = "xAI Grok session active.";

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

    return { text: fullText, agentSessionId: `grok:${context.turnId}` };
  }
}
