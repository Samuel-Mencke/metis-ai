"use client";

import {
  ClipboardEvent,
  DragEvent,
  FormEvent,
  Fragment,
  KeyboardEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ArrowUp,
  ArrowDown,
  Activity,
  Cpu,
  Gauge,
  MemoryStick,
  Network,
  ArrowLeft,
  Archive,
  ArchiveRestore,
  Check,
  ChevronDown,
  CircleAlert,
  Brain,
  AudioLines,
  PanelRight,
  File as FileIcon,
  FileText,
  FileCode2,
  ExternalLink,
  FileClock,
  Fullscreen,
  Globe2,
  Image as ImageIcon,
  KeyRound,
  Link2,
  LoaderCircle,
  Menu,
  Minimize2,
  MessageSquare,
  MoreHorizontal,
  Palette,
  ClipboardList,
  GripVertical,
  PanelLeft,
  Pencil,
  Pin,
  PinOff,
  Plus,
  RotateCcw,
  Reply,
  Search,
  Settings,
  Square,
  Terminal,
  Trash2,
  Undo2,
  Video,
  X,
  type LucideIcon,
} from "lucide-react";
import { toast } from "sonner";
import { EditableMarkdown } from "@/components/editable-markdown";
import { Markdown, StreamingMarkdown } from "@/components/markdown";
import { RichComposerInput } from "@/components/rich-composer-input";
import { RemoteFileEditor } from "@/components/remote-file-editor";
import { RemoteTerminal } from "@/components/remote-terminal";
import { RichUserText } from "@/components/rich-user-text";
import { ProviderSetupDialog } from "@/components/provider-setup-dialog";
import { CommandPalette } from "@/components/command-palette";
import type { MemoryItem } from "@/components/memories-panel";
import type { ChatLogEntry, ChatLogCategory } from "@/lib/chat-logs";
import { ProviderLogo } from "@/components/provider-logo";
import { ModelOptionsMenu } from "@/components/model-options-menu";
import {
  SettingsPanel,
  type FinishSound,
  type ModelInfo,
  type ModelParamSelection,
} from "@/components/settings-panel";
import { ThinkingBlock } from "@/components/thinking-block";
import { PlanToolCallCard, ToolCallGroup, type ToolCallData } from "@/components/tool-call-chip";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { modelAttrSummary } from "@/lib/model-label";
import { clientConfig } from "@/lib/client-config";
import { modelKey, parseModelKey } from "@/lib/providers/types";

type Role = "user" | "assistant" | "system";

type RunMetadata = {
  providerId?: string;
  modelId?: string;
  connectionId?: string;
  outputTokens?: number;
  inputTokens?: number;
  totalTokens?: number;
  costUsd?: number;
  completedAt: string;
};

function formatCompletedAt(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat(undefined, { dateStyle: "short", timeStyle: "short" }).format(date);
}

function formatMetricBytes(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let amount = Math.max(0, value);
  let unit = 0;
  while (amount >= 1024 && unit < units.length - 1) { amount /= 1024; unit += 1; }
  return `${amount.toFixed(amount >= 10 || unit === 0 ? 0 : 1)} ${units[unit]}`;
}

function MetricSparkline({ values, color }: { values: number[]; color: string }) {
  const safe = values.length ? values : [0];
  const max = Math.max(1, ...safe);
  const points = safe.map((value, index) => `${(index / Math.max(1, safe.length - 1)) * 100},${36 - (Math.max(0, value) / max) * 32}`).join(" ");
  return <svg viewBox="0 0 100 36" preserveAspectRatio="none" className="h-12 w-full overflow-visible"><polyline points={points} fill="none" stroke={color} strokeWidth="2" vectorEffect="non-scaling-stroke" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}

type AgentQuestion = {
  id: string;
  question: string;
  multiple?: boolean;
  options?: Array<{ label: string; value?: string }>;
};

type PendingQuestion = {
  questionId: string;
  questions: AgentQuestion[];
};

function selectedQuestionValues(answer: string): string[] {
  if (!answer) return [];
  try {
    const parsed = JSON.parse(answer);
    return Array.isArray(parsed)
      ? parsed.filter((value): value is string => typeof value === "string")
      : [answer];
  } catch {
    return [answer];
  }
}

type ToolPart = {
  id: string;
  name: string;
  status: string;
  detail?: string;
  kind?: "plan" | "edit" | "read" | "shell" | "subagent" | "mcp" | "canvas" | "todo" | "browser" | "memory" | "other";
  path?: string;
  diff?: { before?: string; after?: string; additions?: number; deletions?: number };
  todos?: Array<{ id?: string; content: string; status?: string }>;
  input?: string;
  result?: string;
  subagent?: {
    agentId?: string;
    title?: string;
    mode?: string;
    model?: string;
    prompt?: string;
    messages?: Array<{ role: string; text: string; timestamp?: string }>;
  };
};

type MsgPart =
  | { type: "thinking"; content: string; done?: boolean; durationMs?: number }
  | ({ type: "tool"; } & ToolPart)
  | { type: "text"; content: string };

type ThinkingPart = Extract<MsgPart, { type: "thinking" }>;
type ToolMsgPart = Extract<MsgPart, { type: "tool" }>;
type Suggestion = { label: string; prompt: string };

type MsgAttachment = {
  id: string;
  name: string;
  mimeType: string;
  kind: "image" | "file";
  storedName?: string;
  size?: number;
  previewUrl?: string; // client-only
};

type Msg = {
  id: string;
  role: Role;
  content: string;
  errorMessage?: string;
  referenceText?: string;
  createdAt?: string;
  thinking?: string;
  thinkingDone?: boolean;
  thinkingDurationMs?: number;
  tools?: ToolPart[];
  parts?: MsgPart[];
  streaming?: boolean;
  attachments?: MsgAttachment[];
  suggestions?: Suggestion[];
  runMetadata?: RunMetadata;
  references?: ReferenceItem[];
};

type SourceLink = {
  label: string;
  url: string;
};

type PendingFile = {
  id: string;
  file: File;
  previewUrl?: string;
};

type QueuedMessage = {
  id: string;
  text: string;
  files: PendingFile[];
  referenceText?: string;
  references?: ReferenceItem[];
  storedAttachments?: MsgAttachment[];
};

type PersistedQueuedMessage = {
  id: string;
  text: string;
  referenceText?: string;
  references?: ReferenceItem[];
};

const MAX_PENDING_FILES = 8;
const FILE_ACCEPT =
  "image/*,video/*,audio/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.webm,.mp4,.mov,.m4v,.mp3,.wav,.ogg,.m4a,.txt,.md,.json,.csv,.ts,.tsx,.js,.jsx,.py,.go,.rs,.java,.c,.cpp,.h,.css,.html,.xml,.yaml,.yml,.toml,.zip";

function isTextAttachment(mimeType: string, name: string): boolean {
  return (
    mimeType.startsWith("text/") ||
    /(?:json|javascript|typescript|python|csv|markdown|xml|yaml|toml)/i.test(mimeType) ||
    /\.(json|js|jsx|ts|tsx|py|csv|md|markdown|xml|ya?ml|toml|txt|css|html|go|rs|java|c|cpp|h)$/i.test(name)
  );
}

function AttachmentIcon({ mimeType, className }: { mimeType: string; className?: string }) {
  if (mimeType.startsWith("image/")) return <ImageIcon className={className} />;
  if (mimeType.startsWith("video/")) return <Video className={className} />;
  if (mimeType.startsWith("audio/")) return <AudioLines className={className} />;
  if (isTextAttachment(mimeType, "")) return <FileText className={className} />;
  return <FileIcon className={className} />;
}

async function fileToBase64(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  let binary = "";
  const bytes = new Uint8Array(buf);
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function truncateFileName(name: string, max = 22): string {
  if (name.length <= max) return name;
  const extIdx = name.lastIndexOf(".");
  if (extIdx > 0 && name.length - extIdx <= 6) {
    const ext = name.slice(extIdx);
    const keep = Math.max(4, max - ext.length - 1);
    return `${name.slice(0, keep)}…${ext}`;
  }
  return `${name.slice(0, max - 1)}…`;
}

function partsFromFlat(m: {
  content: string;
  thinking?: string;
  thinkingDone?: boolean;
  thinkingDurationMs?: number;
  tools?: ToolPart[];
}): MsgPart[] {
  const parts: MsgPart[] = [];
  if (m.thinking) {
    parts.push({
      type: "thinking",
      content: m.thinking,
      done: m.thinkingDone,
      durationMs: m.thinkingDurationMs,
    });
  }
  const toolsById = new Map<string, ToolPart>();
  for (const t of m.tools ?? []) {
    const previous = toolsById.get(t.id);
    toolsById.set(t.id, previous ? { ...previous, ...t } : t);
  }
  for (const t of toolsById.values()) {
    parts.push({
      type: "tool",
      id: t.id,
      name: t.name,
      status: t.status,
      detail: t.detail,
      kind: t.kind,
      path: t.path,
      diff: t.diff,
      input: t.input,
      result: t.result,
      subagent: t.subagent,
      todos: t.todos,
    });
  }
  if (m.content) {
    parts.push({ type: "text", content: m.content });
  }
  return parts;
}

function flatFromParts(parts: MsgPart[]): {
  content: string;
  thinking?: string;
  thinkingDone?: boolean;
  thinkingDurationMs?: number;
  tools?: ToolPart[];
} {
  let content = "";
  let thinking: string | undefined;
  let thinkingDone: boolean | undefined;
  let thinkingDurationMs: number | undefined;
  const tools: ToolPart[] = [];
  for (const p of parts) {
    if (p.type === "thinking") {
      thinking = p.content;
      thinkingDone = p.done;
      thinkingDurationMs = p.durationMs;
    } else if (p.type === "tool") {
      tools.push({
        id: p.id,
        name: p.name,
        status: p.status,
        detail: p.detail,
        kind: p.kind,
        path: p.path,
        diff: p.diff,
        input: p.input,
        result: p.result,
        subagent: p.subagent,
        todos: p.todos,
      });
    } else if (p.type === "text") {
      content += p.content;
    }
  }
  return {
    content,
    thinking,
    thinkingDone,
    thinkingDurationMs,
    tools: tools.length ? tools : undefined,
  };
}

function withSyncedFlat(parts: MsgPart[], extra: Partial<Msg> = {}): Partial<Msg> {
  const flat = flatFromParts(parts);
  return { ...flat, parts, ...extra };
}

type ChatIndexEntry = {
  id: string;
  title: string;
  updatedAt: string;
  createdAt: string;
  agentId?: string;
  modelId?: string;
  runStatus?: "idle" | "running" | "waiting_input" | "completed" | "error";
  runUpdatedAt?: string;
  pendingQuestion?: PendingQuestion;
  badge?: "blue" | "red";
  pinned?: boolean;
  archived?: boolean;
};

type Chat = ChatIndexEntry & {
  messages: Array<{
    id: string;
    role: Role;
    content: string;
    errorMessage?: string;
    referenceText?: string;
    thinking?: string;
    tools?: ToolPart[];
    suggestions?: Array<string | Suggestion>;
    runMetadata?: RunMetadata;
    references?: ReferenceItem[];
    attachments?: MsgAttachment[];
    createdAt: string;
  }>;
  modelParams?: ModelParamSelection[];
  queuedMessages?: PersistedQueuedMessage[];
  canvas?: string;
  workspaces?: WorkspaceItem[];
  browserContext?: BrowserContext;
  sessionState?: ChatSessionState;
};

type ChatPage = {
  chat: Chat & { modelParams?: ModelParamSelection[] };
  messageOffset?: number;
  hasEarlierMessages?: boolean;
  totalMessages?: number;
};

type ChatSessionState = {
  input?: string;
  remoteCwd?: string;
  terminalCwd?: string;
  fileCwd?: string;
  terminalSessionId?: string;
  terminalTabs?: TerminalTab[];
  activeTerminalTabId?: string;
  workspaceTab?: "canvas" | "plan" | "terminal" | "files" | "browser" | "monitor";
  activeWorkspaceId?: string | null;
  workspaceOpen?: boolean;
  workspaceWidth?: number;
};

type TerminalTab = {
  id: string;
  title: string;
  cwd: string;
  sessionId?: string;
};

function normalizeWorkDirectory(value?: string): string {
  const cwd = value?.trim();
  return cwd && cwd !== "workspace" ? cwd : clientConfig.defaultCwd;
}

function normalizeTerminalTabs(session: ChatSessionState): TerminalTab[] {
  const tabs = (session.terminalTabs || [])
    .filter((tab) => tab && typeof tab.id === "string" && typeof tab.cwd === "string")
    .slice(0, 20)
    .map((tab, index) => ({
      id: tab.id.slice(0, 200),
      title: tab.title?.trim().slice(0, 80) || `Terminal ${index + 1}`,
      cwd: normalizeWorkDirectory(tab.cwd),
      ...(tab.sessionId ? { sessionId: tab.sessionId.slice(0, 200) } : {}),
    }));
  if (tabs.length) return tabs;
  return [{
    id: "terminal-1",
    title: "Terminal 1",
    cwd: normalizeWorkDirectory(session.terminalCwd || session.remoteCwd),
    ...(session.terminalSessionId ? { sessionId: session.terminalSessionId } : {}),
  }];
}

type WorkspaceItem = {
  id: string;
  type: "canvas" | "plan";
  name: string;
  content: string;
  createdAt: string;
  updatedAt: string;
};

type ReferenceKind = "file" | "canvas" | "plan" | "browser" | "memory" | "chat" | "terminal";

type ReferenceItem = {
  kind: ReferenceKind;
  id: string;
  label: string;
  detail?: string;
  chatId?: string;
  isCurrentChat?: boolean;
  path?: string;
  content?: string;
  sessionId?: string;
};

type StatusPayload = {
  authenticated: boolean;
  cursorSdkConfigured: boolean;
  mcp: { ok: boolean; url: string; detail: string };
  providers?: Array<{
    id: string;
    providerKey: string;
    label: string;
    enabled: boolean;
    hasSecret: boolean;
    lastError?: string;
  }>;
};

type ConfiguredModelProvider = {
  id: string;
  providerKey: string;
  label: string;
  enabled: boolean;
};

const CHAT_MESSAGE_LOAD_LIMIT = 2;
const CHAT_MESSAGE_PRELOAD_MAX = 10;
const MODEL_STORAGE_KEY = `${clientConfig.storagePrefix}_model`;
const PARAMS_STORAGE_KEY = `${clientConfig.storagePrefix}_model_params`;
const SIDEBAR_WIDTH_STORAGE_KEY = `${clientConfig.storagePrefix}_sidebar_width`;
const SIDEBAR_MIN_WIDTH = 200;
const SIDEBAR_MAX_WIDTH = 420;
const WORKSPACE_WIDTH_STORAGE_KEY = `${clientConfig.storagePrefix}_workspace_width_compact`;
const WORKSPACE_MIN_WIDTH = 280;
const WORKSPACE_MAX_WIDTH = 480;
const NOTIFICATIONS_STORAGE_KEY = `${clientConfig.storagePrefix}_notifications_enabled`;
const SOUND_CUES_STORAGE_KEY = `${clientConfig.storagePrefix}_sound_cues_enabled`;
const FINISH_SOUND_STORAGE_KEY = `${clientConfig.storagePrefix}_finish_sound`;
const UNREAD_CHATS_STORAGE_KEY = `${clientConfig.storagePrefix}_unread_chats`;

function loadUnreadChatIds(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const parsed: unknown = JSON.parse(
      localStorage.getItem(UNREAD_CHATS_STORAGE_KEY) || "[]",
    );
    return Array.isArray(parsed)
      ? parsed.filter((id): id is string => typeof id === "string")
      : [];
  } catch {
    return [];
  }
}

function saveUnreadChatIds(ids: string[]) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(UNREAD_CHATS_STORAGE_KEY, JSON.stringify(ids));
  } catch {
    // localStorage may be unavailable in private browsing contexts.
  }
}

function loadFinishSound(): FinishSound | null {
  if (typeof window === "undefined") return null;
  try {
    const parsed: unknown = JSON.parse(
      localStorage.getItem(FINISH_SOUND_STORAGE_KEY) || "null",
    );
    return parsed &&
      typeof parsed === "object" &&
      typeof (parsed as { name?: unknown }).name === "string" &&
      typeof (parsed as { dataUrl?: unknown }).dataUrl === "string"
      ? parsed as FinishSound
      : null;
  } catch {
    return null;
  }
}

function saveFinishSound(sound: FinishSound | null) {
  if (typeof window === "undefined") return;
  try {
    if (sound) localStorage.setItem(FINISH_SOUND_STORAGE_KEY, JSON.stringify(sound));
    else localStorage.removeItem(FINISH_SOUND_STORAGE_KEY);
  } catch {
    // localStorage may be unavailable or full.
  }
}

function chatHref(id: string | null): string {
  return id ? `/?c=${encodeURIComponent(id)}` : "/";
}

function normalizeBrowserContext(
  context: BrowserContext | undefined,
  sessionKey: string,
): BrowserContext {
  const tabs = Array.isArray(context?.tabs) && context.tabs.length
    ? context.tabs
    : [{ id: "browser-1", title: "New tab", url: "" }];
  const activeTabId = tabs.some((tab) => tab.id === context?.activeTabId)
    ? context?.activeTabId || tabs[0].id
    : tabs[0].id;
  return {
    tabs,
    activeTabId,
    sessionKey: context?.sessionKey || sessionKey,
    updatedAt: context?.updatedAt || new Date().toISOString(),
  };
}

function workspacesFromChat(chat: Pick<Chat, "workspaces" | "canvas">): WorkspaceItem[] {
  if (Array.isArray(chat.workspaces) && chat.workspaces.length) return chat.workspaces;
  return chat.canvas
    ? [{
        id: "canvas-default",
        type: "canvas",
        name: "Canvas",
        content: chat.canvas,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }]
    : [];
}

function mergeWorkspaceItems(current: WorkspaceItem[], workspace: WorkspaceItem) {
  const index = current.findIndex(
    (item) =>
      item.id === workspace.id ||
      (item.type === workspace.type &&
        item.name.trim().toLowerCase() === workspace.name.trim().toLowerCase()),
  );
  const next = [...current];
  if (index >= 0) next[index] = workspace;
  else next.push(workspace);
  return next.slice(-20);
}

function WorkspaceIcon({ type, className }: { type: WorkspaceItem["type"]; className?: string }) {
  return type === "plan"
    ? <ClipboardList className={className} />
    : <PanelRight className={className} />;
}

function ErrorMessageCard({ message }: { message: string }) {
  return (
    <section
      role="alert"
      className="my-3 w-full rounded-xl border border-red-500/35 bg-red-500/[0.08] p-3 shadow-sm"
    >
      <div className="flex items-start gap-2">
        <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-red-500/15 text-red-500 dark:text-red-300">
          <CircleAlert className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-medium uppercase tracking-wide text-red-600/80 dark:text-red-300/80">
            Error
          </p>
          <p className="mt-1 whitespace-pre-wrap break-words text-sm text-red-950/90 dark:text-red-100/90">
            {message}
          </p>
        </div>
      </div>
    </section>
  );
}

function extractMessageSources(message: Msg): SourceLink[] {
  const sources = new Map<string, SourceLink>();
  const add = (url: string, label?: string) => {
    const cleanUrl = url.replace(/[),.;!?]+$/g, "");
    if (!/^https?:\/\//i.test(cleanUrl) || sources.has(cleanUrl)) return;
    let fallbackLabel = cleanUrl;
    try {
      fallbackLabel = new URL(cleanUrl).hostname.replace(/^www\./i, "");
    } catch {
      // Keep the full URL when it cannot be parsed.
    }
    sources.set(cleanUrl, { label: label?.trim() || fallbackLabel, url: cleanUrl });
  };
  const addFromSourceBlock = (text: string) => {
    for (const match of text.matchAll(/\[([^\]]{1,200})\]\((https?:\/\/[^)\s]+)\)/gi)) {
      add(match[2], match[1]);
    }
    for (const match of text.matchAll(/https?:\/\/[^\s<>"'`)\]]+/gi)) {
      add(match[0]);
    }
  };

  for (const match of message.content.matchAll(/```sources\s*([\s\S]*?)```/gi)) {
    addFromSourceBlock(match[1]);
  }
  return [...sources.values()].slice(0, 12);
}

function stripSourceBlocks(content: string) {
  return content.replace(/```sources\s*[\s\S]*?```/gi, "").replace(/\n{3,}/g, "\n\n").trim();
}

function MessageSources({ sources }: { sources: SourceLink[] }) {
  return (
    <details className="group mt-3 text-muted-foreground">
      <summary className="flex cursor-pointer list-none items-center gap-1.5 text-[11px] font-medium marker:hidden [&::-webkit-details-marker]:hidden hover:text-foreground">
        <Link2 className="size-3.5 shrink-0" />
        <span>Sources</span>
        <span className="text-[10px] opacity-70">({sources.length})</span>
        <ChevronDown className="ml-auto size-3.5 opacity-60 transition-transform group-open:rotate-180" />
      </summary>
      <ol className="mt-1.5 space-y-1 pl-5">
        {sources.map((source, index) => (
          <li key={source.url} className="flex min-w-0 items-start gap-2 text-xs">
            <span className="mt-0.5 shrink-0 opacity-60">{index + 1}.</span>
            <a
              href={source.url}
              target="_blank"
              rel="noreferrer"
              className="min-w-0 truncate underline decoration-border underline-offset-2 hover:text-foreground"
              title={source.url}
            >
              {source.label}
            </a>
          </li>
        ))}
      </ol>
    </details>
  );
}

function modelDisplayName(model: ModelInfo) {
  return model.displayName;
}

type ChatSnapshot = {
  messages: Msg[];
  chatTitle: string;
  updatedAt?: string;
  agentId?: string;
  modelId: string;
  modelParams: ModelParamSelection[];
  queuedMessages: PersistedQueuedMessage[];
  workspaces: WorkspaceItem[];
  browserContext: BrowserContext;
  sessionState: ChatSessionState;
  runStatus?: "idle" | "running" | "waiting_input" | "completed" | "error";
  pendingQuestion?: PendingQuestion;
  messageOffset: number;
  hasEarlierMessages: boolean;
};

type ChatRuntime = {
  abortController: AbortController;
  assistantMessageId: string;
  generation: string;
};

type ActiveDiff = { name: string; path?: string; detail?: string; diff?: ToolPart["diff"] };
type ActiveSubagent = ToolPart;
type ActiveRawTool = ToolPart;
type BrowserTab = { id: string; title: string; url: string };
type BrowserContext = {
  tabs: BrowserTab[];
  activeTabId: string;
  sessionKey: string;
  updatedAt: string;
};
type MonitorGpu = { id: string; name: string; utilizationPercent: number | null; memoryUsedBytes: number | null; memoryTotalBytes: number | null; temperatureC: number | null };
type MonitorMetric = { timestamp: string; cpuPercent: number; ramUsedBytes: number; ramTotalBytes: number; load: number[]; networkRxBytesPerSecond: number; networkTxBytesPerSecond: number; gpus: MonitorGpu[] };
type MonitorPayload = { current: MonitorMetric | null; history: MonitorMetric[] };

type DiffLine = {
  text: string;
  kind: "add" | "remove" | "context";
};

function buildDiffLines(before: string, after: string): DiffLine[] {
  const oldLines = before.split("\n");
  const newLines = after.split("\n");
  const lcs = Array.from(
    { length: oldLines.length + 1 },
    () => new Uint32Array(newLines.length + 1),
  );

  for (let oldIndex = oldLines.length - 1; oldIndex >= 0; oldIndex -= 1) {
    for (let newIndex = newLines.length - 1; newIndex >= 0; newIndex -= 1) {
      lcs[oldIndex][newIndex] =
        oldLines[oldIndex] === newLines[newIndex]
          ? lcs[oldIndex + 1][newIndex + 1] + 1
          : Math.max(lcs[oldIndex + 1][newIndex], lcs[oldIndex][newIndex + 1]);
    }
  }

  const lines: DiffLine[] = [];
  let oldIndex = 0;
  let newIndex = 0;
  while (oldIndex < oldLines.length || newIndex < newLines.length) {
    if (
      oldIndex < oldLines.length &&
      newIndex < newLines.length &&
      oldLines[oldIndex] === newLines[newIndex]
    ) {
      lines.push({ text: `  ${oldLines[oldIndex]}`, kind: "context" });
      oldIndex += 1;
      newIndex += 1;
    } else if (
      newIndex < newLines.length &&
      (oldIndex >= oldLines.length ||
        lcs[oldIndex][newIndex + 1] >= lcs[oldIndex + 1][newIndex])
    ) {
      lines.push({ text: `+ ${newLines[newIndex]}`, kind: "add" });
      newIndex += 1;
    } else {
      lines.push({ text: `- ${oldLines[oldIndex]}`, kind: "remove" });
      oldIndex += 1;
    }
  }
  return lines;
}

function DiffViewer({ active }: { active: ActiveDiff }) {
  const before = active.diff?.before ?? "";
  const after = active.diff?.after ?? "";
  const lines = buildDiffLines(before, after);
  const additions = lines.filter((line) => line.kind === "add").length;
  const deletions = lines.filter((line) => line.kind === "remove").length;
  return (
    <div className="min-w-0 space-y-3">
      <div>
        <p className="min-w-0 break-all font-medium">{active.path || active.name}</p>
        <p className="text-xs text-muted-foreground">
          +{additions} -{deletions}
        </p>
      </div>
      {lines.length ? (
        <pre className="w-full min-w-0 max-w-full max-h-[60vh] overflow-x-hidden overflow-y-auto whitespace-normal rounded-lg bg-muted/30 p-3 font-mono text-xs leading-5">
          {lines.map((line, index) => (
            <span
              key={`${index}-${line.text}`}
              className={cn(
                "block min-w-0 whitespace-pre-wrap break-all",
                line.kind === "add"
                  ? "text-emerald-500"
                  : line.kind === "remove"
                    ? "text-red-400"
                    : "text-muted-foreground/80",
              )}
            >
              {line.text}
            </span>
          ))}
        </pre>
      ) : (
        <p className="text-sm text-muted-foreground">
          No diff payload was provided. {active.detail || "The file path is available, but its content was not returned by the tool."}
        </p>
      )}
    </div>
  );
}

function SidebarResizeHandle({
  width,
  onWidthChange,
}: {
  width: number;
  onWidthChange: (width: number) => void;
}) {
  const [dragging, setDragging] = useState(false);
  const startRef = useRef<{ pointerX: number; width: number } | null>(null);
  const widthRef = useRef(width);

  useEffect(() => {
    widthRef.current = width;
  }, [width]);

  const stopDragging = useCallback(() => {
    startRef.current = null;
    setDragging(false);
    document.body.style.removeProperty("cursor");
    document.body.style.removeProperty("user-select");
  }, []);

  useEffect(() => {
    if (!dragging) return;
    const onPointerMove = (event: PointerEvent) => {
      const start = startRef.current;
      if (!start) return;
      onWidthChange(
        Math.min(
          SIDEBAR_MAX_WIDTH,
          Math.max(
            SIDEBAR_MIN_WIDTH,
            Math.round(start.width + event.clientX - start.pointerX),
          ),
        ),
      );
    };
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", stopDragging);
    window.addEventListener("pointercancel", stopDragging);
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", stopDragging);
      window.removeEventListener("pointercancel", stopDragging);
    };
  }, [dragging, onWidthChange, stopDragging]);

  useEffect(() => () => stopDragging(), [stopDragging]);

  function startDragging(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    startRef.current = { pointerX: event.clientX, width: widthRef.current };
    setDragging(true);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key === "ArrowRight") {
      event.preventDefault();
      onWidthChange(
        Math.min(SIDEBAR_MAX_WIDTH, widthRef.current + 16),
      );
    } else if (event.key === "ArrowLeft") {
      event.preventDefault();
      onWidthChange(
        Math.max(SIDEBAR_MIN_WIDTH, widthRef.current - 16),
      );
    } else if (event.key === "Home") {
      event.preventDefault();
      onWidthChange(SIDEBAR_MIN_WIDTH);
    } else if (event.key === "End") {
      event.preventDefault();
      onWidthChange(SIDEBAR_MAX_WIDTH);
    }
  }

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize chat sidebar"
      aria-valuemin={SIDEBAR_MIN_WIDTH}
      aria-valuemax={SIDEBAR_MAX_WIDTH}
      aria-valuenow={width}
      tabIndex={0}
      onPointerDown={startDragging}
      onKeyDown={onKeyDown}
      className={cn(
        "absolute inset-y-0 right-0 z-10 hidden w-3 translate-x-1/2 cursor-col-resize items-center justify-center md:flex",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        dragging && "bg-primary/10",
      )}
    >
      <span
        className={cn(
          "h-full w-px bg-border/50 transition-colors",
          dragging && "bg-primary",
        )}
      />
    </div>
  );
}

function WorkspaceResizeHandle({
  width,
  onWidthChange,
}: {
  width: number;
  onWidthChange: (width: number) => void;
}) {
  const [dragging, setDragging] = useState(false);
  const startRef = useRef<{ pointerX: number; width: number } | null>(null);
  const widthRef = useRef(width);

  useEffect(() => {
    widthRef.current = width;
  }, [width]);

  const stopDragging = useCallback(() => {
    startRef.current = null;
    setDragging(false);
    document.body.style.removeProperty("cursor");
    document.body.style.removeProperty("user-select");
  }, []);

  useEffect(() => {
    if (!dragging) return;
    const onPointerMove = (event: PointerEvent) => {
      const start = startRef.current;
      if (!start) return;
      onWidthChange(
        Math.min(
          WORKSPACE_MAX_WIDTH,
          Math.max(
            WORKSPACE_MIN_WIDTH,
            Math.round(start.width + start.pointerX - event.clientX),
          ),
        ),
      );
    };
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", stopDragging);
    window.addEventListener("pointercancel", stopDragging);
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", stopDragging);
      window.removeEventListener("pointercancel", stopDragging);
    };
  }, [dragging, onWidthChange, stopDragging]);

  useEffect(() => () => stopDragging(), [stopDragging]);

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize canvas"
      aria-valuemin={WORKSPACE_MIN_WIDTH}
      aria-valuemax={WORKSPACE_MAX_WIDTH}
      aria-valuenow={width}
      tabIndex={0}
      onPointerDown={(event) => {
        if (event.pointerType === "mouse" && event.button !== 0) return;
        event.preventDefault();
        startRef.current = { pointerX: event.clientX, width: widthRef.current };
        setDragging(true);
        document.body.style.cursor = "col-resize";
        document.body.style.userSelect = "none";
      }}
      onKeyDown={(event) => {
        if (event.key === "ArrowLeft") {
          event.preventDefault();
          onWidthChange(Math.min(WORKSPACE_MAX_WIDTH, widthRef.current + 16));
        } else if (event.key === "ArrowRight") {
          event.preventDefault();
          onWidthChange(Math.max(WORKSPACE_MIN_WIDTH, widthRef.current - 16));
        } else if (event.key === "Home") {
          event.preventDefault();
          onWidthChange(WORKSPACE_MIN_WIDTH);
        } else if (event.key === "End") {
          event.preventDefault();
          onWidthChange(WORKSPACE_MAX_WIDTH);
        }
      }}
      className={cn(
        "absolute inset-y-0 left-0 z-10 hidden w-3 -translate-x-1/2 cursor-col-resize items-center justify-center sm:flex",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        dragging && "bg-primary/10",
      )}
    >
      <span className={cn("h-10 w-0.5 rounded-full bg-border transition-colors", dragging && "bg-primary")} />
    </div>
  );
}

