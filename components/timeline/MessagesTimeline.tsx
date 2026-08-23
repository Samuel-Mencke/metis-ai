"use client";

import React, { useEffect, useReducer, useRef } from "react";
import { User, Sparkles } from "lucide-react";
import { timelineReducer, createInitialTimelineState } from "@/lib/runtime/timeline-reducer";
import type { ProviderRuntimeEvent } from "@/lib/runtime/contracts";
import { ToolRunCard } from "./ToolRunCard";
import { StyledDiffView } from "./StyledDiffView";
import { ProposedPlanCard } from "./ProposedPlanCard";
import { ApprovalPanel } from "./ApprovalPanel";
import { QuestionModal } from "./QuestionModal";
import { ContextMeter } from "./ContextMeter";
import { ReasoningBlock } from "./ReasoningBlock";

export function MessagesTimeline({
  sessionId,
  className,
}: {
  sessionId: string;
  className?: string;
}) {
  const [state, dispatch] = useReducer(timelineReducer, createInitialTimelineState());
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!sessionId) return;
    const es = new EventSource(`/api/runtime/stream?sessionId=${encodeURIComponent(sessionId)}`);

    es.onmessage = (e) => {
      try {
        const ev: ProviderRuntimeEvent = JSON.parse(e.data);
        dispatch(ev);
      } catch (err) {
        console.error("Failed to parse runtime event", err);
      }
    };

    return () => {
      es.close();
    };
  }, [sessionId]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [state.items, state.isRunning]);

  return (
    <div className={`flex flex-col h-full overflow-y-auto p-4 space-y-4 ${className || ""}`}>
      {state.items.map((item) => {
        switch (item.kind) {
          case "message": {
            const isUser = item.role === "user";
            return (
              <div
                key={item.id}
                className={`flex gap-3 max-w-3xl ${isUser ? "ml-auto flex-row-reverse" : "mr-auto"}`}
              >
                <div
                  className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${
                    isUser ? "bg-primary text-primary-foreground" : "bg-muted text-foreground border border-border"
                  }`}
                >
                  {isUser ? <User className="w-4 h-4" /> : <Sparkles className="w-4 h-4 text-primary" />}
                </div>

                <div className="space-y-2 flex-1">
                  {item.reasoningText && <ReasoningBlock text={item.reasoningText} />}
                  <div
                    className={`p-3.5 rounded-xl text-sm leading-relaxed whitespace-pre-wrap break-words ${
                      isUser
                        ? "bg-primary text-primary-foreground rounded-tr-xs"
                        : "bg-card border border-border text-foreground rounded-tl-xs shadow-2xs"
                    }`}
                  >
                    {item.text}
                  </div>
                </div>
              </div>
            );
          }

          case "tool_group":
            return <ToolRunCard key={item.id} group={item} />;

          case "plan":
            return <ProposedPlanCard key={item.id} plan={item} />;

          case "diff":
            return <StyledDiffView key={item.id} item={item} />;

          case "approval": {
            const payload = item.payload as any;
            if (payload.requestType === "tool_user_input" || payload.options) {
              return <QuestionModal key={item.id} item={item} />;
            }
            return <ApprovalPanel key={item.id} item={item} />;
          }

          default:
            return null;
        }
      })}

      {state.totalUsage && (
        <div className="flex justify-end pt-2">
          <ContextMeter usage={state.totalUsage} />
        </div>
      )}

      <div ref={endRef} />
    </div>
  );
}
