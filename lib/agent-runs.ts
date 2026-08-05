import type { Run } from "@cursor/sdk";

type ActiveRun = {
  run: Pick<Run, "cancel">;
  cancelRequested: boolean;
};

const activeRuns = new Map<string, ActiveRun>();

export function registerActiveRun(chatId: string, run: Pick<Run, "cancel">) {
  activeRuns.set(chatId, { run, cancelRequested: false });
}

export function getActiveRun(chatId: string) {
  return activeRuns.get(chatId);
}

export function clearActiveRun(chatId: string, run?: Pick<Run, "cancel">) {
  const current = activeRuns.get(chatId);
  if (!run || current?.run === run) activeRuns.delete(chatId);
}

export function requestRunCancel(chatId: string) {
  const current = activeRuns.get(chatId);
  if (!current) return null;
  current.cancelRequested = true;
  return current;
}
