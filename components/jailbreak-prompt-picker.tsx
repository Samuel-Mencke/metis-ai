"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ArrowRight, Copy, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

type Prompt = {
  id: string;
  title: string;
  text: string;
  category: string;
  categoryLabel: string;
  models: string[];
  kind: "technique" | "model-specific";
};

type Data = { meta: Record<string, unknown>; prompts: Prompt[] };

type Props = {
  modelDisplayName?: string;
  onPick: (text: string) => void;
  className?: string;
};

let dataCache: Data | null = null;
let inflight: Promise<Data | null> | null = null;

async function loadData(): Promise<Data | null> {
  if (dataCache) return dataCache;
  if (inflight) return inflight;
  inflight = fetch("/prompts.json")
    .then((r) => (r.ok ? r.json() : null))
    .then((d) => {
      dataCache = d;
      return d;
    })
    .catch(() => null);
  return inflight;
}

function highlightMatches(text: string, query: string): ReactNode {
  const normalized = query.trim();
  if (!normalized) return text;
  const pattern = new RegExp(`(${normalized.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "gi");
  return text.split(pattern).map((part, index) =>
    part.toLowerCase() === normalized.toLowerCase() ? (
      <mark key={`${part}-${index}`} className="rounded bg-primary/20 px-0.5 text-primary">
        {part}
      </mark>
    ) : (
      <span key={`${part}-${index}`}>{part}</span>
    ),
  );
}

export function JailbreakPromptPicker({ modelDisplayName, onPick, className }: Props) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<Data | null>(null);
  const [query, setQuery] = useState("");
  const [cat, setCat] = useState("all");
  const [model, setModel] = useState("all");
  const [activeIndex, setActiveIndex] = useState(0);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setActiveIndex(0);
    let alive = true;
    void loadData().then((d) => {
      if (!alive || !d) return;
      setData(d);
      if (modelDisplayName) {
        const key = modelDisplayName.toLowerCase().split(" ")[0];
        const match = d.prompts
          .flatMap((p) => p.models)
          .find((m) => m.toLowerCase().includes(key));
        if (match) setModel(match);
      }
    });
    const timer = window.setTimeout(() => inputRef.current?.focus(), 0);
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [open, modelDisplayName]);

  const models = useMemo(() => {
    if (!data) return [];
    const s = new Set<string>();
    data.prompts.forEach((p) => p.models.forEach((m) => s.add(m)));
    return [...s].sort();
  }, [data]);

  const categories = useMemo(() => {
    if (!data) return [] as { id: string; label: string; count: number }[];
    const map = new Map<string, { label: string; count: number }>();
    data.prompts.forEach((p) => {
      const e = map.get(p.category) ?? { label: p.categoryLabel, count: 0 };
      e.count += 1;
      map.set(p.category, e);
    });
    return [...map.entries()].map(([id, v]) => ({ id, label: v.label, count: v.count }));
  }, [data]);

  const filtered = useMemo(() => {
    if (!data) return [];
    let list = data.prompts;
    if (model !== "all") list = list.filter((p) => p.models.includes(model));
    if (cat !== "all") list = list.filter((p) => p.category === cat);
    if (query.trim()) {
      const needle = query.toLowerCase();
      list = list.filter((p) => (p.title + " " + p.text).toLowerCase().includes(needle));
    }
    return list;
  }, [data, model, cat, query]);

  useEffect(() => {
    setActiveIndex(0);
  }, [query, model, cat]);

  async function copyPrompt(p: Prompt) {
    try {
      await navigator.clipboard.writeText(p.text);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = p.text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      ta.remove();
    }
    setCopiedId(p.id);
    setTimeout(() => setCopiedId((id) => (id === p.id ? null : id)), 1000);
  }

  function selectActive() {
    const p = filtered[activeIndex];
    if (p) {
      onPick(p.text);
      setOpen(false);
    }
  }

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label="Select jailbreak prompt"
        title="Select jailbreak prompt"
        className={cn("size-7 rounded-full text-muted-foreground", className)}
        onClick={() => setOpen(true)}
      >
        <Search className="size-3.5" />
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
          <DialogContent
          showCloseButton={false}
          className="gap-0 overflow-hidden p-0 max-sm:top-[2dvh] max-sm:max-h-[46dvh] max-sm:translate-y-0 sm:max-w-lg"
        >
          <DialogHeader className="sr-only">
            <DialogTitle>Select jailbreak prompt</DialogTitle>
            <DialogDescription>
              Browse the red-teaming prompt collection and insert a prompt into the chat.
            </DialogDescription>
          </DialogHeader>

          <div className="flex items-center gap-2 border-b border-border/60 px-3">
            <Search className="size-4 shrink-0 text-muted-foreground" />
            <Input
              ref={inputRef}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                const count = filtered.length;
                if (event.key === "ArrowDown") {
                  event.preventDefault();
                  setActiveIndex((current) => (current + 1) % Math.max(1, count));
                } else if (event.key === "ArrowUp") {
                  event.preventDefault();
                  setActiveIndex((current) => (current - 1 + Math.max(1, count)) % Math.max(1, count));
                } else if (event.key === "Enter") {
                  event.preventDefault();
                  selectActive();
                } else if (event.key === "Escape") {
                  event.preventDefault();
                  setOpen(false);
                }
              }}
              placeholder="Jailbreak-Prompt suchen…"
              aria-label="Jailbreak-Prompt suchen"
              className="h-10 border-0 bg-popover px-0 text-sm shadow-none focus-visible:ring-0 dark:bg-popover"
            />
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="group size-6 shrink-0"
              onClick={() => setOpen(false)}
              aria-label="Close"
              title="Close"
            >
              <kbd className="rounded border border-border/60 px-1 py-0.5 text-[10px] text-muted-foreground group-hover:hidden">
                ESC
              </kbd>
              <X className="hidden size-3.5 group-hover:block" />
            </Button>
          </div>

          {/* Filters */}
          <div className="flex items-center gap-1 overflow-x-auto border-b border-border/60 px-2 py-1.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            <FilterChip active={model === "all"} onClick={() => setModel("all")}>
              Alle
            </FilterChip>
            {models.map((m) => (
              <FilterChip key={m} active={model === m} onClick={() => setModel(m)}>
                {m}
              </FilterChip>
            ))}
            <span className="mx-0.5 h-3.5 w-px shrink-0 bg-border/60" />
            <FilterChip active={cat === "all"} onClick={() => setCat("all")}>
              Alle Kat.
            </FilterChip>
            {categories.map((c) => (
              <FilterChip key={c.id} active={cat === c.id} onClick={() => setCat(c.id)}>
                {c.label}
              </FilterChip>
            ))}
          </div>

          {/* Results */}
          <div className="max-h-[min(40vh,360px)] overflow-y-auto p-1">
            {!data ? (
              <p className="px-2 py-4 text-center text-xs text-muted-foreground">Loading prompts…</p>
            ) : filtered.length === 0 ? (
              <p className="px-2 py-4 text-center text-xs text-muted-foreground">
                No matches.
              </p>
            ) : (
              <>
                <p className="px-2 py-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                  {filtered.length}
                </p>
                {filtered.slice(0, 200).map((p, index) => (
                  <button
                    key={p.id}
                    type="button"
                    className={cn(
                      "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left",
                      index === activeIndex ? "bg-muted" : "hover:bg-muted/60",
                    )}
                    onMouseEnter={() => setActiveIndex(index)}
                    onClick={() => {
                      onPick(p.text);
                      setOpen(false);
                    }}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-xs font-medium">
                        {highlightMatches(p.title, query)}
                      </span>
                      <span className="mt-0.5 block truncate font-mono text-[10px] text-muted-foreground">
                        {highlightMatches(p.text, query)}
                      </span>
                    </span>
                    <span className="flex shrink-0 items-center gap-0.5">
                      <span
                        role="button"
                        tabIndex={-1}
                        onClick={(e) => {
                          e.stopPropagation();
                          void copyPrompt(p);
                        }}
                        className="rounded p-1 text-muted-foreground hover:text-foreground"
                        aria-label="Kopieren"
                        title="Kopieren"
                      >
                        <Copy className="size-3" />
                        {copiedId === p.id ? "✓" : null}
                      </span>
                      <ArrowRight className="size-3 shrink-0 text-muted-foreground" />
                    </span>
                  </button>
                ))}
                {filtered.length > 200 ? (
                  <p className="px-2 py-2 text-center text-[10px] text-muted-foreground">
                    … {filtered.length - 200} weitere.
                  </p>
                ) : null}
              </>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

function FilterChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "shrink-0 whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] transition-colors",
        active
          ? "border-primary bg-primary/15 text-primary"
          : "border-border/60 bg-transparent text-muted-foreground hover:bg-muted/60 hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}
