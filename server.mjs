import http from "node:http";
import next from "next";
import { WebSocketServer } from "ws";
import { getAuthenticatedUser } from "./lib/auth.ts";
import { captureBrowserFrame, performBrowserAction } from "./lib/server-browser.ts";

const port = Number(process.env.PORT || 3100);
const dev = process.env.NODE_ENV !== "production";
const nextApp = next({ dev, hostname: "127.0.0.1", port });
const handle = nextApp.getRequestHandler();
const websocketServer = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 });

function streamUrl(request) {
  const host = request.headers.host || `127.0.0.1:${port}`;
  return new URL(`http://${host}${request.url || "/"}`);
}

async function authenticate(request, url) {
  const headers = new Headers();
  for (const [key, value] of Object.entries(request.headers)) {
    if (typeof value === "string") headers.set(key, value);
  }
  const user = await getAuthenticatedUser(new Request(url, { headers }));
  const chatId = url.searchParams.get("chatId")?.trim();
  return user && chatId ? { userId: user.id || user.username, chatId } : null;
}

async function sendFrame(socket, context, tabId, quality, streamState) {
  if (socket.readyState !== 1 || socket.bufferedAmount > 2_000_000) return tabId;
  const frame = await captureBrowserFrame(context.userId, context.chatId, tabId, quality);
  const metadataKey = JSON.stringify({ tabId: frame.tabId, url: frame.url, title: frame.title, viewport: frame.viewport });
  if (metadataKey !== streamState.metadataKey) {
    streamState.metadataKey = metadataKey;
    socket.send(JSON.stringify({ type: "meta", tabId: frame.tabId, url: frame.url, title: frame.title, viewport: frame.viewport }));
  }
  socket.send(frame.data, { binary: true });
  return frame.tabId;
}

websocketServer.on("connection", async (socket, request, context, options) => {
  let tabId = options.tabId;
  let inFlight = false;
  let stopped = false;
  const streamState = { metadataKey: "" };
  const fps = Math.max(5, Math.min(Number(options.fps) || 10, 15));
  const quality = Math.max(35, Math.min(Number(options.quality) || 70, 90));

  const push = async () => {
    if (stopped || inFlight || socket.readyState !== 1) return;
    inFlight = true;
    try {
      tabId = await sendFrame(socket, context, tabId, quality, streamState);
    } catch (error) {
      socket.send(JSON.stringify({ type: "error", message: error instanceof Error ? error.message : "Browser stream failed" }));
    } finally {
      inFlight = false;
    }
  };

  socket.on("message", async (raw) => {
    let message;
    try { message = JSON.parse(raw.toString()); } catch { return; }
    if (message.type !== "action" || !message.action) return;
    try {
      const result = await performBrowserAction(context.userId, context.chatId, {
        action: message.action,
        tabId: message.tabId || tabId,
        selector: message.selector,
        text: message.text,
        key: message.key,
        x: message.x,
        y: message.y,
        deltaY: message.deltaY,
        width: message.width,
        height: message.height,
      });
      tabId = result.tabId;
      socket.send(JSON.stringify({ type: "meta", tabId: result.tabId, url: result.url === "about:blank" ? "" : result.url, title: result.title, viewport: result.viewport, tabs: result.tabs }));
      await push();
    } catch (error) {
      socket.send(JSON.stringify({ type: "error", message: error instanceof Error ? error.message : "Browser action failed" }));
    }
  });

  socket.on("close", () => { stopped = true; });
  await push();
  let timer;
  const scheduleNextFrame = () => {
    if (stopped) return;
    timer = setTimeout(async () => {
      await push();
      scheduleNextFrame();
    }, Math.round(1000 / fps));
  };
  scheduleNextFrame();
  socket.on("close", () => clearTimeout(timer));
});

await nextApp.prepare();
const server = http.createServer((request, response) => handle(request, response));
server.on("upgrade", async (request, socket, head) => {
  const url = streamUrl(request);
  if (url.pathname !== "/api/browser/stream") {
    socket.destroy();
    return;
  }
  try {
    const context = await authenticate(request, url);
    if (!context) {
      socket.write("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
      socket.destroy();
      return;
    }
    websocketServer.handleUpgrade(request, socket, head, (client) => {
      websocketServer.emit("connection", client, request, context, {
        tabId: url.searchParams.get("tabId") || undefined,
        fps: url.searchParams.get("fps"),
        quality: url.searchParams.get("quality"),
      });
    });
  } catch {
    socket.destroy();
  }
});

server.listen(port, "0.0.0.0", () => {
  console.log(`AI Chat listening on http://127.0.0.1:${port}`);
});
