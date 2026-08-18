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
  if (options.force || options.isOverride) return "send";
  if (!options.hasContent) return "ignore";
  if (options.waitingForQuestion || options.busy || options.sendInFlight) return "queue";
  return "send";
}
