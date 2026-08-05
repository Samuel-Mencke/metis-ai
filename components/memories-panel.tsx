"use client";

import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";

export type MemoryItem = {
  id: string;
  content: string;
  tags?: string[];
  createdAt: string;
  updatedAt: string;
};

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  memories: MemoryItem[];
  onChanged: () => void;
};

export function MemoriesPanel({
  open,
  onOpenChange,
  memories,
  onChanged,
}: Props) {
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);

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
      onChanged();
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
      onChanged();
      toast.success("Memory deleted");
    } catch {
      toast.error("Failed to delete memory");
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex w-full flex-col sm:max-w-md">
        <SheetHeader>
          <SheetTitle>Memories</SheetTitle>
          <SheetDescription>
            Durable facts injected into every chat turn. The agent can also
            write these itself.
          </SheetDescription>
        </SheetHeader>

        <div className="mt-4 flex gap-2 px-1">
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

        <ScrollArea className="mt-4 flex-1 pr-2">
          <ul className="space-y-2 pb-6">
            {memories.length === 0 ? (
              <li className="px-1 py-8 text-center text-sm text-muted-foreground">
                No memories yet.
              </li>
            ) : (
              memories.map((m) => (
                <li
                  key={m.id}
                  className="group flex items-start gap-2 rounded-lg border border-border/60 bg-card/40 p-3"
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-sm whitespace-pre-wrap">{m.content}</p>
                    {m.tags && m.tags.length > 0 ? (
                      <p className="mt-1 text-xs text-muted-foreground">
                        {m.tags.join(" · ")}
                      </p>
                    ) : null}
                  </div>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    className="opacity-60 group-hover:opacity-100"
                    onClick={() => void removeMemory(m.id)}
                    aria-label="Delete memory"
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </li>
              ))
            )}
          </ul>
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
}
