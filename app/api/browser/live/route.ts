import { getAuthenticatedUser, isAuthenticated } from "@/lib/auth";
import { browserEvents, type BrowserEventPayload } from "@/lib/server-browser";
import { matchesBrowserLiveEvent } from "@/lib/browser-live-filter";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Server-Sent Events stream of live agent-browser activity. Clients subscribe
// with their session cookie; events are filtered server-side to the
// authenticated owner (and optionally ?chatId= and ?tabId=) before they
// leave the process. Keepalive comments every 15s keep proxies from reaping
// the connection; the listener is removed when the client disconnects.
export async function GET(req: Request) {
  if (!(await isAuthenticated(req))) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const user = await getAuthenticatedUser(req);
  const ownerId = user?.id || user?.username || null;
  if (!ownerId) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const chatFilter = new URL(req.url).searchParams.get("chatId")?.trim() || null;
  const tabFilter = new URL(req.url).searchParams.get("tabId")?.trim() || null;

  const encoder = new TextEncoder();
  let listener: ((event: BrowserEventPayload) => void) | null = null;
  let keepalive: ReturnType<typeof setInterval> | null = null;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (chunk: string) => {
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          cleanup();
        }
      };

      const cleanup = () => {
        if (listener) {
          browserEvents.removeListener("browser-event", listener);
          listener = null;
        }
        if (keepalive) {
          clearInterval(keepalive);
          keepalive = null;
        }
      };

      send(`retry: 3000\n\n`);

      listener = (event) => {
        if (!matchesBrowserLiveEvent(event, ownerId, chatFilter, tabFilter)) return;
        send(`data: ${JSON.stringify(event)}\n\n`);
      };
      browserEvents.addListener("browser-event", listener);

      keepalive = setInterval(() => send(`: ping\n\n`), 15_000);

      // Client disconnect (EventSource closed / tab closed / proxy teardown).
      req.signal.addEventListener("abort", () => {
        cleanup();
        try {
          controller.close();
        } catch {
          // Already closed.
        }
      });
    },
    cancel() {
      if (listener) {
        browserEvents.removeListener("browser-event", listener);
        listener = null;
      }
      if (keepalive) {
        clearInterval(keepalive);
        keepalive = null;
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-store, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
