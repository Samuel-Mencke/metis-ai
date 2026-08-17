import dns from "node:dns/promises";
import crypto from "node:crypto";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { chromium, type BrowserContext, type Page } from "playwright";
import { config } from "@/lib/config";

const MAX_SNAPSHOT_LENGTH = 120_000;
const SESSION_IDLE_MS = 30 * 60 * 1000;
const MAX_TABS = 12;
const DEFAULT_VIEWPORT = { width: 1280, height: 800 };

type BrowserContextState = {
  ownerId: string;
  chatId: string;
  context: BrowserContext;
  tabs: Map<string, Page>;
  activeTabId: string;
  lastUsed: number;
};

type BrowserAction = {
  action: string;
  sessionId?: string;
  tabId?: string;
  url?: string;
  selector?: string;
  text?: string;
  key?: string;
  value?: string;
  targetSelector?: string;
  filePath?: string;
  x?: number;
  y?: number;
  deltaY?: number;
  width?: number;
  height?: number;
  downloadPath?: string;
};

type BrowserResult = {
  sessionId: string;
  tabId: string;
  activeTabId: string;
  url: string;
  title: string;
  tabs: Array<{ id: string; url: string; title: string; favicon?: string }>;
  screenshot?: string;
  snapshot?: string;
  viewport: { width: number; height: number };
  downloadPath?: string;
  downloadFilename?: string;
};

export type PointerKind = "click" | "drag" | "hover" | "type" | "scroll";

export type BrowserEventPayload = {
  type: "action" | "navigation" | "screenshot" | "pointer";
  ownerId: string;
  chatId: string;
  tabId: string;
  url: string;
  title: string;
  action?: string;
  screenshot?: string;
  // Pointer events: viewport-relative FRACTIONS (0..1) so any stream resolution scales.
  x?: number;
  y?: number;
  pointerKind?: PointerKind;
  detail?: string;
  ts: number;
};

async function recordBrowserHistory(ownerId: string, chatId: string, url: string, title: string) {
  try {
    const { getDatabase } = await import("@/lib/sqlite");
    getDatabase().prepare("INSERT INTO browser_history (owner_id, chat_id, url, title, ts) VALUES (?, ?, ?, ?, ?)")
      .run(ownerId, chatId, url, title || "", Date.now());
  } catch {
    // history persistence is best-effort, never break navigation
  }
}

async function emitPointerEvent(
  ownerId: string, chatId: string, tabId: string, page: Page,
  kind: PointerKind, detail?: string,
  coords?: { x?: number; y?: number }, selector?: string,
) {
  try {
    let x = coords?.x;
    let y = coords?.y;
    if ((x === undefined || y === undefined) && selector) {
      const box = await page.locator(selector).first().boundingBox();
      if (box) { x = box.x + box.width / 2; y = box.y + box.height / 2; }
    }
    if (x === undefined || y === undefined) return;
    const viewport = page.viewportSize() || DEFAULT_VIEWPORT;
    emitBrowserEvent({
      type: "pointer", ownerId, chatId, tabId, url: page.url(), title: "",
      pointerKind: kind, detail,
      x: Math.max(0, Math.min(1, x / viewport.width)),
      y: Math.max(0, Math.min(1, y / viewport.height)),
      ts: Date.now(),
    });
  } catch {
    // pointer overlay is cosmetic — never break the action
  }
}

// The custom server entrypoint (server.mjs via tsx) and the Next-bundled route
// handlers can end up with separate module instances of this file; anchor the
// emitter on globalThis so every consumer observes the same instance.
const browserEventsGlobal = globalThis as typeof globalThis & { __metisBrowserEvents?: EventEmitter };
export const browserEvents: EventEmitter = browserEventsGlobal.__metisBrowserEvents || new EventEmitter();
browserEvents.setMaxListeners(200);
browserEventsGlobal.__metisBrowserEvents = browserEvents;

function emitBrowserEvent(payload: BrowserEventPayload) {
  try {
    browserEvents.emit("browser-event", payload);
  } catch {
    // Event emission must never break the browser action it reports.
  }
}

const pageMeta = new WeakMap<Page, { ownerId: string; chatId: string; tabId: string }>();

