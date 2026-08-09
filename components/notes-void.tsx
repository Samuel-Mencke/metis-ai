"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Maximize2, Palette, Plus, RefreshCw, Search, Trash2, ZoomIn, ZoomOut } from "lucide-react";
import type { SharedNote } from "@/lib/store";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EditableMarkdown } from "@/components/editable-markdown";
import { cn } from "@/lib/utils";

type View = { x: number; y: number; zoom: number };
type DragState = { id: string; dx: number; dy: number } | null;

const NOTE_COLORS = ["#fef08a", "#bfdbfe", "#bbf7d0", "#fecdd3", "#ddd6fe", "#fed7aa"];

function requestKey() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random()}`;
}

export function NotesVoid() {
  const [notes, setNotes] = useState<SharedNote[]>([]);
  const [search, setSearch] = useState("");
  const [view, setView] = useState<View>({ x: 0, y: 0, zoom: 1 });
  const [drag, setDrag] = useState<DragState>(null);
  const [status, setStatus] = useState<"idle" | "loading" | "saving" | "saved" | "offline" | "error">("idle");
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
      params.set("scope", "global");
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
  }, []);

  useEffect(() => {
    const timers = saveTimers.current;
    void load();
    return () => {
      loadAbortRef.current?.abort();
      for (const timer of timers.values()) window.clearTimeout(timer);
    };
  }, [load]);

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

  const visibleNotes = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    return query
      ? notes.filter((note) => `${note.title}\n${note.content}`.toLocaleLowerCase().includes(query))
      : notes;
  }, [notes, search]);

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
          title: "New note",
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
    if (!window.confirm(`Delete "${note.title}"?`)) return;
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

  const fitAll = () => {
    if (!notes.length) {
      setView({ x: 0, y: 0, zoom: 1 });
      return;
    }
    const minX = Math.min(...notes.map((note) => note.position.x));
    const minY = Math.min(...notes.map((note) => note.position.y));
    const maxX = Math.max(...notes.map((note) => note.position.x + note.size.width));
    const maxY = Math.max(...notes.map((note) => note.position.y + note.size.height));
    const bounds = surfaceRef.current?.getBoundingClientRect();
    const zoom = Math.max(0.25, Math.min(1.5, Math.min(
      (bounds?.width || 800) / Math.max(320, maxX - minX + 80),
      (bounds?.height || 600) / Math.max(260, maxY - minY + 80),
    )));
    setView({ x: -minX * zoom + 40, y: -minY * zoom + 40, zoom });
  };

  const localPoint = (event: React.PointerEvent) => {
    const bounds = surfaceRef.current?.getBoundingClientRect();
    if (!bounds) return { x: 0, y: 0 };
    return {
      x: (event.clientX - bounds.left - view.x) / view.zoom,
      y: (event.clientY - bounds.top - view.y) / view.zoom,
    };
  };

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-border/40 bg-muted/10">
      <div className="flex shrink-0 flex-wrap items-center gap-1.5 border-b border-border/40 px-2 py-1.5">
        <Button type="button" size="xs" onClick={() => void create()}><Plus className="size-3.5" />New note</Button>
        <Button type="button" size="icon-xs" variant="ghost" title="Fit all notes" aria-label="Fit all notes" onClick={fitAll}><Maximize2 className="size-3.5" /></Button>
        <Button type="button" size="icon-xs" variant="ghost" title="Zoom out" aria-label="Zoom out" onClick={() => setView((current) => ({ ...current, zoom: Math.max(0.2, current.zoom - 0.1) }))}><ZoomOut className="size-3.5" /></Button>
        <Button type="button" size="icon-xs" variant="ghost" title="Zoom in" aria-label="Zoom in" onClick={() => setView((current) => ({ ...current, zoom: Math.min(3, current.zoom + 0.1) }))}><ZoomIn className="size-3.5" /></Button>
        <Button type="button" size="icon-xs" variant="ghost" title="Reload notes" aria-label="Reload notes" onClick={() => void load()}><RefreshCw className="size-3.5" /></Button>
        <div className="relative ml-auto min-w-32 flex-1 sm:max-w-56">
          <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search notes" className="h-7 pl-7 text-xs" />
        </div>
        <span className={cn("text-[10px]", status === "error" || status === "offline" ? "text-destructive" : "text-muted-foreground")}>
          {status === "loading" ? "Loading…" : status === "saving" ? "Saving…" : status === "offline" ? "Offline" : status === "error" ? "Error" : status === "saved" ? "Saved" : `${visibleNotes.length} notes`}
        </span>
      </div>
      {error ? <div className="flex shrink-0 items-center justify-between gap-2 border-b border-destructive/30 bg-destructive/10 px-2 py-1 text-[11px] text-destructive"><span className="truncate">{error}</span><Button type="button" size="xs" variant="ghost" onClick={() => void load()}>Retry</Button></div> : null}
      <div
        ref={surfaceRef}
        className="relative min-h-0 flex-1 touch-none overflow-hidden bg-[radial-gradient(circle_at_1px_1px,hsl(var(--foreground)/0.2)_1px,transparent_0)] [background-size:24px_24px]"
        onPointerDown={(event) => {
          if (event.target !== event.currentTarget) return;
          const point = localPoint(event);
          setDrag({ id: "__pan__", dx: point.x, dy: point.y });
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={(event) => {
          if (!drag) return;
          const point = localPoint(event);
          if (drag.id === "__pan__") {
            setView((current) => ({ ...current, x: current.x + (point.x - drag.dx) * current.zoom, y: current.y + (point.y - drag.dy) * current.zoom }));
            return;
          }
          const note = notes.find((item) => item.id === drag.id);
          if (!note) return;
          scheduleUpdate(note, { position: { x: point.x - drag.dx, y: point.y - drag.dy } });
        }}
        onPointerUp={(event) => {
          setDrag(null);
          if (surfaceRef.current?.hasPointerCapture(event.pointerId)) surfaceRef.current.releasePointerCapture(event.pointerId);
        }}
        onPointerCancel={() => setDrag(null)}
        onWheel={(event) => {
          event.preventDefault();
          if (event.ctrlKey || event.metaKey) {
            setView((current) => ({ ...current, zoom: Math.max(0.2, Math.min(3, current.zoom * (event.deltaY > 0 ? 0.9 : 1.1))) }));
          } else {
            setView((current) => ({ ...current, x: current.x - event.deltaX, y: current.y - event.deltaY }));
          }
        }}
      >
        {visibleNotes.map((note) => (
          <article
            key={note.id}
            className="absolute flex flex-col overflow-hidden rounded-md border border-black/10 shadow-md"
            style={{
              left: note.position.x * view.zoom + view.x,
              top: note.position.y * view.zoom + view.y,
              width: note.size.width * view.zoom,
              minHeight: note.size.height * view.zoom,
              backgroundColor: note.color,
            }}
            onPointerDown={(event) => {
              event.stopPropagation();
              const point = localPoint(event);
              setDrag({ id: note.id, dx: point.x - note.position.x, dy: point.y - note.position.y });
              surfaceRef.current?.setPointerCapture(event.pointerId);
            }}
          >
            <div className="flex items-center gap-1 border-b border-black/10 px-2 py-1">
              <Input
                value={note.title}
                onChange={(event) => scheduleUpdate(note, { title: event.target.value })}
                className="h-6 min-w-0 flex-1 border-0 bg-transparent px-0 text-xs font-semibold text-black outline-none focus-visible:ring-0"
                aria-label="Note title"
                onPointerDown={(event) => event.stopPropagation()}
              />
              <div className="flex items-center">
                <Palette className="mr-1 size-3 text-black/60" />
                <select
                  value={note.color}
                  onChange={(event) => void update(note, { color: event.target.value })}
                  className="h-5 w-5 cursor-pointer appearance-none bg-transparent text-[0px]"
                  aria-label="Note color"
                >
                  {NOTE_COLORS.map((color) => <option key={color} value={color}>{color}</option>)}
                </select>
              </div>
              <Button type="button" size="icon-xs" variant="ghost" className="size-6 text-black/70 hover:bg-black/10" aria-label="Delete note" onClick={(event) => { event.stopPropagation(); void remove(note); }}><Trash2 className="size-3" /></Button>
            </div>
            <EditableMarkdown
              value={note.content}
              onChange={(value) => scheduleUpdate(note, { content: value })}
              className="min-h-0 flex-1 bg-transparent text-xs text-black [&_.markdown-body]:text-black [&_.markdown-body_p]:my-1 [&_.markdown-body_ul]:my-1 [&_.markdown-body_ol]:my-1"
              placeholder="Write a note…"
              aria-label="Note content"
              onPointerDown={(event) => event.stopPropagation()}
            />
          </article>
        ))}
        {!visibleNotes.length ? <div className="absolute inset-0 flex items-center justify-center p-8 text-center text-xs text-muted-foreground">No notes yet. Create one to share context with the agent.</div> : null}
      </div>
    </div>
  );
}
