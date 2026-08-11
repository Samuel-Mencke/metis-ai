import dns from "node:dns/promises";
import net from "node:net";
import path from "node:path";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";

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

let browserPromise: Promise<Browser> | undefined;
const sessions = new Map<string, BrowserContextState>();

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

  const addresses = await dns.lookup(hostname, { all: true });
  if (!addresses.length || addresses.some(({ address }) => isPrivateAddress(address))) {
    throw new Error("Browser target resolves to a private or unavailable network address");
  }
  return url.toString();
}

async function getBrowser() {
  browserPromise ??= chromium.launch({ headless: true });
  try {
    return await browserPromise;
  } catch (error) {
    browserPromise = undefined;
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

async function createSession(ownerId: string, chatId: string) {
  const browser = await getBrowser();
  const context = await browser.newContext({ viewport: DEFAULT_VIEWPORT });
  const page = await context.newPage();
  await installRequestGuard(page);
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
  const tabId = requested || state.activeTabId;
  if (!state.tabs.has(tabId)) throw new Error("Browser tab not found");
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

export async function captureBrowserFrame(ownerId: string, chatId: string, requestedTabId?: string, quality = 70) {
  const state = await getSession(ownerId, chatId);
  const tabId = tabIdFor(state, requestedTabId);
  const page = state.tabs.get(tabId)!;
  const info = await pageInfo(state, tabId);
  return {
    tabId,
    activeTabId: state.activeTabId,
    tabs: await Promise.all([...state.tabs.keys()].map((id) => pageInfo(state, id))),
    url: info.url === "about:blank" ? "" : info.url,
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

export async function performBrowserAction(ownerId: string, chatId: string, action: BrowserAction): Promise<BrowserResult> {
  if (!ownerId || !chatId) throw new Error("Browser actions require an authenticated user and chat");
  const state = await getSession(ownerId, chatId);
  let tabId: string;
  let page: Page;

  if (action.action === "new_tab") {
    if (state.tabs.size >= MAX_TABS) throw new Error(`A browser session can have at most ${MAX_TABS} tabs`);
    tabId = `browser-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    page = await state.context.newPage();
    await installRequestGuard(page);
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
    await page.goto(await assertAllowedUrl(action.url), { waitUntil: "domcontentloaded", timeout: 30_000 });
  } else if (action.action === "back") {
    await page.goBack({ waitUntil: "domcontentloaded", timeout: 15_000 }).catch(() => null);
  } else if (action.action === "forward") {
    await page.goForward({ waitUntil: "domcontentloaded", timeout: 15_000 }).catch(() => null);
  } else if (action.action === "reload") {
    await page.reload({ waitUntil: "domcontentloaded", timeout: 30_000 });
  } else if (action.action === "click") {
    if (action.selector) await page.locator(action.selector).first().click({ timeout: 15_000 });
    else if (Number.isFinite(action.x) && Number.isFinite(action.y)) await page.mouse.click(action.x!, action.y!);
    else throw new Error("A selector or x/y coordinates are required for click");
  } else if (action.action === "type") {
    if (typeof action.text !== "string") throw new Error("Text is required");
    if (action.selector) {
      const target = page.locator(action.selector).first();
      await target.scrollIntoViewIfNeeded();
      await target.fill(action.text);
    } else {
      await page.keyboard.insertText(action.text);
    }
  } else if (action.action === "press") {
    if (!action.key) throw new Error("A key is required");
    await page.keyboard.press(action.key);
  } else if (action.action === "scroll") {
    await page.mouse.wheel(0, Number(action.deltaY) || 600);
  } else if (action.action === "resize") {
    const width = Math.max(320, Math.min(Number(action.width) || DEFAULT_VIEWPORT.width, 2560));
    const height = Math.max(240, Math.min(Number(action.height) || DEFAULT_VIEWPORT.height, 1600));
    await page.setViewportSize({ width, height });
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
    return { ...(await resultFor(state, tabId)), downloadPath: destination, downloadFilename: filename };
  }

  const result = await resultFor(state, tabId);
  if (action.action === "screenshot" || action.action === "navigate" || action.action === "click" || action.action === "type" || action.action === "press" || action.action === "reload" || action.action === "back" || action.action === "forward" || action.action === "select_tab" || action.action === "scroll" || action.action === "resize") {
    result.screenshot = (await page.screenshot({ type: "png" })).toString("base64");
  }
  if (action.action === "snapshot") {
    result.snapshot = (await page.locator("body").ariaSnapshot().catch(() => page.locator("body").innerText().catch(() => ""))).slice(0, MAX_SNAPSHOT_LENGTH);
  }
  if (action.action === "extract_text") {
    result.snapshot = (await page.locator("body").innerText().catch(() => "")).slice(0, MAX_SNAPSHOT_LENGTH);
  }
  return result;
}

export async function cleanupBrowserSessions() {
  const cutoff = Date.now() - SESSION_IDLE_MS;
  for (const [key, state] of sessions) {
    if (state.lastUsed < cutoff) {
      await state.context.close().catch(() => undefined);
      sessions.delete(key);
    }
  }
}