const persistentContexts = new Map<string, Promise<BrowserContext>>();
const sessions = new Map<string, BrowserContextState>();
const actionLocks = new Map<string, Promise<void>>();
const allowedAddressCache = new Map<string, { expiresAt: number }>();
const browserProfilesDir = path.join(config.dataDir, "browser-profiles");

function envList(name: string) {
  return (process.env[name] || "")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
}

function sessionKey(ownerId: string, chatId: string) {
  return `${ownerId}:${chatId}`;
}

function isPrivateAddress(address: string) {
  if (!net.isIP(address)) return false;
  if (address === "::1" || address.startsWith("fc") || address.startsWith("fd") || address.startsWith("fe80:")) return true;
  const octets = address.split(".").map(Number);
  return octets.length === 4 && (
    octets[0] === 10 ||
    octets[0] === 127 ||
    (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) ||
    (octets[0] === 192 && octets[1] === 168) ||
    (octets[0] === 169 && octets[1] === 254)
  );
}

function isLocalhost(hostname: string) {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
}

async function assertAllowedUrl(rawUrl: string) {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error("Invalid browser URL");
  }
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error("Only HTTP and HTTPS browser URLs are allowed");
  }

  const allowedHosts = envList("BROWSER_ALLOWED_HOSTS");
  const hostname = url.hostname.toLowerCase();
  if (!isLocalhost(hostname) && !allowedHosts.includes(hostname)) {
    if (url.protocol !== "https:") throw new Error("External browser targets must use HTTPS");
  }
  if (isLocalhost(hostname)) return url.toString();

  const cached = allowedAddressCache.get(hostname);
  if (!cached || cached.expiresAt <= Date.now()) {
    const addresses = await dns.lookup(hostname, { all: true });
    if (!addresses.length || addresses.some(({ address }) => isPrivateAddress(address))) {
      throw new Error("Browser target resolves to a private or unavailable network address");
    }
    allowedAddressCache.set(hostname, { expiresAt: Date.now() + 60_000 });
  }
  return url.toString();
}

function ownerHash(ownerId: string) {
  return crypto.createHash("sha256").update(ownerId).digest("hex");
}

function profilePath(ownerId: string) {
  return path.join(browserProfilesDir, ownerHash(ownerId));
}

function metadataPath(ownerId: string) {
  return path.join(browserProfilesDir, `${ownerHash(ownerId)}.json`);
}

function readMetadata(ownerId: string): Record<string, { lastAccess: string }> {
  try {
    const value = JSON.parse(fs.readFileSync(metadataPath(ownerId), "utf8")) as unknown;
    return value && typeof value === "object" ? value as Record<string, { lastAccess: string }> : {};
  } catch {
    return {};
  }
}

function writeMetadata(ownerId: string, metadata: Record<string, { lastAccess: string }>) {
  fs.mkdirSync(browserProfilesDir, { recursive: true, mode: 0o700 });
  const target = metadataPath(ownerId);
  const temporary = `${target}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(metadata)}\n`, { encoding: "utf8", mode: 0o600 });
  fs.renameSync(temporary, target);
  fs.chmodSync(browserProfilesDir, 0o700);
}

function recordOrigin(ownerId: string, rawUrl: string) {
  try {
    const origin = new URL(rawUrl).origin;
    if (origin === "null" || origin === "about:blank") return;
    const metadata = readMetadata(ownerId);
    metadata[origin] = { lastAccess: new Date().toISOString() };
    writeMetadata(ownerId, metadata);
  } catch {
    // Browser navigation validation handles invalid URLs.
  }
}

async function getPersistentContext(ownerId: string) {
  const existing = persistentContexts.get(ownerId);
  if (existing) return existing;
  fs.mkdirSync(browserProfilesDir, { recursive: true, mode: 0o700 });
  const pending = chromium.launchPersistentContext(profilePath(ownerId), {
    headless: true,
    viewport: DEFAULT_VIEWPORT,
  });
  persistentContexts.set(ownerId, pending);
  try {
    const context = await pending;
    fs.chmodSync(profilePath(ownerId), 0o700);
    context.on("close", () => {
      if (persistentContexts.get(ownerId) === pending) persistentContexts.delete(ownerId);
    });
    return context;
  } catch (error) {
    if (persistentContexts.get(ownerId) === pending) persistentContexts.delete(ownerId);
    const message = error instanceof Error ? error.message : String(error);
    if (/Executable doesn't exist/i.test(message)) {
      throw new Error("Playwright Chromium is not installed. From /home/samuel/metis-ai run: pnpm exec playwright install chromium");
    }
    throw error;
  }
}

