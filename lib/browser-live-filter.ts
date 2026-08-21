import type { BrowserEventPayload } from "@/lib/server-browser";

export function matchesBrowserLiveEvent(
  event: Pick<BrowserEventPayload, "ownerId" | "chatId" | "tabId">,
  ownerId: string,
  chatId?: string | null,
  tabId?: string | null,
) {
  return event.ownerId === ownerId
    && (!chatId || event.chatId === chatId)
    && (!tabId || event.tabId === tabId);
}