function mapApiMessages(
  messages: Chat["messages"],
  runStatus?: Chat["runStatus"],
): Msg[] {
  const latestAssistantId = runStatus === "error"
    ? [...messages].reverse().find((message) => message.role === "assistant")?.id
    : undefined;
  return messages.map((m) => {
    const legacyError = !m.errorMessage &&
      m.role === "assistant" &&
      (m.id === latestAssistantId || /^⚠\s*/.test(m.content))
      ? m.content.replace(/^⚠\s*/, "").trim() || "Agent run failed."
      : "";
    const base = {
      id: m.id,
      role: m.role,
      content: legacyError ? "" : m.content,
      errorMessage: m.errorMessage || legacyError || undefined,
      referenceText: m.referenceText,
      createdAt: m.createdAt,
      thinking: m.thinking,
      thinkingDone: Boolean(m.thinking),
      tools: m.tools,
      references: m.references,
      suggestions: normalizeSuggestions(m.suggestions),
      runMetadata: m.runMetadata,
      attachments: m.attachments,
    };
    return { ...base, parts: partsFromFlat(base) };
  });
}

function normalizeSuggestions(value: unknown): Suggestion[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (typeof item === "string" && item.trim()) {
        return { label: item.trim(), prompt: item.trim() };
      }
      if (!item || typeof item !== "object") return null;
      const candidate = item as { label?: unknown; prompt?: unknown };
      if (
        typeof candidate.label !== "string" ||
        typeof candidate.prompt !== "string" ||
        !candidate.label.trim() ||
        !candidate.prompt.trim()
      ) return null;
      return { label: candidate.label.trim(), prompt: candidate.prompt.trim() };
    })
    .filter((item): item is Suggestion => Boolean(item))
    .slice(0, 5);
}

function mergeMessages(current: Msg[], incoming: Msg[]): Msg[] {
  const byId = new Map(current.map((message) => [message.id, message]));
  const order = new Map(current.map((message, index) => [message.id, index]));
  incoming.forEach((message) => {
    if (!order.has(message.id)) order.set(message.id, order.size);
    byId.set(message.id, message);
  });
  return [...byId.values()].sort((a, b) => {
    const createdAtOrder = (a.createdAt || "").localeCompare(b.createdAt || "");
    return createdAtOrder || (order.get(a.id) || 0) - (order.get(b.id) || 0);
  });
}

function ChatLoadingSkeleton() {
  return (
    <div className="flex h-full min-h-[420px] items-center justify-center" role="status" aria-label="Loading chat">
      <div className="flex items-center gap-3 text-sm text-muted-foreground">
        <LoaderCircle className="size-5 animate-spin" />
        <span>Loading chat…</span>
      </div>
    </div>
  );
}

