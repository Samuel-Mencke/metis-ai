export const COMPOSER_SEND_DEDUP_MS = 900;

export function composerLiveText(domText: string | null | undefined, stateText: string) {
  const fromDom = (domText ?? "").replace(/\u00a0/g, " ");
  return fromDom.trim() ? fromDom : stateText;
}

export function shouldIgnoreComposerEnter(event: {
  key: string;
  shiftKey: boolean;
  repeat?: boolean;
  isComposing?: boolean;
  keyCode?: number;
}) {
  if (event.key !== "Enter" || event.shiftKey) return false;
  if (event.repeat) return true;
  if (event.isComposing || event.keyCode === 229) return true;
  return false;
}

export function isDuplicateComposerSend(
  text: string,
  last: { text: string; at: number },
  now = Date.now(),
  windowMs = COMPOSER_SEND_DEDUP_MS,
) {
  if (!text) return false;
  return last.text === text && now - last.at < windowMs;
}

export type ComposerSendAction = "ignore" | "queue" | "send";

export function decideComposerSend(options: {
  force: boolean;
  isOverride: boolean;
  hasContent: boolean;
  sendInFlight: boolean;
  busy: boolean;
  waitingForQuestion: boolean;
  duplicate: boolean;
}): ComposerSendAction {
  if (options.duplicate && !options.force) return "ignore";
  if (!options.hasContent && !options.isOverride) return "ignore";
  // Force/override must not start a second in-flight POST (queue spam / 409).
  if (options.sendInFlight) return options.force || options.isOverride ? "ignore" : "queue";
  if (options.force || options.isOverride) return "send";
  if (!options.hasContent) return "ignore";
  if (options.waitingForQuestion || options.busy) return "queue";
  return "send";
}

export function shouldAutoDrainQueue(options: {
  busy: boolean;
  sendInFlight: boolean;
  waitingForQuestion: boolean;
  drainBlocked: boolean;
  drainInProgress: boolean;
  queueLength: number;
  hasActiveRuntime?: boolean;
}) {
  return (
    !options.busy &&
    !options.sendInFlight &&
    !options.waitingForQuestion &&
    !options.drainBlocked &&
    !options.drainInProgress &&
    !options.hasActiveRuntime &&
    options.queueLength > 0
  );
}

export function mergeQueuedFollowUps<T extends { id: string }>(
  local: T[],
  server: T[],
  options?: { consumedIds?: Iterable<string> },
): T[] {
  const consumed = new Set(options?.consumedIds);
  const byId = new Map<string, T>();
  for (const item of server) {
    if (!consumed.has(item.id)) byId.set(item.id, item);
  }
  for (const item of local) {
    if (consumed.has(item.id)) {
      byId.delete(item.id);
      continue;
    }
    byId.set(item.id, item);
  }
  const merged: T[] = [];
  const seen = new Set<string>();
  for (const item of [...local, ...server]) {
    const next = byId.get(item.id);
    if (!next || seen.has(next.id)) continue;
    seen.add(next.id);
    merged.push(next);
  }
  return merged;
}
