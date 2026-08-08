"use client";

import { FormEvent, Suspense, useEffect, useState } from "react";
import { LockKeyhole, MessageSquareShare } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { Markdown } from "@/components/markdown";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type SharedMessage = {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  createdAt: string;
};

type SharedChat = {
  title: string;
  messages: SharedMessage[];
};

function ShareView() {
  const searchParams = useSearchParams();
  const shareId = searchParams.get("id") || "";
  const [chat, setChat] = useState<SharedChat | null>(null);
  const [password, setPassword] = useState("");
  const [needsPassword, setNeedsPassword] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  async function loadShare(nextPassword?: string) {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/share", {
        method: nextPassword === undefined ? "GET" : "POST",
        headers: nextPassword === undefined ? undefined : { "Content-Type": "application/json" },
        body: nextPassword === undefined ? undefined : JSON.stringify({ id: shareId, password: nextPassword }),
        ...(nextPassword === undefined ? { cache: "no-store" as const } : {}),
      });
      const data = (await res.json().catch(() => ({}))) as {
        chat?: SharedChat;
        error?: string;
      };
      if (res.status === 401) {
        setNeedsPassword(true);
        setError(nextPassword ? data.error || "Incorrect password" : "");
        return;
      }
      if (!res.ok || !data.chat) throw new Error(data.error || "This share link is unavailable.");
      setChat(data.chat);
      setNeedsPassword(false);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Unable to load this shared chat.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (shareId) void loadShare();
    else {
      setError("Missing share link.");
      setLoading(false);
    }
  }, [shareId]);

  function submitPassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (password.trim()) void loadShare(password);
  }

  return (
    <main className="min-h-dvh bg-background px-4 py-8 text-foreground sm:px-6">
      <div className="mx-auto max-w-3xl">
        <header className="mb-8 flex items-center gap-3 border-b border-border/60 pb-5">
          <span className="flex size-9 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <MessageSquareShare className="size-5" />
          </span>
          <div className="min-w-0">
            <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground">Shared chat</p>
            <h1 className="truncate text-lg font-semibold">{chat?.title || "Shared conversation"}</h1>
          </div>
        </header>
        {loading ? <p className="text-sm text-muted-foreground">Loading shared chat…</p> : null}
        {!loading && needsPassword ? (
          <form onSubmit={submitPassword} className="mx-auto max-w-sm space-y-3 rounded-2xl border border-border/60 bg-card p-5 shadow-sm">
            <div className="flex items-center gap-2 text-sm font-medium">
              <LockKeyhole className="size-4 text-muted-foreground" />
              Password-protected chat
            </div>
            <Input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="Enter password"
              autoFocus
              autoComplete="off"
              aria-label="Share password"
            />
            <Button type="submit" className="w-full" disabled={!password.trim()}>Unlock</Button>
            {error ? <p className="text-sm text-destructive">{error}</p> : null}
          </form>
        ) : null}
        {!loading && !needsPassword && error ? <p className="text-sm text-destructive">{error}</p> : null}
        {chat ? (
          <div className="space-y-6">
            {chat.messages.map((message) => (
              <article key={message.id} className="rounded-2xl border border-border/50 bg-card/40 p-4">
                <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  {message.role === "user" ? "You" : message.role}
                </p>
                <Markdown content={message.content} />
              </article>
            ))}
          </div>
        ) : null}
      </div>
    </main>
  );
}

export default function SharePage() {
  return (
    <Suspense fallback={<main className="flex min-h-dvh items-center justify-center text-sm text-muted-foreground">Loading shared chat…</main>}>
      <ShareView />
    </Suspense>
  );
}
