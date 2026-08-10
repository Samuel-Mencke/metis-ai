"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { LayoutGrid, Maximize2, Palette, Plus, RefreshCw, Search, Trash2, ZoomIn, ZoomOut } from "lucide-react";
import type { SharedNote } from "@/lib/store";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EditableMarkdown } from "@/components/editable-markdown";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { cn } from "@/lib/utils";

type View = { x: number; y: number; zoom: number };
type ResizeEdge = "n" | "ne" | "e" | "se" | "s" | "sw" | "w" | "nw";
type DragState =
  | { id: string; dx: number; dy: number; mode: "move" }
  | {
      id: string;
      mode: "resize";
      edge: ResizeEdge;
      startX: number;
      startY: number;
      startWidth: number;
      startHeight: number;
      pointerX: number;
      pointerY: number;
    }
  | null;

const NOTE_COLORS = ["#fef08a", "#bfdbfe", "#bbf7d0", "#fecdd3", "#ddd6fe", "#fed7aa"];

function requestKey() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random()}`;
}

export function NotesVoid({
  chatId,
  focusNoteId,
}: {
  chatId?: string | null;
  focusNoteId?: string | null;
}) {
  const [notes, setNotes] = useState<SharedNote[]>([]);
  const [search, setSearch] = useState("");
  const [view, setView] = useState<View>({ x: 0, y: 0, zoom: 1 });
  const [drag, setDrag] = useState<DragState>(null);
  const [frontNoteId, setFrontNoteId] = useState<string | null>(null);
  const [editingTitleId, setEditingTitleId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<SharedNote | null>(null);
  const [status, setStatus] = useState<"idle" | "loading" | "saving" | "saved" | "offline" | "error">("loading");
  const [error, setError] = useState("");
  const surfaceRef = useRef<HTMLDivElement | null>(null);
  const saveTimers = useRef(new Map<string, number>());
  const loadAbortRef = useRef<AbortController | null>(null);
  const hasInitializedViewRef = useRef(false);

  const load = useCallback(async () => {
    loadAbortRef.current?.abort();
    const controller = new AbortController();
    loadAbortRef.current = controller;
    setStatus("loading");
    setError("");
    try {
      const params = new URLSearchParams();
      if (chatId) params.set("chatId", chatId);
      else params.set("scope", "global");
      const response = await fetch(`/api/notes?${params}`, { cache: "no-store", signal: controller.signal });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || "Could not load notes.");
      const next = Array.isArray(body.notes) ? body.notes as SharedNote[] : [];
      setNotes(next);
      setStatus("saved");
      if (!hasInitializedViewRef.current && next.length) {
        const minX = Math.min(...next.map((note) => note.position.x));
        const minY = Math.min(...next.map((note) => note.position.y));
        setView({ x: -minX + 40, y: -minY + 40, zoom: 1 });
        hasInitializedViewRef.current = true;
      }
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === "AbortError") return;
      setError(cause instanceof Error ? cause.message : "Could not load notes.");
      setStatus("offline");
    }
  }, [chatId]);

  useEffect(() => {
    const timers = saveTimers.current;
    void load();
    return () => {
      loadAbortRef.current?.abort();
      for (const timer of timers.values()) window.clearTimeout(timer);
    };
  }, [load]);

  useEffect(() => {
    if (!focusNoteId) return;
    const note = notes.find((item) => item.id === focusNoteId);
    if (!note) return;
    setFrontNoteId(note.id);
    setView((current) => {
      const bounds = surfaceRef.current?.getBoundingClientRect();
      return {
        ...current,
        x: (bounds?.width || 800) / 2 - (note.position.x + note.size.width / 2) * current.zoom,
        y: (bounds?.height || 600) / 2 - (note.position.y + note.size.height / 2) * current.zoom,
      };
    });
    const timer = window.setTimeout(() => setFrontNoteId(null), 2200);
    return () => window.clearTimeout(timer);
  }, [focusNoteId, notes]);

  useEffect(() => {
    const refreshOnReturn = () => {
      if (document.visibilityState === "visible") void load();
    };
    window.addEventListener("focus", refreshOnReturn);
    document.addEventListener("visibilitychange", refreshOnReturn);
    return () => {
      window.removeEventListener("focus", refreshOnReturn);
      document.removeEventListener("visibilitychange", refreshOnReturn);
    };
  }, [load]);

  useEffect(() => {
    const refreshFromAgent = () => {
      void load();
    };
    window.addEventListener("ai-chat:notes-updated", refreshFromAgent);
    return () => window.removeEventListener("ai-chat:notes-updated", refreshFromAgent);
  }, [load]);

  const visibleNotes = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    return query
      ? notes.filter((note) => note.content.toLocaleLowerCase().includes(query))
      : notes;
  }, [notes, search]);

  const orderedNotes = useMemo(
    () => [...notes].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id)),
    [notes],
  );

  const update = useCallback(async (note: SharedNote, patch: Partial<SharedNote>) => {
    setStatus("saving");
    try {
      const response = await fetch(`/api/notes/${encodeURIComponent(note.id)}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": requestKey(),
        },
        body: JSON.stringify({ ...patch, version: note.version }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        if (response.status === 409 && body.note) {
          setNotes((current) => current.map((item) => item.id === note.id ? body.note as SharedNote : item));
        }
        throw new Error(body.error || "Could not save note.");
      }
      setNotes((current) => current.map((item) => item.id === note.id ? body.note as SharedNote : item));
      setStatus("saved");
      setError("");
    } catch (cause) {
      setStatus("error");
      setError(cause instanceof Error ? cause.message : "Could not save note.");
    }
  }, []);

  const scheduleUpdate = useCallback((note: SharedNote, patch: Partial<SharedNote>) => {
    setNotes((current) => current.map((item) => item.id === note.id ? { ...item, ...patch } : item));
    const existing = saveTimers.current.get(note.id);
    if (existing) window.clearTimeout(existing);
    const timer = window.setTimeout(() => {
      const current = notes.find((item) => item.id === note.id) || note;
      void update({ ...current, ...patch }, patch);
      saveTimers.current.delete(note.id);
    }, 500);
    saveTimers.current.set(note.id, timer);
  }, [notes, update]);

  const create = async () => {
    setStatus("saving");
    try {
      const response = await fetch("/api/notes", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": requestKey() },
        body: JSON.stringify({
          scope: "global",
          content: "",
          position: { x: -view.x + 80, y: -view.y + 80 },
          color: NOTE_COLORS[notes.length % NOTE_COLORS.length],
        }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || "Could not create note.");
      setNotes((current) => [body.note as SharedNote, ...current.filter((item) => item.id !== body.note.id)]);
      await load();
      setStatus("saved");
    } catch (cause) {
      setStatus("error");
      setError(cause instanceof Error ? cause.message : "Could not create note.");
    }
  };

  const remove = async (note: SharedNote) => {
    setStatus("saving");
    try {
      const response = await fetch(`/api/notes/${encodeURIComponent(note.id)}`, {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": requestKey(),
        },
        body: JSON.stringify({ confirm: true }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || "Could not delete note.");
      setNotes((current) => current.filter((item) => item.id !== note.id));
      setStatus("saved");
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not delete note.");
      setStatus("error");
    }
  };

  const changeColor = useCallback((noteId: string) => {
    const current = notes.find((item) => item.id === noteId);
    if (!current) return;
    const pending = saveTimers.current.get(noteId);
    if (pending) {
      window.clearTimeout(pending);
      saveTimers.current.delete(noteId);
    }
    const availableColors = NOTE_COLORS.filter((color) => color !== current.color);
    const color = availableColors[Math.floor(Math.random() * availableColors.length)];
    void update(current, { color });
  }, [notes, update]);

  const fitAll = useCallback((items: SharedNote[] = notes) => {
    if (!items.length) {
      setView({ x: 0, y: 0, zoom: 1 });
      return;
    }
    const minX = Math.min(...items.map((note) => note.position.x));
    const minY = Math.min(...items.map((note) => note.position.y));
    const maxX = Math.max(...items.map((note) => note.position.x + note.size.width));
    const maxY = Math.max(...items.map((note) => note.position.y + note.size.height));
    const bounds = surfaceRef.current?.getBoundingClientRect();
    const zoom = Math.max(0.25, Math.min(1.5, Math.min(
      (bounds?.width || 800) / Math.max(320, maxX - minX + 80),
      (bounds?.height || 600) / Math.max(260, maxY - minY + 80),
    )));
    setView({ x: -minX * zoom + 40, y: -minY * zoom + 40, zoom });
  }, [notes]);

  const arrangeNotes = useCallback(() => {
    if (!notes.length) return;
    const gap = 24;
    const bounds = surfaceRef.current?.getBoundingClientRect();
    const availableWidth = Math.max(320, (bounds?.width || 960) / Math.max(view.zoom, 0.25) - 80);
    const arranged: SharedNote[] = [];
    let x = 40;
    let y = 40;
    let rowHeight = 0;

    for (const note of orderedNotes) {
      if (x > 40 && x + note.size.width > availableWidth + 40) {
        x = 40;
        y += rowHeight + gap;
        rowHeight = 0;
      }
      const position = { x, y };
      scheduleUpdate(note, { position });
      arranged.push({ ...note, position });
      x += note.size.width + gap;
      rowHeight = Math.max(rowHeight, note.size.height);
    }

    setFrontNoteId(orderedNotes.at(-1)?.id ?? null);
    window.setTimeout(() => fitAll(arranged), 0);
  }, [fitAll, notes, orderedNotes, scheduleUpdate, view.zoom]);

  const localPoint = (event: React.PointerEvent) => {
    const bounds = surfaceRef.current?.getBoundingClientRect();
    if (!bounds) return { x: 0, y: 0 };
    return {
      x: (event.clientX - bounds.left - view.x) / view.zoom,
      y: (event.clientY - bounds.top - view.y) / view.zoom,
    };
  };

  const startResize = (event: React.PointerEvent, note: SharedNote, edge: ResizeEdge) => {
    event.stopPropagation();
    event.preventDefault();
    const point = localPoint(event);
    setFrontNoteId(note.id);
    setDrag({
      id: note.id,
      mode: "resize",
      edge,
      startX: note.position.x,
      startY: note.position.y,
      startWidth: note.size.width,
      startHeight: note.size.height,
      pointerX: point.x,
      pointerY: point.y,
    });
    document.body.style.userSelect = "none";
    document.body.style.cursor = `${edge}-resize`;
    surfaceRef.current?.setPointerCapture(event.pointerId);
  };

  const zoomAt = useCallback((event: React.WheelEvent<HTMLDivElement>) => {
    const bounds = surfaceRef.current?.getBoundingClientRect();
    if (!bounds) return;

    const hoveredNote = event.target instanceof Element && event.target.closest("[data-note-card]");
    let anchorX = bounds.width / 2;
    let anchorY = bounds.height / 2;

    if (hoveredNote) {
      anchorX = event.clientX - bounds.left;
      anchorY = event.clientY - bounds.top;
    } else if (visibleNotes.length) {
      const left = Math.min(...visibleNotes.map((note) => note.position.x));
      const right = Math.max(...visibleNotes.map((note) => note.position.x + note.size.width));
      const top = Math.min(...visibleNotes.map((note) => note.position.y));
      const bottom = Math.max(...visibleNotes.map((note) => note.position.y + note.size.height));
      anchorX = ((left + right) / 2) * view.zoom + view.x;
      anchorY = ((top + bottom) / 2) * view.zoom + view.y;
    }

    setView((current) => {
      const nextZoom = Math.max(0.2, Math.min(3, current.zoom * (event.deltaY > 0 ? 0.9 : 1.1)));
      const contentX = (anchorX - current.x) / current.zoom;
      const contentY = (anchorY - current.y) / current.zoom;
      return {
        zoom: nextZoom,
        x: anchorX - contentX * nextZoom,
        y: anchorY - contentY * nextZoom,
      };
    });
  }, [view.zoom, view.x, view.y, visibleNotes]);

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-border/40 bg-muted/10">
      <div className="flex shrink-0 flex-wrap items-center gap-1.5 border-b border-border/40 px-2 py-1.5">
        <div className="relative min-w-32 flex-1 sm:max-w-56">
          <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search notes" className="h-7 pl-7 text-xs" />
        </div>
        <span className={cn("text-[10px]", status === "error" || status === "offline" ? "text-destructive" : "text-muted-foreground")}>
          {status === "loading" ? "Loading…" : status === "saving" ? "Saving…" : status === "offline" ? "Offline" : status === "error" ? "Error" : status === "saved" ? "Saved" : `${visibleNotes.length} notes`}
        </span>
        <div className="ml-auto flex shrink-0 items-center gap-1.5">
          <Button type="button" size="xs" onClick={() => void create()}><Plus className="size-3.5" />New note</Button>
          <Button type="button" size="xs" variant="ghost" title="Arrange notes in a tidy, consistent layout" aria-label="Arrange notes in a tidy, consistent layout" onClick={() => arrangeNotes()}><LayoutGrid className="size-3.5" />Arrange</Button>
          <Button type="button" size="icon-xs" variant="ghost" title="Fit all notes" aria-label="Fit all notes" onClick={() => fitAll()}><Maximize2 className="size-3.5" /></Button>
          <Button type="button" size="icon-xs" variant="ghost" title="Zoom out" aria-label="Zoom out" onClick={() => setView((current) => ({ ...current, zoom: Math.max(0.2, current.zoom - 0.1) }))}><ZoomOut className="size-3.5" /></Button>
          <Button type="button" size="icon-xs" variant="ghost" title="Zoom in" aria-label="Zoom in" onClick={() => setView((current) => ({ ...current, zoom: Math.min(3, current.zoom + 0.1) }))}><ZoomIn className="size-3.5" /></Button>
          <Button type="button" size="icon-xs" variant="ghost" title="Reload notes" aria-label="Reload notes" onClick={() => void load()}><RefreshCw className="size-3.5" /></Button>
        </div>
      </div>
      <ConfirmDialog
        open={Boolean(deleteTarget)}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title="Delete note?"
        description="Are you sure you want to delete this note? This action cannot be undone."
        confirmLabel="Delete"
        onConfirm={() => {
          if (deleteTarget) return remove(deleteTarget);
        }}
      />
      {error ? <div className="flex shrink-0 items-center justify-between gap-2 border-b border-destructive/30 bg-destructive/10 px-2 py-1 text-[11px] text-destructive"><span className="truncate">{error}</span><Button type="button" size="xs" variant="ghost" onClick={() => void load()}>Retry</Button></div> : null}
      <div
        ref={surfaceRef}
        className="relative min-h-0 flex-1 touch-none overflow-hidden"
        style={{
          backgroundColor: "var(--background)",
          backgroundImage: "radial-gradient(circle at 1px 1px, color-mix(in oklch, var(--muted-foreground) 24%, transparent) 1px, transparent 1.2px)",
          backgroundSize: `${24 * view.zoom}px ${24 * view.zoom}px`,
          backgroundPosition: `${view.x}px ${view.y}px`,
        }}
        onPointerDown={(event) => {
          if (event.target !== event.currentTarget) return;
          const point = localPoint(event);
          setDrag({ id: "__pan__", dx: point.x, dy: point.y, mode: "move" });
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={(event) => {
          if (!drag) return;
          const point = localPoint(event);
          if (drag.mode === "move" && drag.id === "__pan__") {
            setView((current) => ({ ...current, x: current.x + (point.x - drag.dx) * current.zoom, y: current.y + (point.y - drag.dy) * current.zoom }));
            return;
          }
          const note = notes.find((item) => item.id === drag.id);
          if (!note) return;
          if (drag.mode === "resize") {
            const deltaX = point.x - drag.pointerX;
            const deltaY = point.y - drag.pointerY;
            const minWidth = 160;
            const minHeight = 120;
            const nextWidth = drag.edge.includes("w")
              ? Math.max(minWidth, drag.startWidth - deltaX)
              : drag.edge.includes("e")
                ? Math.max(minWidth, drag.startWidth + deltaX)
                : drag.startWidth;
            const nextHeight = drag.edge.includes("n")
              ? Math.max(minHeight, drag.startHeight - deltaY)
              : drag.edge.includes("s")
                ? Math.max(minHeight, drag.startHeight + deltaY)
                : drag.startHeight;
            scheduleUpdate(note, {
              position: {
                x: drag.edge.includes("w")
                  ? drag.startX + (drag.startWidth - nextWidth)
                  : drag.startX,
                y: drag.edge.includes("n")
                  ? drag.startY + (drag.startHeight - nextHeight)
                  : drag.startY,
              },
              size: {
                width: nextWidth,
                height: nextHeight,
              },
            });
          } else {
            scheduleUpdate(note, { position: { x: point.x - drag.dx, y: point.y - drag.dy } });
          }
        }}
        onPointerUp={(event) => {
          setDrag(null);
          document.body.style.removeProperty("user-select");
          document.body.style.removeProperty("cursor");
          if (surfaceRef.current?.hasPointerCapture(event.pointerId)) surfaceRef.current.releasePointerCapture(event.pointerId);
        }}
        onPointerCancel={() => {
          setDrag(null);
          document.body.style.removeProperty("user-select");
          document.body.style.removeProperty("cursor");
        }}
        onWheel={(event) => {
          if (event.target instanceof Element && event.target.closest(".editable-markdown")) return;
          event.preventDefault();
          if (event.altKey || event.ctrlKey || event.metaKey) {
            zoomAt(event);
          } else {
            setView((current) => ({ ...current, x: current.x - event.deltaX, y: current.y - event.deltaY }));
          }
        }}
      >
        {[...visibleNotes].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id)).map((note, index) => (
          <article
            key={note.id}
            data-note-card
            className={cn(
              "sticky-note absolute flex flex-col overflow-hidden rounded-md border border-black/10 shadow-md transition-shadow",
              note.id === frontNoteId && "ring-4 ring-primary ring-offset-2 ring-offset-background",
            )}
            style={{
              left: note.position.x * view.zoom + view.x,
              top: note.position.y * view.zoom + view.y,
              width: note.size.width,
              height: note.size.height,
              transform: `scale(${view.zoom})`,
              transformOrigin: "top left",
              backgroundColor: note.color,
              ["--note-color" as string]: note.color,
              zIndex: note.id === frontNoteId ? visibleNotes.length + 1 : index + 1,
            }}
            onPointerDown={(event) => {
              event.stopPropagation();
              event.preventDefault();
              setFrontNoteId(note.id);
              const point = localPoint(event);
              setDrag({ id: note.id, dx: point.x - note.position.x, dy: point.y - note.position.y, mode: "move" });
              document.body.style.userSelect = "none";
              document.body.style.cursor = "move";
              surfaceRef.current?.setPointerCapture(event.pointerId);
            }}
          >
            <div className="flex select-none items-center gap-1 border-b border-black/10 px-2 py-1">
              {editingTitleId === note.id ? (
                <Input
                  autoFocus
                  value={note.title}
                  onChange={(event) => scheduleUpdate(note, { title: event.target.value })}
                  onBlur={() => setEditingTitleId(null)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === "Escape") {
                      event.preventDefault();
                      event.currentTarget.blur();
                    }
                  }}
                  className="h-6 min-w-0 flex-1 border-0 bg-transparent px-0 text-xs font-semibold text-black shadow-none focus-visible:ring-0"
                  aria-label="Note title"
                  onPointerDown={(event) => {
                    event.stopPropagation();
                    setFrontNoteId(note.id);
                  }}
                />
              ) : (
                <button
                  type="button"
                  className="min-w-0 flex-1 truncate bg-transparent px-0 text-left text-xs font-semibold text-black outline-none"
                  onClick={(event) => {
                    event.stopPropagation();
                    setEditingTitleId(note.id);
                  }}
                  onPointerDown={(event) => {
                    event.stopPropagation();
                    setFrontNoteId(note.id);
                  }}
                  aria-label={`Edit note title: ${note.title}`}
                >
                  {note.title || "Untitled note"}
                </button>
              )}
              <Button
                type="button"
                size="icon-xs"
                variant="ghost"
                className="size-6 text-black/70 hover:bg-black/10"
                aria-label="Change note color"
                title="Change note color"
                onPointerDown={(event) => {
                  event.stopPropagation();
                  setFrontNoteId(note.id);
                }}
                onClick={(event) => {
                  event.stopPropagation();
                  changeColor(note.id);
                }}
              >
                <Palette className="size-3" />
              </Button>
              <Button
                type="button"
                size="icon-xs"
                variant="ghost"
                className="size-6 text-black/70 hover:bg-black/10"
                aria-label="Delete note"
                onPointerDown={(event) => {
                  event.stopPropagation();
                  setFrontNoteId(note.id);
                }}
                onClick={(event) => {
                  event.stopPropagation();
                  setDeleteTarget(note);
                }}
              >
                <Trash2 className="size-3" />
              </Button>
            </div>
            <EditableMarkdown
              value={note.content}
              onChange={(value) => scheduleUpdate(note, { content: value })}
              className="min-h-0 flex-1 bg-transparent text-xs text-black [&_.markdown-body]:text-black [&_.markdown-body_p]:my-1 [&_.markdown-body_ul]:my-1 [&_.markdown-body_ol]:my-1"
              placeholder="Write a note…"
              aria-label="Note content"
              onPointerDown={(event) => {
                event.stopPropagation();
                setFrontNoteId(note.id);
              }}
            />
            {([
              ["n", "inset-x-1/2 top-0 h-2 w-1/2 -translate-x-1/2 cursor-ns-resize"],
              ["ne", "right-0 top-0 size-3 cursor-nesw-resize"],
              ["e", "inset-y-1/2 right-0 h-1/2 w-2 -translate-y-1/2 cursor-ew-resize"],
              ["se", "bottom-0 right-0 size-3 cursor-nwse-resize"],
              ["s", "inset-x-1/2 bottom-0 h-2 w-1/2 -translate-x-1/2 cursor-ns-resize"],
              ["sw", "bottom-0 left-0 size-3 cursor-nesw-resize"],
              ["w", "inset-y-1/2 left-0 h-1/2 w-2 -translate-y-1/2 cursor-ew-resize"],
              ["nw", "left-0 top-0 size-3 cursor-nwse-resize"],
            ] as const).map(([edge, className]) => (
              <div
                key={edge}
                role="separator"
                aria-label={`Resize note ${edge}`}
                title="Resize note"
                className={cn("absolute z-10 touch-none select-none", className)}
                onPointerDown={(event) => startResize(event, note, edge)}
              />
            ))}
          </article>
        ))}
        {status === "loading" ? (
          <div className="absolute inset-0 flex items-center justify-center gap-2 p-8 text-center text-xs text-muted-foreground">
            <RefreshCw className="size-4 animate-spin" aria-hidden="true" />
            Loading notes…
          </div>
        ) : !visibleNotes.length ? (
          <div className="absolute inset-0 flex items-center justify-center p-8 text-center text-xs text-muted-foreground">
            No notes yet. Create one to share context with the agent.
          </div>
        ) : null}
      </div>
    </div>
  );
}
