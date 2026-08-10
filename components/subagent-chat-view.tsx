"use client";

import { ArrowLeft, Bot, CircleStop, Clock3, LoaderCircle } from "lucide-react";
import type { ToolPart } from "@/lib/store";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Markdown } from "@/components/markdown";
import { ToolCallGroup } from "@/components/tool-call-chip";

type Props = {
  tool: ToolPart;
  onBack: () => void;
  onCancel?: () => void;
  cancelling?: boolean;
};

export function SubagentChatView({ tool, onBack, onCancel, cancelling = false }: Props) {
  const title = tool.subagent?.title || tool.subagent?.prompt || "Subagent chat";
  const messages = tool.subagent?.messages ?? [];
  const status = tool.status === "running" ? "Running" : tool.status;

  return (
    <section className="fixed inset-0 z-50 flex min-h-0 flex-col bg-background" aria-label="Subagent chat">
      <header className="flex shrink-0 items-center gap-3 border-b border-border/60 px-4 py-3">
        <Button type="button" variant="ghost" size="icon-sm" onClick={onBack} aria-label="Back to chat" title="Back to chat">
          <ArrowLeft className="size-4" />
        </Button>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-sm font-medium">{title}</h1>
          <p className="flex items-center gap-1.5 truncate text-xs text-muted-foreground">
            {tool.status === "running" ? <LoaderCircle className="size-3 animate-spin" /> : <Bot className="size-3" />}
            {status}
            {tool.subagent?.mode ? ` · ${tool.subagent.mode}` : ""}
            {tool.subagent?.model ? ` · ${tool.subagent.model}` : ""}
          </p>
        </div>
        {tool.status === "running" && onCancel ? (
          <Button type="button" variant="destructive" size="sm" onClick={onCancel} disabled={cancelling}>
            <CircleStop className="mr-1.5 size-3.5" />
            {cancelling ? "Stopping…" : "Stop"}
          </Button>
        ) : null}
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-6 sm:px-8">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
          {tool.subagent?.prompt || tool.input ? (
            <div className="ml-auto max-w-[85%] rounded-2xl rounded-tr-sm bg-primary/15 px-4 py-3 text-sm">
              <p className="mb-1 text-[10px] font-medium uppercase tracking-wide text-primary/70">Task</p>
              <p className="whitespace-pre-wrap break-words">{tool.subagent?.prompt || tool.input}</p>
            </div>
          ) : null}
          {messages.map((message, index) => (
            <div
              key={`${message.timestamp ?? "message"}-${index}`}
              className={cn(
                "max-w-[85%] rounded-2xl px-4 py-3 text-sm",
                message.role === "user" ? "ml-auto rounded-tr-sm bg-primary/15" : "rounded-tl-sm border border-border/50 bg-muted/20",
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
          {tool.subagent?.tools?.length ? (
            <ToolCallGroup
              tools={tool.subagent.tools}
              autoExpand={tool.status === "running"}
            />
          ) : null}
          {!messages.length && tool.result ? (
            <div className="rounded-2xl rounded-tl-sm border border-border/50 bg-muted/20 px-4 py-3 text-sm">
              <p className="mb-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Result</p>
              <p className="whitespace-pre-wrap break-words">{tool.result}</p>
            </div>
          ) : null}
          {!messages.length && !tool.result ? (
            <p className="text-sm text-muted-foreground">{tool.detail || "Waiting for the subagent to respond…"}</p>
          ) : null}
          {tool.status === "running" ? (
            <p className="flex items-center gap-2 text-xs text-muted-foreground">
              <Clock3 className="size-3.5" />
              This is a read-only live view. Sending messages is disabled.
            </p>
          ) : null}
        </div>
      </div>
    </section>
  );
}
