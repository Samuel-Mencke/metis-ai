"use client";

import { useCallback, useEffect, useState, type ChangeEvent } from "react";
import {
  Archive,
  ArchiveRestore,
  Bell,
  Brain,
  Lock,
  PlugZap,
  Plus,
  Server,
  Settings2,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import type { MemoryItem } from "@/components/memories-panel";

type StatusPayload = {
  authenticated: boolean;
  cursorApiKey: boolean;
  mcp: { ok: boolean; url: string; detail: string };
};

type McpServer = {
  id: string;
  name: string;
  kind: "remote" | "stdio";
  url?: string;
  command?: string;
  args?: string[];
  enabled?: boolean;
  configured_env_keys?: string[];
  configured_header_keys?: string[];
};

type ArchivedChat = {
  id: string;
  title: string;
  updatedAt: string;
  pinned?: boolean;
  archived?: boolean;
};

type McpDraft = {
  id: string;
  name: string;
  kind: "remote" | "stdio";
  url: string;
  command: string;
  args: string;
  env: string;
  headers: string;
};

const emptyMcpDraft: McpDraft = {
  id: "",
  name: "",
  kind: "remote",
  url: "",
  command: "",
  args: "",
  env: "",
  headers: "",
};

export type ModelParamValue = {
  value: string;
  displayName?: string;
};

export type ModelParameter = {
  id: string;
  displayName?: string;
  values: ModelParamValue[];
};

export type ModelParamSelection = {
  id: string;
  value: string;
};

export type ModelInfo = {
  id: string;
  displayName: string;
  description?: string;
  parameters?: ModelParameter[];
  defaultParams?: ModelParamSelection[];
};

export type FinishSound = {
  name: string;
  dataUrl: string;
};

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  memories: MemoryItem[];
  status: StatusPayload | null;
  notificationsEnabled: boolean;
  onNotificationsEnabledChange: (enabled: boolean) => void;
  soundCuesEnabled: boolean;
  onSoundCuesEnabledChange: (enabled: boolean) => void;
  models: ModelInfo[];
  subagentModelEnabled: boolean;
  onSubagentModelEnabledChange: (enabled: boolean) => void;
  subagentModelId: string;
  onSubagentModelIdChange: (modelId: string) => void;
  finishSound: FinishSound | null;
  onFinishSoundChange: (sound: FinishSound | null) => void;
  onTestFinishSound: () => void;
  onMemoriesChanged: () => void;
  onChatsChanged: () => void;
  onLogout: () => void;
};

