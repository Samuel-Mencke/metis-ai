export type CursorSessionFailureKind = "active_run" | "missing" | null;

export function cursorSessionFailureKind(error: unknown): CursorSessionFailureKind {
  const message = error instanceof Error ? error.message : String(error ?? "");
  if (/already has active run|InvalidRunStateTransition/i.test(message)) return "active_run";
  if (/not found|no such|does not exist|unknown agent/i.test(message)) return "missing";
  return null;
}

export function canRecoverCursorSend(input: {
  error: unknown;
  receivedTextDelta: boolean;
  toolCount: number;
  alreadyRetried: boolean;
}) {
  return Boolean(
    !input.alreadyRetried &&
    !input.receivedTextDelta &&
    input.toolCount === 0 &&
    cursorSessionFailureKind(input.error),
  );
}
