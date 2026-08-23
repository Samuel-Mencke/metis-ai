"use client";

import React, { useState } from "react";
import { HelpCircle, Send, Check } from "lucide-react";
import type { TimelineApprovalItem } from "@/lib/runtime/timeline-reducer";

export function QuestionModal({ item }: { item: TimelineApprovalItem }) {
  const payload = item.payload as any;
  const [selectedOption, setSelectedOption] = useState<string | null>(null);
  const [customText, setCustomText] = useState("");
  const [submitted, setSubmitted] = useState(item.status === "answered");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async () => {
    if (!selectedOption && !customText.trim()) return;
    setLoading(true);
    try {
      await fetch("/api/runtime/question", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          requestId: item.requestId,
          selectedOption: selectedOption || undefined,
          textInput: customText.trim() || undefined,
        }),
      });
      setSubmitted(true);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  };

  const options: Array<{ value: string; label?: string }> = payload.options || [];

  return (
    <div className="my-3 rounded-lg border border-sky-500/30 bg-sky-500/5 p-4 space-y-3 shadow-xs">
      <div className="flex items-center gap-2 text-xs font-semibold text-sky-500">
        <HelpCircle className="w-4 h-4" />
        <span>Clarification Question</span>
      </div>

      <div className="text-sm font-medium text-foreground leading-relaxed">
        {payload.prompt}
      </div>

      {!submitted ? (
        <div className="space-y-3 pt-1">
          {options.length > 0 && (
            <div className="grid grid-cols-1 gap-2">
              {options.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setSelectedOption(opt.value)}
                  className={`w-full text-left p-2.5 rounded-md text-xs font-medium transition-colors border cursor-pointer ${
                    selectedOption === opt.value
                      ? "bg-sky-500/20 border-sky-500 text-sky-300 font-semibold"
                      : "bg-muted/40 border-border hover:bg-muted text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {opt.label || opt.value}
                </button>
              ))}
            </div>
          )}

          {payload.allowCustomInput && (
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={customText}
                onChange={(e) => setCustomText(e.target.value)}
                placeholder="Or type a custom answer..."
                className="flex-1 px-3 py-1.5 rounded-md border border-border bg-background text-xs text-foreground focus:outline-hidden focus:ring-1 focus:ring-sky-500"
              />
            </div>
          )}

          <button
            type="button"
            disabled={loading || (!selectedOption && !customText.trim())}
            onClick={handleSubmit}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-sky-600 hover:bg-sky-500 text-white text-xs font-medium transition-colors cursor-pointer disabled:opacity-50"
          >
            <Send className="w-3.5 h-3.5" />
            Submit Answer
          </button>
        </div>
      ) : (
        <div className="text-xs font-semibold text-emerald-500 flex items-center gap-1.5">
          <Check className="w-4 h-4" />
          Answer submitted
        </div>
      )}
    </div>
  );
}