export function SettingsPanel({
  open,
  onOpenChange,
  memories,
  status,
  notificationsEnabled,
  onNotificationsEnabledChange,
  soundCuesEnabled,
  onSoundCuesEnabledChange,
  models,
  subagentModelEnabled,
  onSubagentModelEnabledChange,
  subagentModelId,
  onSubagentModelIdChange,
  finishSound,
  onFinishSoundChange,
  onTestFinishSound,
  onMemoriesChanged,
  onChatsChanged,
  onLogout,
}: Props) {
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [mcpServers, setMcpServers] = useState<McpServer[]>([]);
  const [mcpLoaded, setMcpLoaded] = useState(false);
  const [mcpDraft, setMcpDraft] = useState<McpDraft>(emptyMcpDraft);
  const [mcpBusy, setMcpBusy] = useState(false);
  const [archivedChats, setArchivedChats] = useState<ArchivedChat[]>([]);
  const [archivedChatsLoaded, setArchivedChatsLoaded] = useState(false);
  const [browserNotificationsAvailable, setBrowserNotificationsAvailable] =
    useState(false);
  useEffect(() => {
    setBrowserNotificationsAvailable(
      typeof window !== "undefined" && "Notification" in window,
    );
  }, []);

  const loadMcpServers = useCallback(async () => {
    try {
      const res = await fetch("/api/mcp-servers", { cache: "no-store" });
      if (!res.ok) throw new Error("Failed to load MCP servers");
      const data = (await res.json()) as { servers?: McpServer[] };
      setMcpServers(data.servers || []);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to load MCP servers");
    } finally {
      setMcpLoaded(true);
    }
  }, []);

  const loadArchivedChats = useCallback(async () => {
    setArchivedChatsLoaded(false);
    try {
      const res = await fetch("/api/chats?includeArchived=true", { cache: "no-store" });
      if (!res.ok) throw new Error("Failed to load archived chats");
      const data = (await res.json()) as { chats?: ArchivedChat[] };
      setArchivedChats((data.chats || []).filter((chat) => chat.archived));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to load archived chats");
    } finally {
      setArchivedChatsLoaded(true);
    }
  }, []);

  useEffect(() => {
    if (open) {
      void loadMcpServers();
      void loadArchivedChats();
    }
  }, [loadArchivedChats, loadMcpServers, open]);

  async function updateArchivedChat(id: string, archived: boolean) {
    const res = await fetch(`/api/chats/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ archived }),
    });
    if (!res.ok) {
      toast.error("Failed to update chat");
      return;
    }
    await loadArchivedChats();
    onChatsChanged();
    toast.success(archived ? "Chat archived" : "Chat restored");
  }

  async function deleteArchivedChat(id: string) {
    const res = await fetch(`/api/chats/${id}`, { method: "DELETE" });
    if (!res.ok) {
      toast.error("Failed to delete chat");
      return;
    }
    await loadArchivedChats();
    onChatsChanged();
    toast.success("Chat deleted");
  }

  async function addMemory() {
    const content = draft.trim();
    if (!content || busy) return;
    setBusy(true);
    try {
      const res = await fetch("/api/memories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(
          (err as { error?: string }).error || "Failed to add memory",
        );
      }
      setDraft("");
      onMemoriesChanged();
      toast.success("Memory saved");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to add memory");
    } finally {
      setBusy(false);
    }
  }

  async function removeMemory(id: string) {
    try {
      const res = await fetch(`/api/memories/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to delete");
      onMemoriesChanged();
      toast.success("Memory deleted");
    } catch {
      toast.error("Failed to delete memory");
    }
  }

  function parseLines(value: string) {
    const entries: Record<string, string> = {};
    for (const line of value.split(/\r?\n/).map((item) => item.trim()).filter(Boolean)) {
      const separator = line.indexOf("=");
      if (separator <= 0) throw new Error("Environment and header lines must use NAME=value");
      const key = line.slice(0, separator).trim();
      const item = line.slice(separator + 1);
      if (!/^[A-Za-z_][A-Za-z0-9-]*$/.test(key)) throw new Error(`Invalid key: ${key}`);
      entries[key] = item;
    }
    return entries;
  }

  async function saveMcpServer() {
    if (mcpBusy) return;
    setMcpBusy(true);
    try {
      if (!/^[a-z0-9][a-z0-9._-]{1,63}$/.test(mcpDraft.id)) {
        throw new Error("ID must use 2-64 lowercase characters, numbers, dots, underscores, or hyphens");
      }
      if (!mcpDraft.name.trim()) throw new Error("Name is required");
      if (mcpDraft.kind === "remote" && !mcpDraft.url.trim()) throw new Error("URL is required");
      if (mcpDraft.kind === "stdio" && !mcpDraft.command.trim()) throw new Error("Command is required");
      const env = parseLines(mcpDraft.env);
      const headers = parseLines(mcpDraft.headers);
      const body = {
        id: mcpDraft.id.trim(),
        name: mcpDraft.name.trim(),
        kind: mcpDraft.kind,
        ...(mcpDraft.url.trim() ? { url: mcpDraft.url.trim() } : {}),
        ...(mcpDraft.command.trim() ? { command: mcpDraft.command.trim() } : {}),
        ...(mcpDraft.args.trim() ? { args: mcpDraft.args.split(/\r?\n/).map((item) => item.trim()).filter(Boolean) } : {}),
        ...(Object.keys(env).length ? { env } : {}),
        ...(Object.keys(headers).length ? { headers } : {}),
      };
      const res = await fetch("/api/mcp-servers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(data.error || "Failed to save MCP server");
      setMcpDraft(emptyMcpDraft);
      await loadMcpServers();
      toast.success("MCP server saved");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to save MCP server");
    } finally {
      setMcpBusy(false);
    }
  }

  function editMcpServer(server: McpServer) {
    setMcpDraft({
      id: server.id,
      name: server.name,
      kind: server.kind,
      url: server.url || "",
      command: server.command || "",
      args: server.args?.join("\n") || "",
      env: "",
      headers: "",
    });
  }

  async function toggleMcpServer(server: McpServer) {
    const res = await fetch(`/api/mcp-servers/${encodeURIComponent(server.id)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: !server.enabled }),
    });
    if (!res.ok) {
      toast.error("Failed to update MCP server");
      return;
    }
    await loadMcpServers();
  }

  async function deleteMcpServer(server: McpServer) {
    if (!window.confirm(`Delete MCP server “${server.name}”?`)) return;
    const res = await fetch(`/api/mcp-servers/${encodeURIComponent(server.id)}`, { method: "DELETE" });
    if (!res.ok) {
      toast.error("Failed to delete MCP server");
      return;
    }
    await loadMcpServers();
    if (mcpDraft.id === server.id) setMcpDraft(emptyMcpDraft);
    toast.success("MCP server deleted");
  }

  async function toggleNotifications() {
    if (notificationsEnabled) {
      onNotificationsEnabledChange(false);
      return;
    }
    if (typeof window === "undefined" || !("Notification" in window)) return;
    if (Notification.permission === "default") {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        toast.warning(
          permission === "denied"
            ? "Browser notifications are blocked."
            : "Browser notification permission was not granted.",
        );
        return;
      }
    } else if (Notification.permission !== "granted") {
      toast.warning("Browser notifications are blocked.");
      return;
    }
    onNotificationsEnabledChange(true);
  }

  function handleFinishSoundUpload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (!file.type.startsWith("audio/")) {
      toast.error("Please choose an audio file.");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      toast.error("Custom sounds must be 5 MB or smaller.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result !== "string") return;
      onFinishSoundChange({ name: file.name, dataUrl: reader.result });
      toast.success("Custom finish sound saved");
    };
    reader.onerror = () => toast.error("Could not read the audio file.");
    reader.readAsDataURL(file);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[min(48rem,calc(100dvh-1.5rem))] min-w-[min(36rem,calc(100vw-1.5rem))] w-[calc(100%-1.5rem)] max-w-4xl flex-col gap-0 overflow-hidden rounded-2xl p-0">
        <DialogHeader className="shrink-0 border-b border-border px-6 py-5 pr-14 sm:px-8">
          <DialogTitle className="flex items-center gap-2 text-base">
            <Settings2 className="size-4 text-primary" />
            Settings
          </DialogTitle>
          <DialogDescription className="text-xs sm:text-sm">
            Manage your workspace in one place.
          </DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="general" className="min-h-0 flex-1 gap-0 md:grid md:grid-cols-[13rem_minmax(0,1fr)]">
          <TabsList className="h-auto w-full shrink-0 flex-wrap justify-start gap-1.5 rounded-none border-b border-border bg-muted/20 px-4 py-3 md:flex-nowrap md:flex-col md:items-stretch md:justify-start md:border-b-0 md:border-r md:px-3 md:py-5">
            <TabsTrigger value="general" className="min-h-10 justify-start px-3.5 py-2.5 md:w-full md:flex-none">
              <Settings2 data-icon="inline-start" />
              General
            </TabsTrigger>
            <TabsTrigger value="archived" className="min-h-10 justify-start px-3.5 py-2.5 md:w-full md:flex-none">
              <Archive data-icon="inline-start" />
              Archived chats
            </TabsTrigger>
            <TabsTrigger value="connection" className="min-h-10 justify-start px-3.5 py-2.5 md:w-full md:flex-none">
              <PlugZap data-icon="inline-start" />
              Connection
            </TabsTrigger>
            <TabsTrigger value="mcp" className="min-h-10 justify-start px-3.5 py-2.5 md:w-full md:flex-none">
              <Server data-icon="inline-start" />
              MCP Servers
            </TabsTrigger>
            <TabsTrigger value="memories" className="min-h-10 justify-start px-3.5 py-2.5 md:w-full md:flex-none">
              <Brain data-icon="inline-start" />
              Memories
              <span className="ml-1 text-xs text-muted-foreground">
                {memories.length}
              </span>
            </TabsTrigger>
            <TabsTrigger value="session" className="min-h-10 justify-start px-3.5 py-2.5 md:w-full md:flex-none">
              <Lock data-icon="inline-start" />
              Session
            </TabsTrigger>
          </TabsList>

          <div className="min-h-0 min-w-0 overflow-x-hidden overflow-y-auto">
            <TabsContent value="general" className="mt-0 px-6 py-6 sm:px-8 sm:py-8">
              <section className="flex flex-col gap-4">
                <div>
                  <h3 className="text-sm font-medium">Notifications</h3>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Get notified when the agent needs input or finishes a
                    response.
                  </p>
                </div>
                {browserNotificationsAvailable ? (
                  <>
                    <div className="flex items-center justify-between gap-4">
                      <p className="text-xs text-muted-foreground">
                        Browser notifications
                      </p>
                      <Button
                        type="button"
                        variant={notificationsEnabled ? "default" : "outline"}
                        aria-pressed={notificationsEnabled}
                        onClick={() => void toggleNotifications()}
                        className="shrink-0"
                      >
                        {notificationsEnabled ? "On" : "Off"}
                      </Button>
                    </div>
                    {Notification.permission === "denied" ? (
                      <p className="text-xs text-amber-400">
                        Notifications are blocked in this browser.
                      </p>
                    ) : null}
                  </>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    Browser notifications are unavailable.
                  </p>
                )}
                <div className="flex items-center justify-between gap-4 border-t border-border/60 pt-3">
                  <div>
                    <p className="text-xs text-muted-foreground">Sound cues</p>
                    <p className="mt-1 text-xs text-muted-foreground/70">
                      Play a sound when an agent finishes.
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant={soundCuesEnabled ? "default" : "outline"}
                    aria-pressed={soundCuesEnabled}
                    onClick={() => onSoundCuesEnabledChange(!soundCuesEnabled)}
                    className="shrink-0"
                  >
                    {soundCuesEnabled ? "On" : "Off"}
                  </Button>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Input
                    type="file"
                    accept="audio/*"
                    onChange={handleFinishSoundUpload}
                    aria-label="Upload custom finish sound"
                    className="min-w-0 flex-1"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    onClick={onTestFinishSound}
                    disabled={!soundCuesEnabled}
                  >
                    Test sound
                  </Button>
                  {finishSound ? (
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={() => onFinishSoundChange(null)}
                    >
                      Remove custom sound
                    </Button>
                  ) : null}
                </div>
                <p className="text-xs text-muted-foreground">
                  {finishSound
                    ? `Custom sound: ${finishSound.name}`
                    : "No custom sound uploaded. The default chime will be used."}
                </p>
                <div className="border-t border-border/60 pt-4">
                  <h3 className="text-sm font-medium">Subagent model</h3>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Optionally use one model for delegated subagents. When disabled, the agent chooses the model.
                  </p>
                  <div className="mt-3 flex items-center justify-between gap-4">
                    <p className="text-xs text-muted-foreground">Use a standard model</p>
                    <Button
                      type="button"
                      variant={subagentModelEnabled ? "default" : "outline"}
                      aria-pressed={subagentModelEnabled}
                      onClick={() => onSubagentModelEnabledChange(!subagentModelEnabled)}
                      className="shrink-0"
                    >
                      {subagentModelEnabled ? "On" : "Off"}
                    </Button>
                  </div>
                  <select
                    value={subagentModelId}
                    onChange={(event) => onSubagentModelIdChange(event.target.value)}
                    disabled={!subagentModelEnabled || models.length === 0}
                    aria-label="Standard subagent model"
                    className="mt-3 h-9 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <option value="" disabled>Select a model</option>
                    {models.map((model) => (
                      <option key={model.id} value={model.id}>
                        {model.displayName}
                      </option>
                    ))}
                  </select>
                </div>
              </section>
            </TabsContent>

            <TabsContent value="archived" className="mt-0 px-6 py-6 sm:px-8 sm:py-8">
              <section className="flex flex-col gap-4">
                <div>
                  <h3 className="flex items-center gap-2 text-sm font-medium">
                    <Archive className="size-4 text-muted-foreground" />
                    Archived chats
                  </h3>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Archived chats disappear from the sidebar but remain available in chat search.
                  </p>
                </div>
                {!archivedChatsLoaded ? (
                  <div className="rounded-lg border border-dashed border-border px-3 py-8 text-center text-sm text-muted-foreground">
                    Loading archived chats…
                  </div>
                ) : archivedChats.length === 0 ? (
                  <div className="rounded-lg border border-dashed border-border px-3 py-8 text-center text-sm text-muted-foreground">
                    No archived chats.
                  </div>
                ) : (
                  <ul className="flex flex-col gap-2">
                    {archivedChats.map((chat) => (
                      <li
                        key={chat.id}
                        className="flex items-center gap-3 rounded-lg border border-border/60 bg-card/40 p-3"
                      >
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium">{chat.title || "Untitled"}</p>
                          <p className="mt-0.5 text-xs text-muted-foreground">
                            Archived chat
                          </p>
                        </div>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() => void updateArchivedChat(chat.id, false)}
                        >
                          <ArchiveRestore className="size-3.5" />
                          Restore
                        </Button>
                        <Button
                          type="button"
                          size="icon-sm"
                          variant="ghost"
                          aria-label={`Delete ${chat.title || "archived chat"}`}
                          onClick={() => void deleteArchivedChat(chat.id)}
                        >
                          <Trash2 className="size-3.5" />
                        </Button>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </TabsContent>

            <TabsContent value="connection" className="mt-0 px-6 py-6 sm:px-8 sm:py-8">
              <section className="flex flex-col gap-3">
                <div>
                  <h3 className="text-sm font-medium">Connection status</h3>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Check the services used by this chat.
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Badge
                    variant="outline"
                    className={cn(
                      "text-xs",
                      status?.mcp.ok
                        ? "border-emerald-500/40 text-emerald-400"
                        : "border-red-500/40 text-red-400",
                    )}
                    title={status?.mcp.detail}
                  >
                    MCP {status?.mcp.ok ? "ok" : "down"}
                  </Badge>
                  <Badge
                    variant="outline"
                    className={cn(
                      "text-xs",
                      status?.cursorApiKey
                        ? "border-emerald-500/40 text-emerald-400"
                        : "border-amber-500/40 text-amber-400",
                    )}
                  >
                    API key {status?.cursorApiKey ? "set" : "missing"}
                  </Badge>
                </div>
                {status?.mcp.url ? (
                  <p className="break-all text-xs text-muted-foreground">
                    {status.mcp.url}
                    {status.mcp.detail ? ` · ${status.mcp.detail}` : ""}
                  </p>
                ) : null}
              </section>
            </TabsContent>

            <TabsContent value="mcp" className="mt-0 px-6 py-6 sm:px-8 sm:py-8">
              <section className="flex flex-col gap-4">
                <div>
                  <h3 className="text-sm font-medium">Custom MCP servers</h3>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Add remote HTTP or local stdio MCP servers. Secret values are write-only.
                  </p>
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                  <Input
                    value={mcpDraft.id}
                    onChange={(e) => setMcpDraft((current) => ({ ...current, id: e.target.value }))}
                    placeholder="server-id"
                    aria-label="MCP server ID"
                  />
                  <Input
                    value={mcpDraft.name}
                    onChange={(e) => setMcpDraft((current) => ({ ...current, name: e.target.value }))}
                    placeholder="Display name"
                    aria-label="MCP server name"
                  />
                </div>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant={mcpDraft.kind === "remote" ? "default" : "outline"}
                    onClick={() => setMcpDraft((current) => ({ ...current, kind: "remote" }))}
                  >
                    Remote HTTP
                  </Button>
                  <Button
                    type="button"
                    variant={mcpDraft.kind === "stdio" ? "default" : "outline"}
                    onClick={() => setMcpDraft((current) => ({ ...current, kind: "stdio" }))}
                  >
                    Local stdio
                  </Button>
                </div>
                {mcpDraft.kind === "remote" ? (
                  <Input
                    value={mcpDraft.url}
                    onChange={(e) => setMcpDraft((current) => ({ ...current, url: e.target.value }))}
                    placeholder="https://example.com/mcp"
                    aria-label="MCP server URL"
                  />
                ) : (
                  <>
                    <Input
                      value={mcpDraft.command}
                      onChange={(e) => setMcpDraft((current) => ({ ...current, command: e.target.value }))}
                      placeholder="npx"
                      aria-label="MCP command"
                    />
                    <Textarea
                      value={mcpDraft.args}
                      onChange={(e) => setMcpDraft((current) => ({ ...current, args: e.target.value }))}
                      placeholder={"One argument per line\n-y\n@modelcontextprotocol/server-filesystem\n/path/to/allowed-directory"}
                      aria-label="MCP arguments"
                      rows={4}
                    />
                  </>
                )}
                <div className="grid gap-3 sm:grid-cols-2">
                  <Textarea
                    value={mcpDraft.env}
                    onChange={(e) => setMcpDraft((current) => ({ ...current, env: e.target.value }))}
                    placeholder={"Environment (NAME=value)\nAPI_KEY=..."}
                    aria-label="MCP environment"
                    rows={4}
                  />
                  <Textarea
                    value={mcpDraft.headers}
                    onChange={(e) => setMcpDraft((current) => ({ ...current, headers: e.target.value }))}
                    placeholder={"Headers (NAME=value)\nAuthorization=Bearer ..."}
                    aria-label="MCP headers"
                    rows={4}
                  />
                </div>
                <div className="flex gap-2">
                  <Button type="button" onClick={() => void saveMcpServer()} disabled={mcpBusy}>
                    {mcpBusy ? "Saving…" : "Save server"}
                  </Button>
                  <Button type="button" variant="ghost" onClick={() => setMcpDraft(emptyMcpDraft)}>
                    Clear
                  </Button>
                </div>
                <ul className="flex flex-col gap-2">
                  {!mcpLoaded ? (
                    [0, 1, 2].map((item) => (
                      <li key={item} className="space-y-2 rounded-lg border border-border/60 bg-card/40 p-3" aria-label="Loading MCP servers" role="status">
                        <Skeleton className="h-4 w-2/5" />
                        <Skeleton className="h-3 w-3/5" />
                      </li>
                    ))
                  ) : mcpServers.map((server) => (
                    <li key={server.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-border/60 bg-card/40 p-3">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{server.name}</p>
                        <p className="truncate text-xs text-muted-foreground">
                          {server.id} · {server.kind} · {server.enabled ? "enabled" : "disabled"}
                        </p>
                        {(server.configured_env_keys?.length || server.configured_header_keys?.length) ? (
                          <p className="mt-1 text-xs text-muted-foreground">
                            Secrets configured: {[...(server.configured_env_keys || []), ...(server.configured_header_keys || [])].join(", ")}
                          </p>
                        ) : null}
                      </div>
                      <Button type="button" size="sm" variant="outline" onClick={() => void toggleMcpServer(server)}>
                        {server.enabled ? "Disable" : "Enable"}
                      </Button>
                      <Button type="button" size="sm" variant="ghost" onClick={() => editMcpServer(server)}>
                        Edit
                      </Button>
                      <Button type="button" size="icon-sm" variant="ghost" onClick={() => void deleteMcpServer(server)} aria-label={`Delete ${server.name}`}>
                        <Trash2 className="size-3.5" />
                      </Button>
                    </li>
                  ))}
                </ul>
              </section>
            </TabsContent>

            <TabsContent value="memories" className="mt-0 px-6 py-6 sm:px-8 sm:py-8">
              <section className="flex flex-col gap-3">
                <div>
                  <h3 className="text-sm font-medium">Memories</h3>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Durable facts injected into every turn. The agent can
                    write these itself.
                  </p>
                </div>
                <div className="flex gap-2">
                  <Input
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    placeholder="Add a memory…"
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        void addMemory();
                      }
                    }}
                  />
                  <Button
                    size="icon"
                    onClick={() => void addMemory()}
                    disabled={busy || !draft.trim()}
                    aria-label="Add memory"
                  >
                    <Plus className="size-4" />
                  </Button>
                </div>
                <ul className="flex flex-col gap-2">
                  {memories.length === 0 ? (
                    <li className="rounded-lg border border-dashed border-border px-3 py-8 text-center text-sm text-muted-foreground">
                      No memories yet.
                    </li>
                  ) : (
                    memories.map((m) => (
                      <li
                        key={m.id}
                        className="group flex items-start gap-2 rounded-lg border border-border/60 bg-card/40 p-3"
                      >
                        <div className="min-w-0 flex-1">
                          <p className="text-sm whitespace-pre-wrap">
                            {m.content}
                          </p>
                          {m.tags && m.tags.length > 0 ? (
                            <p className="mt-1 text-xs text-muted-foreground">
                              {m.tags.join(" · ")}
                            </p>
                          ) : null}
                        </div>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          className="opacity-100 sm:opacity-60 sm:group-hover:opacity-100"
                          onClick={() => void removeMemory(m.id)}
                          aria-label="Delete memory"
                        >
                          <Trash2 className="size-3.5" />
                        </Button>
                      </li>
                    ))
                  )}
                </ul>
              </section>
            </TabsContent>

            <TabsContent value="session" className="mt-0 px-6 py-6 sm:px-8 sm:py-8">
              <section className="flex flex-col gap-3">
                <div>
                  <h3 className="text-sm font-medium">Session</h3>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Lock this chat and return to the sign-in screen.
                  </p>
                </div>
                <Button
                  variant="outline"
                  className="w-full justify-start gap-2"
                  onClick={() => {
                    onOpenChange(false);
                    onLogout();
                  }}
                >
                  <Lock className="size-4" />
                  Lock screen
                </Button>
              </section>
            </TabsContent>
          </div>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