async function installRequestGuard(page: Page) {
  await page.route("**/*", async (route) => {
    try {
      await assertAllowedUrl(route.request().url());
      await route.continue();
    } catch {
      await route.abort("blockedbyclient");
    }
  });
}

// Tracks a session page so page-initiated navigations (links, redirects,
// JS router pushes) surface as live events even without an explicit action.
function attachPageEventTracking(page: Page, ownerId: string, chatId: string, tabId: string) {
  pageMeta.set(page, { ownerId, chatId, tabId });
  page.on("framenavigated", (frame) => {
    if (frame !== page.mainFrame()) return;
    const meta = pageMeta.get(page);
    if (!meta) return;
    const url = frame.url();
    const ts = Date.now();
    void page
      .title()
      .catch(() => "")
      .then((title) => {
        emitBrowserEvent({ type: "navigation", ownerId: meta.ownerId, chatId: meta.chatId, tabId: meta.tabId, url, title, ts });
        void recordBrowserHistory(meta.ownerId, meta.chatId, url, title);
      });
  });
}

async function createSession(ownerId: string, chatId: string) {
  const context = await getPersistentContext(ownerId);
  const page = await context.newPage();
  await installRequestGuard(page);
  attachPageEventTracking(page, ownerId, chatId, "browser-1");
  const state: BrowserContextState = {
    ownerId,
    chatId,
    context,
    tabs: new Map([["browser-1", page]]),
    activeTabId: "browser-1",
    lastUsed: Date.now(),
  };
  sessions.set(sessionKey(ownerId, chatId), state);
  return state;
}

async function getSession(ownerId: string, chatId: string) {
  const key = sessionKey(ownerId, chatId);
  let state = sessions.get(key);
  if (!state) state = await createSession(ownerId, chatId);
  state.lastUsed = Date.now();
  return state;
}

function tabIdFor(state: BrowserContextState, requested?: string) {
  const tabId = requested && state.tabs.has(requested) ? requested : state.activeTabId;
  state.activeTabId = tabId;
  return tabId;
}

async function pageInfo(state: BrowserContextState, tabId: string) {
  const page = state.tabs.get(tabId)!;
  const url = page.url();
  const faviconHref = await page.locator('link[rel~="icon"], link[rel="shortcut icon"]').first().getAttribute("href").catch(() => null);
  let favicon: string | undefined;
  if (faviconHref) {
    try {
      favicon = new URL(faviconHref, url).toString();
    } catch {
      favicon = undefined;
    }
  } else if (url && url !== "about:blank") {
    favicon = `${new URL(url).origin}/favicon.ico`;
  }
  return { id: tabId, url, title: await page.title().catch(() => "New tab"), favicon };
}

async function resultFor(state: BrowserContextState, tabId: string): Promise<BrowserResult> {
  const page = state.tabs.get(tabId)!;
  const info = await pageInfo(state, tabId);
  return {
    sessionId: sessionKey(state.ownerId, state.chatId),
    tabId,
    activeTabId: state.activeTabId,
    url: info.url,
    title: info.title,
    tabs: await Promise.all([...state.tabs.keys()].map((id) => pageInfo(state, id))),
    viewport: state.context.pages().find((candidate) => candidate === page)?.viewportSize() || { width: 1280, height: 800 },
  };
}

export async function captureBrowserFrame(
  ownerId: string,
  chatId: string,
  requestedTabId?: string,
  quality = 70,
  includeMetadata = true,
) {
  const state = await getSession(ownerId, chatId);
  const tabId = tabIdFor(state, requestedTabId);
  const page = state.tabs.get(tabId)!;
  const url = page.url();
  const info = includeMetadata
    ? await pageInfo(state, tabId)
    : { id: tabId, url, title: "" };
  return {
    tabId,
    activeTabId: state.activeTabId,
    tabs: includeMetadata
      ? await Promise.all([...state.tabs.keys()].map((id) => pageInfo(state, id)))
      : [],
    url: url === "about:blank" ? "" : url,
    title: info.title,
    viewport: page.viewportSize() || DEFAULT_VIEWPORT,
    data: await page.screenshot({ type: "jpeg", quality: Math.max(35, Math.min(90, quality)) }),
  };
}

