"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Copy, ExternalLink, Filter, RotateCcw, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";

type Prompt = {
  id: string;
  title: string;
  text: string;
  category: string;
  categoryLabel: string;
  models: string[];
  kind: "technique" | "model-specific";
  source: string;
};

type Data = { meta: Record<string, unknown>; prompts: Prompt[] };

const KIND_LABEL: Record<string, string> = {
  technique: "Technik",
  "model-specific": "modell-spezifisch",
};

export default function JailbreakLibrary() {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [model, setModel] = useState("all");
  const [kind, setKind] = useState("all");
  const [cat, setCat] = useState("all");
  const [q, setQ] = useState("");
  const [sort, setSort] = useState("default");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [active, setActive] = useState<Prompt | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  useEffect(() => {
    fetch("/prompts.json")
      .then((r) => {
        if (!r.ok) throw new Error("HTTP " + r.status);
        return r.json();
      })
      .then((d: Data) => setData(d))
      .catch((e) => setError(String(e)));
  }, []);

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
    if (kind !== "all") list = list.filter((p) => p.kind === kind);
    if (model !== "all") list = list.filter((p) => p.models.includes(model));
    if (cat !== "all") list = list.filter((p) => p.category === cat);
    if (q.trim()) {
      const needle = q.toLowerCase();
      list = list.filter((p) => (p.title + " " + p.text).toLowerCase().includes(needle));
    }
    if (sort === "alpha") list = [...list].sort((a, b) => a.title.localeCompare(b.title));
    else if (sort === "cat")
      list = [...list].sort(
        (a, b) => a.categoryLabel.localeCompare(b.categoryLabel) || a.title.localeCompare(b.title),
      );
    return list;
  }, [data, kind, model, cat, q, sort]);

  const reset = useCallback(() => {
    setModel("all"); setKind("all"); setCat("all"); setQ(""); setSort("default");
  }, []);

  const copy = useCallback(async (p: Prompt) => {
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
    setTimeout(() => setCopiedId((id) => (id === p.id ? null : id)), 1200);
  }, []);

  const toggleExpand = useCallback((id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  if (error) {
    return (
      <div className="flex min-h-dvh items-center justify-center p-8 text-sm text-muted-foreground">
          Could not load prompts.json: {error}
      </div>
    );
  }
  if (!data) {
    return (
      <div className="min-h-dvh bg-background text-foreground">
        <div className="border-b border-red-500/20 bg-red-500/[0.06] px-4 py-2">
          <Skeleton className="h-4 w-72 bg-red-500/20" />
        </div>
        <header className="flex items-start justify-between gap-4 px-6 pt-6">
          <div className="space-y-3">
            <Skeleton className="h-7 w-72" />
            <Skeleton className="h-4 w-[min(90vw,42rem)]" />
          </div>
          <Skeleton className="h-8 w-28 rounded-full" />
        </header>
        <div className="mx-auto grid max-w-[1500px] grid-cols-1 gap-4 px-6 py-4 lg:grid-cols-[280px_1fr]">
          <aside className="rounded-xl border border-border bg-card p-3">
            <Skeleton className="h-8 w-full rounded-lg" />
            <div className="mt-4 space-y-2">
              {[0, 1, 2, 3, 4, 5].map((item) => (
                <Skeleton key={item} className="h-8 w-full rounded-lg" />
              ))}
            </div>
          </aside>
          <main className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {[0, 1, 2, 3, 4, 5].map((item) => (
              <div key={item} className="rounded-xl border border-border bg-card p-4">
                <Skeleton className="h-5 w-4/5" />
                <Skeleton className="mt-3 h-3 w-full" />
                <Skeleton className="mt-2 h-3 w-2/3" />
                <Skeleton className="mt-6 h-7 w-24 rounded-full" />
              </div>
            ))}
          </main>
        </div>
      </div>
    );
  }

  const shown = filtered.slice(0, 600);
  const overflow = filtered.length - shown.length;

  return (
    <div className="min-h-dvh bg-background text-foreground">
      {/* Warning banner */}
      <div className="flex items-center gap-2 border-b border-red-500/30 bg-red-500/10 px-4 py-2 text-[13px] text-red-200">
        <span className="size-2 shrink-0 rounded-full bg-red-500 shadow-[0_0_10px] shadow-red-500" />
        <span>
          <b className="text-red-400">Authorized testing only.</b> This collection is for
          AI safety research and red-teaming your own systems. Do not use it against
          third-party systems or people.
        </span>
      </div>

      <header className="flex flex-wrap items-center justify-between gap-4 px-6 pt-6">
        <div>
          <h1 className="text-xl font-bold tracking-tight">🔓 Jailbreak Prompt Library</h1>
          <p className="mt-1 text-[13px] text-muted-foreground">
            Public red-teaming prompts to browse and select — for many different AI models.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="font-mono text-xs text-muted-foreground">
            {data.prompts.length} Prompts
          </span>
          <Button asChild variant="ghost" size="sm">
            <Link href="/">
              <ArrowLeft className="size-3.5" /> Back to chat
            </Link>
          </Button>
        </div>
      </header>

      <div className="mx-auto grid max-w-[1500px] grid-cols-1 gap-4 px-6 py-4 lg:grid-cols-[280px_1fr]">
        {/* Sidebar */}
        <aside className="lg:sticky lg:top-4 lg:h-[calc(100dvh-28px)] lg:overflow-auto rounded-xl border border-border bg-card p-3">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search prompts…"
              className="pl-8"
            />
          </div>

          <h3 className="mt-4 mb-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground/70">
            Modell
          </h3>
          <div className="flex flex-wrap gap-1.5">
            <FilterChip active={model === "all"} onClick={() => setModel("all")}>
              Alle Modelle
            </FilterChip>
            {models.map((m) => (
              <FilterChip key={m} active={model === m} onClick={() => setModel(m)}>
                {m}
              </FilterChip>
            ))}
          </div>

          <h3 className="mt-4 mb-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground/70">
            Typ
          </h3>
          <div className="flex flex-wrap gap-1.5">
            <FilterChip active={kind === "all"} onClick={() => setKind("all")}>Alle</FilterChip>
            <FilterChip active={kind === "technique"} onClick={() => setKind("technique")}>
              Techniken
            </FilterChip>
            <FilterChip active={kind === "model-specific"} onClick={() => setKind("model-specific")}>
              Modell-spezifisch
            </FilterChip>
          </div>

          <h3 className="mt-4 mb-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground/70">
            Kategorie
          </h3>
          <div className="flex flex-col gap-0.5">
            <CatItem active={cat === "all"} count={data.prompts.length} onClick={() => setCat("all")}>
              Alle Kategorien
            </CatItem>
            {categories.map((c) => (
              <CatItem key={c.id} active={cat === c.id} count={c.count} onClick={() => setCat(c.id)}>
                {c.label}
              </CatItem>
            ))}
          </div>

          <Button variant="outline" size="sm" className="mt-3 w-full" onClick={reset}>
            <RotateCcw className="size-3.5" /> Reset filters
          </Button>
        </aside>

        {/* Main */}
        <main>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <div className="text-[13px] text-muted-foreground">
              <b className="text-foreground">{filtered.length}</b> of {data.prompts.length} prompts
            </div>
            <div className="flex items-center gap-1 rounded-lg border border-border bg-card p-0.5">
              {(["default", "alpha", "cat"] as const).map((s) => (
                <button
                  key={s}
                  onClick={() => setSort(s)}
                  className={cn(
                    "rounded-md px-2.5 py-1.5 text-xs transition-colors",
                    sort === s ? "bg-background text-foreground" : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {s === "default" ? "Standard" : s === "alpha" ? "A–Z" : "Kategorie"}
                </button>
              ))}
            </div>
          </div>

          {shown.length === 0 ? (
            <div className="py-16 text-center text-sm text-muted-foreground">
              No matches for the current filters.
            </div>
          ) : (
            <>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {shown.map((p) => (
                  <div
                    key={p.id}
                    className="flex flex-col gap-2.5 rounded-xl border border-border bg-card p-3.5 transition-colors hover:border-border/70"
                  >
                    <div className="text-sm font-semibold">{p.title}</div>
                    <div className="flex flex-wrap gap-1">
                      <Badge variant="cat">{p.categoryLabel}</Badge>
                      <Badge variant="kind">{KIND_LABEL[p.kind]}</Badge>
                      {p.models.slice(0, 3).map((m) => (
                        <Badge key={m} variant="model">{m}</Badge>
                      ))}
                      {p.models.length > 3 && <Badge variant="model">+{p.models.length - 3}</Badge>}
                    </div>
                    <div
                      onClick={() => toggleExpand(p.id)}
                      className={cn(
                        "cursor-pointer whitespace-pre-wrap break-words font-mono text-xs text-muted-foreground",
                        expanded.has(p.id) ? "" : "max-h-[116px] overflow-hidden",
                      )}
                    >
                      {p.text}
                    </div>
                    <div className="mt-auto flex gap-2">
                      <Button
                        size="sm"
                        className="flex-1"
                        onClick={() => copy(p)}
                        variant={copiedId === p.id ? "secondary" : "default"}
                      >
                        <Copy className="size-3.5" />
                        {copiedId === p.id ? "Kopiert" : "Kopieren"}
                      </Button>
                      <Button size="sm" variant="outline" className="flex-1" onClick={() => setActive(p)}>
                        <Filter className="size-3.5" /> Open
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
              {overflow > 0 && (
                <div className="py-8 text-center text-sm text-muted-foreground">
                  … {overflow} weitere. Bitte Filter verfeinern.
                </div>
              )}
            </>
          )}

          <footer className="py-8 text-center text-xs text-muted-foreground">
            Quelle:{" "}
            <a
              href="https://github.com/AUTHENSOR/ai-seclists"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-sky-400 hover:underline"
            >
              AUTHENSOR/ai-seclists <ExternalLink className="size-3" />
            </a>{" "}
            · For authorized red-teaming and safety research only.
          </footer>
        </main>
      </div>

      <Dialog open={!!active} onOpenChange={(o) => !o && setActive(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{active?.title}</DialogTitle>
            <DialogDescription className="flex flex-wrap gap-1">
              {active && <Badge variant="cat">{active.categoryLabel}</Badge>}
              {active?.models.map((m) => (
                <Badge key={m} variant="model">{m}</Badge>
              ))}
            </DialogDescription>
          </DialogHeader>
          <Textarea
            defaultValue={active?.text ?? ""}
            spellCheck={false}
            className="min-h-[260px] font-mono text-xs"
          />
          <div className="flex gap-2">
            <Button
              className="flex-1"
              onClick={() => active && copy(active)}
              variant={copiedId === active?.id ? "secondary" : "default"}
            >
              <Copy className="size-4" />
              {copiedId === active?.id ? "Kopiert" : "In Zwischenablage kopieren"}
            </Button>
            <Button variant="outline" onClick={() => setActive(null)}>Close</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
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
      onClick={onClick}
      className={cn(
        "rounded-full border px-2.5 py-1 text-xs transition-colors",
        active
          ? "border-primary bg-primary/15 text-purple-200"
          : "border-border bg-background text-muted-foreground hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

function CatItem({
  active,
  count,
  onClick,
  children,
}: {
  active: boolean;
  count: number;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 text-[13px] transition-colors",
        active
          ? "bg-sky-500/10 text-sky-200"
          : "text-muted-foreground hover:bg-background hover:text-foreground",
      )}
    >
      <span>{children}</span>
      <span className="font-mono text-[11px] text-muted-foreground/70">{count}</span>
    </button>
  );
}

function Badge({
  variant,
  children,
}: {
  variant: "cat" | "model" | "kind";
  children: React.ReactNode;
}) {
  const styles = {
    cat: "border-sky-500/25 bg-sky-500/10 text-sky-300",
    model: "border-purple-500/25 bg-purple-500/10 text-purple-200",
    kind: "border-amber-500/25 bg-amber-500/10 text-amber-300",
  } as const;
  return (
    <span
      className={cn(
        "rounded-md border px-1.5 py-0.5 font-mono text-[10px]",
        styles[variant],
      )}
    >
      {children}
    </span>
  );
}
