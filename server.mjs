import http from "node:http";
import { AsyncLocalStorage } from "node:async_hooks";
import { WebSocketServer } from "ws";

// Next's custom-server entrypoint expects this Node primitive to be exposed
// globally. The regular `next start` launcher does this during its bootstrap,
// but a custom server loaded through tsx does not.
if (!globalThis.AsyncLocalStorage) {
  globalThis.AsyncLocalStorage = AsyncLocalStorage;
}
const { default: next } = await import("next");
const { getAuthenticatedUser, passwordMatches } = await import("./lib/auth.ts");
const { updateChat } = await import("./lib/db-store.ts");
const {
  captureBrowserFrame,
  cleanupBrowserSessions,
  performBrowserAction,
  setBrowserViewport,
} = await import("./lib/server-browser.ts");

const port = Number(process.env.PORT || 3100);
const host = process.env.AI_CHAT_HOST?.trim() || "127.0.0.1";
const dev = process.env.NODE_ENV !== "production";
const nextApp = next({ dev, hostname: host, port });
const handle = nextApp.getRequestHandler();
const websocketServer = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 });
const browserStreamSubscribers = new Map();

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

function internalEngineAuthorized(request) {
  const configured =
    process.env.AI_CHAT_INTERNAL_TOKEN?.trim() ||
    process.env.MCP_BEARER_TOKEN?.trim();
  if (configured) {
    return request.headers.authorization === `Bearer ${configured}`;
  }
  return request.headers["x-ai-chat-internal"] === "1" &&
    passwordMatches(request.headers["x-chat-password"]);
}

async function readRequestJson(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}

function persistBrowserContext(userId, chatId, result) {
  updateChat(chatId, {
    browserContext: {
      tabs: result.tabs,
      activeTabId: result.tabId,
      sessionKey: chatId,
      updatedAt: new Date().toISOString(),
    },
  }, userId);
}

async function performSharedBrowserAction(userId, chatId, action) {
  await cleanupBrowserSessions();
  const result = await performBrowserAction(userId, chatId, action);
  persistBrowserContext(userId, chatId, result);
  const subscribers = browserStreamSubscribers.get(`${userId}:${chatId}`);
  if (subscribers) {
    await Promise.allSettled([...subscribers].map((notify) => notify(result)));
  }
  return result;
}

async function handleBrowserEngine(request, response) {
  if (request.method !== "POST") {
    response.writeHead(405, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ error: "Method not allowed" }));
    return;
  }
  if (!internalEngineAuthorized(request)) {
    response.writeHead(401, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ error: "Unauthorized" }));
    return;
  }
  const userId = String(request.headers["x-ai-chat-user-id"] || "").trim();
  const chatId = String(request.headers["x-ai-chat-id"] || "").trim();
  if (!userId || !chatId) {
    response.writeHead(400, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ error: "Chat and user context are required" }));
    return;
  }
  try {
    const action = await readRequestJson(request);
    const result = await performSharedBrowserAction(userId, chatId, action);
    response.writeHead(200, {
      "Cache-Control": "no-store",
      "Content-Type": "application/json",
    });
    response.end(JSON.stringify(result));
  } catch (error) {
    response.writeHead(400, { "Content-Type": "application/json" });
    response.end(JSON.stringify({
      error: error instanceof Error ? error.message : "Browser action failed",
    }));
  }
}

async function sendFrame(socket, context, tabId, quality, streamState) {
  if (socket.readyState !== 1 || socket.bufferedAmount > 2_000_000) return tabId;
  const frame = await captureBrowserFrame(context.userId, context.chatId, tabId, quality);
  const metadataKey = JSON.stringify({
    tabId: frame.tabId,
    activeTabId: frame.activeTabId,
    url: frame.url,
    title: frame.title,
    tabs: frame.tabs,
    viewport: frame.viewport,
  });
  if (metadataKey !== streamState.metadataKey) {
    streamState.metadataKey = metadataKey;
    socket.send(JSON.stringify({
      type: "meta",
      tabId: frame.tabId,
      activeTabId: frame.activeTabId,
      url: frame.url,
      title: frame.title,
      tabs: frame.tabs,
      viewport: frame.viewport,
    }));
  }
  socket.send(frame.data, { binary: true });
  return frame.tabId;
}

websocketServer.on("connection", async (socket, request, context, options) => {
  let tabId = options.tabId;
  let inFlight = false;
  let stopped = false;
  const streamState = { metadataKey: "" };
  const fps = Math.max(1, Math.min(Number(options.fps) || 10, 30));
  const quality = Math.max(35, Math.min(Number(options.quality) || 70, 90));
  const realtime = options.realtime !== false;

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

  const subscriberKey = `${context.userId}:${context.chatId}`;
  const subscribers = browserStreamSubscribers.get(subscriberKey) || new Set();
  const notify = (result) => {
    if (result?.activeTabId) tabId = result.activeTabId;
    return push();
  };
  subscribers.add(notify);
  browserStreamSubscribers.set(subscriberKey, subscribers);

  socket.on("message", async (raw) => {
    let message;
    try { message = JSON.parse(raw.toString()); } catch { return; }
    if (message.type !== "action" || !message.action) return;
    try {
      const result = await performSharedBrowserAction(context.userId, context.chatId, {
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
      socket.send(JSON.stringify({
        type: "meta",
        tabId: result.tabId,
        activeTabId: result.activeTabId,
        url: result.url === "about:blank" ? "" : result.url,
        title: result.title,
        viewport: result.viewport,
        tabs: result.tabs,
      }));
    } catch (error) {
      socket.send(JSON.stringify({ type: "error", message: error instanceof Error ? error.message : "Browser action failed" }));
    }
  });

  socket.on("close", () => {
    stopped = true;
    subscribers.delete(notify);
    if (!subscribers.size) browserStreamSubscribers.delete(subscriberKey);
  });
  if (options.width && options.height) {
    await setBrowserViewport(context.userId, context.chatId, options.width, options.height);
  }
  await push();
  let timer;
  if (!realtime) return;
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
const server = http.createServer(async (request, response) => {
  const url = streamUrl(request);
  if (url.pathname === "/__internal/browser-engine") {
    await handleBrowserEngine(request, response);
    return;
  }
  await handle(request, response);
});
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
        realtime: url.searchParams.get("realtime") !== "0",
        width: url.searchParams.get("width"),
        height: url.searchParams.get("height"),
      });
    });
  } catch {
    socket.destroy();
  }
});

server.listen(port, host, () => {
  const publicUrl = process.env.AI_CHAT_PUBLIC_URL?.trim() || `http://${host}:${port}`;
  console.log(`AI Chat listening on ${publicUrl} (bound to ${host}:${port})`);
});
