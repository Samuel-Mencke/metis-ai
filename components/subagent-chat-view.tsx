"use client";

import { ArrowLeft, Bot, CircleStop, Clock3, LoaderCircle } from "lucide-react";
import type { CSSProperties } from "react";
import type { ToolPart } from "@/lib/store";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Markdown } from "@/components/markdown";
import { ToolCallGroup } from "@/components/tool-call-chip";
import { ThinkingBlock } from "@/components/thinking-block";

type Props = {
  tool: ToolPart;
  onBack: () => void;
  onCancel?: () => void;
  cancelling?: boolean;
  sidebarWidth?: number;
};

function readableSubagentText(value: unknown): string {
  if (value == null) return "";
  if (typeof value !== "string") {
    if (Array.isArray(value)) return value.map(readableSubagentText).filter(Boolean).join("\n");
    if (typeof value === "object") {
      const record = value as Record<string, unknown>;
      for (const key of ["text", "content", "message", "answer", "response", "value"]) {
        const result = readableSubagentText(record[key]);
        if (result) return result;
      }
      return Object.entries(record)
        .map(([key, item]) => {
          const result = readableSubagentText(item);
          return result ? `${key}: ${result}` : "";
        })
        .filter(Boolean)
        .join("\n");
    }
    return String(value);
  }
  const trimmed = value.trim();
  if (!trimmed) return "";
  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (typeof parsed === "string") return parsed;
    if (Array.isArray(parsed)) {
      return parsed.map(readableSubagentText).filter(Boolean).join("\n");
    }
    if (parsed && typeof parsed === "object") {
      const record = parsed as Record<string, unknown>;
      if (Array.isArray(record.conversationSteps)) {
        return record.conversationSteps
          .map((step) => {
            if (!step || typeof step !== "object") return "";
            const item = step as Record<string, unknown>;
            return readableSubagentText(
              item.response ?? item.answer ?? item.text ?? item.content ?? item.message ?? item.result,
            );
          })
          .filter(Boolean)
          .join("\n\n");
      }
      for (const key of ["text", "content", "message", "answer", "response", "value"]) {
        const result = readableSubagentText(record[key]);
        if (result) return result;
      }
      return Object.entries(record)
        .map(([key, item]) => {
          const result = readableSubagentText(item);
          return result ? `${key}: ${result}` : "";
        })
        .filter(Boolean)
        .join("\n");
    }
  } catch {
    // Normal markdown/text, not JSON.
  }
  return value;
}

export function SubagentChatView({ tool, onBack, onCancel, cancelling = false, sidebarWidth = 0 }: Props) {
  const title = tool.subagent?.title || tool.subagent?.prompt || "Subagent chat";
  const messages = tool.subagent?.messages ?? [];
  const status = tool.status === "running" ? "Running" : tool.status;

  return (
    <section
      className="fixed inset-y-0 right-0 z-50 flex min-h-0 w-full animate-in fade-in slide-in-from-right-2 flex-col bg-background duration-200 md:w-[calc(100%-var(--subagent-sidebar-width))]"
      style={{ "--subagent-sidebar-width": `${sidebarWidth}px` } as CSSProperties}
      aria-label="Subagent chat"
    >
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border/30 bg-background/90 px-3 backdrop-blur-xl md:px-4">
        <Button type="button" variant="ghost" size="icon" className="size-8" onClick={onBack} aria-label="Back to chat" title="Back to chat">
          <ArrowLeft className="size-4" />
        </Button>
        <p className="min-w-0 flex-1 truncate text-sm font-medium text-foreground" title={title}>{title}</p>
        <span className="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
          {tool.status === "running" ? <LoaderCircle className="size-3 animate-spin" /> : <Bot className="size-3" />}
          {status}
        </span>
        {tool.status === "running" && onCancel ? (
          <Button type="button" variant="destructive" size="sm" onClick={onCancel} disabled={cancelling}>
            <CircleStop className="mr-1.5 size-3.5" />
            {cancelling ? "Stopping…" : "Stop"}
          </Button>
        ) : null}
      </header>

      <div className="messages-composer-mask min-h-0 flex-1 overflow-y-auto" style={{ ["--composer-mask-size" as string]: "9rem" }}>
        <div className="mx-auto w-full max-w-2xl space-y-6 px-4 pt-6 sm:px-6" style={{ paddingBottom: 144 }}>
          {tool.subagent?.prompt || tool.input ? (
            <div className="flex flex-col items-end gap-1">
              <div className="max-w-[85%] space-y-2 rounded-3xl bg-secondary/80 px-4 py-2.5 text-[15px] leading-relaxed">
                <p className="whitespace-pre-wrap break-words">{readableSubagentText(tool.subagent?.prompt || tool.input)}</p>
              </div>
            </div>
          ) : null}
          {tool.subagent?.thinking ? (
            <ThinkingBlock text={tool.subagent.thinking} done={tool.status !== "running"} />
          ) : null}
          {messages.map((message, index) => (
            <div
              key={`${message.timestamp ?? "message"}-${index}`}
              className={cn(
                "w-full",
                message.role === "user"
                  ? "flex flex-col items-end gap-1"
                  : "text-[15px] leading-relaxed text-foreground/95",
              )}
            >
              {message.role.toLowerCase().includes("assistant") ? (
                <div className="block w-full">
                  <Markdown content={readableSubagentText(message.text)} />
                </div>
              ) : (
                <div className="max-w-[85%] space-y-2 rounded-3xl bg-secondary/80 px-4 py-2.5 text-[15px] leading-relaxed">
                  <p className="whitespace-pre-wrap break-words">{readableSubagentText(message.text)}</p>
                </div>
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
            <div className="text-[15px] leading-relaxed text-foreground/95">
              <Markdown content={readableSubagentText(tool.result)} />
            </div>
          ) : null}
          {!messages.length && !tool.result ? (
            <p className="text-sm text-muted-foreground">{tool.detail || "Waiting for the subagent to respond…"}</p>
          ) : null}
        </div>
      </div>
      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20">
        <div className="pointer-events-none pb-4 pt-3">
          <div className="pointer-events-auto relative mx-auto w-full max-w-2xl px-4 sm:px-6">
            <div className="relative flex w-full items-center gap-2 rounded-3xl border border-border/50 bg-card/80 p-2 text-sm text-muted-foreground shadow-[0_8px_40px_-12px_rgba(0,0,0,0.4)] backdrop-blur-xl">
              <div className="flex min-h-10 min-w-0 flex-1 items-center gap-3 rounded-2xl px-3 py-2">
                <Clock3 className="size-4 shrink-0" />
                <span className="truncate">This subagent chat is read-only.</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