export async function setBrowserViewport(
  ownerId: string,
  chatId: string,
  width: number,
  height: number,
) {
  const state = await getSession(ownerId, chatId);
  const nextWidth = Math.max(320, Math.min(2560, Math.round(width) || DEFAULT_VIEWPORT.width));
  const nextHeight = Math.max(240, Math.min(1600, Math.round(height) || DEFAULT_VIEWPORT.height));
  await Promise.all(
    [...state.tabs.values()].map((page) => page.setViewportSize({ width: nextWidth, height: nextHeight })),
  );
  return { width: nextWidth, height: nextHeight };
}

async function performBrowserActionUnlocked(ownerId: string, chatId: string, action: BrowserAction): Promise<BrowserResult> {
  if (!ownerId || !chatId) throw new Error("Browser actions require an authenticated user and chat");
  const state = await getSession(ownerId, chatId);
  let tabId: string;
  let page: Page;

  if (action.action === "new_tab") {
    if (state.tabs.size >= MAX_TABS) throw new Error(`A browser session can have at most ${MAX_TABS} tabs`);
    tabId = `browser-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    page = await state.context.newPage();
    await installRequestGuard(page);
    attachPageEventTracking(page, ownerId, chatId, tabId);
    state.tabs.set(tabId, page);
    state.activeTabId = tabId;
  } else {
    tabId = tabIdFor(state, action.tabId);
    page = state.tabs.get(tabId)!;
  }

  if (action.action === "close_tab") {
    if (state.tabs.size <= 1) throw new Error("The last browser tab cannot be closed");
    await page.close();
    state.tabs.delete(tabId);
    tabId = [...state.tabs.keys()][0];
    state.activeTabId = tabId;
    page = state.tabs.get(tabId)!;
  } else if (action.action === "select_tab") {
    state.activeTabId = tabId;
  } else if (action.action === "navigate") {
    if (!action.url) throw new Error("A URL is required");
    await page.evaluate(() => window.stop()).catch(() => undefined);
    await page.goto(await assertAllowedUrl(action.url), { waitUntil: "domcontentloaded", timeout: 30_000 });
    recordOrigin(ownerId, page.url());
  } else if (action.action === "back") {
    await page.goBack({ waitUntil: "domcontentloaded", timeout: 15_000 }).catch(() => null);
  } else if (action.action === "forward") {
    await page.goForward({ waitUntil: "domcontentloaded", timeout: 15_000 }).catch(() => null);
  } else if (action.action === "reload") {
    await page.reload({ waitUntil: "domcontentloaded", timeout: 30_000 });
  } else if (action.action === "click") {
    if (action.selector) await page.locator(action.selector).first().click({ timeout: 15_000, noWaitAfter: true });
    else if (Number.isFinite(action.x) && Number.isFinite(action.y)) await page.mouse.click(action.x!, action.y!);
    else throw new Error("A selector or x/y coordinates are required for click");
    await emitPointerEvent(ownerId, chatId, tabId, page, "click", undefined, { x: action.x, y: action.y }, action.selector);
  } else if (action.action === "type") {
    if (typeof action.text !== "string") throw new Error("Text is required");
    if (action.selector) {
      const target = page.locator(action.selector).first();
      await target.scrollIntoViewIfNeeded();
      await target.fill(action.text);
    } else {
      await page.keyboard.insertText(action.text);
    }
    await emitPointerEvent(ownerId, chatId, tabId, page, "type", action.text.slice(0, 40), undefined, action.selector);
  } else if (action.action === "press") {
    if (!action.key) throw new Error("A key is required");
    await page.keyboard.press(action.key);
  } else if (action.action === "scroll") {
    await page.mouse.wheel(0, Number(action.deltaY) || 600);
    await emitPointerEvent(ownerId, chatId, tabId, page, "scroll", `Δy ${Number(action.deltaY) || 600}`);
  } else if (action.action === "resize") {
    const width = Math.max(320, Math.min(Number(action.width) || DEFAULT_VIEWPORT.width, 2560));
    const height = Math.max(240, Math.min(Number(action.height) || DEFAULT_VIEWPORT.height, 1600));
    await page.setViewportSize({ width, height });
  } else if (action.action === "drag") {
    if (!action.selector || !action.targetSelector) throw new Error("source selector and target selector are required for drag");
    const source = page.locator(action.selector).first();
    const target = page.locator(action.targetSelector).first();
    await source.scrollIntoViewIfNeeded();
    await target.scrollIntoViewIfNeeded();
    await source.dragTo(target, { timeout: 15_000 });
    await emitPointerEvent(ownerId, chatId, tabId, page, "drag", undefined, undefined, action.targetSelector);
  } else if (action.action === "hover") {
    if (!action.selector) throw new Error("A selector is required for hover");
    await page.locator(action.selector).first().hover({ timeout: 10_000 });
    await emitPointerEvent(ownerId, chatId, tabId, page, "hover", undefined, undefined, action.selector);
  } else if (action.action === "select_option") {
    if (!action.selector || typeof action.value !== "string") throw new Error("A selector and value are required for select_option");
    await page.locator(action.selector).first().selectOption(action.value, { timeout: 10_000 });
  } else if (action.action === "upload_file") {
    if (!action.selector || !action.filePath) throw new Error("A selector and file path are required for upload_file");
    const local = path.resolve(String(action.filePath));
    if (!fs.existsSync(local)) throw new Error(`File not found: ${local}`);
    await page.locator(action.selector).first().setInputFiles(local, { timeout: 15_000 });
  } else if (action.action === "download") {
    if (!action.selector) throw new Error("A selector is required for download");
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.locator(action.selector).first().click({ timeout: 15_000 }),
    ]);
    const directory = action.downloadPath || process.cwd();
    const filename = await download.suggestedFilename();
    const destination = path.join(directory, filename);
    await download.saveAs(destination);
    const downloadResult = { ...(await resultFor(state, tabId)), downloadPath: destination, downloadFilename: filename };
    emitBrowserEvent({ type: "action", ownerId, chatId, tabId, url: downloadResult.url, title: downloadResult.title, action: action.action, ts: Date.now() });
    return downloadResult;
  }

  recordOrigin(ownerId, page.url());
  const result = await resultFor(state, tabId);
  // Screenshot diet: JPEG q60, only for visually changing actions (skip hover/press).
  const SCREENSHOT_ACTIONS = ["screenshot", "navigate", "click", "type", "reload", "back", "forward", "select_tab", "scroll", "resize", "drag", "select_option", "upload_file"];
  if (SCREENSHOT_ACTIONS.includes(action.action)) {
    result.screenshot = (await page.screenshot({ type: "jpeg", quality: 60 })).toString("base64");
  }
  if (action.action === "snapshot") {
    result.snapshot = (await page.locator("body").ariaSnapshot().catch(() => page.locator("body").innerText().catch(() => ""))).slice(0, MAX_SNAPSHOT_LENGTH);
  }
  if (action.action === "extract_text") {
    result.snapshot = (await page.locator("body").innerText().catch(() => "")).slice(0, MAX_SNAPSHOT_LENGTH);
  }

  emitBrowserEvent({ type: "action", ownerId, chatId, tabId, url: result.url, title: result.title, action: action.action, ts: Date.now() });
  if (result.screenshot) {
    emitBrowserEvent({ type: "screenshot", ownerId, chatId, tabId, url: result.url, title: result.title, screenshot: result.screenshot, ts: Date.now() });
  }
  return result;
}

export async function performBrowserAction(ownerId: string, chatId: string, action: BrowserAction): Promise<BrowserResult> {
  const key = sessionKey(ownerId, chatId);
  const previous = actionLocks.get(key) || Promise.resolve();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const queued = previous.then(() => gate);
  actionLocks.set(key, queued);
  await previous;
  try {
    return await performBrowserActionUnlocked(ownerId, chatId, action);
  } finally {
    release();
    if (actionLocks.get(key) === queued) actionLocks.delete(key);
  }
}

export async function closeBrowserSession(ownerId: string, chatId: string) {
  const key = sessionKey(ownerId, chatId);
  const state = sessions.get(key);
  if (!state) return;
  sessions.delete(key);
  await Promise.all([...state.tabs.values()].map((page) => page.close().catch(() => undefined)));
}

export async function cleanupBrowserSessions() {
  const cutoff = Date.now() - SESSION_IDLE_MS;
  const owners = new Set([...sessions.values()].map((state) => state.ownerId));
  for (const ownerId of owners) {
    const ownerSessions = [...sessions.entries()].filter(([, state]) => state.ownerId === ownerId);
    if (!ownerSessions.length || ownerSessions.some(([, state]) => state.lastUsed >= cutoff)) continue;
    const context = ownerSessions[0][1].context;
    await context.close().catch(() => undefined);
    for (const [key] of ownerSessions) sessions.delete(key);
    persistentContexts.delete(ownerId);
  }
}

export type BrowserStorageOrigin = {
  origin: string;
  storageTypes: string[];
  lastAccess?: string;
  sizeBytes: null;
};

export async function listBrowserStorage(ownerId: string): Promise<BrowserStorageOrigin[]> {
  const context = await getPersistentContext(ownerId);
  const metadata = readMetadata(ownerId);
  const origins = new Map<string, BrowserStorageOrigin>(
    Object.entries(metadata).map(([origin, value]) => [origin, {
      origin,
      storageTypes: ["persistent profile"],
      lastAccess: value.lastAccess,
      sizeBytes: null,
    }]),
  );
  for (const cookie of await context.cookies()) {
    const hostname = cookie.domain.replace(/^\./, "");
    const existingOrigin = [...origins.keys()].find((candidate) => {
      try {
        return new URL(candidate).hostname === hostname;
      } catch {
        return false;
      }
    });
    const origin = existingOrigin || `https://${hostname}`;
    if (!origins.has(origin)) {
      origins.set(origin, { origin, storageTypes: ["cookies"], sizeBytes: null });
    } else if (!origins.get(origin)!.storageTypes.includes("cookies")) {
      origins.get(origin)!.storageTypes.push("cookies");
    }
  }
  return [...origins.values()].sort((a, b) => a.origin.localeCompare(b.origin));
}

