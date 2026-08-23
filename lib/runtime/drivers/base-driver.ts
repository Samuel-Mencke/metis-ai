import type { ProviderRuntimeEvent } from "../contracts";
import { runtimeEventBus } from "../event-bus";

export interface DriverExecutionContext {
  sessionId: string;
  turnId: string;
  modelId: string;
  prompt: string;
  cwd: string;
  secret?: string;
  baseUrl?: string;
  signal: AbortSignal;
  mcpEndpoint: string;
  mcpToken: string;
  parameters?: Array<{ id: string; value: string }>;
  systemPrompt?: string;
}

export interface DriverExecutionResult {
  text?: string;
  agentSessionId?: string;
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
  };
}

export interface ProviderDriver {
  key: string;
  displayName: string;
  execute: (context: DriverExecutionContext) => Promise<DriverExecutionResult>;
}

export abstract class BaseDriver implements ProviderDriver {
  abstract key: string;
  abstract displayName: string;
  abstract execute(context: DriverExecutionContext): Promise<DriverExecutionResult>;

  protected emit(sessionId: string, event: ProviderRuntimeEvent): void {
    runtimeEventBus.publish(sessionId, event);
  }
}
