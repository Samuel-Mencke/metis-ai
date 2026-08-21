import { extractEmbeddedToolCalls, type EmbeddedToolCall } from "@/lib/providers/tool-schema";

export type { EmbeddedToolCall };
export type EmbeddedToolExecution = EmbeddedToolCall & {
  ok: boolean;
  result?: unknown;
  error?: string;
};

/** AI-SDK-loop payload runner.ts can append as a tool result without extra mapping. */
export type EmbeddedToolResultPayload = {
  name: string;
  args: Record<string, unknown>;
  result: unknown;
  ok: boolean;
};

/**
 * Some OpenAI-compatible endpoints occasionally serialize tool calls as text
 * instead of returning a native tool-call part. Execute those calls in order
 * through the same tool surface rather than silently stripping them.
 */
export async function executeEmbeddedToolFallbacks(
  text: string,
  executor: (call: EmbeddedToolCall, index: number) => Promise<unknown>,
): Promise<EmbeddedToolExecution[]> {
  const calls = extractEmbeddedToolCalls(text);
  const executions: EmbeddedToolExecution[] = [];
  for (let index = 0; index < calls.length; index += 1) {
    const call = calls[index];
    try {
      executions.push({ ...call, ok: true, result: await executor(call, index) });
    } catch (error) {
      executions.push({
        ...call,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return executions;
}

export function toEmbeddedToolResultPayloads(
  executions: EmbeddedToolExecution[],
): EmbeddedToolResultPayload[] {
  return executions.map((execution) => ({
    name: execution.name,
    args: execution.args,
    result: execution.ok ? execution.result : execution.error,
    ok: execution.ok,
  }));
}