async function closeOwnerContext(ownerId: string) {
  const context = persistentContexts.get(ownerId);
  if (context) await (await context).close().catch(() => undefined);
  persistentContexts.delete(ownerId);
  for (const [key, state] of sessions) {
    if (state.ownerId === ownerId) sessions.delete(key);
  }
}

export async function clearBrowserOrigin(ownerId: string, rawOrigin: string) {
  const origin = new URL(rawOrigin).origin;
  if (!["http:", "https:"].includes(new URL(origin).protocol)) throw new Error("Invalid browser origin");
  const context = await getPersistentContext(ownerId);
  const cookies = await context.cookies();
  for (const cookie of cookies) {
    const cookieOrigin = `https://${cookie.domain.replace(/^\./, "")}`;
    if (cookieOrigin === origin || cookieOrigin === origin.replace(/^https:/, "http:")) {
      await context.clearCookies({ name: cookie.name, domain: cookie.domain, path: cookie.path });
    }
  }
  const pages = context.pages();
  let cleanupPage: Page | undefined;
  if (!pages.some((page) => page.url().startsWith(`${origin}/`) || page.url() === origin)) {
    cleanupPage = await context.newPage();
    await installRequestGuard(cleanupPage);
    await cleanupPage.goto(await assertAllowedUrl(origin), { waitUntil: "domcontentloaded", timeout: 30_000 }).catch(() => undefined);
  }
  for (const page of [...pages, ...(cleanupPage ? [cleanupPage] : [])]) {
    if (page.url().startsWith(`${origin}/`) || page.url() === origin) {
      await page.evaluate(async () => {
        localStorage.clear();
        sessionStorage.clear();
        for (const registration of await navigator.serviceWorker?.getRegistrations?.() || []) await registration.unregister();
        for (const database of await indexedDB.databases?.() || []) {
          if (database.name) indexedDB.deleteDatabase(database.name);
        }
        if ("caches" in window) {
          for (const key of await caches.keys()) await caches.delete(key);
        }
      }).catch(() => undefined);
    }
  }
  await cleanupPage?.close().catch(() => undefined);
  const metadata = readMetadata(ownerId);
  delete metadata[origin];
  writeMetadata(ownerId, metadata);
}

export async function clearAllBrowserStorage(ownerId: string) {
  await closeOwnerContext(ownerId);
  fs.rmSync(profilePath(ownerId), { recursive: true, force: true });
  fs.rmSync(metadataPath(ownerId), { force: true });
}