function AttachmentViewer({
  active,
  onOpenChange,
}: {
  active: { attachment: MsgAttachment; chatId?: string } | null;
  onOpenChange: (open: boolean) => void;
}) {
  const [text, setText] = useState<string | null>(null);
  const [textError, setTextError] = useState<string | null>(null);
  const attachment = active?.attachment;
  const url =
    attachment?.storedName && active?.chatId
      ? `/api/uploads/${active.chatId}/${encodeURIComponent(attachment.storedName)}`
      : attachment?.previewUrl;
  const textFile = Boolean(attachment && isTextAttachment(attachment.mimeType, attachment.name));

  useEffect(() => {
    let cancelled = false;
    setText(null);
    setTextError(null);
    if (!attachment || !url || !textFile) return;
    fetch(url)
      .then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.text();
      })
      .then((value) => {
        if (!cancelled) setText(value);
      })
      .catch((error) => {
        if (!cancelled) setTextError(error instanceof Error ? error.message : "Could not load file");
      });
    return () => {
      cancelled = true;
    };
  }, [attachment, textFile, url]);

  return (
    <Dialog open={Boolean(active)} onOpenChange={onOpenChange}>
      <DialogContent className="h-[100dvh] max-h-none w-screen max-w-none rounded-none p-4 sm:h-auto sm:max-h-[90vh] sm:max-w-5xl sm:rounded-xl sm:p-6">
        <DialogHeader>
          <DialogTitle className="truncate pr-8">{attachment?.name || "Attachment"}</DialogTitle>
          {attachment ? (
            <p className="text-left text-xs text-muted-foreground">
              {attachment.mimeType}{attachment.size ? ` · ${(attachment.size / 1024 / 1024).toFixed(2)} MB` : ""}
            </p>
          ) : null}
        </DialogHeader>
        <div className="min-h-0 flex-1 max-h-[calc(100dvh-7rem)] overflow-auto sm:max-h-[78vh]">
          {!attachment || !url ? (
            <p className="text-sm text-muted-foreground">Preview unavailable.</p>
          ) : attachment.mimeType.startsWith("image/") ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={url} alt={attachment.name} className="mx-auto max-h-[70vh] max-w-full object-contain" />
          ) : attachment.mimeType.startsWith("video/") ? (
            <video src={url} controls className="mx-auto max-h-[70vh] max-w-full" />
          ) : attachment.mimeType.startsWith("audio/") ? (
            <audio src={url} controls className="w-full" />
          ) : attachment.mimeType === "application/pdf" ? (
            <iframe src={url} title={attachment.name} className="h-[70vh] w-full rounded-lg border" />
          ) : textFile ? (
            textError ? (
              <p className="text-sm text-destructive">Could not load text file: {textError}</p>
            ) : text === null ? (
              <p className="text-sm text-muted-foreground">Loading file…</p>
            ) : (
              <pre className="max-h-[70vh] overflow-auto whitespace-pre-wrap break-words rounded-lg bg-muted/40 p-4 text-sm">{text}</pre>
            )
          ) : (
            <div className="flex flex-col items-center gap-3 py-10 text-center">
              <AttachmentIcon mimeType={attachment.mimeType} className="size-10 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">{attachment.mimeType}</p>
              <a
                href={url}
                target="_blank"
                rel="noreferrer"
                download={attachment.name}
                className="rounded-lg border border-border/60 px-3 py-2 text-sm hover:bg-muted"
              >
                Download / open file
              </a>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default function AppShell() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const routeChatId = searchParams.get("c");
  const [authed, setAuthed] = useState<boolean | null>(null);
  const authedRef = useRef<boolean | null>(null);
  const [username, setUsername] = useState(clientConfig.username);
  const [password, setPassword] = useState("");
  const [authError, setAuthError] = useState("");
  const [status, setStatus] = useState<StatusPayload | null>(null);

  const [chats, setChats] = useState<ChatIndexEntry[]>([]);
  const [chatsLoaded, setChatsLoaded] = useState(false);
  const [activeChatId, setActiveChatId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [messageOffset, setMessageOffset] = useState(0);
  const [hasEarlierMessages, setHasEarlierMessages] = useState(false);
  const [loadingEarlierMessages, setLoadingEarlierMessages] = useState(false);
  const [chatTitle, setChatTitle] = useState("New chat");
  const [loadingChatId, setLoadingChatId] = useState<string | null>(null);
  const [agentId, setAgentId] = useState<string | undefined>();
  const [modelId, setModelId] = useState("");
  const [defaultModelId, setDefaultModelId] = useState("");
  const [defaultModelParams, setDefaultModelParams] = useState<ModelParamSelection[]>([]);
  const [modelParamsByModel, setModelParamsByModel] = useState<Record<string, ModelParamSelection[]>>({});
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [configuredModelProviders, setConfiguredModelProviders] = useState<ConfiguredModelProvider[]>([]);
  const [modelsLoaded, setModelsLoaded] = useState(false);
  const [providerSetupOpen, setProviderSetupOpen] = useState(false);
  const [modelSearch, setModelSearch] = useState("");
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const [modelParams, setModelParams] = useState<ModelParamSelection[]>([]);
  const [customModelInputs, setCustomModelInputs] = useState<Record<string, string>>({});
  const [favoriteModelKeys, setFavoriteModelKeys] = useState<string[]>([]);
  const [modelProviderFilter, setModelProviderFilter] = useState("all");
  const [subagentModelEnabled, setSubagentModelEnabled] = useState(false);
  const [subagentModelId, setSubagentModelId] = useState("");
  const [subagentModelParams, setSubagentModelParams] = useState<ModelParamSelection[]>([]);
  const [workspaces, setWorkspaces] = useState<WorkspaceItem[]>([]);
  const [activeWorkspaceId, setActiveWorkspaceId] = useState<string | null>(null);
  const [workspaceOpen, setWorkspaceOpen] = useState(false);
  const [workspaceMounted, setWorkspaceMounted] = useState(false);
  const [workspaceTab, setWorkspaceTab] = useState<"canvas" | "plan" | "terminal" | "files" | "browser" | "monitor">("canvas");
  const [browserFullscreen, setBrowserFullscreen] = useState(false);
  const [remoteTerminalCwd, setRemoteTerminalCwd] = useState(clientConfig.defaultCwd);
  const [remoteFileCwd, setRemoteFileCwd] = useState(clientConfig.defaultCwd);
  const [terminalTabs, setTerminalTabs] = useState<TerminalTab[]>([]);
  const [activeTerminalTabId, setActiveTerminalTabId] = useState<string | null>(null);
  const [browserUrl, setBrowserUrl] = useState("");
  const [browserInput, setBrowserInput] = useState("");
  const [browserTabs, setBrowserTabs] = useState<BrowserTab[]>([
    { id: "browser-1", title: "New tab", url: "" },
  ]);
  const [activeBrowserTabId, setActiveBrowserTabId] = useState("browser-1");
  const [browserLoading, setBrowserLoading] = useState(false);
  const [browserError, setBrowserError] = useState("");
  const [browserViewport, setBrowserViewport] = useState({ width: 1280, height: 800 });
  const [browserWidthInput, setBrowserWidthInput] = useState("1280");
  const [browserHeightInput, setBrowserHeightInput] = useState("800");
  const [browserRealtime, setBrowserRealtime] = useState(true);
  const [browserFps, setBrowserFps] = useState(10);
  const [browserDefaultViewport, setBrowserDefaultViewport] = useState({ width: 1280, height: 800 });
  const [monitorData, setMonitorData] = useState<MonitorPayload>({ current: null, history: [] });
  const browserSocketRef = useRef<WebSocket | null>(null);
  const browserStreamObjectUrlRef = useRef<string | null>(null);
  const browserLastFrameAtRef = useRef(0);
  const browserViewportRef = useRef<HTMLDivElement | null>(null);
  const browserScreenshotRef = useRef<HTMLImageElement | null>(null);
  const browserScreenshotPlaceholderRef = useRef<HTMLDivElement | null>(null);
  const browserInputDirtyRef = useRef(false);
  const browserNavigationVersionRef = useRef(0);
  const [workspaceWidth, setWorkspaceWidth] = useState(() => {
    if (typeof window === "undefined") return 520;
    const saved = Number(localStorage.getItem(WORKSPACE_WIDTH_STORAGE_KEY));
    return Number.isFinite(saved)
      ? Math.min(WORKSPACE_MAX_WIDTH, Math.max(WORKSPACE_MIN_WIDTH, saved))
      : 380;
  });
  const [activeDiff, setActiveDiff] = useState<ActiveDiff | null>(null);
  const [activeRawTool, setActiveRawTool] = useState<ActiveRawTool | null>(null);
  const [activeSubagent, setActiveSubagent] = useState<ActiveSubagent | null>(null);
  const [cancellingSubagent, setCancellingSubagent] = useState(false);
  const [revertTarget, setRevertTarget] = useState<Msg | null>(null);
  const [manualCleanupTools, setManualCleanupTools] = useState<string[]>([]);
  const [reverting, setReverting] = useState(false);
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");

  const [input, setInput] = useState("");
  const [references, setReferences] = useState<ReferenceItem[]>([]);
  const [referenceMenu, setReferenceMenu] = useState<{
    query: string;
    kind: ReferenceKind | null;
    start: number;
    end: number;
  } | null>(null);
  const [referenceResults, setReferenceResults] = useState<ReferenceItem[]>([]);
  const [referenceIndex, setReferenceIndex] = useState(0);
  const referenceAutocompleteDismissedRef = useRef(false);
  const previousComposerInputRef = useRef("");
  const [referenceText, setReferenceText] = useState("");
  const [selectionAction, setSelectionAction] = useState<{ text: string; x: number; y: number } | null>(null);
  const [composerHeight, setComposerHeight] = useState(0);
  const [busy, setBusy] = useState(false);
  const [runningChatIds, setRunningChatIds] = useState<string[]>([]);
  const [queuedMessages, setQueuedMessages] = useState<QueuedMessage[]>([]);
  const [draggedQueueId, setDraggedQueueId] = useState<string | null>(null);
  const [dragOverQueueId, setDragOverQueueId] = useState<string | null>(null);
  const queueDrainBlockedRef = useRef(false);
  const queuedSendRef = useRef<Set<string>>(new Set());
  const [attentionChatIds, setAttentionChatIds] = useState<string[]>([]);
  const attentionNotifiedRef = useRef<Set<string>>(new Set());
  const [showScrollDown, setShowScrollDown] = useState(false);
  const [liveStatus, setLiveStatus] = useState("");
  const [pendingQuestion, setPendingQuestion] = useState<PendingQuestion | null>(null);
  const [questionAnswers, setQuestionAnswers] = useState<string[]>([]);
  const [questionCustom, setQuestionCustom] = useState<string[]>([]);
  const [questionCustomActive, setQuestionCustomActive] = useState<boolean[]>([]);
  const [answeringQuestion, setAnsweringQuestion] = useState(false);
  const [paneKey, setPaneKey] = useState(0);
  const [pendingFiles, setPendingFiles] = useState<PendingFile[]>([]);
  const [restoredAttachments, setRestoredAttachments] = useState<MsgAttachment[]>([]);
  const [activeAttachment, setActiveAttachment] = useState<{
    attachment: MsgAttachment;
    chatId?: string;
  } | null>(null);
  const [dragOver, setDragOver] = useState(false);

  useEffect(() => {
    if (workspaceOpen) {
      setWorkspaceMounted(true);
      return;
    }
    const timer = window.setTimeout(() => setWorkspaceMounted(false), 180);
    return () => window.clearTimeout(timer);
  }, [workspaceOpen]);

  useEffect(() => {
    if (workspaceTab !== "browser") setBrowserFullscreen(false);
  }, [workspaceTab]);

  const [memories, setMemories] = useState<MemoryItem[]>([]);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [chatLogsOpen, setChatLogsOpen] = useState(false);
  const [chatLogs, setChatLogs] = useState<ChatLogEntry[]>([]);
  const [chatLogsChatId, setChatLogsChatId] = useState<string | null>(null);
  const [chatLogsLoading, setChatLogsLoading] = useState(false);
  const [chatLogsCategory, setChatLogsCategory] = useState<"all" | ChatLogCategory>("all");
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [desktopSidebarOpen, setDesktopSidebarOpen] = useState(true);
  const [desktopSidebarMounted, setDesktopSidebarMounted] = useState(true);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [highlightedMessageId, setHighlightedMessageId] = useState<string | null>(null);
  const [notificationsEnabled, setNotificationsEnabled] = useState(false);
  const [notificationsReady, setNotificationsReady] = useState(false);
  const [soundCuesEnabled, setSoundCuesEnabled] = useState(false);
  const [finishSound, setFinishSound] = useState<FinishSound | null>(null);
  const [unreadChatIds, setUnreadChatIds] = useState<string[]>([]);
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    if (typeof window === "undefined") return 240;
    const raw = localStorage.getItem(SIDEBAR_WIDTH_STORAGE_KEY);
    const saved = raw === null ? Number.NaN : Number(raw);
    return Number.isFinite(saved)
      ? Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, saved))
      : 240;
  });

  useEffect(() => {
    if (desktopSidebarOpen) {
      setDesktopSidebarMounted(true);
      return;
    }
    const timer = window.setTimeout(() => setDesktopSidebarMounted(false), 180);
    return () => window.clearTimeout(timer);
  }, [desktopSidebarOpen]);

  const [renameOpen, setRenameOpen] = useState(false);
  const [renameValue, setRenameValue] = useState("");
  const [renameChatId, setRenameChatId] = useState<string | null>(null);

  const bottomRef = useRef<HTMLDivElement>(null);
  const messagesScrollRef = useRef<HTMLDivElement>(null);
  const stickToBottomRef = useRef(true);
  const runtimeRef = useRef<Map<string, ChatRuntime>>(new Map());
  const queueDrainRef = useRef(false);
  const textareaRef = useRef<HTMLDivElement>(null);
  const composerContainerRef = useRef<HTMLDivElement>(null);
  const modelSearchRef = useRef<HTMLInputElement>(null);
  const editTextareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const activeChatIdRef = useRef<string | null>(null);
  const chatCacheRef = useRef<Map<string, ChatSnapshot>>(new Map());
  const serverSnapshotVersionRef = useRef<Map<string, string>>(new Map());
  const pendingFilesRef = useRef<PendingFile[]>([]);
  const notifiedQuestionRef = useRef<string | null>(null);
  const pendingQuestionIdRef = useRef<string | null>(null);
  const draftInputRef = useRef("");
  const draftInputLoadedRef = useRef(false);
  const notifiedPlanRef = useRef<string | null>(null);
  const swipeRef = useRef<{ x: number; y: number; ignored: boolean } | null>(null);
  const chatLoadRequestRef = useRef(0);
  const chatLoadAbortRef = useRef<AbortController | null>(null);
  const seenChatUpdatedAtRef = useRef<Map<string, string>>(new Map());
  const chatListInitializedRef = useRef(false);
  const stateRef = useRef({
    messages,
    chatTitle,
    agentId,
    modelId,
    defaultModelId,
    defaultModelParams,
    modelParams,
    queuedMessages,
    workspaces,
    browserTabs,
    activeBrowserTabId,
    remoteTerminalCwd,
    remoteFileCwd,
    terminalTabs,
    activeTerminalTabId,
    workspaceTab,
    activeWorkspaceId,
    workspaceOpen,
    workspaceWidth,
    messageOffset,
    hasEarlierMessages,
    input,
  });

  const markChatRunning = useCallback((id: string, runtime: ChatRuntime) => {
    runtimeRef.current.set(id, runtime);
    setRunningChatIds((current) => current.includes(id) ? current : [...current, id]);
  }, []);

  const clearChatRunning = useCallback((id: string) => {
    runtimeRef.current.delete(id);
    setRunningChatIds((current) => current.filter((chatId) => chatId !== id));
  }, []);

  const acceptServerSnapshot = useCallback((id: string, updatedAt?: string) => {
    if (!updatedAt) return true;
    const previous = serverSnapshotVersionRef.current.get(id);
    if (previous && updatedAt < previous) return false;
    serverSnapshotVersionRef.current.set(id, updatedAt);
    return true;
  }, []);

  useEffect(() => {
    pendingFilesRef.current = pendingFiles;
  }, [pendingFiles]);

  useEffect(() => {
    if (!referenceMenu) {
      setReferenceResults([]);
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      try {
        const params = new URLSearchParams({
          q: referenceMenu.query,
          chatId: activeChatId || "",
        });
        if (referenceMenu.kind) params.set("kind", referenceMenu.kind);
        const response = await fetch(`/api/references?${params}`, {
          cache: "no-store",
          signal: controller.signal,
        });
        if (!response.ok) return;
        const data = (await response.json()) as { results?: ReferenceItem[] };
        setReferenceResults(data.results || []);
        setReferenceIndex(0);
      } catch (error) {
        if ((error as Error).name !== "AbortError") setReferenceResults([]);
      }
    }, 120);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [activeChatId, referenceMenu]);

  useEffect(() => {
    localStorage.setItem(SIDEBAR_WIDTH_STORAGE_KEY, String(sidebarWidth));
  }, [sidebarWidth]);

  useEffect(() => {
    localStorage.setItem(WORKSPACE_WIDTH_STORAGE_KEY, String(workspaceWidth));
  }, [workspaceWidth]);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(NOTIFICATIONS_STORAGE_KEY) === "true";
      const soundSaved = localStorage.getItem(SOUND_CUES_STORAGE_KEY) === "true";
      const permissionGranted =
        typeof window !== "undefined" &&
        "Notification" in window &&
        Notification.permission === "granted";
      setNotificationsEnabled(saved || permissionGranted);
      setSoundCuesEnabled(soundSaved);
      setFinishSound(loadFinishSound());
    } catch {
      setNotificationsEnabled(false);
      setSoundCuesEnabled(false);
      setFinishSound(null);
    } finally {
      setNotificationsReady(true);
    }
  }, []);

  useEffect(() => {
    setUnreadChatIds(loadUnreadChatIds());
  }, []);

  const markUnread = useCallback((id: string) => {
    setUnreadChatIds((current) => {
      if (current.includes(id)) return current;
      const next = [...current, id];
      saveUnreadChatIds(next);
      return next;
    });
  }, []);

  const clearUnread = useCallback((id: string) => {
    setUnreadChatIds((current) => {
      if (!current.includes(id)) return current;
      const next = current.filter((chatId) => chatId !== id);
      saveUnreadChatIds(next);
      return next;
    });
    setChats((current) =>
      current.map((chat) => chat.id === id ? { ...chat, badge: undefined } : chat),
    );
    void fetch(`/api/chats/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ badge: null }),
    }).catch(() => undefined);
  }, []);

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (!document.hidden && activeChatIdRef.current) {
        clearUnread(activeChatIdRef.current);
      }
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);
    handleVisibilityChange();
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [activeChatId, clearUnread]);

  useEffect(() => {
    if (!notificationsReady) return;
    try {
      localStorage.setItem(
        NOTIFICATIONS_STORAGE_KEY,
        String(notificationsEnabled),
      );
    } catch {
      // localStorage may be unavailable in private browsing contexts.
    }
  }, [notificationsEnabled, notificationsReady]);

  useEffect(() => {
    if (!notificationsReady) return;
    try {
      localStorage.setItem(SOUND_CUES_STORAGE_KEY, String(soundCuesEnabled));
    } catch {
      // localStorage may be unavailable in private browsing contexts.
    }
  }, [soundCuesEnabled, notificationsReady]);

  useEffect(() => {
    return () => {
      for (const p of pendingFilesRef.current) {
        if (p.previewUrl) URL.revokeObjectURL(p.previewUrl);
      }
    };
  }, []);

  useEffect(() => {
    activeChatIdRef.current = activeChatId;
  }, [activeChatId]);

  useEffect(() => {
    if (!editingMessageId) return;
    const frame = requestAnimationFrame(() => {
      editTextareaRef.current?.focus();
      editTextareaRef.current?.select();
    });
    return () => cancelAnimationFrame(frame);
  }, [editingMessageId]);

  useEffect(() => {
    const handleSelectionChange = () => {
      const selection = window.getSelection();
      const node = selection?.anchorNode;
      const hasSelection = Boolean(
        selection &&
          !selection.isCollapsed &&
          selection.toString().trim() &&
          node &&
          messagesScrollRef.current?.contains(node),
      );
      if (!hasSelection) setSelectionAction(null);
    };

    document.addEventListener("selectionchange", handleSelectionChange);
    return () => {
      document.removeEventListener("selectionchange", handleSelectionChange);
    };
  }, []);

  useEffect(() => {
    stateRef.current = {
      messages,
      chatTitle,
      agentId,
      modelId,
      defaultModelId,
      defaultModelParams,
      modelParams,
      queuedMessages,
      workspaces,
      browserTabs,
      activeBrowserTabId,
      remoteTerminalCwd,
      remoteFileCwd,
      terminalTabs,
      activeTerminalTabId,
      workspaceTab,
      activeWorkspaceId,
      workspaceOpen,
      workspaceWidth,
      messageOffset,
      hasEarlierMessages,
      input,
    };
  }, [
    messages,
    chatTitle,
    agentId,
    modelId,
    defaultModelId,
    defaultModelParams,
    modelParams,
    queuedMessages,
    workspaces,
    browserTabs,
    activeBrowserTabId,
    remoteTerminalCwd,
    remoteFileCwd,
    terminalTabs,
    activeTerminalTabId,
    workspaceTab,
    activeWorkspaceId,
    workspaceOpen,
    workspaceWidth,
    messageOffset,
    hasEarlierMessages,
    input,
  ]);

  useEffect(() => {
    if (!activeChatId) return;
    const browserContext = normalizeBrowserContext(
      {
        tabs: browserTabs,
        activeTabId: activeBrowserTabId,
        sessionKey: activeChatId,
        updatedAt: new Date().toISOString(),
      },
      activeChatId,
    );
    const timer = window.setTimeout(() => {
      void fetch(`/api/chats/${activeChatId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ browserContext }),
      });
    }, 250);
    return () => window.clearTimeout(timer);
  }, [activeChatId, activeBrowserTabId, browserTabs]);

  useEffect(() => {
    if (!activeChatId) return;
    const timer = window.setTimeout(() => {
      void fetch(`/api/chats/${activeChatId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionState: {
            input,
            terminalCwd: remoteTerminalCwd,
            fileCwd: remoteFileCwd,
            terminalTabs,
            activeTerminalTabId: activeTerminalTabId || undefined,
            workspaceTab,
            activeWorkspaceId,
            workspaceOpen,
            workspaceWidth,
          },
        }),
      });
    }, 250);
    return () => window.clearTimeout(timer);
  }, [
    activeChatId,
    remoteTerminalCwd,
    remoteFileCwd,
    terminalTabs,
    activeTerminalTabId,
    workspaceTab,
    activeWorkspaceId,
    workspaceOpen,
    workspaceWidth,
    input,
  ]);

  const persistActiveSnapshot = useCallback(() => {
    const id = activeChatIdRef.current;
    if (!id) return;
    const s = stateRef.current;
    chatCacheRef.current.set(id, {
      messages: s.messages.map((m) => ({
        ...m,
        streaming: false,
        thinkingDone: m.thinking ? true : m.thinkingDone,
      })),
      chatTitle: s.chatTitle,
      agentId: s.agentId,
      modelId: s.modelId,
      modelParams: s.modelParams,
      queuedMessages: s.queuedMessages.map(({ id, text, referenceText, references }) => ({
        id,
        text,
        ...(referenceText ? { referenceText } : {}),
        ...(references?.length ? { references } : {}),
      })),
      workspaces: s.workspaces,
      browserContext: normalizeBrowserContext(
        {
          tabs: s.browserTabs,
          activeTabId: s.activeBrowserTabId,
          sessionKey: id,
          updatedAt: new Date().toISOString(),
        },
        id,
      ),
      sessionState: {
        input: s.input,
        terminalCwd: s.remoteTerminalCwd,
        fileCwd: s.remoteFileCwd,
        terminalTabs: s.terminalTabs,
        activeTerminalTabId: s.activeTerminalTabId || undefined,
        workspaceTab: s.workspaceTab,
        activeWorkspaceId: s.activeWorkspaceId,
        workspaceOpen: s.workspaceOpen,
        workspaceWidth: s.workspaceWidth,
      },
      messageOffset: s.messageOffset,
      hasEarlierMessages: s.hasEarlierMessages,
    });
    void fetch(`/api/chats/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        queuedMessages: s.queuedMessages.map(({ id: messageId, text, referenceText, references }) => ({
          id: messageId,
          text,
          ...(referenceText ? { referenceText } : {}),
          ...(references?.length ? { references } : {}),
        })),
        browserContext: {
          tabs: s.browserTabs,
          activeTabId: s.activeBrowserTabId,
          sessionKey: id,
          updatedAt: new Date().toISOString(),
        },
        sessionState: {
          input: s.input,
          terminalCwd: s.remoteTerminalCwd,
          fileCwd: s.remoteFileCwd,
          terminalTabs: s.terminalTabs,
          activeTerminalTabId: s.activeTerminalTabId || undefined,
          workspaceTab: s.workspaceTab,
          activeWorkspaceId: s.activeWorkspaceId,
          workspaceOpen: s.workspaceOpen,
          workspaceWidth: s.workspaceWidth,
        },
      }),
    });
  }, []);

  const navigateChat = useCallback(
    (id: string | null, replace = false) => {
      const href = chatHref(id);
      if (replace) router.replace(href, { scroll: false });
      else router.push(href, { scroll: false });
    },
    [router],
  );

  const isDraft = !activeChatId;
  const isEmpty = messages.length === 0;
  const activeChatIsRunning = Boolean(
    activeChatId &&
      (runningChatIds.includes(activeChatId) ||
        chats.some(
          (chat) =>
            chat.id === activeChatId &&
            (chat.runStatus === "running" || chat.runStatus === "waiting_input"),
        )),
  );
  const hasCurrentAttention =
    Boolean(activeChatId) &&
    (Boolean(pendingQuestion) || attentionChatIds.includes(activeChatId ?? ""));
  const activeWorkspace =
    (workspaceTab === "plan" || workspaceTab === "canvas"
      ? workspaces.find((item) => item.id === activeWorkspaceId && item.type === workspaceTab) ??
        workspaces.find((item) => item.type === workspaceTab)
      : workspaces.find((item) => item.id === activeWorkspaceId)) ?? null;
  const toolOutputs = messages.flatMap((message) =>
    (message.parts ?? partsFromFlat(message))
      .filter((part): part is ToolMsgPart => part.type === "tool")
      .filter((part) => part.kind === "shell" || part.kind === "read" || part.kind === "edit"),
  );
  const subagentOutputs = messages.flatMap((message) =>
    (message.parts ?? partsFromFlat(message))
      .filter((part): part is ToolMsgPart => part.type === "tool")
      .filter((part) => part.kind === "subagent"),
  );

  function handleTouchStart(event: React.TouchEvent<HTMLDivElement>) {
    if (event.touches.length !== 1) {
      swipeRef.current = null;
      return;
    }
    const target = event.target as HTMLElement;
    const ignored = Boolean(
      target.closest("input, textarea, button, a, select, [contenteditable='true'], [data-swipe-ignore]"),
    );
    const touch = event.touches[0];
    swipeRef.current = { x: touch.clientX, y: touch.clientY, ignored };
  }

  function handleTouchEnd(event: React.TouchEvent<HTMLDivElement>) {
    const start = swipeRef.current;
    swipeRef.current = null;
    if (!start || start.ignored || typeof window === "undefined" || window.innerWidth >= 768) return;
    const touch = event.changedTouches[0];
    const deltaX = touch.clientX - start.x;
    const deltaY = touch.clientY - start.y;
    if (Math.abs(deltaX) < 64 || Math.abs(deltaX) < Math.abs(deltaY) * 1.35) return;

    if (mobileNavOpen) {
      if (deltaX < 0) setMobileNavOpen(false);
      return;
    }

    if (deltaX > 0) {
      if (workspaceOpen) {
        setWorkspaceOpen(false);
      } else {
        setMobileNavOpen(true);
      }
      return;
    }
    setMobileNavOpen(false);
    setActiveWorkspaceId((current) => current ?? workspaces[0]?.id ?? null);
    setWorkspaceOpen(true);
  }

  useEffect(() => {
    const openSubagent = (event: Event) => {
      const rawReference = (event as CustomEvent<string>).detail?.trim();
      if (!rawReference) return;
      let reference = rawReference;
      try {
        reference = decodeURIComponent(rawReference);
      } catch {
        // Keep the raw reference when it is not URI encoded.
      }
      const target = subagentOutputs.find((tool) =>
        tool.id === reference ||
        tool.subagent?.agentId === reference ||
        tool.subagent?.title?.trim().toLocaleLowerCase() === reference.toLocaleLowerCase(),
      );
      if (target) {
        setMobileNavOpen(false);
        setActiveSubagent({ ...target });
      }
      else toast.info("Referenced subagent is not available in this chat");
    };
    window.addEventListener("ai-chat:open-subagent", openSubagent);
    return () => window.removeEventListener("ai-chat:open-subagent", openSubagent);
  }, [subagentOutputs]);

  function sendBrowserStreamAction(action: string, extra: Record<string, unknown> = {}) {
    const socket = browserSocketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) return false;
    socket.send(JSON.stringify({ type: "action", action, tabId: activeBrowserTabId, ...extra }));
    return true;
  }

  function showBrowserScreenshot(source: string) {
    if (browserScreenshotRef.current) {
      browserScreenshotRef.current.src = source;
      browserScreenshotRef.current.style.display = "block";
    }
    if (browserScreenshotPlaceholderRef.current) {
      browserScreenshotPlaceholderRef.current.style.display = "none";
    }
  }

  async function performBrowserAction(action: string, extra: Record<string, unknown> = {}) {
    if (!activeChatId) return null;
    const navigationVersion = browserNavigationVersionRef.current;
    setBrowserLoading(true);
    setBrowserError("");
    try {
      const response = await fetch("/api/browser", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chatId: activeChatId, action, tabId: activeBrowserTabId, ...extra }),
      });
      const data = await response.json() as { error?: string; screenshot?: string; url?: string; tabId?: string; tabs?: BrowserTab[]; viewport?: { width: number; height: number } };
      if (!response.ok) throw new Error(data.error || "Browser action failed");
      if (data.screenshot) showBrowserScreenshot(`data:image/png;base64,${data.screenshot}`);
      if (data.tabs) setBrowserTabs(data.tabs);
      if (data.tabId) setActiveBrowserTabId(data.tabId);
      if (data.viewport) {
        setBrowserViewport(data.viewport);
        setBrowserWidthInput(String(data.viewport.width));
        setBrowserHeightInput(String(data.viewport.height));
      }
      if (typeof data.url === "string") {
        const syncedUrl = data.url === "about:blank" ? "" : data.url;
        setBrowserUrl(syncedUrl);
        if (action === "navigate") {
          browserInputDirtyRef.current = false;
          setBrowserInput(syncedUrl);
        } else if (!browserInputDirtyRef.current && navigationVersion === browserNavigationVersionRef.current) {
          setBrowserInput(syncedUrl);
        }
      }
      return data;
    } catch (error) {
      setBrowserError(error instanceof Error ? error.message : "Browser action failed");
      return null;
    } finally {
      setBrowserLoading(false);
    }
  }

  function navigateBrowser(url: string) {
    const rawUrl = url.trim();
    if (!rawUrl) return;
    const nextUrl = /^[a-z][a-z\d+.-]*:\/\//i.test(rawUrl) ? rawUrl : `https://${rawUrl}`;
    browserNavigationVersionRef.current += 1;
    void performBrowserAction("navigate", { url: nextUrl });
  }

  function resizeBrowser() {
    const width = Math.max(320, Math.min(2560, Number(browserWidthInput) || 1280));
    const height = Math.max(240, Math.min(1600, Number(browserHeightInput) || 800));
    setBrowserWidthInput(String(width));
    setBrowserHeightInput(String(height));
    if (!sendBrowserStreamAction("resize", { width, height })) void performBrowserAction("resize", { width, height });
  }

  function openBrowserTab(url = "") {
    browserInputDirtyRef.current = false;
    void performBrowserAction("new_tab").then((result) => {
      if (!result?.tabId) return;
      if (url) void performBrowserAction("navigate", { url, tabId: result.tabId });
      else void performBrowserAction("screenshot", { tabId: result.tabId });
    });
  }

  function openBrowserUrlInNewTab() {
    const url = (browserUrl || browserInput).trim();
    if (!url) return;
    window.open(url, "_blank", "noopener,noreferrer");
  }

  function clickBrowserScreenshot(event: ReactPointerEvent<HTMLImageElement>) {
    if (!browserScreenshotRef.current?.src) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width) * browserViewport.width;
    const y = ((event.clientY - rect.top) / rect.height) * browserViewport.height;
    browserViewportRef.current?.focus();
    if (!sendBrowserStreamAction("click", { x, y })) void performBrowserAction("click", { x, y });
  }

  function pressBrowserKey(event: KeyboardEvent<HTMLDivElement>) {
    const modifiers = [
      event.ctrlKey ? "Control" : "",
      event.altKey ? "Alt" : "",
      event.shiftKey ? "Shift" : "",
      event.metaKey ? "Meta" : "",
    ].filter(Boolean);
    const aliases: Record<string, string> = {
      " ": "Space",
      Esc: "Escape",
      Del: "Delete",
      Left: "ArrowLeft",
      Right: "ArrowRight",
      Up: "ArrowUp",
      Down: "ArrowDown",
    };
    const key = aliases[event.key] || event.key;
    if (!key || key === "Unidentified") return;
    const press = [...modifiers, key].join("+");
    event.preventDefault();
    event.stopPropagation();
    if (!sendBrowserStreamAction("press", { key: press })) void performBrowserAction("press", { key: press });
  }

  useEffect(() => {
    if (workspaceTab !== "browser" || !activeChatId) return;
    let reconnectTimer: number | null = null;
    let disposed = false;
    const connect = () => {
      if (disposed) return;
      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      const query = new URLSearchParams({
        chatId: activeChatId,
        tabId: activeBrowserTabId,
        fps: String(browserFps),
        quality: "70",
        realtime: browserRealtime ? "1" : "0",
        width: String(browserDefaultViewport.width),
        height: String(browserDefaultViewport.height),
      });
      const socket = new WebSocket(`${protocol}//${window.location.host}/api/browser/stream?${query}`);
      browserSocketRef.current = socket;
      socket.binaryType = "blob";
      socket.onmessage = (event) => {
        if (typeof event.data === "string") {
          try {
            const message = JSON.parse(event.data) as { type?: string; url?: string; tabId?: string; activeTabId?: string; title?: string; viewport?: { width: number; height: number }; tabs?: BrowserTab[]; message?: string };
            if (message.type === "meta") {
              const url = message.url || "";
              setBrowserUrl(url);
              if (!browserInputDirtyRef.current) setBrowserInput(url);
              if (message.activeTabId) setActiveBrowserTabId(message.activeTabId);
              else if (message.tabId) setActiveBrowserTabId(message.tabId);
              if (message.title && message.tabId) setBrowserTabs((current) => current.map((tab) => tab.id === message.tabId ? { ...tab, title: message.title!, url } : tab));
              if (message.tabs) setBrowserTabs(message.tabs);
              if (message.viewport) {
                setBrowserViewport(message.viewport);
                setBrowserWidthInput(String(message.viewport.width));
                setBrowserHeightInput(String(message.viewport.height));
              }
            } else if (message.type === "error") setBrowserError(message.message || "Browser stream failed");
          } catch { /* Ignore malformed stream metadata. */ }
          return;
        }
        const blob = event.data instanceof Blob ? event.data : new Blob([event.data], { type: "image/jpeg" });
        const nextUrl = URL.createObjectURL(blob);
        if (browserStreamObjectUrlRef.current) URL.revokeObjectURL(browserStreamObjectUrlRef.current);
        browserStreamObjectUrlRef.current = nextUrl;
        browserLastFrameAtRef.current = Date.now();
        if (browserScreenshotRef.current) {
          browserScreenshotRef.current.src = nextUrl;
          browserScreenshotRef.current.style.display = "block";
        }
        if (browserScreenshotPlaceholderRef.current) {
          browserScreenshotPlaceholderRef.current.style.display = "none";
        }
      };
      socket.onclose = () => {
        if (browserSocketRef.current === socket) browserSocketRef.current = null;
        if (!disposed) reconnectTimer = window.setTimeout(connect, 1000);
      };
    };
    connect();
    let fallbackRequestPending = false;
    const fallbackTimer = window.setInterval(() => {
      if (!browserRealtime || !activeChatId) return;
      const socket = browserSocketRef.current;
      const frameIsFresh = Date.now() - browserLastFrameAtRef.current < 2500;
      if (socket?.readyState === WebSocket.OPEN && frameIsFresh) return;
      if (fallbackRequestPending) return;
      fallbackRequestPending = true;
      void fetch(
        `/api/browser?chatId=${encodeURIComponent(activeChatId)}&tabId=${encodeURIComponent(activeBrowserTabId)}&action=screenshot&format=image`,
        { cache: "no-store" },
      )
        .then((response) => (response.ok ? response.blob() : null))
        .then((blob) => {
          if (!blob || disposed) return;
          const nextUrl = URL.createObjectURL(blob);
          if (browserStreamObjectUrlRef.current) URL.revokeObjectURL(browserStreamObjectUrlRef.current);
          browserStreamObjectUrlRef.current = nextUrl;
          browserLastFrameAtRef.current = Date.now();
          if (browserScreenshotRef.current) {
            browserScreenshotRef.current.src = nextUrl;
            browserScreenshotRef.current.style.display = "block";
          }
          if (browserScreenshotPlaceholderRef.current) {
            browserScreenshotPlaceholderRef.current.style.display = "none";
          }
        })
        .catch(() => undefined)
        .finally(() => {
          fallbackRequestPending = false;
        });
    }, 1000);
    return () => {
      disposed = true;
      window.clearInterval(fallbackTimer);
      if (reconnectTimer) window.clearTimeout(reconnectTimer);
      if (browserSocketRef.current) browserSocketRef.current.close();
      browserSocketRef.current = null;
      if (browserStreamObjectUrlRef.current) URL.revokeObjectURL(browserStreamObjectUrlRef.current);
      browserStreamObjectUrlRef.current = null;
      if (browserScreenshotRef.current) {
        browserScreenshotRef.current.removeAttribute("src");
        browserScreenshotRef.current.style.display = "none";
      }
      if (browserScreenshotPlaceholderRef.current) {
        browserScreenshotPlaceholderRef.current.style.display = "flex";
      }
    };
  // The stream intentionally follows the active browser tab.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceTab, activeChatId, activeBrowserTabId, browserRealtime, browserFps, browserDefaultViewport]);

  useEffect(() => {
    if (workspaceTab !== "monitor") return;
    let disposed = false;
    const load = async () => {
      const response = await fetch("/api/monitor", { cache: "no-store" });
      if (!response.ok || disposed) return;
      setMonitorData(await response.json() as MonitorPayload);
    };
    void load();
    const timer = window.setInterval(() => void load(), 5000);
    return () => { disposed = true; window.clearInterval(timer); };
  }, [workspaceTab]);

  function selectTerminalTab(tab: TerminalTab) {
    setActiveTerminalTabId(tab.id);
    setRemoteTerminalCwd(tab.cwd);
  }

  function openTerminalTab() {
    const id = `terminal-${crypto.randomUUID()}`;
    const tab: TerminalTab = {
      id,
      title: `Terminal ${terminalTabs.length + 1}`,
      cwd: remoteTerminalCwd || clientConfig.defaultCwd,
    };
    setTerminalTabs((current) => [...current, tab].slice(-20));
    setActiveTerminalTabId(id);
    setRemoteTerminalCwd(tab.cwd);
  }

  function closeTerminalTab(id: string) {
    if (terminalTabs.length <= 1) return;
    const nextTabs = terminalTabs.filter((tab) => tab.id !== id);
    const nextActiveId = activeTerminalTabId === id
      ? nextTabs[Math.max(0, terminalTabs.findIndex((tab) => tab.id === id) - 1)]?.id
      : activeTerminalTabId;
    setTerminalTabs(nextTabs);
    setActiveTerminalTabId(nextActiveId || nextTabs[0].id);
    setRemoteTerminalCwd(nextTabs.find((tab) => tab.id === (nextActiveId || nextTabs[0].id))?.cwd || clientConfig.defaultCwd);
  }

  function notifyUser(
    title: string,
    body: string,
    chatId = activeChatIdRef.current,
  ) {
    if (
      !notificationsEnabled ||
      typeof window === "undefined" ||
      !("Notification" in window) ||
      Notification.permission !== "granted"
    ) {
      return;
    }
    try {
      const notification = new Notification(title, {
        body,
        tag: `ai-chat-${chatId ?? "agent"}`,
      });
      notification.onclick = () => {
        window.focus();
        notification.close();
      };
    } catch {
      // Browser notification construction can fail in restricted contexts.
    }
  }

  function playFinishSound() {
    if (!soundCuesEnabled || typeof window === "undefined") return;
    try {
      if (finishSound) {
        const audio = new Audio(finishSound.dataUrl);
        audio.volume = 0.8;
        void audio.play();
        return;
      }
      const AudioContextClass = window.AudioContext ||
        (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioContextClass) return;
      const context = new AudioContextClass();
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = "sine";
      oscillator.frequency.setValueAtTime(740, context.currentTime);
      oscillator.frequency.exponentialRampToValueAtTime(988, context.currentTime + 0.12);
      gain.gain.setValueAtTime(0.0001, context.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.16, context.currentTime + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.32);
      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.start();
      oscillator.stop(context.currentTime + 0.34);
      oscillator.addEventListener("ended", () => void context.close());
    } catch {
      // Audio playback can be blocked by browser autoplay policies.
    }
  }

  function notifyAttention(chatId: string, questionId: string, body: string) {
    const notificationKey = `${chatId}:${questionId}`;
    setAttentionChatIds((current) => current.includes(chatId) ? current : [...current, chatId]);
    if (attentionNotifiedRef.current.has(notificationKey)) return;
    attentionNotifiedRef.current.add(notificationKey);
    const isCurrentChat = activeChatIdRef.current === chatId;
    toast.info("Attention required", {
      description: body,
      action: {
        label: isCurrentChat ? "Scroll down" : "Open chat",
        onClick: () => {
          if (isCurrentChat) scrollMessagesToBottom();
          else navigateChat(chatId);
        },
      },
    });
    notifyUser("Agent needs your input", body, chatId);
  }

  const refreshStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/status", { cache: "no-store" });
      const data = (await res.json()) as StatusPayload;
      setStatus(data);
      authedRef.current = data.authenticated;
      setAuthed(data.authenticated);
    } catch {
      // Keep an authenticated session during transient network failures.
      if (authedRef.current !== true) {
        authedRef.current = false;
        setAuthed(false);
      }
    }
  }, []);

  const loadChats = useCallback(async () => {
    try {
      const res = await fetch("/api/chats", { cache: "no-store" });
      if (!res.ok) return;
      const data = (await res.json()) as { chats: ChatIndexEntry[] };
      setChats(data.chats);
      const serverUnreadIds = data.chats
        .filter((chat) => chat.badge === "blue" && activeChatIdRef.current !== chat.id)
        .map((chat) => chat.id);
      setUnreadChatIds(serverUnreadIds);
      saveUnreadChatIds(serverUnreadIds);
      for (const chat of data.chats) {
        const previousUpdatedAt = seenChatUpdatedAtRef.current.get(chat.id);
        if (
          chatListInitializedRef.current &&
          previousUpdatedAt &&
          chat.updatedAt > previousUpdatedAt &&
          chat.badge === "blue" &&
          activeChatIdRef.current !== chat.id
        ) {
          markUnread(chat.id);
        }
        seenChatUpdatedAtRef.current.set(chat.id, chat.updatedAt);
      }
      chatListInitializedRef.current = true;
      const attentionChats = data.chats.filter((chat) => chat.pendingQuestion);
      setAttentionChatIds((current) => [
        ...new Set([
          ...current.filter((id) => data.chats.some((chat) => chat.id === id)),
          ...attentionChats.map((chat) => chat.id),
          ...data.chats.filter((chat) => chat.badge === "red").map((chat) => chat.id),
        ]),
      ]);
      for (const chat of attentionChats) {
        const question = chat.pendingQuestion;
        if (!question) continue;
        const body = question.questions.length === 1
          ? question.questions[0].question
          : `${question.questions.length} questions need your input.`;
        notifyAttention(chat.id, question.questionId, body);
      }
    } finally {
      setChatsLoaded(true);
    }
  }, [markUnread, navigateChat]);

  const loadMemories = useCallback(async () => {
    const res = await fetch("/api/memories", { cache: "no-store" });
    if (!res.ok) return;
    const data = (await res.json()) as { memories: MemoryItem[] };
    setMemories(data.memories);
  }, []);

  const loadModels = useCallback(async () => {
    const res = await fetch("/api/models", { cache: "no-store" });
    if (!res.ok) return;
    const data = (await res.json()) as {
      models: ModelInfo[];
      defaultModelId?: string;
      providers?: ConfiguredModelProvider[];
    };
    setModels(data.models);
    setConfiguredModelProviders(data.providers || []);
    setModelsLoaded(true);

    const savedModel =
      typeof window !== "undefined"
        ? localStorage.getItem(MODEL_STORAGE_KEY)
        : null;
    const nextModelId =
      (savedModel && data.models.some((m) => m.id === savedModel)
        ? savedModel
        : null) ||
      data.defaultModelId ||
      data.models[0]?.id ||
      "";

    const firstAvailableModelId = data.defaultModelId || data.models[0]?.id || "";
    setDefaultModelId((current) => current || firstAvailableModelId);
    if (!activeChatIdRef.current) setModelId(nextModelId);
    const meta = data.models.find((m) => m.id === nextModelId);
    let savedParams: ModelParamSelection[] | null = null;
    try {
      const raw = localStorage.getItem(PARAMS_STORAGE_KEY);
      if (raw) savedParams = JSON.parse(raw) as ModelParamSelection[];
    } catch {
      savedParams = null;
    }
    const allowed = new Set((meta?.parameters ?? []).map((p) => p.id));
    const filtered = (savedParams ?? []).filter((p) => allowed.has(p.id));
    const nextParams = filtered.length > 0 ? filtered : meta?.defaultParams ?? [];
    setDefaultModelParams((current) => current.length ? current : nextParams);
    if (!activeChatIdRef.current) setModelParams(nextParams);
  }, []);

  useEffect(() => {
    if (!authed || !models.length) return;
    let cancelled = false;
    void fetch("/api/preferences", { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : null))
      .then((data: {
        settings?: {
          modelId?: string;
          modelParams?: ModelParamSelection[];
          modelParamsByModel?: Record<string, ModelParamSelection[]>;
          subagentModelEnabled?: boolean;
          subagentModelId?: string;
          draftInput?: string;
          favoriteModelKeys?: string[];
          modelAliases?: Record<string, string>;
          browserRealtime?: boolean;
          browserFps?: number;
          browserViewportWidth?: number;
          browserViewportHeight?: number;
        };
      } | null) => {
        if (cancelled || !data?.settings) return;
        const settings = data.settings;
        const paramsByModel = settings.modelParamsByModel || {};
        setModelParamsByModel(paramsByModel);
        const nextId = settings.modelId && models.some((model) => model.id === settings.modelId)
          ? settings.modelId
          : null;
        if (nextId) {
          setDefaultModelId(nextId);
          if (!activeChatIdRef.current) setModelId(nextId);
        }
        const defaultParams = nextId && Object.prototype.hasOwnProperty.call(paramsByModel, nextId)
          ? paramsByModel[nextId] || []
          : settings.modelParams || [];
        if (defaultParams.length || settings.modelParams || nextId) {
          setDefaultModelParams(defaultParams);
          if (!activeChatIdRef.current) setModelParams(defaultParams);
        }
        setSubagentModelEnabled(Boolean(settings.subagentModelEnabled));
        if (settings.subagentModelId && models.some((model) => model.id === settings.subagentModelId)) {
          setSubagentModelId(settings.subagentModelId);
          setSubagentModelParams(
            Object.prototype.hasOwnProperty.call(paramsByModel, settings.subagentModelId)
              ? paramsByModel[settings.subagentModelId] || []
              : models.find((model) => model.id === settings.subagentModelId)?.defaultParams || [],
          );
        }
        if (Array.isArray(settings.favoriteModelKeys)) {
          setFavoriteModelKeys(settings.favoriteModelKeys);
        }
        if (typeof settings.browserRealtime === "boolean") {
          setBrowserRealtime(settings.browserRealtime);
        }
        if (typeof settings.browserFps === "number") {
          setBrowserFps(Math.max(1, Math.min(30, Math.round(settings.browserFps))));
        }
        const defaultWidth = typeof settings.browserViewportWidth === "number"
          ? Math.max(320, Math.min(2560, Math.round(settings.browserViewportWidth)))
          : 1280;
        const defaultHeight = typeof settings.browserViewportHeight === "number"
          ? Math.max(240, Math.min(1600, Math.round(settings.browserViewportHeight)))
          : 800;
        setBrowserDefaultViewport({ width: defaultWidth, height: defaultHeight });
        const serverDraft = typeof settings.draftInput === "string"
          ? settings.draftInput
          : "";
        draftInputLoadedRef.current = true;
        if (serverDraft.trim() && !activeChatIdRef.current) {
          draftInputRef.current = serverDraft;
          setInput(serverDraft);
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [authed, models]);

  useEffect(() => {
    if (!activeChatId || !modelId) return;
    if (Object.prototype.hasOwnProperty.call(modelParamsByModel, modelId)) {
      setModelParams(modelParamsByModel[modelId] || []);
    }
  }, [activeChatId, modelId, modelParamsByModel]);

  useEffect(() => {
    if (!authed || activeChatId || !draftInputLoadedRef.current) return;
    draftInputRef.current = input;
    const timer = window.setTimeout(() => {
      void fetch("/api/preferences", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ draftInput: input }),
      });
    }, 250);
    return () => window.clearTimeout(timer);
  }, [activeChatId, authed, input]);

  function applyModelParams(next: ModelParamSelection[]) {
    setModelParams(next);
    if (modelId) persistModelParamsByModel({ ...modelParamsByModel, [modelId]: next });
    localStorage.setItem(PARAMS_STORAGE_KEY, JSON.stringify(next));
    setAgentId(undefined);
    if (activeChatId) {
      void fetch(`/api/chats/${activeChatId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ modelParams: next }),
      });
    }
  }

  function toggleFavoriteModel(modelKey: string) {
    const next = favoriteModelKeys.includes(modelKey)
      ? favoriteModelKeys.filter((key) => key !== modelKey)
      : [...favoriteModelKeys, modelKey].slice(-100);
    setFavoriteModelKeys(next);
    void fetch("/api/preferences", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ favoriteModelKeys: next }),
    });
  }

  function updateSubagentModelEnabled(enabled: boolean) {
    const nextId = subagentModelId || models[0]?.id || "";
    setSubagentModelEnabled(enabled);
    if (enabled && nextId) {
      const nextParams = rememberedParamsForModel(nextId);
      setSubagentModelId(nextId);
      setSubagentModelParams(nextParams);
      if (!Object.prototype.hasOwnProperty.call(modelParamsByModel, nextId)) {
        persistModelParamsByModel({ ...modelParamsByModel, [nextId]: nextParams });
      }
    }
    void fetch("/api/preferences", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        subagentModelEnabled: enabled,
        ...(enabled && nextId ? { subagentModelId: nextId } : {}),
      }),
    });
  }

  function updateSubagentModelId(nextId: string) {
    setSubagentModelId(nextId);
    setSubagentModelParams(rememberedParamsForModel(nextId));
    void fetch("/api/preferences", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ subagentModelId: nextId }),
    });
  }

  function updateBrowserSettings(next: {
    browserRealtime?: boolean;
    browserFps?: number;
    browserViewportWidth?: number;
    browserViewportHeight?: number;
  }) {
    if (next.browserRealtime !== undefined) setBrowserRealtime(next.browserRealtime);
    if (next.browserFps !== undefined) setBrowserFps(next.browserFps);
    if (next.browserViewportWidth !== undefined || next.browserViewportHeight !== undefined) {
      setBrowserDefaultViewport((current) => ({
        width: next.browserViewportWidth ?? current.width,
        height: next.browserViewportHeight ?? current.height,
      }));
    }
    void fetch("/api/preferences", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(next),
    });
  }

  const applySnapshot = useCallback((id: string, snap: ChatSnapshot) => {
    if (!acceptServerSnapshot(id, snap.updatedAt)) return;
    const browser = normalizeBrowserContext(snap.browserContext, id);
    const session = snap.sessionState || {};
    clearUnread(id);
    if (snap.updatedAt) seenChatUpdatedAtRef.current.set(id, snap.updatedAt);
    if (!snap.pendingQuestion) {
      setAttentionChatIds((current) => current.filter((chatId) => chatId !== id));
    }
    setActiveChatId(id);
    activeChatIdRef.current = id;
    setChatTitle(snap.chatTitle);
    setAgentId(snap.agentId);
    setModelId(snap.modelId);
    setModelParams(
      Object.prototype.hasOwnProperty.call(modelParamsByModel, snap.modelId)
        ? modelParamsByModel[snap.modelId] || []
        : snap.modelParams ?? [],
    );
    setWorkspaces(snap.workspaces ?? []);
    setActiveWorkspaceId(
      session.activeWorkspaceId && snap.workspaces?.some((item) => item.id === session.activeWorkspaceId)
        ? session.activeWorkspaceId
        : snap.workspaces?.[0]?.id ?? null,
    );
    setWorkspaceTab(session.workspaceTab || "canvas");
    setWorkspaceOpen(Boolean(session.workspaceOpen));
    setWorkspaceWidth(
      typeof session.workspaceWidth === "number"
        ? Math.min(WORKSPACE_MAX_WIDTH, Math.max(WORKSPACE_MIN_WIDTH, session.workspaceWidth))
        : 380,
    );
    const loadedTerminalTabs = normalizeTerminalTabs(session);
    const loadedActiveTerminalTabId =
      session.activeTerminalTabId && loadedTerminalTabs.some((tab) => tab.id === session.activeTerminalTabId)
        ? session.activeTerminalTabId
        : loadedTerminalTabs[0].id;
    setTerminalTabs(loadedTerminalTabs);
    setActiveTerminalTabId(loadedActiveTerminalTabId);
    setRemoteTerminalCwd(loadedTerminalTabs.find((tab) => tab.id === loadedActiveTerminalTabId)?.cwd || clientConfig.defaultCwd);
    setRemoteFileCwd(normalizeWorkDirectory(session.fileCwd || session.remoteCwd));
    setInput(session.input || "");
    setReferenceMenu(null);
    setReferences([]);
    setMessages(snap.messages);
    setMessageOffset(snap.messageOffset);
    setHasEarlierMessages(snap.hasEarlierMessages);
    setQueuedMessages(
      (snap.queuedMessages ?? []).map((message) => ({
        ...message,
        files: [],
      })),
    );
    setBrowserTabs(browser.tabs);
    setActiveBrowserTabId(browser.activeTabId);
    const activeTab = browser.tabs.find((tab) => tab.id === browser.activeTabId);
    setBrowserUrl(activeTab?.url || "");
    setBrowserInput(activeTab?.url || "");
    setLiveStatus("");
    setBusy(
      Boolean(
        runtimeRef.current.has(id) ||
          snap.runStatus === "running" ||
          snap.runStatus === "waiting_input" ||
          snap.pendingQuestion,
      ),
    );
    pendingQuestionIdRef.current = snap.pendingQuestion?.questionId ?? null;
    setPendingQuestion(snap.pendingQuestion ?? null);
    setQuestionAnswers(snap.pendingQuestion?.questions.map(() => "") ?? []);
    setQuestionCustom(snap.pendingQuestion?.questions.map(() => "") ?? []);
    setQuestionCustomActive(snap.pendingQuestion?.questions.map(() => false) ?? []);
    setMobileNavOpen(false);
    setPaneKey((k) => k + 1);
  }, [acceptServerSnapshot, clearUnread, modelParamsByModel]);

  const openDraft = useCallback(
    (opts?: { skipNav?: boolean }) => {
      chatLoadAbortRef.current?.abort();
      chatLoadAbortRef.current = null;
      chatLoadRequestRef.current += 1;
      setLoadingChatId(null);
      const previousChatId = activeChatIdRef.current;
      persistActiveSnapshot();
      setBusy(Boolean(activeChatIdRef.current && runtimeRef.current.has(activeChatIdRef.current)));
      setPendingQuestion(null);
      setAttentionChatIds((current) => current.filter((id) => id !== activeChatIdRef.current));
      setQuestionAnswers([]);
      setQuestionCustom([]);
      setQuestionCustomActive([]);

      setActiveChatId(null);
      activeChatIdRef.current = null;
      setBusy(false);
      setChatTitle("New chat");
      setAgentId(undefined);
      setModelId(stateRef.current.defaultModelId || "");
      setModelParams(stateRef.current.defaultModelParams);
      const browser = normalizeBrowserContext(
        previousChatId
          ? {
              tabs: stateRef.current.browserTabs,
              activeTabId: stateRef.current.activeBrowserTabId,
              sessionKey: previousChatId,
              updatedAt: new Date().toISOString(),
            }
          : undefined,
        previousChatId || "draft",
      );
      setBrowserTabs(browser.tabs);
      setActiveBrowserTabId(browser.activeTabId);
      const activeTab = browser.tabs.find((tab) => tab.id === browser.activeTabId);
      setBrowserUrl(activeTab?.url || "");
      setBrowserInput(activeTab?.url || "");
      setMessages([]);
      setInput(draftInputRef.current);
      setReferenceMenu(null);
      setReferences([]);
      setMessageOffset(0);
      setHasEarlierMessages(false);
      setQueuedMessages([]);
      setWorkspaces([]);
      setActiveWorkspaceId(null);
      setWorkspaceOpen(false);
      setLiveStatus("");
      setMobileNavOpen(false);
      setPaneKey((k) => k + 1);
      if (!opts?.skipNav) navigateChat(null);
    },
    [navigateChat, persistActiveSnapshot],
  );

  const loadChat = useCallback(
    async (id: string, opts?: { skipNav?: boolean; forceReload?: boolean }) => {
      chatLoadAbortRef.current?.abort();
      const controller = new AbortController();
      chatLoadAbortRef.current = controller;
      const requestId = ++chatLoadRequestRef.current;
      clearUnread(id);
      if (activeChatIdRef.current === id && !opts?.forceReload) {
        if (!opts?.skipNav) navigateChat(id);
        setLoadingChatId(null);
        return true;
      }

      persistActiveSnapshot();
      setLoadingChatId(id);
      setActiveChatId(id);
      activeChatIdRef.current = id;
      setMessages([]);
      setMessageOffset(0);
      setHasEarlierMessages(false);
      setLoadingEarlierMessages(false);
      setPendingQuestion(null);
      setLiveStatus("");
      setActiveWorkspaceId(null);
      setWorkspaces([]);
      setChatTitle("Loading…");
      setBusy(Boolean(runtimeRef.current.get(id)));
      setPendingQuestion(null);
      setQuestionAnswers([]);
      setQuestionCustom([]);
      setQuestionCustomActive([]);

      const cached = chatCacheRef.current.get(id);
      const useChatCache = false;
      if (cached && useChatCache && !opts?.forceReload) {
        if (chatLoadRequestRef.current !== requestId) return false;
        applySnapshot(id, cached);
        if (!opts?.skipNav) navigateChat(id);
        // Soft revalidate in background without clearing UI
        void (async () => {
          try {
            const res = await fetch(
              `/api/chats/${id}?messageLimit=${CHAT_MESSAGE_LOAD_LIMIT}&messageOffset=0`,
              { cache: "no-store", signal: controller.signal },
            );
            if (
              !res.ok ||
              activeChatIdRef.current !== id ||
              chatLoadRequestRef.current !== requestId
            ) return;
            const data = (await res.json()) as ChatPage;
            if (!acceptServerSnapshot(id, data.chat.updatedAt)) return;
            const mid =
              data.chat.modelId ||
              localStorage.getItem(MODEL_STORAGE_KEY) ||
              "";
            const next: ChatSnapshot = {
              messages: mergeMessages(cached.messages, mapApiMessages(data.chat.messages, data.chat.runStatus)),
              chatTitle: data.chat.title,
              updatedAt: data.chat.updatedAt,
              agentId: data.chat.agentId,
              modelId: mid,
              modelParams: Array.isArray(data.chat.modelParams)
                ? data.chat.modelParams
                : cached.modelParams,
              queuedMessages: cached.queuedMessages,
              workspaces: workspacesFromChat(data.chat),
              browserContext: normalizeBrowserContext(data.chat.browserContext, id),
              sessionState: data.chat.sessionState || cached.sessionState,
              runStatus: data.chat.runStatus,
              pendingQuestion: data.chat.pendingQuestion,
              messageOffset: cached.messageOffset,
              hasEarlierMessages: Boolean(data.hasEarlierMessages),
            };
            chatCacheRef.current.set(id, next);
            if (
              activeChatIdRef.current !== id ||
              chatLoadRequestRef.current !== requestId
            ) return;
            setChatTitle(next.chatTitle);
            setAgentId(next.agentId);
            setModelId(next.modelId);
            setModelParams(
              Object.prototype.hasOwnProperty.call(modelParamsByModel, next.modelId)
                ? modelParamsByModel[next.modelId] || []
                : next.modelParams,
            );
            setMessages(next.messages);
            setQueuedMessages(next.queuedMessages.map((message) => ({ ...message, files: [] })));
            setWorkspaces(next.workspaces);
            setBrowserTabs(next.browserContext.tabs);
            setActiveBrowserTabId(next.browserContext.activeTabId);
            const activeTab = next.browserContext.tabs.find(
              (tab) => tab.id === next.browserContext.activeTabId,
            );
            setBrowserUrl(activeTab?.url || "");
            setBrowserInput(activeTab?.url || "");
            const session = next.sessionState || {};
            setActiveWorkspaceId(
              session.activeWorkspaceId && next.workspaces.some((item) => item.id === session.activeWorkspaceId)
                ? session.activeWorkspaceId
                : next.workspaces[0]?.id ?? null,
            );
            setWorkspaceTab(session.workspaceTab || "canvas");
            setWorkspaceOpen(Boolean(session.workspaceOpen));
            setWorkspaceWidth(
              typeof session.workspaceWidth === "number"
                ? Math.min(WORKSPACE_MAX_WIDTH, Math.max(WORKSPACE_MIN_WIDTH, session.workspaceWidth))
                : 380,
            );
            const loadedTerminalTabs = normalizeTerminalTabs(session);
            const loadedActiveTerminalTabId =
              session.activeTerminalTabId && loadedTerminalTabs.some((tab) => tab.id === session.activeTerminalTabId)
                ? session.activeTerminalTabId
                : loadedTerminalTabs[0].id;
            setTerminalTabs(loadedTerminalTabs);
            setActiveTerminalTabId(loadedActiveTerminalTabId);
            setRemoteTerminalCwd(loadedTerminalTabs.find((tab) => tab.id === loadedActiveTerminalTabId)?.cwd || clientConfig.defaultCwd);
            setRemoteFileCwd(normalizeWorkDirectory(session.fileCwd || session.remoteCwd));
            setPendingQuestion(next.pendingQuestion ?? null);
            setBusy(
              next.runStatus === "running" ||
                next.runStatus === "waiting_input" ||
                Boolean(next.pendingQuestion),
            );
          } catch {
            /* ignore */
          }
        })();
        return true;
      }

      try {
        const res = await fetch(
          `/api/chats/${id}?messageLimit=${CHAT_MESSAGE_LOAD_LIMIT}&messageOffset=0`,
          { cache: "no-store", signal: controller.signal },
        );
        if (chatLoadRequestRef.current !== requestId) return false;
        if (!res.ok) {
          toast.error("Could not open chat");
          navigateChat(null, true);
          return false;
        }
        const data = (await res.json()) as ChatPage;
        if (chatLoadRequestRef.current !== requestId) return false;
        if (!acceptServerSnapshot(id, data.chat.updatedAt)) return false;
      const mid =
        data.chat.modelId ||
        localStorage.getItem(MODEL_STORAGE_KEY) ||
        "";
      const snap: ChatSnapshot = {
        messages: mapApiMessages(data.chat.messages, data.chat.runStatus),
        chatTitle: data.chat.title,
        updatedAt: data.chat.updatedAt,
        agentId: data.chat.agentId,
        modelId: mid,
        modelParams: Array.isArray(data.chat.modelParams)
          ? data.chat.modelParams
          : [],
        queuedMessages: Array.isArray(data.chat.queuedMessages)
          ? data.chat.queuedMessages
          : [],
        workspaces: workspacesFromChat(data.chat),
        browserContext: normalizeBrowserContext(data.chat.browserContext, data.chat.id),
        sessionState: data.chat.sessionState || {},
        runStatus: data.chat.runStatus,
        pendingQuestion: data.chat.pendingQuestion,
        messageOffset: data.messageOffset ?? 0,
        hasEarlierMessages: Boolean(data.hasEarlierMessages),
      };
      chatCacheRef.current.set(data.chat.id, snap);
      applySnapshot(data.chat.id, snap);
      setLoadingChatId(null);
      if (!opts?.skipNav) navigateChat(data.chat.id);
      return true;
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return false;
        toast.error("Could not open chat");
        return false;
      } finally {
        if (chatLoadRequestRef.current === requestId) {
          setLoadingChatId(null);
        }
      }
    },
    [acceptServerSnapshot, applySnapshot, clearUnread, modelParamsByModel, navigateChat, persistActiveSnapshot],
  );

  const loadEarlierMessages = useCallback(async () => {
    const id = activeChatIdRef.current;
    const el = messagesScrollRef.current;
    if (!id || !el || !hasEarlierMessages || loadingEarlierMessages) return;
    const previousHeight = el.scrollHeight;
    setLoadingEarlierMessages(true);
    try {
      const nextOffset = messageOffset + CHAT_MESSAGE_LOAD_LIMIT;
      const res = await fetch(
        `/api/chats/${id}?messageLimit=${CHAT_MESSAGE_LOAD_LIMIT}&messageOffset=${nextOffset}`,
        { cache: "no-store" },
      );
      if (!res.ok) return;
      const data = (await res.json()) as ChatPage;
      const olderMessages = mapApiMessages(data.chat.messages);
      setMessages((current) => mergeMessages(current, olderMessages));
      setMessageOffset(data.messageOffset ?? nextOffset);
      setHasEarlierMessages(Boolean(data.hasEarlierMessages));
      window.requestAnimationFrame(() => {
        const currentEl = messagesScrollRef.current;
        if (currentEl) currentEl.scrollTop += currentEl.scrollHeight - previousHeight;
      });
    } finally {
      setLoadingEarlierMessages(false);
    }
  }, [hasEarlierMessages, loadingEarlierMessages, messageOffset]);

  useEffect(() => {
    if (loadingChatId || !activeChatId || !hasEarlierMessages || messages.length >= CHAT_MESSAGE_PRELOAD_MAX) return;
    let cancelled = false;
    let offset = messageOffset;
    let loaded = messages.length;

    const preload = async () => {
      while (!cancelled && loaded < CHAT_MESSAGE_PRELOAD_MAX && hasEarlierMessages) {
        const nextOffset = offset + CHAT_MESSAGE_LOAD_LIMIT;
        const scrollElement = messagesScrollRef.current;
        const previousHeight = scrollElement?.scrollHeight ?? 0;
        const previousTop = scrollElement?.scrollTop ?? 0;
        const wasAtBottom = scrollElement
          ? scrollElement.scrollHeight - scrollElement.scrollTop - scrollElement.clientHeight < 48
          : false;
        try {
          const res = await fetch(
            `/api/chats/${activeChatId}?messageLimit=${CHAT_MESSAGE_LOAD_LIMIT}&messageOffset=${nextOffset}`,
            { cache: "no-store" },
          );
          if (!res.ok || cancelled) return;
          const data = (await res.json()) as ChatPage;
          const olderMessages = mapApiMessages(data.chat.messages);
          if (cancelled) return;
          setMessages((current) => mergeMessages(current, olderMessages));
          offset = data.messageOffset ?? nextOffset;
          loaded += olderMessages.length;
          setMessageOffset(offset);
          setHasEarlierMessages(Boolean(data.hasEarlierMessages));
          window.requestAnimationFrame(() => {
            if (!scrollElement || cancelled) return;
            const heightDelta = scrollElement.scrollHeight - previousHeight;
            scrollElement.scrollTop = wasAtBottom
              ? scrollElement.scrollHeight - scrollElement.clientHeight
              : previousTop + heightDelta;
          });
          if (!data.hasEarlierMessages || olderMessages.length === 0) return;
          await new Promise((resolve) => window.setTimeout(resolve, 40));
        } catch {
          return;
        }
      }
    };

    void preload();
    return () => {
      cancelled = true;
    };
  }, [activeChatId, loadingChatId]);

  async function openSearchResult(chatId: string, messageId?: string) {
    setHighlightedMessageId(messageId || null);
    await loadChat(chatId);
  }

  function exportCurrentChat() {
    const snapshot = stateRef.current;
    const lines = [`# ${snapshot.chatTitle}`, ""];
    for (const message of snapshot.messages) {
      lines.push(`## ${message.role}`, "", message.content || "(no text)", "");
    }
    const blob = new Blob([lines.join("\n")], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${snapshot.chatTitle.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").slice(0, 64) || "chat"}.md`;
    link.click();
    URL.revokeObjectURL(url);
  }

  function persistModelParamsByModel(next: Record<string, ModelParamSelection[]>) {
    setModelParamsByModel(next);
    void fetch("/api/preferences", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ modelParamsByModel: next }),
    });
  }

  function rememberedParamsForModel(
    id: string,
    fallback: ModelParamSelection[] = models.find((model) => model.id === id)?.defaultParams ?? [],
  ) {
    return Object.prototype.hasOwnProperty.call(modelParamsByModel, id)
      ? modelParamsByModel[id] || []
      : fallback;
  }

  function updateDefaultModel(nextId: string) {
    if (!nextId) return;
    const nextParams = rememberedParamsForModel(nextId);
    const nextMap = { ...modelParamsByModel, [nextId]: nextParams };
    setDefaultModelId(nextId);
    setDefaultModelParams(nextParams);
    persistModelParamsByModel(nextMap);
    if (!activeChatIdRef.current) {
      setModelId(nextId);
      setModelParams(nextParams);
      localStorage.setItem(MODEL_STORAGE_KEY, nextId);
      localStorage.setItem(PARAMS_STORAGE_KEY, JSON.stringify(nextParams));
    }
    void fetch("/api/preferences", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ modelId: nextId, modelParams: nextParams }),
    });
  }

  function updateDefaultModelParams(next: ModelParamSelection[]) {
    const nextMap = defaultModelId
      ? { ...modelParamsByModel, [defaultModelId]: next }
      : modelParamsByModel;
    setDefaultModelParams(next);
    if (subagentModelId === defaultModelId) setSubagentModelParams(next);
    persistModelParamsByModel(nextMap);
    if (!activeChatIdRef.current) {
      setModelParams(next);
      localStorage.setItem(PARAMS_STORAGE_KEY, JSON.stringify(next));
    }
    void fetch("/api/preferences", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        modelParams: next,
      }),
    });
  }

  function updateSubagentModelParams(next: ModelParamSelection[]) {
    setSubagentModelParams(next);
    if (!subagentModelId) return;
    persistModelParamsByModel({ ...modelParamsByModel, [subagentModelId]: next });
  }

  async function selectModel(nextId: string) {
    if (!nextId || nextId === modelId) return;
    const nextMap = { ...modelParamsByModel };
    if (modelId) nextMap[modelId] = modelParams;
    const nextParams = Object.prototype.hasOwnProperty.call(nextMap, nextId)
      ? nextMap[nextId] || []
      : models.find((model) => model.id === nextId)?.defaultParams ?? [];
    nextMap[nextId] = nextParams;
    setModelParamsByModel(nextMap);
    void fetch("/api/preferences", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ modelParamsByModel: nextMap }),
    });
    setModelId(nextId);
    localStorage.setItem(MODEL_STORAGE_KEY, nextId);
    setAgentId(undefined);
    setModelParams(nextParams);
    localStorage.setItem(PARAMS_STORAGE_KEY, JSON.stringify(nextParams));
    if (activeChatId) {
      await fetch(`/api/chats/${activeChatId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ modelId: nextId, modelParams: nextParams }),
      });
    }
  }

  useEffect(() => {
    void refreshStatus();
    const t = setInterval(() => void refreshStatus(), 30000);
    return () => clearInterval(t);
  }, [refreshStatus]);

  useEffect(() => {
    if (!authed) return;
    void loadChats();
    void loadMemories();
    void loadModels();
  }, [authed, loadChats, loadMemories, loadModels]);

  useEffect(() => {
    if (!authed) return;
    const current = activeChatIdRef.current;
    if (routeChatId) {
      if (current !== routeChatId) {
        void loadChat(routeChatId, { skipNav: true });
      }
    } else if (current) {
      openDraft({ skipNav: true });
    }
  }, [authed, routeChatId, loadChat, openDraft]);

  useEffect(() => {
    if (!authed || !activeChatId || loadingChatId) {
      return;
    }
    const refreshBackgroundRun = async () => {
      try {
        const res = await fetch(
          `/api/chats/${activeChatId}?messageLimit=${CHAT_MESSAGE_LOAD_LIMIT}&messageOffset=0`,
          { cache: "no-store" },
        );
        if (!res.ok || activeChatIdRef.current !== activeChatId) return;
        const data = (await res.json()) as { chat: Chat };
        if (!acceptServerSnapshot(activeChatId, data.chat.updatedAt)) return;
        setMessages((current) => mergeMessages(current, mapApiMessages(data.chat.messages, data.chat.runStatus)));
        if (data.chat.modelId) setModelId(data.chat.modelId);
        setModelParams(
          data.chat.modelId && Object.prototype.hasOwnProperty.call(modelParamsByModel, data.chat.modelId)
            ? modelParamsByModel[data.chat.modelId] || []
            : data.chat.modelParams ?? [],
        );
        const serverWorkspaces = workspacesFromChat(data.chat);
        setWorkspaces(serverWorkspaces);
        setActiveWorkspaceId((current) =>
          current && serverWorkspaces.some((item) => item.id === current)
            ? current
            : serverWorkspaces[0]?.id ?? null,
        );
        const waitingForInput =
          data.chat.runStatus === "waiting_input" ||
          Boolean(data.chat.pendingQuestion);
        setPendingQuestion(data.chat.pendingQuestion ?? null);
        if (
          data.chat.pendingQuestion &&
          data.chat.pendingQuestion.questionId !== pendingQuestion?.questionId
        ) {
          setQuestionAnswers(data.chat.pendingQuestion.questions.map(() => ""));
          setQuestionCustom(data.chat.pendingQuestion.questions.map(() => ""));
          setQuestionCustomActive(
            data.chat.pendingQuestion.questions.map(() => false),
          );
        }
        setBusy(
          runtimeRef.current.has(activeChatId) ||
            data.chat.runStatus === "running" ||
            waitingForInput,
        );
        if (data.chat.pendingQuestion?.questionId &&
            notifiedQuestionRef.current !== data.chat.pendingQuestion.questionId) {
          notifiedQuestionRef.current = data.chat.pendingQuestion.questionId;
          const questions = data.chat.pendingQuestion.questions;
          notifyAttention(
            activeChatId,
            data.chat.pendingQuestion.questionId,
            questions.length === 1
              ? questions[0].question
              : `${questions.length} questions need your input.`,
          );
        }
        if (!["running", "waiting_input"].includes(data.chat.runStatus || "")) {
          await loadChats();
        }
      } catch {
        /* retry on the next interval */
      }
    };
    const interval = window.setInterval(() => {
      void refreshBackgroundRun();
    }, 3000);
    return () => window.clearInterval(interval);
  }, [acceptServerSnapshot, activeChatId, authed, loadChats, loadingChatId, modelParamsByModel, pendingQuestion]);

  useEffect(() => {
    if (!authed) return;
    const refresh = () => {
      void loadChats();
    };
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [authed, loadChats]);

  useEffect(() => {
    if (!authed) return;
    const interval = window.setInterval(() => void loadChats(), 3000);
    return () => window.clearInterval(interval);
  }, [authed, loadChats]);

  useEffect(() => {
    const openLinkedUrl = (event: Event) => {
      const url = (event as CustomEvent<unknown>).detail;
      if (typeof url !== "string" || !/^https?:\/\//i.test(url)) return;
      navigateBrowser(url);
      setWorkspaceTab("browser");
      setWorkspaceOpen(true);
    };
    const openLinkedReference = async (event: Event) => {
      const reference = (event as CustomEvent<ReferenceItem>).detail;
      if (!reference?.kind || !reference.id) return;

      const targetChatId =
        reference.chatId ||
        (reference.kind === "chat" ? reference.id : undefined);
      if (targetChatId && targetChatId !== activeChatIdRef.current) {
        const opened = await loadChat(targetChatId);
        if (!opened) return;
      }

      if (reference.kind === "chat") return;
      if (reference.kind === "canvas" || reference.kind === "plan") {
        setActiveWorkspaceId(reference.id);
        setWorkspaceTab(reference.kind);
        setWorkspaceOpen(true);
        return;
      }
      if (reference.kind === "browser" && reference.path) {
        navigateBrowser(reference.path);
        setWorkspaceTab("browser");
        setWorkspaceOpen(true);
        return;
      }
      if (reference.kind === "terminal") {
        const terminalId = reference.id.split(":").at(-1);
        const terminal = terminalTabs.find((tab) => tab.id === terminalId);
        if (terminal) setActiveTerminalTabId(terminal.id);
        setWorkspaceTab("terminal");
        setWorkspaceOpen(true);
        return;
      }
      if (reference.kind === "file" && targetChatId) {
        const response = await fetch(
          `/api/chats/${targetChatId}?messageLimit=100&messageOffset=0`,
          { cache: "no-store" },
        );
        if (!response.ok) return;
        const data = (await response.json()) as { chat?: Chat };
        const attachmentId = reference.id.split(":").at(-1);
        const attachment = data.chat?.messages
          .flatMap((message) => message.attachments || [])
          .find((item) => item.id === attachmentId || item.name === reference.label);
        if (attachment) {
          setActiveAttachment({ attachment, chatId: targetChatId });
        }
        return;
      }
      if (reference.kind === "memory") setSettingsOpen(true);
    };
    const openLinkedWorkspace = async (event: Event) => {
      const detail = (event as CustomEvent<{ type?: string; id?: string }>).detail;
      if (!detail?.id || (detail.type !== "plan" && detail.type !== "canvas")) return;
      let workspace = workspaces.find((item) => item.id === detail.id);
      if (!workspace && activeChatIdRef.current) {
        try {
          const response = await fetch(
            `/api/chats/${activeChatIdRef.current}?messageLimit=${CHAT_MESSAGE_LOAD_LIMIT}&messageOffset=${messageOffset}`,
            { cache: "no-store" },
          );
          if (response.ok) {
            const data = (await response.json()) as { chat?: Chat };
            const nextWorkspaces = data.chat ? workspacesFromChat(data.chat) : [];
            setWorkspaces(nextWorkspaces);
            workspace = nextWorkspaces.find((item) => item.id === detail.id);
          }
        } catch {
          // Keep the side panel closed when the workspace cannot be loaded.
        }
      }
      if (!workspace) return;
      setActiveWorkspaceId(workspace.id);
      setWorkspaceTab(detail.type);
      setWorkspaceOpen(true);
    };
    window.addEventListener("ai-chat:open-browser", openLinkedUrl);
    window.addEventListener("ai-chat:open-reference", openLinkedReference);
    window.addEventListener("ai-chat:open-workspace", openLinkedWorkspace);
    return () => {
      window.removeEventListener("ai-chat:open-browser", openLinkedUrl);
      window.removeEventListener("ai-chat:open-reference", openLinkedReference);
      window.removeEventListener("ai-chat:open-workspace", openLinkedWorkspace);
    };
  }, [activeChatId, loadChat, messageOffset, navigateBrowser, terminalTabs, workspaces]);

  useEffect(() => {
    if (!authed) return;
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      const modifier = event.ctrlKey || event.metaKey;
      const key = event.key.toLowerCase();
      const target = event.target as HTMLElement | null;
      if (target?.closest("[data-browser-viewport]")) return;
      const isEditable =
        target?.isContentEditable ||
        target?.tagName === "INPUT" ||
        target?.tagName === "TEXTAREA";

      if (modifier && key === "n") {
        event.preventDefault();
        openDraft();
        return;
      }
      if (modifier && event.shiftKey && key === "o") {
        event.preventDefault();
        openDraft();
        return;
      }
      if (modifier && key === "k") {
        event.preventDefault();
        setCommandPaletteOpen(true);
        return;
      }
      if (key === "/" && !isEditable) {
        event.preventDefault();
        setCommandPaletteOpen(true);
        return;
      }
      if (modifier && event.shiftKey && (key === "arrowup" || key === "arrowdown")) {
        event.preventDefault();
        const currentIndex = activeChatIdRef.current
          ? chats.findIndex((chat) => chat.id === activeChatIdRef.current)
          : -1;
        const nextIndex =
          key === "arrowup"
            ? Math.max(0, currentIndex < 0 ? 0 : currentIndex - 1)
            : Math.min(chats.length - 1, currentIndex < 0 ? 0 : currentIndex + 1);
        const nextChat = chats[nextIndex];
        if (nextChat) void loadChat(nextChat.id);
        return;
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [authed, chats, loadChat, openDraft]);

  useEffect(() => {
    if (!authed) return;
    const timer = window.setTimeout(() => {
      textareaRef.current?.focus();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [authed, activeChatId, paneKey]);

  useEffect(() => {
    if (!modelMenuOpen) return;
    const timer = window.setTimeout(() => modelSearchRef.current?.focus(), 0);
    return () => window.clearTimeout(timer);
  }, [modelMenuOpen]);

  // Keep in-memory chat cache warm so switches stay instant
  useEffect(() => {
    if (!activeChatId) return;
    chatCacheRef.current.set(activeChatId, {
      messages: messages.map((m) => ({
        ...m,
        streaming: false,
        thinkingDone: m.thinking ? true : m.thinkingDone,
      })),
      chatTitle,
      agentId,
      modelId,
      modelParams,
      queuedMessages: queuedMessages.map(({ id, text, referenceText, references }) => ({
        id,
        text,
        ...(referenceText ? { referenceText } : {}),
        ...(references?.length ? { references } : {}),
      })),
      workspaces,
      browserContext: normalizeBrowserContext(
        {
          tabs: browserTabs,
          activeTabId: activeBrowserTabId,
          sessionKey: activeChatId,
          updatedAt: new Date().toISOString(),
        },
        activeChatId,
      ),
      sessionState: {
        terminalCwd: remoteTerminalCwd,
        fileCwd: remoteFileCwd,
        terminalTabs,
        activeTerminalTabId: activeTerminalTabId || undefined,
        workspaceTab,
        activeWorkspaceId,
        workspaceOpen,
        workspaceWidth,
      },
      runStatus: pendingQuestion
        ? "waiting_input"
        : busy
          ? "running"
          : "completed",
      pendingQuestion: pendingQuestion ?? undefined,
      messageOffset,
      hasEarlierMessages,
    });
  }, [
    activeChatId,
    messages,
    chatTitle,
    agentId,
    modelId,
    modelParams,
    queuedMessages,
    workspaces,
    browserTabs,
    activeBrowserTabId,
    remoteTerminalCwd,
    remoteFileCwd,
    terminalTabs,
    activeTerminalTabId,
    workspaceTab,
    activeWorkspaceId,
    workspaceOpen,
    workspaceWidth,
    busy,
    pendingQuestion,
    messageOffset,
    hasEarlierMessages,
  ]);

  useEffect(() => {
    if (!activeChatId || isDraft || loadingChatId) return;
    const timer = window.setTimeout(() => {
      void fetch(`/api/chats/${activeChatId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspaces }),
      });
    }, 500);
    return () => window.clearTimeout(timer);
  }, [activeChatId, workspaces, isDraft, loadingChatId]);

  useEffect(() => {
    if (!activeChatId || isDraft || loadingChatId) return;
    const timer = window.setTimeout(() => {
      void fetch(`/api/chats/${activeChatId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          queuedMessages: queuedMessages.map(({ id, text, referenceText, references }) => ({
            id,
            text,
            ...(referenceText ? { referenceText } : {}),
            ...(references?.length ? { references } : {}),
          })),
        }),
      });
    }, 0);
    return () => window.clearTimeout(timer);
  }, [activeChatId, isDraft, loadingChatId, queuedMessages]);

  useEffect(() => {
    setShowScrollDown(false);
    notifiedPlanRef.current = null;
  }, [activeChatId, paneKey]);

  useEffect(() => {
    const el = messagesScrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
    stickToBottomRef.current = true;
    const frame = window.requestAnimationFrame(() => {
      el.scrollTop = el.scrollHeight;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [activeChatId, paneKey]);

  useEffect(() => {
    if (loadingChatId || !activeChatId || !messages.length) return;
    const frame = window.requestAnimationFrame(() => {
      const el = messagesScrollRef.current;
      if (el) el.scrollTop = el.scrollHeight;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [activeChatId, loadingChatId]);

  useEffect(() => {
    const el = messagesScrollRef.current;
    if (!el || !stickToBottomRef.current) return;
    const frame = window.requestAnimationFrame(() => {
      if (stickToBottomRef.current) el.scrollTop = el.scrollHeight;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [messages]);

  useEffect(() => {
    const el = messagesScrollRef.current;
    if (!el) return;
    const updateScrollState = () => {
      const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
      const nearBottom = distanceFromBottom < 48;
      stickToBottomRef.current = nearBottom;
      setShowScrollDown(!nearBottom);
      if (el.scrollTop < 80) void loadEarlierMessages();
    };
    updateScrollState();
    el.addEventListener("scroll", updateScrollState, { passive: true });
    return () => el.removeEventListener("scroll", updateScrollState);
  }, [loadEarlierMessages, messages.length, paneKey]);

  useEffect(() => {
    if (!highlightedMessageId) return;
    const frame = window.requestAnimationFrame(() => {
      const element = document.querySelector<HTMLElement>(
        `[data-message-id="${CSS.escape(highlightedMessageId)}"]`,
      );
      element?.scrollIntoView({ behavior: "smooth", block: "center" });
      setTimeout(() => setHighlightedMessageId(null), 1800);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [highlightedMessageId, messages.length]);

  function scrollMessagesToBottom() {
    stickToBottomRef.current = true;
    setShowScrollDown(false);
    messagesScrollRef.current?.scrollTo({
      top: messagesScrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    const minPx = 36; // match send button size-9
    el.style.height = "auto";
    el.style.height = `${Math.min(Math.max(el.scrollHeight, minPx), 180)}px`;
  }, [input]);

  useEffect(() => {
    const el = composerContainerRef.current;
    if (!el) return;

    const updateComposerSpace = () => {
      const height = Math.ceil(el.getBoundingClientRect().height);
      setComposerHeight((current) => (current === height ? current : height));
    };

    updateComposerSpace();
    const observer = new ResizeObserver(updateComposerSpace);
    observer.observe(el);
    return () => observer.disconnect();
  }, [isEmpty, queuedMessages.length, liveStatus, input, referenceText, pendingFiles.length]);

  async function login(e: FormEvent) {
    e.preventDefault();
    setAuthError("");
    const res = await fetch("/api/auth", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });
    if (!res.ok) {
      setAuthError("Wrong username or password");
      return;
    }
    setPassword("");
    await refreshStatus();
  }

  async function logout() {
    await fetch("/api/auth", { method: "DELETE" });
    authedRef.current = false;
    setAuthed(false);
    chatLoadRequestRef.current += 1;
    setActiveChatId(null);
    activeChatIdRef.current = null;
    setMessages([]);
    setChats([]);
    chatCacheRef.current.clear();
    setUnreadChatIds([]);
    saveUnreadChatIds([]);
    navigateChat(null, true);
  }

  async function ensureChatId(): Promise<string | null> {
    if (activeChatIdRef.current) return activeChatIdRef.current;
    const browserContext = normalizeBrowserContext(
      {
        tabs: stateRef.current.browserTabs,
        activeTabId: stateRef.current.activeBrowserTabId,
        sessionKey: "draft",
        updatedAt: new Date().toISOString(),
      },
      "draft",
    );
    const res = await fetch("/api/chats", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        browserContext,
        modelId: stateRef.current.modelId,
        modelParams: stateRef.current.modelParams,
      }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { chat: Chat };
    setActiveChatId(data.chat.id);
    activeChatIdRef.current = data.chat.id;
    setChatTitle(data.chat.title);
    chatCacheRef.current.set(data.chat.id, {
      messages: stateRef.current.messages,
      chatTitle: data.chat.title,
      agentId: undefined,
      modelId: stateRef.current.modelId,
      modelParams: stateRef.current.modelParams,
      queuedMessages: stateRef.current.queuedMessages.map(({ id, text, referenceText, references }) => ({
        id,
        text,
        ...(referenceText ? { referenceText } : {}),
        ...(references?.length ? { references } : {}),
      })),
      workspaces: [],
      browserContext: normalizeBrowserContext(data.chat.browserContext, data.chat.id),
      sessionState: {
        terminalCwd: stateRef.current.remoteTerminalCwd,
        fileCwd: stateRef.current.remoteFileCwd,
        terminalTabs: stateRef.current.terminalTabs,
        activeTerminalTabId: stateRef.current.activeTerminalTabId || undefined,
        workspaceTab: stateRef.current.workspaceTab,
        activeWorkspaceId: stateRef.current.activeWorkspaceId,
        workspaceOpen: stateRef.current.workspaceOpen,
        workspaceWidth: stateRef.current.workspaceWidth,
      },
      messageOffset: 0,
      hasEarlierMessages: false,
    });
    navigateChat(data.chat.id, true);
    await loadChats();
    return data.chat.id;
  }

  function openRename(id: string, currentTitle: string) {
    setRenameChatId(id);
    setRenameValue(currentTitle);
    setRenameOpen(true);
  }

  async function submitRename() {
    if (!renameChatId) return;
    const title = renameValue.trim();
    if (!title) return;
    const res = await fetch(`/api/chats/${renameChatId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title }),
    });
    if (!res.ok) {
      toast.error("Rename failed");
      return;
    }
    if (activeChatId === renameChatId) setChatTitle(title);
    setRenameOpen(false);
    setRenameChatId(null);
    await loadChats();
  }

  async function removeChat(id: string) {
    const res = await fetch(`/api/chats/${id}`, { method: "DELETE" });
    if (!res.ok) {
      toast.error("Delete failed");
      return;
    }
    chatCacheRef.current.delete(id);
    clearUnread(id);
    if (activeChatId === id) openDraft();
    await loadChats();
  }

  async function updateChatFlags(
    id: string,
    patch: { pinned?: boolean; archived?: boolean },
  ) {
    const res = await fetch(`/api/chats/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    if (!res.ok) {
      toast.error("Chat update failed");
      return;
    }
    chatCacheRef.current.delete(id);
    if (patch.archived && activeChatIdRef.current === id) {
      openDraft();
    }
    await loadChats();
  }

  async function openChatLogs(id: string) {
    setChatLogsChatId(id);
    setChatLogsOpen(true);
    setChatLogsLoading(true);
    setChatLogsCategory("all");
    try {
      const res = await fetch(`/api/chats/${encodeURIComponent(id)}/logs`, { cache: "no-store" });
      const data = (await res.json().catch(() => ({}))) as { logs?: ChatLogEntry[]; error?: string };
      if (!res.ok) throw new Error(data.error || "Failed to load chat logs");
      setChatLogs(data.logs || []);
    } catch (error) {
      setChatLogs([]);
      toast.error(error instanceof Error ? error.message : "Failed to load chat logs");
    } finally {
      setChatLogsLoading(false);
    }
  }

  async function revertMessage(
    target: Msg,
    options: { keepMessage?: boolean; successMessage?: string | null; forEdit?: boolean } = {},
  ): Promise<boolean> {
    const chatId = activeChatIdRef.current;
    if (!chatId || reverting) return false;
    const keepMessage = options.keepMessage === true;
    setReverting(true);
    try {
      const res = await fetch(`/api/chats/${chatId}/revert`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messageId: target.id, keepMessage }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        chat?: Chat;
        conflicts?: Array<{ path?: string }>;
        nonReversible?: { count?: number; names?: string[] };
        warnings?: string[];
        error?: string;
      };
      if (!res.ok || !data.chat) {
        toast.error(
          options.forEdit && res.status === 404
            ? "Edit failed: this message is no longer in the chat"
            : data.error || "Revert failed",
        );
        return false;
      }
      const nextMessages = mapApiMessages(data.chat.messages, data.chat.runStatus);
      const nextWorkspaces = workspacesFromChat(data.chat);
      const nextModelId = data.chat.modelId || modelId;
      setMessages(nextMessages);
      setWorkspaces(nextWorkspaces);
      setActiveWorkspaceId(nextWorkspaces[0]?.id ?? null);
      setAgentId(data.chat.agentId);
      setChatTitle(data.chat.title);
      setQueuedMessages(
        (data.chat.queuedMessages ?? []).map((message) => ({
          ...message,
          files: [],
        })),
      );
      setLiveStatus("");
      setBusy(false);
      setPendingFiles((prev) => {
        for (const file of prev) {
          if (file.previewUrl) URL.revokeObjectURL(file.previewUrl);
        }
        return [];
      });
      chatCacheRef.current.set(chatId, {
        messages: nextMessages,
        chatTitle: data.chat.title,
        agentId: data.chat.agentId,
        modelId: nextModelId,
        modelParams,
        queuedMessages: data.chat.queuedMessages ?? [],
        workspaces: nextWorkspaces,
        browserContext: normalizeBrowserContext(data.chat.browserContext, chatId),
        sessionState: data.chat.sessionState || {
          terminalCwd: stateRef.current.remoteTerminalCwd,
          fileCwd: stateRef.current.remoteFileCwd,
          terminalTabs: stateRef.current.terminalTabs,
          activeTerminalTabId: stateRef.current.activeTerminalTabId || undefined,
          workspaceTab: stateRef.current.workspaceTab,
          activeWorkspaceId: stateRef.current.activeWorkspaceId,
          workspaceOpen: stateRef.current.workspaceOpen,
          workspaceWidth: stateRef.current.workspaceWidth,
        },
        messageOffset: 0,
        hasEarlierMessages: false,
      });
      await loadChats();
      const conflicts = data.conflicts ?? [];
      const nonReversibleCount = data.nonReversible?.count ?? 0;
      const nonReversibleNames = data.nonReversible?.names ?? [];
      const warningCount = data.warnings?.length ?? 0;
      if (conflicts.length || nonReversibleCount || warningCount) {
        const names = conflicts
          .map((entry) => entry.path)
          .filter(Boolean)
          .slice(0, 3)
          .join(", ");
        toast.warning(
          [
            conflicts.length ? `${conflicts.length} file conflict${conflicts.length === 1 ? "" : "s"}${names ? `: ${names}` : ""}` : "",
            nonReversibleCount ? `${nonReversibleCount} external action${nonReversibleCount === 1 ? "" : "s"} may need manual cleanup` : "",
            warningCount ? `${warningCount} warning${warningCount === 1 ? "" : "s"}` : "",
          ]
            .filter(Boolean)
            .join(" · "),
          nonReversibleNames.length
            ? {
                action: {
                  label: "Details",
                  onClick: () => setManualCleanupTools(nonReversibleNames),
                },
              }
            : undefined,
        );
        if (options.successMessage) toast.success(options.successMessage);
      } else if (options.successMessage !== null) {
        toast.success(
          options.successMessage ??
            "Message and following changes reverted",
        );
      }
      return true;
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Revert failed");
      return false;
    } finally {
      setReverting(false);
    }
  }

  async function confirmRevert() {
    const target = revertTarget;
    if (!target || reverting) return;
    if (busy) await stopAgent({ forRevert: true });
    const reverted = await revertMessage(target, {
      keepMessage: false,
      successMessage: "Message and following changes reverted",
    });
    if (reverted) {
      setInput(target.content);
      setReferences(target.references ?? []);
      setReferenceText(target.referenceText ?? "");
      setRestoredAttachments(target.attachments ?? []);
      setRevertTarget(null);
    }
  }

  function startEditing(message: Msg) {
    if (
      busy ||
      reverting ||
      !activeChatId ||
      message.id.startsWith("u-") ||
      message.id.startsWith("a-")
    ) {
      return;
    }
    setEditingMessageId(message.id);
    setEditValue(message.content);
  }

  function cancelEditing() {
    if (reverting) return;
    setEditingMessageId(null);
    setEditValue("");
  }

  async function submitEdit(message: Msg) {
    const text = editValue.trim();
    if (!text || busy || reverting) return;
    const reverted = await revertMessage(message, {
      keepMessage: false,
      successMessage: null,
      forEdit: true,
    });
    if (!reverted) return;
    setEditingMessageId(null);
    setEditValue("");
    await send(
      undefined,
      text,
      [],
      false,
      message.referenceText,
      message.references,
      undefined,
      undefined,
      message.attachments,
    );
  }

  async function retryMessage(message: Msg) {
    if (reverting || !activeChatId || !message.content.trim()) return;
    if (busy) await stopAgent({ forRevert: true });
    const text = message.content.trim();
    const reverted = await revertMessage(message, {
      keepMessage: false,
      successMessage: null,
    });
    if (!reverted) return;
    queueDrainBlockedRef.current = false;
    await send(
      undefined,
      text,
      [],
      true,
      message.referenceText,
      message.references,
      undefined,
      undefined,
      message.attachments,
    );
  }

  function addPendingFiles(files: FileList | File[]) {
    const list = Array.from(files).filter((f) => f.size > 0);
    if (!list.length) return;

    setPendingFiles((prev) => {
      const room = MAX_PENDING_FILES - prev.length;
      if (room <= 0) {
        toast.error(`Max ${MAX_PENDING_FILES} files`);
        return prev;
      }
      if (list.length > room) {
        toast.error(`Max ${MAX_PENDING_FILES} files`);
      }
      const next = list.slice(0, room).map((file) => {
        return {
          id: `pf-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
          file,
          previewUrl: URL.createObjectURL(file),
        };
      });
      return [...prev, ...next];
    });
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function removePendingFile(id: string) {
    setPendingFiles((prev) => {
      const target = prev.find((p) => p.id === id);
      if (target?.previewUrl) URL.revokeObjectURL(target.previewUrl);
      return prev.filter((p) => p.id !== id);
    });
  }

  function onComposerPaste(e: ClipboardEvent<HTMLDivElement>) {
    const items = e.clipboardData?.items;
    if (!items) return;
    const imageFiles: File[] = [];
    for (const item of Array.from(items)) {
      if (item.kind === "file" && item.type.startsWith("image/")) {
        const file = item.getAsFile();
        if (file && file.size > 0) imageFiles.push(file);
      }
    }
    if (!imageFiles.length) return;
    e.preventDefault();
    addPendingFiles(imageFiles);
  }

  function onComposerDragOver(e: DragEvent<HTMLFormElement>) {
    e.preventDefault();
    e.stopPropagation();
    if (busy) return;
    setDragOver(true);
  }

  function onComposerDragLeave(e: DragEvent<HTMLFormElement>) {
    e.preventDefault();
    e.stopPropagation();
    const related = e.relatedTarget as Node | null;
    if (related && e.currentTarget.contains(related)) return;
    setDragOver(false);
  }

  function onComposerDrop(e: DragEvent<HTMLFormElement>) {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
    if (busy) return;
    if (e.dataTransfer?.files?.length) {
      addPendingFiles(e.dataTransfer.files);
    }
  }

  async function submitQuestionAnswers() {
    if (!pendingQuestion || answeringQuestion) return;
    const answers = questionAnswers.map((answer, index) =>
      questionCustomActive[index] ? questionCustom[index] || "" : answer,
    );
    if (answers.some((answer) => !answer.trim())) {
      toast.error("Please answer every question");
      return;
    }
    setAnsweringQuestion(true);
    try {
      const res = await fetch("/api/chat/answer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          questionId: pendingQuestion.questionId,
          answers,
        }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      setPendingQuestion(null);
      if (activeChatIdRef.current) {
        setAttentionChatIds((current) =>
          current.filter((id) => id !== activeChatIdRef.current),
        );
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Answer failed");
    } finally {
      setAnsweringQuestion(false);
    }
  }

  function queueCurrentMessage(text: string, files: PendingFile[]) {
    setQueuedMessages((current) => [
      ...current,
      {
        id: `q-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        text,
        files,
        ...(referenceText.trim() ? { referenceText: referenceText.trim() } : {}),
        ...(references.length ? { references: [...references] } : {}),
        ...(restoredAttachments.length ? { storedAttachments: [...restoredAttachments] } : {}),
      },
    ]);
    setInput("");
    setReferenceText("");
    setReferences([]);
    setPendingFiles([]);
    setRestoredAttachments([]);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function sendQueuedMessage(message: QueuedMessage) {
    if (queuedSendRef.current.has(message.id)) return;
    queuedSendRef.current.add(message.id);
    queueDrainBlockedRef.current = true;
    const activeId = activeChatIdRef.current;
    if (activeId) runtimeRef.current.get(activeId)?.abortController.abort();
    if (activeId) clearChatRunning(activeId);
    setBusy(false);
    setLiveStatus("");
    window.setTimeout(() => {
      void send(
        undefined,
        message.text,
        message.files,
        true,
        message.referenceText,
        message.references,
        message.id,
        () => setQueuedMessages((current) => current.filter((item) => item.id !== message.id)),
        message.storedAttachments,
      )
        .finally(() => {
          queuedSendRef.current.delete(message.id);
          queueDrainBlockedRef.current = false;
        });
    }, 0);
  }

  function editQueuedMessage(message: QueuedMessage) {
    setQueuedMessages((current) => current.filter((item) => item.id !== message.id));
    setInput(message.text);
    setReferenceText(message.referenceText ?? "");
    setReferences(message.references ?? []);
    setPendingFiles(message.files);
    setRestoredAttachments(message.storedAttachments ?? []);
    if (fileInputRef.current) fileInputRef.current.value = "";
    window.setTimeout(() => textareaRef.current?.focus(), 0);
  }

  function moveQueuedMessage(messageId: string, direction: -1 | 1) {
    setQueuedMessages((current) => {
      const index = current.findIndex((item) => item.id === messageId);
      const target = index + direction;
      if (index < 0 || target < 0 || target >= current.length) return current;
      const next = [...current];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }

  function dropQueuedMessage(targetId: string) {
    if (!draggedQueueId || draggedQueueId === targetId) return;
    setQueuedMessages((current) => {
      const from = current.findIndex((item) => item.id === draggedQueueId);
      const to = current.findIndex((item) => item.id === targetId);
      if (from < 0 || to < 0) return current;
      const next = [...current];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return next;
    });
  }

  async function stopAgent(options: { forRevert?: boolean } = {}) {
    const activeId = activeChatIdRef.current;
    if (options.forRevert) queueDrainBlockedRef.current = true;
    else queueDrainBlockedRef.current = false;
    if (activeId) runtimeRef.current.get(activeId)?.abortController.abort();
    if (activeId) clearChatRunning(activeId);
    if (activeId) {
      await fetch("/api/chat/cancel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chatId: activeId }),
      }).catch(() => undefined);
    }
    setBusy(false);
    setLiveStatus("");
  }

  function buildPlan(plan: { title: string; content: string }) {
    if (busy) return;
    setWorkspaceOpen(false);
    void send(
      undefined,
      `Build the plan "${plan.title}". Follow the plan referenced below and implement it.`,
      [],
      true,
      plan.content,
    );
  }

  async function cancelSubagent() {
    const chatId = activeChatIdRef.current;
    if (!chatId || cancellingSubagent) return;
    setCancellingSubagent(true);
    try {
      const response = await fetch("/api/chat/cancel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chatId }),
      });
      const data = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
      runtimeRef.current.get(chatId)?.abortController.abort();
      clearChatRunning(chatId);
      setBusy(false);
      setActiveSubagent((current) => current ? { ...current, status: "cancelled" } : current);
      setMessages((messages) =>
        messages.map((message) => ({
          ...message,
          parts: (message.parts ?? partsFromFlat(message)).map((part) =>
            part.type === "tool" && part.status === "running"
              ? { ...part, status: "cancelled" }
              : part,
          ),
        })).map((message) => ({ ...message, ...withSyncedFlat(message.parts ?? []) })),
      );
      setLiveStatus("Agent cancelled");
      toast.info("Agent cancelled");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not cancel agent");
    } finally {
      setCancellingSubagent(false);
    }
  }

  async function send(
    e?: FormEvent | KeyboardEvent,
    textOverride?: string,
    attachmentsOverride?: PendingFile[],
    force = false,
    referenceTextOverride?: string,
    referencesOverride?: ReferenceItem[],
    messageIdOverride?: string,
    onAccepted?: () => void,
    storedAttachmentsOverride?: MsgAttachment[],
  ) {
    e?.preventDefault();
    const text = (textOverride ?? input).trim();
    const filesToSend = attachmentsOverride ?? pendingFiles;
    const referencesToSend = referencesOverride ?? references;
    const storedAttachmentsToSend = storedAttachmentsOverride ?? restoredAttachments;
    const isOverride = textOverride !== undefined;
    const hasComposerContent =
      Boolean(text) ||
      filesToSend.length > 0 ||
      storedAttachmentsToSend.length > 0 ||
      referencesToSend.length > 0 ||
      Boolean((referenceTextOverride ?? referenceText).trim());
    if (
      (pendingQuestionIdRef.current && !isOverride) ||
      (!hasComposerContent) ||
      (busy && force === false && !isOverride)
    ) {
      if (busy && !isOverride && hasComposerContent) {
        queueCurrentMessage(text, filesToSend);
      }
      return;
    }
    if (!modelId.trim()) {
      toast.error("Select a model first");
      return;
    }

    const chatId = await ensureChatId();
    if (!chatId) {
      toast.error("Could not create chat");
      return;
    }

    if (!isOverride) {
      setInput("");
      draftInputRef.current = "";
      void fetch("/api/preferences", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ draftInput: "" }),
      });
      setReferenceText("");
      setReferences([]);
      setPendingFiles([]);
      setRestoredAttachments([]);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
    if (!force) queueDrainBlockedRef.current = false;
    setBusy(true);
    setLiveStatus("");

    const localAttachments: MsgAttachment[] = [
      ...storedAttachmentsToSend,
      ...filesToSend.map((p) => ({
      id: p.id,
      name: p.file.name,
      mimeType: p.file.type || "application/octet-stream",
        kind: (p.file.type.startsWith("image/") ? "image" : "file") as "image" | "file",
      size: p.file.size,
      previewUrl: p.previewUrl,
      })),
    ];

    const localCreatedAt = new Date().toISOString();
    const userMsg: Msg = {
      id: messageIdOverride || `u-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      role: "user",
      createdAt: localCreatedAt,
      content:
        text ||
        (localAttachments.length
          ? `Attached ${localAttachments.length} file${localAttachments.length === 1 ? "" : "s"}`
          : ""),
      ...((referenceTextOverride ?? referenceText).trim()
        ? { referenceText: (referenceTextOverride ?? referenceText).trim() }
        : {}),
      ...(localAttachments.length ? { attachments: localAttachments } : {}),
      ...(referencesToSend.length ? { references: [...referencesToSend] } : {}),
    };
    let asstId = `a-${Date.now()}`;
    setMessages((m) => [
      ...m,
      userMsg,
      { id: asstId, role: "assistant", content: "", createdAt: localCreatedAt, parts: [], streaming: true },
    ]);

    if (!chatTitle || chatTitle === "New chat") {
      const autoSource =
        text ||
        (localAttachments.length
          ? `Attached ${localAttachments.length} file${localAttachments.length === 1 ? "" : "s"}`
          : "New chat");
      const auto =
        autoSource.length > 48 ? `${autoSource.slice(0, 48)}…` : autoSource;
      setChatTitle(auto);
    }

    const ac = new AbortController();
    const generation = crypto.randomUUID();
    markChatRunning(chatId, {
      abortController: ac,
      assistantMessageId: asstId,
      generation,
    });

    try {
      let attachmentsPayload:
        | Array<{ name: string; mimeType: string; data: string }>
        | undefined;
      if (filesToSend.length) {
        attachmentsPayload = await Promise.all(
          filesToSend.map(async (p) => ({
            name: p.file.name,
            mimeType: p.file.type || "application/octet-stream",
            data: await fileToBase64(p.file),
          })),
        );
      }

      let res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chatId,
          messageId: userMsg.id,
          message: text,
          referenceText: (referenceTextOverride ?? referenceText) || undefined,
          references: referencesToSend.length ? referencesToSend : undefined,
          agentId: agentId || undefined,
          modelId,
          modelParams,
          ...(attachmentsPayload?.length
            ? { attachments: attachmentsPayload }
            : {}),
          ...(storedAttachmentsToSend.length
            ? { storedAttachments: storedAttachmentsToSend }
            : {}),
        }),
        signal: ac.signal,
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        const msg =
          (err as { error?: string }).error || `HTTP ${res.status}`;
        setMessages((m) =>
          m.map((x) =>
            x.id === asstId
              ? { ...x, content: "", errorMessage: msg, streaming: false }
              : x,
          ),
        );
        if (activeChatIdRef.current === chatId) setBusy(false);
        return;
      }

      if (res.status !== 202) onAccepted?.();
      if (res.status === 202) {
        const queued = (await res.json().catch(() => ({}))) as { jobId?: string };
        onAccepted?.();
        if (!queued.jobId) throw new Error("The server did not return a job id");
        res = await fetch(
          `/api/runs?chatId=${encodeURIComponent(chatId)}&jobId=${encodeURIComponent(queued.jobId)}&events=1&stream=1`,
          { cache: "no-store", signal: ac.signal },
        );
        if (!res.ok) throw new Error(`Stream connection failed (HTTP ${res.status})`);
      }

      const reader = res.body?.getReader();
      if (!reader) throw new Error("No response body");
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split("\n\n");
        buffer = parts.pop() || "";

        for (const part of parts) {
          const lines = part.split("\n");
          let event = "message";
          let data = "";
          for (const line of lines) {
            if (line.startsWith("event:")) event = line.slice(6).trim();
            if (line.startsWith("data:")) data += line.slice(5).trim();
          }
          if (!data) continue;
          let payload: Record<string, unknown> = {};
          try {
            payload = JSON.parse(data) as Record<string, unknown>;
          } catch {
            continue;
          }
          if (runtimeRef.current.get(chatId)?.generation !== generation) continue;

          if (
            chatId !== activeChatIdRef.current ||
            (typeof document !== "undefined" && document.hidden)
          ) {
            markUnread(chatId);
          }

          if (event === "assistantId" && typeof payload.messageId === "string") {
            const serverMessageId = payload.messageId;
            setMessages((messages) =>
              messages.map((message) =>
                message.id === asstId
                  ? { ...message, id: serverMessageId }
                  : message,
              ),
            );
            asstId = serverMessageId;
          } else if (event === "text" && typeof payload.text === "string") {
            const chunk = payload.text;
            setMessages((m) =>
              m.map((x) => {
                if (x.id !== asstId) return x;
                const parts = [...(x.parts ?? partsFromFlat(x))];
                // Collapse thinking on first text delta
                for (let i = 0; i < parts.length; i++) {
                  const p = parts[i];
                  if (p.type === "thinking" && !p.done) {
                    parts[i] = { ...p, done: true };
                  }
                }
                const last = parts[parts.length - 1];
                if (last?.type === "text") {
                  parts[parts.length - 1] = {
                    type: "text",
                    content: last.content + chunk,
                  };
                } else {
                  parts.push({ type: "text", content: chunk });
                }
                return {
                  ...x,
                  ...withSyncedFlat(parts, { thinkingDone: true }),
                };
              }),
            );
          } else if (
            event === "suggestions" &&
            Array.isArray(payload.suggestions)
          ) {
            const nextSuggestions = normalizeSuggestions(payload.suggestions);
            setMessages((m) =>
              m.map((x) =>
                x.id === asstId
                  ? { ...x, suggestions: nextSuggestions }
                  : x,
              ),
            );
          } else if (event === "text-reset") {
            // Uncensored refusal-retry: drop any streamed text so the retried
            // answer replaces the refused response instead of appending to it.
            setMessages((m) =>
              m.map((x) => {
                if (x.id !== asstId) return x;
                const parts = [...(x.parts ?? partsFromFlat(x))].filter(
                  (p) => p.type !== "text",
                );
                return {
                  ...x,
                  ...withSyncedFlat(parts, {}),
                };
              }),
            );
          } else if (event === "thinking") {
            setMessages((m) =>
              m.map((x) => {
                if (x.id !== asstId) return x;
                const parts = [...(x.parts ?? partsFromFlat(x))];
                const done =
                  payload.done === true ? true : undefined;
                const durationMs =
                  typeof payload.durationMs === "number"
                    ? payload.durationMs
                    : undefined;
                let thinkingIdx = -1;
                for (let i = parts.length - 1; i >= 0; i--) {
                  if (parts[i].type === "thinking") {
                    thinkingIdx = i;
                    break;
                  }
                }
                if (typeof payload.text === "string") {
                  if (payload.replace || thinkingIdx < 0) {
                    const prevThinking: ThinkingPart | null =
                      thinkingIdx >= 0 && parts[thinkingIdx].type === "thinking"
                        ? (parts[thinkingIdx] as ThinkingPart)
                        : null;
                    const nextThinking: MsgPart = {
                      type: "thinking",
                      content: payload.text,
                      done: done ?? false,
                      durationMs:
                        durationMs ?? prevThinking?.durationMs,
                    };
                    if (thinkingIdx >= 0) parts[thinkingIdx] = nextThinking;
                    else parts.push(nextThinking);
                  } else {
                    const prev = parts[thinkingIdx];
                    if (prev.type === "thinking") {
                      parts[thinkingIdx] = {
                        ...prev,
                        content: prev.content + payload.text,
                        done: done ?? prev.done,
                        durationMs: durationMs ?? prev.durationMs,
                      };
                    }
                  }
                } else if (thinkingIdx >= 0) {
                  const prev = parts[thinkingIdx];
                  if (prev.type === "thinking") {
                    parts[thinkingIdx] = {
                      ...prev,
                      done: done ?? prev.done,
                      durationMs: durationMs ?? prev.durationMs,
                    };
                  }
                }
                const flat = withSyncedFlat(parts);
                return {
                  ...x,
                  ...flat,
                  thinkingDone:
                    payload.done === true ? true : x.thinkingDone,
                };
              }),
            );
          } else if (
            event === "tool" &&
            (typeof payload.callId === "string" || typeof payload.call_id === "string")
          ) {
            const callId =
              typeof payload.callId === "string" ? payload.callId : String(payload.call_id);
            const name =
              typeof payload.name === "string" ? payload.name : "tool";
            const status =
              typeof payload.status === "string"
                ? payload.status
                : "running";
            const detail =
              typeof payload.detail === "string" ? payload.detail : undefined;
            const kind =
              typeof payload.kind === "string" ? payload.kind as ToolPart["kind"] : undefined;
            const path =
              typeof payload.path === "string" ? payload.path : undefined;
            const diff =
              payload.diff && typeof payload.diff === "object"
                ? payload.diff as ToolPart["diff"]
                : undefined;
            const input = typeof payload.input === "string" ? payload.input : undefined;
            const result = typeof payload.result === "string" ? payload.result : undefined;
            const subagent =
              payload.subagent && typeof payload.subagent === "object"
                ? payload.subagent as ToolPart["subagent"]
                : undefined;
            const todos =
              Array.isArray(payload.todos)
                ? payload.todos as ToolPart["todos"]
                : undefined;
            if (activeChatIdRef.current === chatId) {
              setLiveStatus(
                status === "running"
                  ? `Agent running · ${name.replaceAll("_", " ")}${detail ? ` · ${detail}` : ""}`
                  : "",
              );
            }
            setMessages((m) =>
              m.map((x) => {
                if (x.id !== asstId) return x;
                const parts = [...(x.parts ?? partsFromFlat(x))];
                const idx = parts.findIndex(
                  (p) => p.type === "tool" && p.id === callId,
                );
                const prevTool: ToolMsgPart | null =
                  idx >= 0 && parts[idx].type === "tool"
                    ? (parts[idx] as ToolMsgPart)
                    : null;
                const next: MsgPart = {
                  type: "tool",
                  id: callId,
                  name,
                  status,
                  detail: detail ?? prevTool?.detail,
                  kind: kind ?? prevTool?.kind,
                  path: path ?? prevTool?.path,
                  diff: diff ?? prevTool?.diff,
                  input: input ?? prevTool?.input,
                  result: result ?? prevTool?.result,
                  subagent: subagent ?? prevTool?.subagent,
                  todos: todos ?? prevTool?.todos,
                };
                if (idx >= 0) {
                  parts[idx] = prevTool ? { ...prevTool, ...next } : next;
                } else {
                  parts.push(next);
                }
                return { ...x, ...withSyncedFlat(parts) };
              }),
            );
            setActiveSubagent((current) =>
              current?.id === callId
                ? {
                    ...current,
                    name,
                    status,
                    detail: detail ?? current.detail,
                    kind: kind ?? current.kind,
                    path: path ?? current.path,
                    diff: diff ?? current.diff,
                    input: input ?? current.input,
                    result: result ?? current.result,
                    subagent: subagent ?? current.subagent,
                  }
                : current,
            );
          } else if (
            event === "question" &&
            typeof payload.questionId === "string" &&
            Array.isArray(payload.questions)
          ) {
            const questions = payload.questions
              .map((item) => {
                if (!item || typeof item !== "object") return null;
                const value = item as {
                  id?: unknown;
                  question?: unknown;
                  multiple?: unknown;
                  options?: unknown;
                };
                if (typeof value.question !== "string") return null;
                const options = Array.isArray(value.options)
                  ? value.options
                      .map((option) => {
                        if (!option || typeof option !== "object") return null;
                        const candidate = option as { label?: unknown; value?: unknown };
                        if (typeof candidate.label !== "string") return null;
                        return {
                          label: candidate.label,
                          ...(typeof candidate.value === "string"
                            ? { value: candidate.value }
                            : {}),
                        };
                      })
                      .filter((option): option is { label: string; value?: string } => Boolean(option))
                  : undefined;
                return {
                  id:
                    typeof value.id === "string"
                      ? value.id
                      : `question-${Math.random().toString(36).slice(2)}`,
                  question: value.question,
                  ...(value.multiple === true ? { multiple: true } : {}),
                  ...(options?.length ? { options } : {}),
                };
              })
              .filter((question): question is AgentQuestion => Boolean(question));
            if (questions.length > 0) {
              const isSameQuestion = pendingQuestionIdRef.current === payload.questionId;
              if (activeChatIdRef.current === chatId) {
                pendingQuestionIdRef.current = payload.questionId;
              }
              setAttentionChatIds((current) => current.includes(chatId) ? current : [...current, chatId]);
              notifiedQuestionRef.current = payload.questionId;
              if (activeChatIdRef.current === chatId) {
                setPendingQuestion({
                  questionId: payload.questionId,
                  questions,
                });
                if (!isSameQuestion) {
                  setQuestionAnswers(questions.map(() => ""));
                  setQuestionCustom(questions.map(() => ""));
                  setQuestionCustomActive(questions.map(() => false));
                }
                setBusy(true);
              }
              notifyAttention(
                chatId,
                payload.questionId,
                questions.length === 1
                  ? questions[0].question
                  : `${questions.length} questions need your input.`,
              );
            }
          } else if (
            event === "workspace" &&
            payload.workspace &&
            typeof payload.workspace === "object"
          ) {
            if (activeChatIdRef.current !== chatId) continue;
            const workspace = payload.workspace as WorkspaceItem;
            setAttentionChatIds((current) => current.includes(chatId) ? current : [...current, chatId]);
            setWorkspaces((current) => mergeWorkspaceItems(current, workspace));
            const keepCanvasVisible =
              workspace.type === "plan" && workspaceOpen && workspaceTab === "canvas";
            if (!keepCanvasVisible) {
              setActiveWorkspaceId(workspace.id);
              setWorkspaceTab(workspace.type === "plan" ? "plan" : "canvas");
              setWorkspaceOpen(true);
            }
            if (workspace.type === "plan" && notifiedPlanRef.current !== workspace.id) {
              notifiedPlanRef.current = workspace.id;
              const preview = workspace.content.replace(/\s+/g, " ").trim();
              toast.success("Plan ready", {
                description: `${workspace.name}: ${preview.slice(0, 140)}${preview.length > 140 ? "…" : ""}`,
              });
              notifyUser("Plan ready", `${workspace.name} is ready to review.`, chatId);
            }
          } else if (event === "canvas" && typeof payload.canvas === "string") {
            if (activeChatIdRef.current !== chatId) continue;
            setAttentionChatIds((current) => current.includes(chatId) ? current : [...current, chatId]);
            const now = new Date().toISOString();
            const workspace: WorkspaceItem = {
              id: "canvas-default",
              type: "canvas",
              name: "Canvas",
              content: payload.canvas.slice(0, 100_000),
              createdAt: now,
              updatedAt: now,
            };
            setWorkspaces((current) => mergeWorkspaceItems(current, workspace));
            setActiveWorkspaceId(workspace.id);
            setWorkspaceOpen(true);
          } else if (
            event === "agentId" &&
            typeof payload.agentId === "string"
          ) {
            if (activeChatIdRef.current === chatId) setAgentId(payload.agentId);
          } else if (event === "status") {
            const rawStatus = typeof payload.status === "string" ? payload.status : "";
            const statusLabel = rawStatus.toLowerCase() === "running"
              ? "Agent running"
              : rawStatus;
            const label = [statusLabel, typeof payload.message === "string" ? payload.message : ""]
              .filter(Boolean)
              .join(" · ");
            if (activeChatIdRef.current === chatId) setLiveStatus(label);
          } else if (
            event === "error" &&
            typeof payload.message === "string"
          ) {
            const errMsg = payload.message;
            notifyUser("Agent error", errMsg);
            setMessages((m) =>
              m.map((x) => {
                if (x.id !== asstId) return x;
                const parts = [...(x.parts ?? partsFromFlat(x))].map((p) =>
                  p.type === "thinking" ? { ...p, done: true } : p,
                );
                return {
                  ...x,
                  ...withSyncedFlat(parts, {
                    thinkingDone: true,
                    streaming: false,
                    errorMessage: errMsg,
                  }),
                };
              }),
            );
          } else if (event === "done") {
            playFinishSound();
            if (typeof document !== "undefined" && document.hidden) {
              markUnread(chatId);
            } else if (activeChatIdRef.current === chatId) {
              clearUnread(chatId);
            }
            notifyUser("Agent finished", "Your response is ready.");
            if (activeChatIdRef.current === chatId) {
              pendingQuestionIdRef.current = null;
              setPendingQuestion(null);
              setAttentionChatIds((current) => current.filter((id) => id !== chatId));
              setQuestionAnswers([]);
              setQuestionCustom([]);
              setQuestionCustomActive([]);
            }
            if (activeChatIdRef.current === chatId && typeof payload.title === "string") {
              setChatTitle(payload.title);
            }
            setMessages((m) =>
              m.map((x) => {
                if (x.id !== asstId) return x;
                const parts = [...(x.parts ?? partsFromFlat(x))].map((p) =>
                  p.type === "thinking" ? { ...p, done: true } : p,
                );
                return {
                  ...x,
                  ...withSyncedFlat(parts, {
                    thinkingDone: true,
                    streaming: false,
                  }),
                };
              }),
            );
            if (activeChatIdRef.current === chatId) setLiveStatus("");
            void loadChats();
            void loadMemories();
          }
        }
      }
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        const msg = err instanceof Error ? err.message : "Request failed";
        setMessages((m) =>
          m.map((x) =>
            x.id === asstId
              ? {
                  ...x,
                  errorMessage: msg,
                  thinkingDone: true,
                  streaming: false,
                }
              : x,
          ),
        );
      }
    } finally {
      setMessages((m) =>
        m.map((x) => {
          if (x.id !== asstId) return x;
          const parts = [...(x.parts ?? partsFromFlat(x))].map((p) =>
            p.type === "thinking" ? { ...p, done: true } : p,
          );
          return {
            ...x,
            ...withSyncedFlat(parts, {
              thinkingDone: true,
              streaming: false,
            }),
          };
        }),
      );
      if (runtimeRef.current.get(chatId)?.generation === generation) {
        clearChatRunning(chatId);
      }
      if (activeChatIdRef.current === chatId && !pendingQuestionIdRef.current) {
        setBusy(false);
        setLiveStatus("");
      }
      void loadChats();
    }
  }

  useEffect(() => {
    if (
      busy ||
      pendingQuestion ||
      queueDrainBlockedRef.current ||
      !queuedMessages.length ||
      queueDrainRef.current
    ) {
      return;
    }
    const next = queuedMessages[0];
    if (!next) return;
    if (queuedSendRef.current.has(next.id)) return;
    queuedSendRef.current.add(next.id);
    queueDrainRef.current = true;
    void send(
      undefined,
      next.text,
      next.files,
      true,
      undefined,
      next.references,
      next.id,
      () => setQueuedMessages((current) => current.filter((item) => item.id !== next.id)),
    ).finally(() => {
      queuedSendRef.current.delete(next.id);
      queueDrainRef.current = false;
    });
  }, [busy, pendingQuestion, queuedMessages]);

  const normalizedModelSearch = modelSearch.trim().toLowerCase();
  const availableProviderIds = new Set([
    ...models.map((model) => model.providerId || "cursor"),
    ...configuredModelProviders.map((provider) => provider.providerKey),
  ]);
  const availableProviders = [...availableProviderIds].map((providerId) => {
    const model = models.find((entry) => (entry.providerId || "cursor") === providerId);
    const configured = configuredModelProviders.find((provider) => provider.providerKey === providerId);
    return {
      value: providerId,
      label: model?.providerName || configured?.label || (providerId === "codex" ? "Codex" : providerId),
      connectionId: model?.connectionId || configured?.id,
    };
  });
  const selectedKey = parseModelKey(modelId);
  const selectedProvider = availableProviders.find((provider) => provider.value === selectedKey.providerKey);
  const selectedModel =
    models.find((m) => m.id === modelId) ||
    ({
      id: modelId,
      displayName: selectedKey.modelId || modelId || "Select a model",
      providerId: selectedKey.providerKey,
      providerName: selectedProvider?.label,
    } satisfies ModelInfo);
  const selectedAttrs = modelAttrSummary(selectedModel, modelParams);
  const providerQueryMatch = normalizedModelSearch.match(/^([a-z0-9_-]+):(.*)$/);
  const providerQuery = providerQueryMatch &&
    availableProviders.some((provider) => provider.value === providerQueryMatch[1])
    ? providerQueryMatch[1]
    : null;
  const effectiveProviderFilter = providerQuery || modelProviderFilter;
  const modelSearchTerm = providerQuery
    ? providerQueryMatch?.[2].trim() || ""
    : normalizedModelSearch;
  const providerModels = effectiveProviderFilter === "all"
    ? models
    : models.filter((model) => (model.providerId || "cursor") === effectiveProviderFilter);
  const matchingModels = providerModels.filter((model) =>
    `${model.displayName} ${model.id} ${model.description || ""} ${model.providerName || ""}`
      .toLowerCase()
      .includes(modelSearchTerm),
  );
  const customPinnedEntries = favoriteModelKeys
    .filter((key) => !models.some((model) => model.id === key))
    .map((key) => {
      const parsed = parseModelKey(key);
      const provider = availableProviders.find((entry) => entry.value === parsed.providerKey);
      return {
        id: key,
        displayName: parsed.modelId,
        providerId: parsed.providerKey,
        providerName: provider?.label || parsed.providerKey,
        connectionId: parsed.connectionId,
        source: "discovered" as const,
      } satisfies ModelInfo;
    })
    .filter((model) =>
      (effectiveProviderFilter === "all" || model.providerId === effectiveProviderFilter) &&
      `${model.displayName} ${model.id} ${model.providerName || ""}`
        .toLowerCase()
        .includes(modelSearchTerm),
    );
  const favoriteEntries = effectiveProviderFilter === "all"
    ? [
        ...matchingModels.filter((model) => favoriteModelKeys.includes(model.id)),
        ...customPinnedEntries,
      ]
    : [];
  const featuredIds = new Set(favoriteEntries.map((entry) => entry.id));
  const groupedModels = new Map<string, { label: string; models: ModelInfo[] }>();
  if (!modelSearchTerm || effectiveProviderFilter !== "all") {
    for (const provider of availableProviders) {
      if (effectiveProviderFilter !== "all" && provider.value !== effectiveProviderFilter) continue;
      groupedModels.set(provider.value, { label: provider.label, models: [] });
    }
  }
  for (const model of matchingModels.filter((entry) => !featuredIds.has(entry.id))) {
    const providerId = model.providerId || "cursor";
    const group = groupedModels.get(providerId);
    if (group) {
      group.models.push(model);
    } else {
      groupedModels.set(providerId, {
        label: model.providerName || providerId,
        models: [model],
      });
    }
  }

  function useCustomModel(providerId: string, connectionId?: string) {
    const customId = customModelInputs[providerId]?.trim();
    if (!customId) return;
    const nextId = modelKey(providerId, customId, connectionId);
    void selectModel(nextId);
    setModelSearch("");
    setModelMenuOpen(false);
  }

  function renderModelOption(model: ModelInfo) {
    const favorite = favoriteModelKeys.includes(model.id);
    return (
      <DropdownMenuItem
        key={model.id}
        onClick={() => {
          void selectModel(model.id);
          setModelSearch("");
        }}
        className="flex items-center gap-2"
      >
        <Check
          className={cn(
            "size-3.5 shrink-0",
            model.id === modelId ? "opacity-100" : "opacity-0",
          )}
        />
        <ProviderLogo providerId={model.providerId} />
        <span className="min-w-0 flex-1 truncate">
          {modelDisplayName(model)}
          {model.providerName ? (
            <span className="ml-1 text-[10px] text-muted-foreground">
              · {model.providerName}
            </span>
          ) : null}
        </span>
        <button
          type="button"
          className="shrink-0 rounded p-1 text-muted-foreground hover:text-foreground"
          aria-label={favorite ? `Unpin ${model.displayName}` : `Pin ${model.displayName}`}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            toggleFavoriteModel(model.id);
          }}
        >
          <Pin className={cn("size-3", favorite ? "fill-current text-primary" : "")} />
        </button>
      </DropdownMenuItem>
    );
  }

  const canSend = Boolean(input.trim() || pendingFiles.length);
  const hasConnectedProvider = Boolean(
    status?.cursorSdkConfigured ||
    status?.providers?.some((provider) => provider.enabled && provider.hasSecret),
  );
  const providerSetupRequired = modelsLoaded && status !== null && !hasConnectedProvider;

  function handleComposerInputChange(value: string, cursorPosition: number) {
    const previousValue = previousComposerInputRef.current;
    previousComposerInputRef.current = value;
    setInput(value);
    if (referenceAutocompleteDismissedRef.current) {
      const addedAtMention =
        (value.match(/@/g) || []).length > (previousValue.match(/@/g) || []).length ||
        (value.endsWith("@") && !previousValue.endsWith("@"));
      if (!addedAtMention) {
        setReferenceMenu(null);
        return;
      }
      referenceAutocompleteDismissedRef.current = false;
    }
    const beforeCursor = value.slice(0, cursorPosition);
    const match = beforeCursor.match(/(?:^|\s)@([^\n]*)$/);
    if (!match) {
      setReferenceMenu(null);
      return;
    }
    const start = beforeCursor.length - match[0].length + (match[0].startsWith("@") ? 0 : 1);
    setReferenceMenu({
      query: match[1],
      kind: null,
      start,
      end: cursorPosition,
    });
  }

  async function selectReference(reference: ReferenceItem) {
    if (!referenceMenu) return;
    let resolvedReference = reference;
    if (reference.kind === "terminal" && reference.sessionId && !reference.content) {
      try {
        const response = await fetch(
          `/api/remote?sessionId=${encodeURIComponent(reference.sessionId)}&cursor=0`,
          { cache: "no-store" },
        );
        if (response.ok) {
          const data = (await response.json()) as {
            chunks?: Array<{ data?: string }>;
          };
          resolvedReference = {
            ...reference,
            content: (data.chunks || [])
              .map((chunk) => chunk.data || "")
              .join("")
              .slice(-30_000),
          };
        }
      } catch {
        // Keep the terminal reference usable even if its live output is unavailable.
      }
    }
    setReferences((current) => (
      current.some((item) => item.kind === resolvedReference.kind && item.id === resolvedReference.id)
        ? current
        : [...current, resolvedReference]
    ));
    const start = referenceMenu.start;
    const end = referenceMenu.end;
    const completedTag = `@${resolvedReference.label}`;
    let caretPosition = start + completedTag.length;
    setInput((current) => {
      const next = `${current.slice(0, start)}${completedTag}${current.slice(end)}`;
      caretPosition = start + completedTag.length;
      return next;
    });
    referenceAutocompleteDismissedRef.current = false;
    setReferenceMenu(null);
    window.requestAnimationFrame(() => {
      const element = textareaRef.current;
      if (!element) return;
      element.focus();
      const selection = window.getSelection();
      if (!selection) return;
      const range = document.createRange();
      let remaining = caretPosition;
      const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
      let node: Node | null;
      while ((node = walker.nextNode())) {
        const length = node.textContent?.length || 0;
        if (remaining <= length) {
          range.setStart(node, remaining);
          range.collapse(true);
          selection.removeAllRanges();
          selection.addRange(range);
          return;
        }
        remaining -= length;
      }
      range.selectNodeContents(element);
      range.collapse(false);
      selection.removeAllRanges();
      selection.addRange(range);
    });
  }

  function removeReference(reference: ReferenceItem) {
    setReferences((current) => current.filter(
      (item) => !(item.kind === reference.kind && item.id === reference.id),
    ));
    setInput((current) => current.replace(`@${reference.label}`, "").replace(/[ \t]{2,}/g, " "));
  }

  function duplicateWorkspace(workspace: WorkspaceItem) {
    const timestamp = new Date().toISOString();
    const baseName = workspace.name.replace(/\s+\(\d+\)$/, "");
    const names = new Set(workspaces.map((item) => item.name.toLocaleLowerCase()));
    let copyName = `${baseName} copy`;
    let suffix = 2;
    while (names.has(copyName.toLocaleLowerCase())) copyName = `${baseName} copy ${suffix++}`;
    const copy = { ...workspace, id: crypto.randomUUID(), name: copyName, createdAt: timestamp, updatedAt: timestamp };
    setWorkspaces((current) => [...current, copy].slice(-20));
    setActiveWorkspaceId(copy.id);
    setWorkspaceTab(copy.type);
  }

  function deleteWorkspace(workspace: WorkspaceItem) {
    const remaining = workspaces.filter((item) => item.id !== workspace.id);
    setWorkspaces(remaining);
    setActiveWorkspaceId(remaining.find((item) => item.type === workspace.type)?.id ?? null);
  }

  function focusWorkspaceTitle(workspace: WorkspaceItem) {
    setActiveWorkspaceId(workspace.id);
    setWorkspaceTab(workspace.type);
    window.setTimeout(() => {
      document.querySelector<HTMLInputElement>(`[aria-label="${workspace.type === "plan" ? "Plan" : "Canvas"} title"]`)?.focus();
    }, 0);
  }

  function referenceLabel(kind: ReferenceKind) {
    return {
      file: "Files",
      canvas: "Canvases",
      plan: "Plans",
      browser: "Browser",
      memory: "Memories",
      chat: "Chats",
      terminal: "Terminals",
    }[kind];
  }

  function referenceIcon(kind: ReferenceKind): LucideIcon {
    return {
      file: FileIcon,
      canvas: Palette,
      plan: ClipboardList,
      browser: Globe2,
      memory: Brain,
      chat: MessageSquare,
      terminal: Terminal,
    }[kind];
  }

  const queuedList = queuedMessages.length > 0 ? (
    <div className="space-y-1.5 px-1">
      {queuedMessages.map((message, index) => (
        <div
          key={message.id}
          onDragOver={(event) => {
            event.preventDefault();
            if (draggedQueueId !== message.id) setDragOverQueueId(message.id);
          }}
          onDrop={(event) => {
            event.preventDefault();
            dropQueuedMessage(message.id);
            setDraggedQueueId(null);
            setDragOverQueueId(null);
          }}
          className={cn(
            "flex items-center gap-2 rounded-lg border bg-muted/20 px-2.5 py-2 text-xs transition-colors",
            dragOverQueueId === message.id ? "border-primary/70 bg-primary/10" : "border-border/40",
            draggedQueueId === message.id && "opacity-50",
          )}
        >
          <span
            draggable
            role="button"
            tabIndex={0}
            aria-label={`Reorder queued message ${index + 1}`}
            title="Drag to reorder"
            onDragStart={(event) => {
              event.dataTransfer.effectAllowed = "move";
              event.dataTransfer.setData("text/plain", message.id);
              setDraggedQueueId(message.id);
            }}
            onDragEnd={() => {
              setDraggedQueueId(null);
              setDragOverQueueId(null);
            }}
            onKeyDown={(event) => {
              if (event.key === "ArrowUp" || event.key === "ArrowDown") {
                event.preventDefault();
                moveQueuedMessage(message.id, event.key === "ArrowUp" ? -1 : 1);
              }
            }}
            className="flex size-6 shrink-0 cursor-grab items-center justify-center rounded text-muted-foreground/70 hover:bg-muted hover:text-foreground active:cursor-grabbing"
          >
            <GripVertical className="size-3.5" aria-hidden="true" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-muted-foreground">
              {index + 1}. {message.text || `Attached ${message.files.length} file${message.files.length === 1 ? "" : "s"}`}
            </p>
            {message.referenceText || message.references?.length || message.storedAttachments?.length ? (
              <div className="mt-1 flex min-w-0 flex-wrap gap-1 text-[10px] text-muted-foreground/80">
                {message.referenceText ? (
                  <span className="max-w-full truncate rounded border border-primary/20 bg-primary/[0.06] px-1.5 py-0.5">
                    Referenced: {message.referenceText}
                  </span>
                ) : null}
                {message.references?.map((reference) => (
                  <span
                    key={`${reference.kind}-${reference.id}`}
                    className="max-w-full truncate rounded border border-border/50 bg-muted/30 px-1.5 py-0.5"
                  >
                    @{reference.label}
                  </span>
                ))}
                {message.storedAttachments?.map((attachment) => (
                  <span
                    key={attachment.id}
                    className="max-w-full truncate rounded border border-border/50 bg-muted/30 px-1.5 py-0.5"
                  >
                    {attachment.name}
                  </span>
                ))}
              </div>
            ) : null}
          </div>
          <Button type="button" size="xs" variant="ghost" className="h-7 shrink-0 px-2 text-xs" onClick={() => sendQueuedMessage(message)}>
            Send now
          </Button>
          <Button type="button" size="icon-xs" variant="ghost" className="size-7 shrink-0" aria-label="Edit queued message" title="Edit queued message" onClick={() => editQueuedMessage(message)}>
            <Pencil className="size-3.5" />
          </Button>
          <Button type="button" size="icon-xs" variant="ghost" className="size-7 shrink-0" aria-label="Remove queued message" onClick={() => setQueuedMessages((current) => current.filter((item) => item.id !== message.id))}>
            <X className="size-3.5" />
          </Button>
        </div>
      ))}
    </div>
  ) : null;

  const composer = providerSetupRequired ? (
    <button
      type="button"
      className="flex w-full items-center justify-between gap-4 rounded-3xl border border-dashed border-primary/40 bg-primary/[0.06] px-5 py-4 text-left shadow-[0_8px_40px_-12px_rgba(0,0,0,0.35)] transition-colors hover:border-primary/70 hover:bg-primary/10"
      onClick={() => setProviderSetupOpen(true)}
    >
      <span className="min-w-0">
        <span className="block text-sm font-medium">First add your provider</span>
        <span className="mt-1 block text-xs text-muted-foreground">
          Choose a provider and connect an API key or OAuth account to start chatting.
        </span>
      </span>
      <KeyRound className="size-5 shrink-0 text-primary" />
    </button>
  ) : (
    <div className="w-full space-y-2">
      {queuedList}
      {referenceText ? (
        <div className="flex items-center gap-2 rounded-xl border border-primary/20 bg-primary/[0.06] px-3 py-2 text-xs">
          <Reply className="size-3.5 shrink-0 text-primary" />
          <span className="min-w-0 flex-1 truncate text-muted-foreground">
            Referenced to: <span className="text-foreground/80">{referenceText}</span>
          </span>
          <Button type="button" size="icon-xs" variant="ghost" className="size-5 shrink-0" aria-label="Remove reference" onClick={() => setReferenceText("")}>
            <X className="size-3" />
          </Button>
        </div>
      ) : null}
      {restoredAttachments.length > 0 ? (
        <div className="flex flex-wrap items-center gap-1.5 px-1" aria-label="Restored attachments">
          {restoredAttachments.map((attachment) => (
            <span
              key={attachment.id}
              className="inline-flex max-w-full items-center gap-1 rounded-md border border-border/60 bg-secondary/60 px-2 py-1 text-xs text-muted-foreground"
            >
              <span className="max-w-48 truncate">{attachment.name}</span>
              <button
                type="button"
                className="rounded-sm p-0.5 hover:bg-muted hover:text-foreground"
                onClick={() => setRestoredAttachments((current) => current.filter((item) => item.id !== attachment.id))}
                aria-label={`Remove ${attachment.name}`}
              >
                <X className="size-3" />
              </button>
            </span>
          ))}
        </div>
      ) : null}
      {references.length > 0 ? (
        <div className="flex flex-wrap gap-1.5 px-1" aria-label="Selected references">
          {references.map((reference) => (
            <button
              key={`${reference.kind}-${reference.id}`}
              type="button"
              className="inline-flex max-w-full items-center gap-1 rounded-full border border-border/60 bg-muted/30 px-2 py-1 text-xs text-muted-foreground hover:bg-muted/60 hover:text-foreground"
              title={reference.detail || reference.label}
              onClick={() => removeReference(reference)}
            >
              <span className="text-primary">@</span>
              <span className="max-w-48 truncate">{reference.label}</span>
              <X className="size-3" />
            </button>
          ))}
        </div>
      ) : null}
      <form
        onSubmit={(e) => void send(e)}
        onDragOver={onComposerDragOver}
        onDragLeave={onComposerDragLeave}
        onDrop={onComposerDrop}
        className={cn(
          "relative flex w-full flex-col gap-2 rounded-3xl border border-border/50 bg-card/80 p-2 shadow-[0_8px_40px_-12px_rgba(0,0,0,0.4)] backdrop-blur-xl transition-colors",
          dragOver && "border-primary/60 bg-primary/5",
        )}
      >
        {referenceMenu ? (
          <div className="absolute bottom-full left-2 right-2 z-40 mb-2 max-h-72 overflow-y-auto rounded-xl border border-border/60 bg-popover p-1.5 text-sm shadow-xl animate-in fade-in-0 slide-in-from-bottom-2 duration-200">
            {!referenceMenu.kind && !referenceMenu.query ? (
              <div className="flex flex-col gap-0.5">
                {(["file", "canvas", "plan", "browser", "terminal", "memory", "chat"] as ReferenceKind[]).map((kind) => (
                  <button
                    key={kind}
                    type="button"
                    aria-label={referenceLabel(kind)}
                    title={referenceLabel(kind)}
                    className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-muted-foreground transition-colors duration-150 hover:bg-muted hover:text-foreground"
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => setReferenceMenu((current) => current ? { ...current, kind } : current)}
                  >
                    {(() => {
                      const Icon = referenceIcon(kind);
                      return (
                        <>
                          <Icon className="size-4" />
                          <span className="text-xs">{referenceLabel(kind)}</span>
                        </>
                      );
                    })()}
                  </button>
                ))}
              </div>
            ) : (
              <>
                <button
                  type="button"
                  aria-label="All categories"
                  title="All categories"
                  className="mb-1 rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => setReferenceMenu((current) => current ? { ...current, kind: null } : current)}
                >
                  <ArrowLeft className="size-4" />
                </button>
                {referenceResults.length > 0 ? (
                  referenceResults.map((reference, index) => (
                    <button
                      key={`${reference.kind}-${reference.id}`}
                      type="button"
                      className={cn(
                        "flex w-full items-start gap-2 rounded-lg px-2.5 py-2 text-left",
                        index === referenceIndex ? "bg-muted" : "hover:bg-muted/60",
                      )}
                      onMouseDown={(event) => event.preventDefault()}
                      onMouseEnter={() => setReferenceIndex(index)}
                      onClick={() => selectReference(reference)}
                    >
                      {(() => {
                        const Icon = referenceIcon(reference.kind);
                        return <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />;
                      })()}
                      <span className="min-w-0">
                        <span className="flex min-w-0 items-center gap-1.5">
                          <span className="min-w-0 truncate text-xs text-foreground">{reference.label}</span>
                          {reference.isCurrentChat ? (
                            <Badge variant="secondary" className="shrink-0 px-1.5 py-0 text-[10px]">
                              In this chat
                            </Badge>
                          ) : null}
                        </span>
                        {reference.detail ? <span className="block truncate text-[11px] text-muted-foreground">{reference.detail}</span> : null}
                      </span>
                    </button>
                  ))
                ) : (
                  <p className="px-2.5 py-4 text-center text-xs text-muted-foreground">No references found.</p>
                )}
              </>
            )}
          </div>
        ) : null}
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept={FILE_ACCEPT}
          className="hidden"
          onChange={(e) => {
            if (e.target.files?.length) addPendingFiles(e.target.files);
          }}
        />
        {pendingFiles.length > 0 ? (
          <div className="flex max-w-full gap-2 overflow-x-auto overscroll-x-contain px-1 pt-1 pb-1">
            {pendingFiles.map((p) => (
              <div
                key={p.id}
                role="button"
                tabIndex={0}
                title={`Open ${p.file.name}`}
                onClick={() => setActiveAttachment({
                  attachment: {
                    id: p.id,
                    name: p.file.name,
                    mimeType: p.file.type || "application/octet-stream",
                    kind: p.file.type.startsWith("image/") ? "image" : "file",
                    size: p.file.size,
                    previewUrl: p.previewUrl,
                  },
                  chatId: activeChatId ?? undefined,
                })}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    event.currentTarget.click();
                  }
                }}
                className="group relative flex w-44 shrink-0 items-center gap-2 rounded-xl border border-border/40 bg-background/50 py-1 pr-1 pl-1 hover:bg-background/80"
              >
                {p.file.type.startsWith("image/") && p.previewUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={p.previewUrl}
                    alt={p.file.name}
                    className="size-9 shrink-0 rounded-lg object-cover"
                  />
                ) : (
                  <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-secondary/80">
                    <AttachmentIcon mimeType={p.file.type} className="size-4 text-muted-foreground" />
                  </div>
                )}
                <span className="min-w-0 flex-1 truncate text-xs text-foreground/90">
                  {p.file.name}
                </span>
                <button
                  type="button"
                  aria-label={`Remove ${p.file.name}`}
                  className="flex size-6 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-secondary hover:text-foreground"
                  onClick={(event) => {
                    event.stopPropagation();
                    removePendingFile(p.id);
                  }}
                >
                  <X className="size-3.5" />
                </button>
              </div>
            ))}
          </div>
        ) : null}
        <div className="flex w-full items-end gap-1">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="Attach files"
            className="size-9 shrink-0 self-end rounded-full"
            onClick={() => fileInputRef.current?.click()}
          >
            <Plus className="size-4" />
          </Button>
          <RichComposerInput
            ref={textareaRef}
            value={input}
            mentionLabels={references.map((reference) => reference.label)}
            onChange={handleComposerInputChange}
            onPaste={onComposerPaste}
            onKeyDown={(e) => {
              if (referenceMenu && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
                e.preventDefault();
                const count = referenceResults.length;
                if (count > 0) {
                  setReferenceIndex((current) => (
                    e.key === "ArrowDown"
                      ? (current + 1) % count
                      : (current - 1 + count) % count
                  ));
                }
                return;
              }
              if (referenceMenu && e.key === "Enter" && referenceResults[referenceIndex]) {
                e.preventDefault();
                selectReference(referenceResults[referenceIndex]);
                return;
              }
              if (referenceMenu && e.key === "Escape") {
                e.preventDefault();
                setReferenceMenu(null);
                referenceAutocompleteDismissedRef.current = true;
                return;
              }
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void send(e);
              }
            }}
            placeholder="Message…"
            className={cn(
              "dark:bg-transparent",
            )}
            aria-label="Message"
          />
          <Button
            type={busy && !canSend ? "button" : "submit"}
            size="icon"
            disabled={!canSend && !busy}
            aria-label={busy && !canSend ? "Stop agent" : busy ? "Queue message" : "Send"}
            className="size-9 shrink-0 self-end rounded-full"
            onClick={busy && !canSend ? () => void stopAgent() : undefined}
          >
            {busy && !canSend ? <Square className="size-3.5 fill-current" /> : <ArrowUp className="size-4" />}
          </Button>
        </div>
      </form>
      <div className="flex min-h-7 items-center px-1">
        {!modelsLoaded ? (
          <div className="flex items-center gap-2 px-2.5 text-xs text-muted-foreground/70" role="status" aria-label="Loading models">
            <Skeleton className="h-6 w-24 rounded-full bg-muted/60" />
            <span>Loading models…</span>
          </div>
        ) : (
          <div className="group/model flex items-center gap-0.5">
            <DropdownMenu open={modelMenuOpen} onOpenChange={setModelMenuOpen}>
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 max-w-[min(100vw-8rem,28rem)] gap-1.5 rounded-full px-2.5 text-xs font-normal hover:text-foreground"
                >
                  {modelId ? <ProviderLogo providerId={selectedModel.providerId} /> : null}
                  <span className="min-w-0 truncate">
                    <span className="text-foreground">
                      {modelDisplayName(selectedModel)}
                    </span>
                    {selectedAttrs ? (
                      <span className="text-muted-foreground">
                        {" "}
                        {selectedAttrs}
                      </span>
                    ) : null}
                  </span>
                  <ChevronDown className="size-3 shrink-0 opacity-60" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="start"
                className="w-72"
              >
                <div className="p-1.5">
                  <Input
                    ref={modelSearchRef}
                    value={modelSearch}
                    onChange={(event) => setModelSearch(event.target.value)}
                    placeholder="Search or provider:model…"
                    aria-label="Search models"
                    className="h-8 text-xs"
                    onKeyDown={(event) => event.stopPropagation()}
                  />
                </div>
                <div className="flex gap-1 overflow-x-auto border-b border-border/60 px-1 pb-1">
                  {[
                    { value: "all", label: "All" },
                    ...availableProviders,
                  ].map((provider) => (
                    <button
                      key={provider.value}
                      type="button"
                      className={cn(
                        "inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-1 text-[11px] transition-colors",
                        effectiveProviderFilter === provider.value
                          ? "bg-primary text-primary-foreground"
                          : "text-muted-foreground hover:bg-muted hover:text-foreground",
                      )}
                      onClick={() => {
                        setModelProviderFilter(provider.value);
                        setModelSearch("");
                      }}
                    >
                      {provider.value === "all" ? null : <ProviderLogo providerId={provider.value} className="size-3" />}
                      {provider.label}
                    </button>
                  ))}
                </div>
                <div className="max-h-60 overflow-y-auto">
                  {favoriteEntries.length ? (
                    <div>
                      <div className="flex items-center gap-1.5 px-2.5 pb-1 pt-2 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                        <Pin className="size-3 fill-current text-primary" aria-hidden="true" />
                        Pinned
                      </div>
                      {favoriteEntries.map(renderModelOption)}
                    </div>
                  ) : null}
                  {[...groupedModels.entries()].map(([providerId, group]) => {
                    const connectionId =
                      group.models.find((model) => model.connectionId)?.connectionId ||
                      availableProviders.find((provider) => provider.value === providerId)?.connectionId;
                    const pinnedCustom = customPinnedEntries.find((model) => model.providerId === providerId);
                    const customValue =
                      customModelInputs[providerId] ||
                      pinnedCustom?.displayName ||
                      (selectedKey.providerKey === providerId && !models.some((model) => model.id === modelId)
                        ? selectedKey.modelId
                        : "");
                    const customKey = customValue.trim()
                      ? modelKey(providerId, customValue.trim(), connectionId)
                      : "";
                    const customPinned = customKey ? favoriteModelKeys.includes(customKey) : false;
                    return (
                      <div key={providerId}>
                        <div className="flex items-center gap-1.5 px-2.5 pb-1 pt-2 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                          <ProviderLogo providerId={providerId} className="size-3" />
                          {group.label}
                        </div>
                        {group.models.map(renderModelOption)}
                        <div className="py-1">
                          <div className="flex items-center gap-1.5 rounded-md px-1.5 py-1">
                            <Check className={cn("size-3.5 shrink-0", modelId === customKey ? "opacity-100" : "opacity-0")} />
                            <ProviderLogo providerId={providerId} className="size-4" />
                            <Input
                              value={customValue}
                              onChange={(event) =>
                                setCustomModelInputs((current) => ({
                                  ...current,
                                  [providerId]: event.target.value,
                                }))
                              }
                              onKeyDown={(event) => {
                                event.stopPropagation();
                                if (event.key === "Enter") {
                                  event.preventDefault();
                                  useCustomModel(providerId, connectionId);
                                }
                              }}
                              placeholder="Custom model ID"
                              aria-label={`Custom ${group.label} model ID`}
                              className="h-7 min-w-0 flex-1 border-0 bg-transparent px-0 pl-1.5 text-xs shadow-none focus-visible:ring-0"
                            />
                            <button
                              type="button"
                              disabled={!customKey}
                              className="shrink-0 rounded p-1 text-muted-foreground hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
                              aria-label={customPinned ? `Unpin custom ${group.label} model` : `Pin custom ${group.label} model`}
                              onClick={(event) => {
                                event.preventDefault();
                                event.stopPropagation();
                                if (customKey) toggleFavoriteModel(customKey);
                              }}
                            >
                              <Pin className={cn("size-3", customPinned ? "fill-current text-primary" : "")} />
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                  {matchingModels.length === 0 && customPinnedEntries.length === 0 ? (
                    <p className="px-2.5 py-3 text-xs text-muted-foreground">
                      No models found.
                    </p>
                  ) : null}
                </div>
              </DropdownMenuContent>
            </DropdownMenu>
            <ModelOptionsMenu
              model={selectedModel}
              modelParams={modelParams}
              onModelParamsChange={applyModelParams}
              onInsertPrompt={(text) => setInput(text)}
            />
          </div>
        )}
      </div>
    </div>
  );

  const sidebar = (mobile = false) => (
    <div className="flex h-full min-w-0 flex-col overflow-hidden">
      <div
        className={cn(
          "relative shrink-0 items-center justify-center px-3 pb-2 pt-8",
          mobile ? "flex md:hidden" : "hidden md:flex",
        )}
        aria-label="Metis AI"
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/hand-left.png"
          alt=""
          aria-hidden="true"
          className="absolute left-0 h-9 w-auto max-w-[5rem] object-contain"
        />
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/hand-right.png"
          alt=""
          aria-hidden="true"
          className="absolute right-0 h-9 w-auto max-w-[5rem] object-contain"
        />
      </div>
      <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto px-2 pt-3">
        <div className="space-y-0.5 pb-3">
          <button
            type="button"
            className={cn(
              "flex w-full min-w-0 items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[13px] transition-colors",
              isDraft
                ? "text-primary"
                : "text-muted-foreground hover:bg-white/[0.03] hover:text-foreground",
            )}
            onClick={() => openDraft()}
          >
            <Plus className="size-3.5 shrink-0 opacity-60" />
            <span className="min-w-0 truncate">New chat</span>
          </button>
          <button
            type="button"
            className="flex w-full min-w-0 items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[13px] text-muted-foreground transition-colors hover:bg-white/[0.03] hover:text-foreground"
            onClick={() => {
              setDesktopSidebarOpen(false);
              setMobileNavOpen(false);
              setCommandPaletteOpen(true);
            }}
          >
            <Search className="size-3.5 shrink-0 opacity-60" />
            <span className="min-w-0 flex-1 truncate">Search chats</span>
            <kbd className="hidden text-[10px] text-muted-foreground/70 lg:inline">⌘K</kbd>
          </button>
          <p className="px-2.5 pb-1 pt-3 text-[11px] font-medium uppercase tracking-wide text-muted-foreground/70">
            Chats
          </p>
          {!chatsLoaded ? (
            <div className="space-y-1 px-1.5 py-1" aria-label="Loading chats" role="status">
              {[0, 1, 2, 3, 4].map((item) => (
                <div key={item} className="flex items-center gap-2 rounded-lg px-1 py-2">
                  <Skeleton className="size-3.5 rounded-full bg-muted/60" />
                  <Skeleton className={cn("h-3 rounded-full bg-muted/60", item % 2 ? "w-32" : "w-44")} />
                </div>
              ))}
            </div>
          ) : chats.length === 0 ? (
            <p className="px-2.5 py-3 text-xs text-muted-foreground/70">No chats yet</p>
          ) : chats.map((c) => (
            <Fragment key={c.id}>
            <div
              key={c.id}
              className={cn(
                "group flex w-full min-w-0 items-center gap-0.5 overflow-hidden rounded-lg",
              )}
            >
              <button
                type="button"
                className={cn(
                  "min-w-0 flex-1 overflow-hidden pl-1.5 pr-2.5 py-2 text-left text-[13px] text-ellipsis whitespace-nowrap",
                  activeChatId === c.id
                    ? "text-primary hover:text-primary"
                    : "text-muted-foreground hover:text-foreground",
                )}
                onClick={() => void loadChat(c.id)}
                title={c.title || "Untitled"}
              >
                <span className="flex min-w-0 items-center gap-2">
                  {runningChatIds.includes(c.id) ||
                  c.runStatus === "running" ||
                  c.runStatus === "waiting_input" ? (
                    <LoaderCircle
                      className="size-3.5 shrink-0 animate-spin text-muted-foreground"
                      aria-label="Generating response"
                    />
                  ) : null}
                  {activeChatId !== c.id && (c.badge === "red" || c.pendingQuestion || attentionChatIds.includes(c.id)) ? (
                    <span
                      className="size-2 shrink-0 rounded-full bg-red-500"
                      aria-label="Needs your attention"
                      title="Needs your attention"
                    />
                  ) : activeChatId !== c.id && unreadChatIds.includes(c.id) ? (
                    <span
                      className="size-2 shrink-0 rounded-full bg-blue-500"
                      aria-label="Unread response"
                      title="Unread response"
                    />
                  ) : null}
                  {c.pinned ? (
                    <Pin
                      className="size-3 shrink-0 text-primary/80"
                      aria-label="Pinned chat"
                    />
                  ) : null}
                  <span className="min-w-0 truncate">{c.title || "Untitled"}</span>
                </span>
              </button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    className="mr-0.5 size-7 shrink-0 opacity-100 transition-[width,opacity] duration-150 md:w-0 md:overflow-hidden md:px-0 md:opacity-0 md:group-hover:w-7 md:group-hover:opacity-100 md:group-focus-within:w-7 md:group-focus-within:opacity-100 data-[state=open]:w-7 data-[state=open]:opacity-100"
                    aria-label={`Actions for ${c.title || "chat"}`}
                    title="Chat actions"
                  >
                    <MoreHorizontal className="size-3.5" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="z-[1200]">
                  <DropdownMenuItem
                    onClick={() => void updateChatFlags(c.id, { pinned: !c.pinned })}
                  >
                    {c.pinned ? <PinOff className="size-3.5" /> : <Pin className="size-3.5" />}
                    {c.pinned ? "Unpin" : "Pin"}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => void updateChatFlags(c.id, { archived: true })}
                  >
                    <Archive className="size-3.5" />
                    Archive
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => openRename(c.id, c.title)}
                  >
                    <Pencil className="size-3.5" />
                    Rename
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => void openChatLogs(c.id)}
                  >
                    <FileClock className="size-3.5" />
                    View logs
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    variant="destructive"
                    onClick={() => void removeChat(c.id)}
                  >
                    <Trash2 className="size-3.5" />
                    Delete
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
            {activeChatId === c.id && subagentOutputs.length > 0 ? (
              <div className="relative ml-5 pb-1 pl-3">
                <span className="pointer-events-none absolute bottom-5 left-0 top-0 border-l border-border/40" aria-hidden="true" />
                {subagentOutputs.map((subagent) => {
                  const title = subagent.subagent?.title || subagent.subagent?.prompt || subagent.name;
                  return (
                    <button
                      key={subagent.id}
                      type="button"
                      className="relative flex w-full min-w-0 items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs text-muted-foreground hover:bg-white/[0.04] hover:text-foreground"
                      onClick={() => {
                        setMobileNavOpen(false);
                        setActiveSubagent({ ...subagent });
                      }}
                      title={title}
                    >
                      <span className="absolute -left-3 top-1/2 w-3 border-t border-border/40" aria-hidden="true" />
                      <span className={cn("size-1.5 shrink-0 rounded-full", subagent.status === "running" ? "animate-pulse bg-purple-400" : "bg-muted-foreground/50")} />
                      <span className="min-w-0 flex-1 truncate">{title}</span>
                      {subagent.subagent?.model ? (
                        <span className="max-w-24 shrink-0 truncate text-[10px] text-muted-foreground/60">{subagent.subagent.model}</span>
                      ) : null}
                    </button>
                  );
                })}
              </div>
            ) : null}
            </Fragment>
          ))}
        </div>
      </div>

      <div className="shrink-0 p-2">
        <Button
          variant="ghost"
          size="sm"
          className="h-9 w-full justify-start gap-2 px-2.5 text-muted-foreground"
          onClick={() => {
            void loadMemories();
            void refreshStatus();
            setSettingsOpen(true);
            setMobileNavOpen(false);
          }}
        >
          <Settings className="size-3.5 shrink-0" />
          <span className="truncate">Settings</span>
        </Button>
      </div>
    </div>
  );

  if (authed === null) {
    return (
      <main className="flex min-h-dvh items-center justify-center text-sm text-muted-foreground">
        …
      </main>
    );
  }

  if (!authed) {
    return (
      <main className="flex min-h-dvh items-center justify-center p-8">
        <form onSubmit={login} className="w-full max-w-[320px] space-y-4">
          <div className="space-y-1 text-center">
            <h1 className="text-base font-medium">Sign in</h1>
            <p className="text-sm text-muted-foreground">Password</p>
          </div>
          <Input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="username"
            className="h-10 rounded-xl"
            placeholder="Username"
          />
          <Input
            type="password"
            autoFocus
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            className="h-10 rounded-xl"
          />
          <Button type="submit" className="h-10 w-full rounded-xl">
            Continue
          </Button>
          {authError ? (
            <p className="text-center text-sm text-destructive">{authError}</p>
          ) : null}
        </form>
      </main>
    );
  }

  return (
    <div
      className="flex h-dvh overflow-hidden bg-background"
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
    >
      <CommandPalette
        open={commandPaletteOpen}
        onOpenChange={setCommandPaletteOpen}
        onOpenDraft={() => openDraft()}
        onOpenChat={(chatId, messageId) => {
          void openSearchResult(chatId, messageId);
        }}
        onOpenMemories={() => {
          void loadMemories();
          setSettingsOpen(true);
        }}
        onOpenSettings={() => {
          void loadMemories();
          void refreshStatus();
          setSettingsOpen(true);
        }}
        onOpenWorkspace={() => {
          setActiveWorkspaceId((current) => current ?? workspaces[0]?.id ?? null);
          setWorkspaceOpen(true);
        }}
        onOpenModel={() => setModelMenuOpen(true)}
        onToggleSidebar={() => setDesktopSidebarOpen((open) => !open)}
        onExport={exportCurrentChat}
      />
      {desktopSidebarMounted ? (
        <aside
          className={cn(
            "relative hidden shrink-0 overflow-hidden border-r border-border/40 md:block",
            desktopSidebarOpen ? "sidebar-panel-enter" : "sidebar-panel-exit",
          )}
          style={{ width: `${sidebarWidth}px` }}
        >
          {sidebar()}
          <SidebarResizeHandle
            width={sidebarWidth}
            onWidthChange={setSidebarWidth}
          />
        </aside>
      ) : null}

      <Sheet open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
        <SheetContent
          side="left"
          className="w-full max-w-none border-border/40 p-0"
          onTouchStart={handleTouchStart}
          onTouchEnd={handleTouchEnd}
        >
          <SheetHeader className="sr-only">
            <SheetTitle>Chats</SheetTitle>
          </SheetHeader>
          {sidebar(true)}
        </SheetContent>
      </Sheet>

      <div className="relative flex min-w-0 flex-1 flex-col">
        {/* Thin top bar */}
        <header className="relative z-20 flex h-12 shrink-0 items-center gap-2 border-b border-border/30 bg-background/90 px-3 backdrop-blur-xl md:px-4">
          <Button
            variant="ghost"
            size="icon"
            className="size-8 md:hidden"
            onClick={() => setMobileNavOpen(true)}
            aria-label="Open sidebar"
          >
            <Menu className="size-4" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="hidden size-8 md:inline-flex"
            aria-label={desktopSidebarOpen ? "Hide sidebar" : "Show sidebar"}
            title={desktopSidebarOpen ? "Hide sidebar" : "Show sidebar"}
            onClick={() => setDesktopSidebarOpen((open) => !open)}
          >
            <PanelLeft className="size-4" />
          </Button>
          {!isDraft && !isEmpty ? (
            <p
              className="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-center text-sm text-muted-foreground md:text-left"
              title={chatTitle}
            >
              {chatTitle}
            </p>
          ) : (
            <div className="flex-1" />
          )}
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-8"
            aria-label="Open workspace and browser"
            title="Open workspace and browser"
            onClick={() => {
              setWorkspaceTab("browser");
              setWorkspaceOpen(true);
            }}
          >
            <Globe2 className="size-4" />
          </Button>
        </header>

        {/* Messages / empty */}
        <div
          key={paneKey}
          className="flex min-h-0 flex-1 flex-col animate-in fade-in duration-200"
        >
        {loadingChatId ? (
          <ChatLoadingSkeleton />
        ) : isEmpty ? (
          <div
            className={cn(
              "flex min-h-0 flex-1 flex-col items-center px-4 pb-8",
              queuedMessages.length ? "justify-end" : "justify-center",
            )}
          >
            <h2 className="mb-8 text-2xl font-medium tracking-tight text-foreground/90">
              What&apos;s on your mind?
            </h2>
            <div ref={composerContainerRef} className="w-full max-w-2xl">{composer}</div>
          </div>
        ) : (
          <>
            <div
              ref={messagesScrollRef}
              className="min-h-0 flex-1 overflow-y-auto"
              onMouseUp={() => {
                const selection = window.getSelection();
                const text = selection?.toString().trim() || "";
                const node = selection?.anchorNode;
                if (!text || !node || !messagesScrollRef.current?.contains(node)) {
                  setSelectionAction(null);
                  return;
                }
                const range = selection?.getRangeAt(0);
                const rect = range?.getBoundingClientRect();
                if (rect) setSelectionAction({ text, x: rect.left, y: Math.max(8, rect.top - 38) });
              }}
            >
              <div
                className="mx-auto w-full max-w-2xl space-y-6 px-4 pt-6 sm:px-6"
                style={{ paddingBottom: Math.max(144, composerHeight + 80) }}
              >
                {hasEarlierMessages || loadingEarlierMessages ? (
                  <div className="text-center text-xs text-muted-foreground">
                    {loadingEarlierMessages ? "Loading more messages…" : "Scroll up for older messages"}
                  </div>
                ) : null}
                {messages.map((m) => {
                  const canRevert = m.role === "user";
                  const sourceLinks = m.role === "assistant" && !m.streaming
                    ? extractMessageSources(m)
                    : [];
                  return (
                  <article
                    key={m.id}
                    data-message-id={m.id}
                    className={cn(
                      "w-full rounded-xl transition-colors",
                      highlightedMessageId === m.id && [
                        "-mx-2 -my-1 px-2 py-1",
                        "bg-primary/10 ring-1 ring-primary/30",
                        "animate-[pulse_1.4s_ease-in-out_2]",
                      ],
                    )}
                  >
                    {m.role === "user" ? (
                      <div className="flex flex-col items-end gap-1">
                        {m.references?.length ? (
                          <div className="flex max-w-[85%] flex-wrap justify-end gap-1">
                            {m.references.map((reference) => {
                              const Icon = referenceIcon(reference.kind);
                              return (
                                <span
                                  key={`${reference.kind}-${reference.id}`}
                                  title={reference.detail || reference.label}
                                  className="inline-flex max-w-48 items-center gap-1 rounded-full border border-primary/20 bg-primary/[0.06] px-2 py-0.5 text-[11px] text-primary/80"
                                >
                                  <Icon className="size-3 shrink-0" />
                                  <span className="truncate">@{reference.label}</span>
                                </span>
                              );
                            })}
                          </div>
                        ) : null}
                        {m.referenceText ? (
                          <div className="flex max-w-[85%] items-start gap-2 rounded-xl border border-primary/20 bg-primary/[0.06] px-3 py-2 text-xs text-muted-foreground">
                            <Reply className="mt-0.5 size-3.5 shrink-0 text-primary" />
                            <span className="whitespace-pre-wrap break-words text-left">{m.referenceText}</span>
                          </div>
                        ) : null}
                        {editingMessageId === m.id ? (
                          <div className="w-full max-w-[85%] space-y-2 rounded-3xl border border-border/60 bg-secondary/50 p-3">
                            <Textarea
                              value={editValue}
                              onChange={(event) => setEditValue(event.target.value)}
                              onKeyDown={(event) => {
                                if (event.key === "Enter" && !event.shiftKey) {
                                  event.preventDefault();
                                  void submitEdit(m);
                                }
                              }}
                              aria-label="Edit message"
                              ref={editTextareaRef}
                              disabled={busy || reverting}
                              className="min-h-20 resize-y border-0 bg-transparent p-1 text-[15px] shadow-none focus-visible:ring-0"
                            />
                            <p className="px-1 text-xs text-muted-foreground">
                              Enter to save and resend · Shift+Enter for a new line
                            </p>
                            <div className="flex justify-end gap-2">
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                disabled={busy || reverting}
                                onClick={cancelEditing}
                              >
                                Cancel
                              </Button>
                              <Button
                                type="button"
                                size="sm"
                                disabled={busy || reverting || !editValue.trim()}
                                onClick={() => void submitEdit(m)}
                              >
                                {reverting ? "Saving…" : "Save & resend"}
                              </Button>
                            </div>
                          </div>
                        ) : (
                        <div className="max-w-[85%] space-y-2 rounded-3xl bg-secondary/80 px-4 py-2.5 text-[15px] leading-relaxed">
                          {m.attachments && m.attachments.length > 0 ? (
                            <div className="flex max-w-full gap-2 overflow-x-auto pb-1">
                              {m.attachments.map((att) => {
                                const href =
                                  att.storedName && activeChatId
                                    ? `/api/uploads/${activeChatId}/${encodeURIComponent(att.storedName)}`
                                    : att.previewUrl;
                                return (
                                  <button
                                    key={att.id}
                                    type="button"
                                    title={att.name}
                                    onClick={() => setActiveAttachment({ attachment: att, chatId: activeChatId ?? undefined })}
                                    className="flex w-52 shrink-0 items-center gap-2 rounded-xl border border-border/40 bg-background/40 p-2 text-left text-xs text-foreground/90 hover:bg-background/70"
                                  >
                                    {att.kind === "image" && href ? (
                                      // eslint-disable-next-line @next/next/no-img-element
                                      <img src={href} alt={att.name} className="size-12 shrink-0 rounded-lg object-cover" />
                                    ) : (
                                      <span className="flex size-12 shrink-0 items-center justify-center rounded-lg bg-secondary/80">
                                        <AttachmentIcon mimeType={att.mimeType} className="size-5 text-muted-foreground" />
                                      </span>
                                    )}
                                    <span className="min-w-0">
                                      <span className="block truncate font-medium">{att.name}</span>
                                      <span className="mt-0.5 block text-[11px] text-muted-foreground">
                                        {att.size === undefined ? "Size unavailable" : formatMetricBytes(att.size)}
                                      </span>
                                    </span>
                                  </button>
                                );
                              })}
                            </div>
                          ) : null}
                          {m.content ? (
                            <div className="whitespace-pre-wrap">
                              <RichUserText content={m.content} references={m.references} />
                            </div>
                          ) : null}
                        </div>
                        )}
                      </div>
                    ) : m.role === "system" ? (
                      <ErrorMessageCard message={m.errorMessage || m.content} />
                    ) : (
                      <div className="text-[15px] leading-relaxed text-foreground/95">
                        {(() => {
                          const messageParts = m.parts && m.parts.length > 0
                          ? m.parts
                          : partsFromFlat(m);
                          const planTools = messageParts.filter(
                            (part): part is ToolMsgPart => part.type === "tool" && part.kind === "plan",
                          );
                          return (
                            <>
                        {messageParts.map((part, pi, parts) => {
                          if (part.type === "thinking") {
                            return (
                              <ThinkingBlock
                                key={`thinking-${pi}`}
                                text={part.content}
                                done={
                                  Boolean(part.done) ||
                                  Boolean(m.thinkingDone) ||
                                  !m.streaming
                                }
                                durationMs={
                                  part.durationMs ?? m.thinkingDurationMs
                                }
                              />
                            );
                          }
                          if (part.type === "tool") {
                            const currentTool = part as ToolCallData;
                            const previousTool = parts[pi - 1]?.type === "tool"
                              ? parts[pi - 1] as ToolCallData
                              : undefined;
                            if (previousTool) return null;
                            const groupedTools: ToolCallData[] = [];
                            for (let toolIndex = pi; toolIndex < parts.length && parts[toolIndex]?.type === "tool"; toolIndex += 1) {
                              groupedTools.push(parts[toolIndex] as ToolCallData);
                            }
                            return (
                              <ToolCallGroup
                                key={`tools-${part.id}`}
                                tools={groupedTools.filter((tool) => tool.kind !== "plan")}
                                onOpenDiff={(tool) =>
                                  setActiveDiff({
                                    name: tool.name,
                                    path: tool.path,
                                    detail: tool.detail,
                                    diff: tool.diff,
                                  })
                                }
                                onOpenSubagent={(tool) => setActiveSubagent({ ...tool })}
                                onOpenRaw={(tool) => setActiveRawTool({ ...tool })}
                                onOpenWorkspace={(tool) => {
                                  if (tool.kind === "browser") {
                                    setWorkspaceTab("browser");
                                    navigateBrowser(tool.result?.match(/https?:\/\/[^\s"'`]+/)?.[0] || "");
                                    setWorkspaceOpen(true);
                                    return;
                                  }
                                  const workspace = tool.kind === "plan" || tool.kind === "canvas"
                                    ? workspaces.find((item) => item.type === tool.kind)
                                    : undefined;
                                  if (workspace) {
                                    setActiveWorkspaceId(workspace.id);
                                    setWorkspaceTab(tool.kind === "plan" ? "plan" : "canvas");
                                    setWorkspaceOpen(true);
                                  }
                                }}
                                onBuildPlan={(tool, plan) => {
                                  void tool;
                                  buildPlan(plan);
                                }}
                                buildDisabled={busy}
                                includePlans={false}
                              />
                            );
                          }
                          const displayContent = stripSourceBlocks(part.content);
                          return (
                            <div
                              key={`text-${pi}`}
                              className={cn(
                                "block w-full",
                                m.streaming && "streaming-answer",
                                pi > 0 && "mt-3",
                              )}
                            >
                              {m.streaming ? (
                                <StreamingMarkdown content={displayContent} />
                              ) : (
                                <Markdown content={displayContent} />
                              )}
                            </div>
                          );
                        })}
                        {planTools.map((tool) => (
                          <PlanToolCallCard
                            key={`plan-ready-${tool.id}`}
                            tool={tool}
                            onOpenWorkspace={() => {
                              const workspace = workspaces.find((item) => item.type === "plan");
                              if (workspace) {
                                setActiveWorkspaceId(workspace.id);
                                setWorkspaceTab("plan");
                                setWorkspaceOpen(true);
                              }
                            }}
                            onBuildPlan={buildPlan}
                            buildDisabled={busy}
                          />
                        ))}
                            </>
                          );
                        })()}
                        {m.errorMessage ? <ErrorMessageCard message={m.errorMessage} /> : null}
                      </div>
                    )}
                    {sourceLinks.length ? <MessageSources sources={sourceLinks} /> : null}
                    {m.role === "assistant" && !m.streaming && m.runMetadata ? (
                      <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                        {typeof m.runMetadata.outputTokens === "number" ? (
                          <span>Output: {m.runMetadata.outputTokens} Tokens</span>
                        ) : null}
                        {m.runMetadata.modelId ? <span>Model: {m.runMetadata.modelId}</span> : null}
                        <span>Completed: {formatCompletedAt(m.runMetadata.completedAt)}</span>
                      </div>
                    ) : null}
                    {m.role === "assistant" && m.suggestions?.length ? (
                      <div className="mt-3 flex flex-col items-start gap-1" aria-label="Suggested next steps">
                        {m.suggestions.map((suggestion) => (
                          <Button
                            key={`${suggestion.label}-${suggestion.prompt}`}
                            type="button"
                            size="xs"
                            variant="link"
                            className="h-auto min-w-0 justify-start gap-1.5 whitespace-normal text-left text-xs text-muted-foreground hover:text-foreground"
                            aria-label={`Use suggestion: ${suggestion.label}`}
                            title="Use suggestion"
                            disabled={busy}
                            onClick={() => {
                              setInput(suggestion.prompt);
                              window.setTimeout(() => {
                                const editor = textareaRef.current;
                                if (!editor) return;
                                editor.focus();
                                const selection = window.getSelection();
                                const range = document.createRange();
                                range.selectNodeContents(editor);
                                selection?.removeAllRanges();
                                selection?.addRange(range);
                              }, 0);
                            }}
                          >
                            <Reply className="size-3.5 shrink-0" />
                            <span>{suggestion.label}</span>
                          </Button>
                        ))}
                      </div>
                    ) : null}
                    {canRevert ? (
                    <div className={cn("mt-1 flex justify-end gap-1")}>
                      <Button
                        type="button"
                        variant="ghost"
                        size="xs"
                        className="h-6 gap-1 px-1.5 text-[11px] text-muted-foreground opacity-100 sm:opacity-60 sm:hover:opacity-100"
                        disabled={
                          reverting ||
                          Boolean(editingMessageId) ||
                          busy
                        }
                        onClick={() => void retryMessage(m)}
                        title="Revert and resend this message"
                        aria-label="Revert and resend this message"
                      >
                        <RotateCcw className="size-3" />
                        Retry
                      </Button>
                      {canRevert ? <Button
                        type="button"
                        variant="ghost"
                        size="xs"
                        className="h-6 gap-1 px-1.5 text-[11px] text-muted-foreground opacity-100 sm:opacity-60 sm:hover:opacity-100"
                        disabled={
                          reverting ||
                          Boolean(editingMessageId) ||
                          !canRevert
                        }
                        onClick={() => setRevertTarget(m)}
                        title="Revert this message and everything after it"
                        aria-label="Revert this message and everything after it"
                      >
                        <Undo2 className="size-3" />
                        Revert
                      </Button> : null}
                    </div>
                    ) : null}
                  </article>
                  );
                })}
                {pendingQuestion ? (
                  <section className="space-y-4 rounded-2xl border border-primary/30 bg-primary/[0.06] p-4 shadow-sm">
                    <div>
                      <p className="text-sm font-medium text-foreground">
                        Agent needs your input
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        Answer every question to continue.
                      </p>
                    </div>
                    {pendingQuestion.questions.map((question, index) => {
                      const customSelected = questionCustomActive[index] === true;
                      const selected = questionAnswers[index];
                      const selectedValues = selectedQuestionValues(selected);
                      return (
                        <div key={question.id} className="space-y-2">
                          <p className="text-sm leading-relaxed">
                            {index + 1}. {question.question}
                          </p>
                          {question.multiple ? (
                            <p className="text-xs text-muted-foreground">
                              Select one or more options.
                            </p>
                          ) : null}
                          <div className="flex flex-wrap gap-2">
                            {(question.options ?? []).map((option) => {
                              const value = option.value || option.label;
                              const isSelected = question.multiple
                                ? selectedValues.includes(value)
                                : selected === value;
                              return (
                                <button
                                  key={`${question.id}-${value}`}
                                  type="button"
                                  className={cn(
                                    "max-w-full rounded-xl border px-3 py-2 text-left text-sm whitespace-normal break-words transition-colors",
                                    !customSelected && isSelected
                                      ? "border-primary bg-primary/15 text-foreground"
                                      : "border-border/60 bg-background/40 text-muted-foreground hover:border-primary/50 hover:text-foreground",
                                  )}
                                  onClick={() => {
                                    setQuestionAnswers((answers) => {
                                      const next = [...answers];
                                      if (question.multiple) {
                                        const values = selectedQuestionValues(next[index]);
                                        const nextValues = values.includes(value)
                                          ? values.filter((item) => item !== value)
                                          : [...values, value];
                                        next[index] = nextValues.length
                                          ? JSON.stringify(nextValues)
                                          : "";
                                      } else {
                                        next[index] = value;
                                      }
                                      return next;
                                    });
                                    setQuestionCustomActive((active) => {
                                      const next = [...active];
                                      next[index] = false;
                                      return next;
                                    });
                                  }}
                                >
                                  {option.label}
                                </button>
                              );
                            })}
                            <button
                              type="button"
                              className={cn(
                                "max-w-full rounded-xl border px-3 py-2 text-sm whitespace-normal break-words transition-colors",
                                customSelected
                                  ? "border-primary bg-primary/15 text-foreground"
                                  : "border-border/60 bg-background/40 text-muted-foreground hover:border-primary/50 hover:text-foreground",
                              )}
                              onClick={() => {
                                setQuestionCustomActive((active) => {
                                  const next = [...active];
                                  next[index] = true;
                                  return next;
                                });
                                setQuestionAnswers((answers) => {
                                  const next = [...answers];
                                  next[index] = "";
                                  return next;
                                });
                              }}
                            >
                              Custom…
                            </button>
                          </div>
                          {customSelected ? (
                            <Textarea
                              autoFocus={pendingQuestion.questions.length === 1}
                              value={questionCustom[index] ?? ""}
                              onChange={(event) => {
                                const value = event.target.value;
                                setQuestionCustom((custom) => {
                                  const next = [...custom];
                                  next[index] = value;
                                  return next;
                                });
                                setQuestionAnswers((answers) => {
                                  const next = [...answers];
                                  next[index] = value;
                                  return next;
                                });
                              }}
                              onKeyDown={(event) => {
                                if (
                                  event.key === "Enter" &&
                                  !event.shiftKey &&
                                  pendingQuestion.questions.length === 1
                                ) {
                                  event.preventDefault();
                                  void submitQuestionAnswers();
                                }
                              }}
                              placeholder="Type your answer…"
                              className="min-h-16 resize-y bg-background/60 text-sm"
                            />
                          ) : null}
                        </div>
                      );
                    })}
                    <div className="flex justify-end">
                      <Button
                        type="button"
                        size="sm"
                        disabled={
                          answeringQuestion ||
                          questionAnswers.length !== pendingQuestion.questions.length ||
                          questionAnswers.some((answer) => !answer.trim())
                        }
                        onClick={() => void submitQuestionAnswers()}
                      >
                        {answeringQuestion ? "Sending…" : "Continue"}
                      </Button>
                    </div>
                  </section>
                ) : null}
                <div ref={bottomRef} />
              </div>
            </div>

            {/* Floating composer */}
            <div ref={composerContainerRef} className="pointer-events-none absolute inset-x-0 bottom-0 z-20">
              <div className="pointer-events-none bg-gradient-to-t from-background via-background/90 to-transparent pb-4 pt-16">
                <div className="pointer-events-auto relative mx-auto w-full max-w-2xl px-4 sm:px-6">
                  {showScrollDown || hasCurrentAttention ? (
                    <Button
                      type="button"
                      size="icon"
                      variant="secondary"
                      aria-label="Scroll to latest message"
                      title="Scroll to latest message"
                      onClick={scrollMessagesToBottom}
                      className="absolute bottom-full left-1/2 z-30 mb-2 size-9 -translate-x-1/2 rounded-full border border-border/60 bg-background/90 shadow-lg backdrop-blur"
                    >
                      <ArrowDown className="size-4" />
                      {hasCurrentAttention ? (
                        <span
                          aria-label="Attention required"
                          className="absolute -right-0.5 -top-0.5 size-2.5 rounded-full border-2 border-background bg-red-500"
                        />
                      ) : null}
                    </Button>
                  ) : null}
                  {activeChatIsRunning ? (
                    <div
                      className="mb-2 flex items-center justify-center gap-2 text-xs text-muted-foreground"
                      role="status"
                      aria-label="Agent running"
                    >
                      <LoaderCircle className="size-3.5 animate-spin" />
                      <span>{liveStatus || "Agent running…"}</span>
                    </div>
                  ) : null}
                  {composer}
                </div>
              </div>
            </div>
            {selectionAction ? (
              <Button
                type="button"
                size="icon-sm"
                variant="secondary"
                aria-label="Reference selected text"
                title="Reference selected text"
                onClick={() => {
                  setReferenceText(selectionAction.text);
                  setSelectionAction(null);
                  window.getSelection()?.removeAllRanges();
                  textareaRef.current?.focus();
                }}
                style={{ position: "fixed", left: selectionAction.x, top: selectionAction.y, zIndex: 60 }}
                className="size-8 rounded-full border border-primary/30 bg-background shadow-lg"
              >
                <Reply className="size-3.5" />
              </Button>
            ) : null}
          </>
        )}
        </div>
      </div>

      {workspaceMounted && browserFullscreen && workspaceTab === "browser" ? (
        <div className="fixed inset-0 z-40 bg-background/55 backdrop-blur-[2px]" aria-hidden="true" />
      ) : null}
      {workspaceMounted ? (
        <aside
          className={cn(
            "relative flex min-h-0 w-full shrink-0 flex-col overflow-hidden border-l border-border/30 bg-background/95 max-md:absolute max-md:inset-0 max-md:z-30 max-md:!w-full",
            browserFullscreen && workspaceTab === "browser" && "fixed inset-[1%] z-50 !w-auto rounded-xl border border-border shadow-2xl ring-1 ring-foreground/10",
            workspaceOpen ? "workspace-panel-enter" : "workspace-panel-exit",
          )}
          style={browserFullscreen && workspaceTab === "browser" ? undefined : { width: `min(100%, ${workspaceWidth}px)` }}
        >
          {browserFullscreen && workspaceTab === "browser" ? null : (
            <WorkspaceResizeHandle width={workspaceWidth} onWidthChange={setWorkspaceWidth} />
          )}
          <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border/30 px-3 py-2">
            <div className="min-w-0">
              <h1 className="flex items-center gap-1.5 text-[13px] font-medium">
                {workspaceTab === "browser" ? <Globe2 className="size-4 shrink-0 text-cyan-400" /> : workspaceTab === "monitor" ? <Activity className="size-4 shrink-0 text-violet-400" /> : workspaceTab === "terminal" ? <Terminal className="size-4 shrink-0 text-orange-400" /> : workspaceTab === "files" ? <FileCode2 className="size-4 shrink-0 text-emerald-400" /> : activeWorkspace ? <WorkspaceIcon type={activeWorkspace.type} className="size-4 shrink-0" /> : null}
                <span className="truncate">{workspaceTab === "browser" ? "Browser" : workspaceTab === "monitor" ? "Monitor" : workspaceTab === "terminal" ? "Terminal" : workspaceTab === "files" ? "Files" : activeWorkspace?.name || "Workspace"}</span>
              </h1>
            </div>
            <Button type="button" variant="ghost" size="icon-xs" aria-label="Close side panel" onClick={() => { setBrowserFullscreen(false); setWorkspaceOpen(false); }}>
              <X className="size-3.5" />
            </Button>
          </div>
          <div className="flex shrink-0 gap-0.5 overflow-x-auto border-b border-border/30 px-2 py-1">
            {(["canvas", "plan", "files", "terminal", "browser", "monitor"] as const).map((tab) => (
              <Button
                key={tab}
                type="button"
                size="xs"
                variant={workspaceTab === tab ? "secondary" : "ghost"}
                onClick={() => {
                  if (tab === "plan" || tab === "canvas") {
                    const workspace = workspaces.find((item) => item.type === tab);
                    setActiveWorkspaceId(workspace?.id ?? null);
                  }
                  setWorkspaceTab(tab);
                }}
                className="h-6 shrink-0 rounded-md px-2 text-[11px] capitalize"
              >
                {tab === "plan" ? "Plans" : tab === "files" ? "Files" : tab === "terminal" ? "Terminal" : tab === "monitor" ? "Monitor" : tab}
              </Button>
            ))}
          </div>
          <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-hidden p-2.5">
            {workspaceTab === "browser" ? (
              <>
                <div className="flex items-center gap-1 overflow-x-auto">
                  {browserTabs.map((tab) => (
                    <Button
                      key={tab.id}
                      type="button"
                      size="xs"
                      variant={tab.id === activeBrowserTabId ? "secondary" : "ghost"}
                      className="h-7 max-w-36 shrink-0 truncate text-xs"
                      onClick={() => {
                        browserInputDirtyRef.current = false;
                        setActiveBrowserTabId(tab.id);
                        setBrowserUrl(tab.url);
                        setBrowserInput(tab.url);
                        void performBrowserAction("select_tab", { tabId: tab.id });
                      }}
                    >
                      {tab.title}
                    </Button>
                  ))}
                  <Button type="button" size="icon-xs" variant="ghost" className="size-7 shrink-0" aria-label="New browser tab" onClick={() => openBrowserTab()}>
                    <Plus className="size-3.5" />
                  </Button>
                </div>
                <form className="flex gap-2" onSubmit={(event) => {
                  event.preventDefault();
                  navigateBrowser(browserInput);
                }}>
                  <Input value={browserInput} onChange={(event) => { browserInputDirtyRef.current = true; setBrowserInput(event.target.value); }} placeholder="https://example.com or local URL" className="h-8 text-xs" />
                  <Button type="submit" size="icon-sm" variant="secondary" aria-label="Open URL" title="Open in embedded browser"><Globe2 className="size-3.5" /></Button>
                  <Button type="button" size="icon-sm" variant="ghost" disabled={!browserUrl.trim() && !browserInput.trim()} aria-label="Open in new browser tab" title="Open in new browser tab" onClick={openBrowserUrlInNewTab}>
                    <ExternalLink className="size-3.5" />
                  </Button>
                </form>
                <div className="flex shrink-0 items-center gap-1">
                  <Button type="button" size="icon-xs" variant="ghost" aria-label="Back" title="Back" onClick={() => void performBrowserAction("back")}><ArrowLeft className="size-3.5" /></Button>
                  <Button type="button" size="icon-xs" variant="ghost" aria-label="Reload" title="Reload" onClick={() => void performBrowserAction("reload")}><RotateCcw className="size-3.5" /></Button>
                  <Button type="button" size="icon-xs" variant="ghost" aria-label={browserFullscreen ? "Exit browser fullscreen" : "Open browser fullscreen"} title={browserFullscreen ? "Exit browser fullscreen" : "Open browser fullscreen"} onClick={() => setBrowserFullscreen((current) => !current)}>
                    {browserFullscreen ? <Minimize2 className="size-3.5" /> : <Fullscreen className="size-3.5" />}
                  </Button>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button type="button" size="icon-xs" variant="ghost" className="size-7" aria-label="Browser settings" title="Browser settings">
                        <MoreHorizontal className="size-3.5" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-56">
                      <DropdownMenuLabel>Viewport resolution</DropdownMenuLabel>
                      <form className="flex items-center gap-1 px-1.5 pb-1" onSubmit={(event) => { event.preventDefault(); resizeBrowser(); }}>
                        <Input value={browserWidthInput} onChange={(event) => setBrowserWidthInput(event.target.value)} aria-label="Browser width" className="h-7 w-full px-2 text-[11px]" inputMode="numeric" />
                        <span className="text-xs text-muted-foreground">×</span>
                        <Input value={browserHeightInput} onChange={(event) => setBrowserHeightInput(event.target.value)} aria-label="Browser height" className="h-7 w-full px-2 text-[11px]" inputMode="numeric" />
                        <Button type="submit" size="xs" variant="secondary" className="h-7">Set</Button>
                      </form>
                    </DropdownMenuContent>
                  </DropdownMenu>
                  {browserLoading ? <LoaderCircle className="ml-1 size-3.5 animate-spin text-muted-foreground" /> : null}
                  <span className="flex shrink-0 items-center gap-1 text-[10px] text-emerald-400"><span className="size-1.5 rounded-full bg-emerald-400" />Live</span>
                  <span className="min-w-0 flex-1 truncate text-[11px] text-muted-foreground">{browserUrl || "Server browser ready"}</span>
                </div>
                <div
                  ref={browserViewportRef}
                  tabIndex={0}
                  role="application"
                  aria-label="Embedded browser viewport. Click the page, then type or use keyboard shortcuts."
                  data-browser-viewport
                  className="min-h-0 flex-1 overflow-auto rounded-md border border-border/40 bg-zinc-950 outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
                  onKeyDown={pressBrowserKey}
                  onWheel={(event) => {
                    event.preventDefault();
                    if (!sendBrowserStreamAction("scroll", { deltaY: event.deltaY })) void performBrowserAction("scroll", { deltaY: event.deltaY });
                  }}
                >
                  <img
                    ref={browserScreenshotRef}
                    alt="Server browser page"
                    className="hidden w-full cursor-crosshair"
                    onClick={clickBrowserScreenshot}
                  />
                  <div
                    ref={browserScreenshotPlaceholderRef}
                    className="flex h-full min-h-48 items-center justify-center px-6 text-center text-xs text-muted-foreground"
                  >
                    Enter a URL to open it in the server browser. The page is rendered on the server, so localhost links refer to the server.
                  </div>
                </div>
                {browserError ? <div className="shrink-0 rounded-md border border-destructive/30 bg-destructive/10 px-2 py-1.5 text-xs text-destructive">{browserError}</div> : null}
              </>
            ) : workspaceTab === "monitor" ? (
              <div className="min-h-0 flex-1 space-y-3 overflow-y-auto pr-1">
                {monitorData.current ? (
                  <>
                    <div className="grid grid-cols-2 gap-2">
                      {[
                        { label: "CPU", value: `${monitorData.current.cpuPercent.toFixed(1)}%`, icon: Cpu, color: "text-cyan-400", values: monitorData.history.map((item) => item.cpuPercent) },
                        { label: "RAM", value: `${formatMetricBytes(monitorData.current.ramUsedBytes)} / ${formatMetricBytes(monitorData.current.ramTotalBytes)}`, icon: MemoryStick, color: "text-violet-400", values: monitorData.history.map((item) => item.ramTotalBytes ? (item.ramUsedBytes / item.ramTotalBytes) * 100 : 0) },
                        { label: "Load", value: monitorData.current.load.map((item) => item.toFixed(2)).join(" / "), icon: Gauge, color: "text-amber-400", values: monitorData.history.map((item) => item.load[0] || 0) },
                        { label: "Network", value: `↓ ${formatMetricBytes(monitorData.current.networkRxBytesPerSecond)}/s · ↑ ${formatMetricBytes(monitorData.current.networkTxBytesPerSecond)}/s`, icon: Network, color: "text-emerald-400", values: monitorData.history.map((item) => item.networkRxBytesPerSecond + item.networkTxBytesPerSecond) },
                      ].map((card) => (
                        <div key={card.label} className="overflow-hidden rounded-lg border border-border/40 bg-card/60 p-3">
                          <div className="flex items-center justify-between gap-2"><span className="flex items-center gap-1.5 text-[11px] text-muted-foreground"><card.icon className={`size-3.5 ${card.color}`} />{card.label}</span><span className="text-xs font-medium">{card.value}</span></div>
                          <div className="mt-2 opacity-80"><MetricSparkline values={card.values} color="currentColor" /></div>
                        </div>
                      ))}
                    </div>
                    <div className="rounded-lg border border-border/40 bg-card/40 p-3">
                      <div className="mb-2 flex items-center justify-between"><span className="flex items-center gap-2 text-xs font-medium"><Activity className="size-3.5 text-violet-400" />Last 5 minutes</span><span className="text-[10px] text-muted-foreground">{monitorData.history.length} samples · 5 s</span></div>
                      <div className="grid grid-cols-2 gap-2 text-[10px] text-muted-foreground"><span>CPU history</span><span>RAM usage history</span><MetricSparkline values={monitorData.history.map((item) => item.cpuPercent)} color="#22d3ee" /><MetricSparkline values={monitorData.history.map((item) => item.ramTotalBytes ? (item.ramUsedBytes / item.ramTotalBytes) * 100 : 0)} color="#a78bfa" /></div>
                    </div>
                    <div className="space-y-2">
                      <div className="flex items-center justify-between"><span className="text-xs font-medium">GPUs</span><span className="text-[10px] text-muted-foreground">{monitorData.current.gpus.length ? `${monitorData.current.gpus.length} detected` : "No GPU telemetry detected"}</span></div>
                      {monitorData.current.gpus.length ? monitorData.current.gpus.map((gpu) => (
                        <div key={gpu.id} className="rounded-lg border border-border/40 bg-card/40 p-3">
                          <div className="flex items-center justify-between gap-2"><span className="truncate text-xs font-medium">{gpu.name}</span><span className="text-xs text-muted-foreground">{gpu.utilizationPercent === null ? "—" : `${gpu.utilizationPercent.toFixed(0)}%`}</span></div>
                          <div className="mt-1 flex justify-between text-[10px] text-muted-foreground"><span>Memory {formatMetricBytes(gpu.memoryUsedBytes)} / {formatMetricBytes(gpu.memoryTotalBytes)}</span><span>{gpu.temperatureC === null ? "—" : `${gpu.temperatureC.toFixed(0)}°C`}</span></div>
                        </div>
                      )) : <div className="rounded-lg border border-dashed border-border/50 p-3 text-xs text-muted-foreground">GPU data is unavailable on this server.</div>}
                    </div>
                  </>
                ) : <div className="flex min-h-48 items-center justify-center text-xs text-muted-foreground"><LoaderCircle className="mr-2 size-4 animate-spin" />Collecting server metrics…</div>}
              </div>
            ) : workspaceTab === "terminal" ? (
              <>
                <div className="flex shrink-0 items-center gap-1 overflow-x-auto">
                  {terminalTabs.map((tab) => (
                    <div key={tab.id} className="flex shrink-0 items-center">
                      <Button
                        type="button"
                        size="xs"
                        variant={tab.id === activeTerminalTabId ? "secondary" : "ghost"}
                        className="h-7 max-w-36 truncate rounded-r-none text-xs"
                        onClick={() => selectTerminalTab(tab)}
                      >
                        {tab.title}
                      </Button>
                      <Button
                        type="button"
                        size="icon-xs"
                        variant={tab.id === activeTerminalTabId ? "secondary" : "ghost"}
                        className="size-7 rounded-l-none"
                        disabled={terminalTabs.length <= 1}
                        aria-label={`Close ${tab.title}`}
                        onClick={() => closeTerminalTab(tab.id)}
                      >
                        <X className="size-3" />
                      </Button>
                    </div>
                  ))}
                  <Button type="button" size="icon-xs" variant="ghost" className="size-7 shrink-0" aria-label="New terminal tab" onClick={openTerminalTab}>
                    <Plus className="size-3.5" />
                  </Button>
                </div>
                {(() => {
                  const activeTab = terminalTabs.find((tab) => tab.id === activeTerminalTabId) || terminalTabs[0];
                  if (!activeTab) return null;
                  return (
                    <RemoteTerminal
                      key={activeTab.id}
                      cwd={activeTab.cwd}
                      sessionId={activeTab.sessionId}
                      onSessionIdChange={(sessionId) => {
                        setTerminalTabs((current) => current.map((tab) => tab.id === activeTab.id ? { ...tab, sessionId } : tab));
                      }}
                    />
                  );
                })()}
              </>
            ) : workspaceTab === "files" ? (
              <RemoteFileEditor cwd={remoteFileCwd} onCwdChange={setRemoteFileCwd} />
            ) : !activeWorkspace ? (
              <p className="p-2 text-xs text-muted-foreground">
                {workspaceTab === "plan"
                  ? "No plans yet."
                  : workspaceTab === "canvas"
                    ? "No canvases yet."
                    : "No workspace selected."}
              </p>
            ) : activeWorkspace.type === "plan" ? (
              <>
                <div className="flex items-center justify-end gap-1">
                  <Button
                    type="button"
                    size="xs"
                    className="ml-auto"
                    disabled={busy}
                    onClick={() => buildPlan({
                      title: activeWorkspace.name,
                      content: activeWorkspace.content,
                    })}
                  >
                    {busy ? "Agent running…" : "Build plan"}
                  </Button>
                </div>
                <div className="flex min-h-0 flex-1 flex-col gap-2">
                  <div className="flex items-center gap-1">
                    <Input
                      value={activeWorkspace.name}
                      onChange={(event) => {
                        const name = event.target.value.slice(0, 200);
                        setWorkspaces((current) => current.map((item) =>
                          item.id === activeWorkspace.id
                            ? { ...item, name, updatedAt: new Date().toISOString() }
                            : item,
                        ));
                      }}
                      aria-label="Plan title"
                      placeholder="Plan title"
                      className="h-8 flex-1 text-sm font-medium"
                    />
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          type="button"
                          size="icon-sm"
                          variant="ghost"
                          className="size-8 shrink-0"
                          aria-label="Choose plan"
                          title="Choose plan"
                        >
                          <ChevronDown className="size-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-64">
                        {workspaces
                          .filter((item) => item.type === "plan")
                          .map((plan) => (
                            <DropdownMenuItem
                              key={plan.id}
                              onClick={() => {
                                setActiveWorkspaceId(plan.id);
                                setWorkspaceTab("plan");
                              }}
                            >
                              <span className="min-w-0 truncate">{plan.name}</span>
                            </DropdownMenuItem>
                          ))}
                      </DropdownMenuContent>
                    </DropdownMenu>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button type="button" size="icon-sm" variant="ghost" className="size-8 shrink-0" aria-label="Plan actions">
                          <MoreHorizontal className="size-3.5" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => focusWorkspaceTitle(activeWorkspace)}>Rename</DropdownMenuItem>
                        <DropdownMenuItem onClick={() => duplicateWorkspace(activeWorkspace)}>Duplicate</DropdownMenuItem>
                        <DropdownMenuItem variant="destructive" onClick={() => deleteWorkspace(activeWorkspace)}>Delete</DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                  <EditableMarkdown
                    key={activeWorkspace.id}
                    value={activeWorkspace.content}
                    onChange={(nextContent) => {
                      const content = nextContent.slice(0, 100_000);
                      setWorkspaces((current) => current.map((item) =>
                        item.id === activeWorkspace.id
                          ? { ...item, content, updatedAt: new Date().toISOString() }
                          : item,
                      ));
                    }}
                    aria-label="Plan content"
                    placeholder="Write the plan…"
                  />
                </div>
              </>
            ) : (
              <>
                <div className="flex min-h-0 flex-1 flex-col gap-2">
                  <div className="flex items-center gap-1">
                    <Input
                      value={activeWorkspace.name}
                      onChange={(event) => {
                        const name = event.target.value.slice(0, 200);
                        setWorkspaces((current) => current.map((item) =>
                          item.id === activeWorkspace.id
                            ? { ...item, name, updatedAt: new Date().toISOString() }
                            : item,
                        ));
                      }}
                      aria-label="Canvas title"
                      placeholder="Canvas title"
                      className="h-8 flex-1 text-sm font-medium"
                    />
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          type="button"
                          size="icon-sm"
                          variant="ghost"
                          className="size-8 shrink-0"
                          aria-label="Choose canvas"
                          title="Choose canvas"
                        >
                          <ChevronDown className="size-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-64">
                        {workspaces
                          .filter((item) => item.type === "canvas")
                          .map((canvas) => (
                            <DropdownMenuItem
                              key={canvas.id}
                              onClick={() => {
                                setActiveWorkspaceId(canvas.id);
                                setWorkspaceTab("canvas");
                              }}
                            >
                              <span className="min-w-0 truncate">{canvas.name}</span>
                            </DropdownMenuItem>
                          ))}
                      </DropdownMenuContent>
                    </DropdownMenu>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button type="button" size="icon-sm" variant="ghost" className="size-8 shrink-0" aria-label="Canvas actions">
                          <MoreHorizontal className="size-3.5" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => focusWorkspaceTitle(activeWorkspace)}>Rename</DropdownMenuItem>
                        <DropdownMenuItem onClick={() => duplicateWorkspace(activeWorkspace)}>Duplicate</DropdownMenuItem>
                        <DropdownMenuItem variant="destructive" onClick={() => deleteWorkspace(activeWorkspace)}>Delete</DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                  <EditableMarkdown
                    key={activeWorkspace.id}
                    value={activeWorkspace.content}
                    onChange={(nextContent) => {
                      const content = nextContent.slice(0, 100_000);
                      setWorkspaces((current) => current.map((item) =>
                        item.id === activeWorkspace.id
                          ? { ...item, content, updatedAt: new Date().toISOString() }
                          : item,
                      ));
                    }}
                    aria-label="Canvas content"
                    placeholder="Write notes, requirements, or a working draft…"
                  />
                </div>
              </>
            )}
          </div>
        </aside>
      ) : null}

      <Dialog
        open={chatLogsOpen}
        onOpenChange={(open) => {
          setChatLogsOpen(open);
          if (!open) setChatLogsChatId(null);
        }}
      >
        <DialogContent className="flex h-[min(52rem,calc(100dvh-1rem))] max-w-6xl flex-col gap-0 overflow-hidden p-0">
          <DialogHeader className="shrink-0 border-b border-border px-6 py-5 pr-14">
            <DialogTitle>Chat logs</DialogTitle>
            <p className="text-xs text-muted-foreground">
              Prompts, responses, tool calls, workspaces, statuses, and errors
              {chatLogsChatId ? ` · ${chatLogsChatId}` : ""}
            </p>
          </DialogHeader>
          <div className="flex shrink-0 gap-1 overflow-x-auto border-b border-border bg-muted/20 px-4 py-3">
            {(["all", "prompt", "response", "stream", "tool", "workspace", "status", "error", "system"] as const).map((category) => (
              <Button
                key={category}
                type="button"
                size="sm"
                variant={chatLogsCategory === category ? "default" : "ghost"}
                className="h-8 shrink-0 rounded-full px-3 text-xs capitalize"
                onClick={() => setChatLogsCategory(category)}
              >
                {category === "all" ? "All" : `${category}s`}
              </Button>
            ))}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-4">
            {chatLogsLoading ? (
              <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                Loading logs…
              </div>
            ) : chatLogs.length === 0 ? (
              <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                No logs recorded for this chat.
              </div>
            ) : (
              <div className="space-y-2">
                {[...chatLogs]
                  .reverse()
                  .filter((entry) => chatLogsCategory === "all" || entry.category === chatLogsCategory)
                  .map((entry) => (
                    <article key={entry.id} className="rounded-lg border border-border/60 bg-card/40 p-3">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[10px] uppercase tracking-wide text-muted-foreground">
                        <span className="font-semibold text-foreground">{entry.category}</span>
                        <span>{entry.title}</span>
                        <span>{formatCompletedAt(entry.timestamp)}</span>
                        {entry.jobId ? <span className="font-mono">{entry.jobId}</span> : null}
                      </div>
                      <pre className="mt-2 whitespace-pre-wrap break-words font-mono text-xs leading-5 text-foreground/90">
                        {entry.content || "—"}
                      </pre>
                      {entry.metadata !== undefined ? (
                        <details className="mt-2">
                          <summary className="cursor-pointer text-[10px] text-muted-foreground">
                            Raw metadata
                          </summary>
                          <pre className="mt-2 max-h-64 overflow-auto rounded bg-muted/30 p-2 font-mono text-[10px] leading-4 text-muted-foreground">
                            {JSON.stringify(entry.metadata, null, 2)}
                          </pre>
                        </details>
                      ) : null}
                    </article>
                  ))}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <ProviderSetupDialog
        open={providerSetupOpen}
        onOpenChange={setProviderSetupOpen}
        onConnected={() => {
          void refreshStatus();
          void loadModels();
        }}
        onStartChat={() => {
          openDraft();
          window.requestAnimationFrame(() => textareaRef.current?.focus());
        }}
      />

      <SettingsPanel
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        memories={memories}
        notificationsEnabled={notificationsEnabled}
        onNotificationsEnabledChange={setNotificationsEnabled}
        soundCuesEnabled={soundCuesEnabled}
        onSoundCuesEnabledChange={setSoundCuesEnabled}
        browserRealtime={browserRealtime}
        browserFps={browserFps}
        browserViewportWidth={browserDefaultViewport.width}
        browserViewportHeight={browserDefaultViewport.height}
        onBrowserSettingsChange={updateBrowserSettings}
        models={models}
        modelId={defaultModelId}
        onModelIdChange={updateDefaultModel}
        modelParams={defaultModelParams}
        onModelParamsChange={updateDefaultModelParams}
        favoriteModelKeys={favoriteModelKeys}
        onToggleFavoriteModel={toggleFavoriteModel}
        subagentModelEnabled={subagentModelEnabled}
        onSubagentModelEnabledChange={updateSubagentModelEnabled}
        subagentModelId={subagentModelId}
        onSubagentModelIdChange={updateSubagentModelId}
        subagentModelParams={subagentModelParams}
        onSubagentModelParamsChange={updateSubagentModelParams}
        finishSound={finishSound}
        onFinishSoundChange={(sound) => {
          setFinishSound(sound);
          saveFinishSound(sound);
        }}
        onTestFinishSound={playFinishSound}
        onMemoriesChanged={() => void loadMemories()}
        onChatsChanged={() => void loadChats()}
        onModelsChanged={() => void loadModels()}
        onLogout={() => void logout()}
      />

      <Dialog open={Boolean(activeDiff)} onOpenChange={(open) => !open && setActiveDiff(null)}>
        <DialogContent className="h-[100dvh] max-h-none w-screen min-w-0 max-w-none overflow-x-hidden rounded-none p-4 sm:h-auto sm:max-h-[90vh] sm:max-w-3xl sm:rounded-xl sm:p-6">
          <DialogHeader>
            <DialogTitle>File diff</DialogTitle>
          </DialogHeader>
          {activeDiff ? <DiffViewer active={activeDiff} /> : null}
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(activeRawTool)} onOpenChange={(open) => !open && setActiveRawTool(null)}>
        <DialogContent className="max-h-[90vh] max-w-3xl">
          <DialogHeader>
            <DialogTitle>Raw tool information</DialogTitle>
          </DialogHeader>
          {activeRawTool ? (
            <pre className="max-h-[70vh] overflow-auto rounded-lg bg-muted/30 p-3 font-mono text-xs leading-5">
              {JSON.stringify(activeRawTool, null, 2)}
            </pre>
          ) : null}
        </DialogContent>
      </Dialog>

      <AttachmentViewer active={activeAttachment} onOpenChange={(open) => !open && setActiveAttachment(null)} />

      <Dialog open={Boolean(activeSubagent)} onOpenChange={(open) => !open && setActiveSubagent(null)}>
        <DialogContent className="h-[100dvh] max-h-none w-screen max-w-none rounded-none p-4 sm:h-auto sm:max-h-[90vh] sm:max-w-4xl sm:rounded-xl sm:p-6">
          <DialogHeader>
            <div className="flex flex-wrap items-center gap-2">
              <DialogTitle>{activeSubagent?.subagent?.title || activeSubagent?.subagent?.prompt || "Subagent chat"}</DialogTitle>
            </div>
            {activeSubagent ? (
              <p className="text-left text-xs text-muted-foreground">
                {activeSubagent.status === "running" ? "Running" : activeSubagent.status}
                {activeSubagent.name ? ` · ${activeSubagent.name}` : ""}
                {activeSubagent.subagent?.agentId ? ` · ${activeSubagent.subagent.agentId}` : ""}
                {activeSubagent.subagent?.mode ? ` · ${activeSubagent.subagent.mode}` : ""}
                {activeSubagent.subagent?.model ? ` · model: ${activeSubagent.subagent.model}` : ""}
              </p>
            ) : null}
          </DialogHeader>
          {activeSubagent ? (
            <div className="min-h-0 flex-1 max-h-[calc(100dvh-7rem)] space-y-4 overflow-y-auto pr-1 sm:max-h-[75vh]">
              {activeSubagent.subagent?.prompt || activeSubagent.input ? (
                <div className="ml-auto max-w-[85%] rounded-2xl rounded-tr-sm bg-primary/15 px-4 py-3 text-sm text-foreground">
                  <p className="mb-1 text-[10px] font-medium uppercase tracking-wide text-primary/70">Task</p>
                  <p className="whitespace-pre-wrap">{activeSubagent.subagent?.prompt || activeSubagent.input}</p>
                </div>
              ) : null}
              {activeSubagent.subagent?.messages?.map((message, index) => (
                <div
                  key={`${message.timestamp ?? "message"}-${index}`}
                  className={cn(
                    "max-w-[85%] rounded-2xl px-4 py-3 text-sm",
                    message.role.toLowerCase().includes("user") || message.role.toLowerCase().includes("task")
                      ? "ml-auto rounded-tr-sm bg-primary/15 text-foreground"
                      : message.role.toLowerCase().includes("tool") || message.role.toLowerCase().includes("system")
                        ? "mx-auto max-w-[92%] rounded-lg bg-muted/40 text-muted-foreground"
                        : "rounded-tl-sm border border-border/50 bg-muted/20 text-foreground/90",
                  )}
                >
                  <p className="mb-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{message.role}</p>
                  {message.role.toLowerCase().includes("assistant") ? (
                    <Markdown content={message.text} />
                  ) : (
                    <p className="whitespace-pre-wrap break-words">{message.text}</p>
                  )}
                </div>
              ))}
              {!activeSubagent.subagent?.messages?.length && activeSubagent.result ? (
                <div className="rounded-2xl rounded-tl-sm border border-border/50 bg-muted/20 px-4 py-3 text-sm">
                  <p className="mb-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Result</p>
                  <p className="whitespace-pre-wrap break-words">{activeSubagent.result}</p>
                </div>
              ) : null}
              {!activeSubagent.subagent?.messages?.length && !activeSubagent.result ? (
                <p className="text-sm text-muted-foreground">{activeSubagent.detail || "No conversation details available yet."}</p>
              ) : null}
            </div>
          ) : null}
          {activeSubagent?.status === "running" ? (
            <DialogFooter>
              <Button type="button" variant="destructive" onClick={() => void cancelSubagent()} disabled={cancellingSubagent}>
                {cancellingSubagent ? "Cancelling…" : "Stop agent"}
              </Button>
            </DialogFooter>
          ) : null}
        </DialogContent>
      </Dialog>

      <Dialog
        open={manualCleanupTools.length > 0}
        onOpenChange={(open) => !open && setManualCleanupTools([])}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Tool calls needing manual cleanup</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            These external actions could not be reverted automatically:
          </p>
          <ul className="flex max-h-64 flex-col gap-2 overflow-y-auto rounded-lg border border-border/60 bg-muted/20 p-3 text-sm">
            {manualCleanupTools.map((toolName, index) => (
              <li key={`${toolName}-${index}`} className="break-words font-mono text-xs">
                {toolName}
              </li>
            ))}
          </ul>
          <DialogFooter>
            <Button variant="outline" onClick={() => setManualCleanupTools([])}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(revertTarget)}
        onOpenChange={(open) => !open && !reverting && setRevertTarget(null)}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Revert this message and open it for editing?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            File changes with captured snapshots are reverted, including writes and
            deletions. Shell commands and other external actions cannot always be
            undone and may require manual cleanup. Everything after the selected user
            message will be removed from this chat, then the message will open for
            editing. You can edit
            it and resend it as a new request.
          </p>
          <DialogFooter>
            <Button
              variant="ghost"
              disabled={reverting}
              onClick={() => setRevertTarget(null)}
            >
              Cancel
            </Button>
            <Button disabled={reverting} onClick={() => void confirmRevert()}>
              <Undo2 className="size-3.5" />
              {reverting ? "Reverting…" : "Revert"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={renameOpen} onOpenChange={setRenameOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Rename</DialogTitle>
          </DialogHeader>
          <Input
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void submitRename();
              }
            }}
            autoFocus
          />
          <DialogFooter>
            <Button variant="ghost" onClick={() => setRenameOpen(false)}>
              Cancel
            </Button>
            <Button onClick={() => void submitRename()}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
