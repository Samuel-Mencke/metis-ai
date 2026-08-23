"use client";

import React, { useState } from "react";
import { ShieldAlert, Check, X, Terminal, FileEdit } from "lucide-react";
import type { TimelineApprovalItem } from "@/lib/runtime/timeline-reducer";

export function ApprovalPanel({ item }: { item: TimelineApprovalItem }) {
  const [submitting, setSubmitting] = useState(false);
  const [status, setStatus] = useState<"pending" | "approved" | "rejected">(item.status === "approved" || item.status === "rejected" ? item.status : "pending");

  const handleDecision = async (decision: "approved" | "rejected") => {
    setSubmitting(true);
    try {
      await fetch("/api/runtime/approval", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requestId: item.requestId, decision }),
      });
      setStatus(decision);
    } catch {
      // ignore
    } finally {
      setSubmitting(false);
    }
  };

  const payload = item.payload as any;
  const isCommand = payload.requestType === "command_execution_approval" || payload.command;

  return (
    <div className="my-3 rounded-lg border border-amber-500/30 bg-amber-500/5 p-4 space-y-3 shadow-xs">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-xs font-semibold text-amber-500">
          <ShieldAlert className="w-4 h-4" />
          <span>Action Approval Required</span>
        </div>
        <span className="text-xs font-medium capitalize text-muted-foreground">
          Status: {status}
        </span>
      </div>

      <div className="text-sm font-medium text-foreground">
        {payload.title || (isCommand ? "Authorize Command Execution" : "Authorize File Change")}
      </div>

      {payload.command && (
        <div className="flex items-center gap-2 p-2.5 rounded-md bg-zinc-950 text-zinc-200 font-mono text-xs overflow-x-auto border border-zinc-800">
          <Terminal className="w-4 h-4 text-amber-400 shrink-0" />
          <span>{payload.command}</span>
        </div>
      )}

      {status === "pending" ? (
        <div className="flex items-center gap-2 pt-2">
          <button
            type="button"
            disabled={submitting}
            onClick={() => handleDecision("approved")}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-medium transition-colors cursor-pointer disabled:opacity-50"
          >
            <Check className="w-3.5 h-3.5" />
            Approve Action
          </button>
          <button
            type="button"
            disabled={submitting}
            onClick={() => handleDecision("rejected")}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-rose-600 hover:bg-rose-500 text-white text-xs font-medium transition-colors cursor-pointer disabled:opacity-50"
          >
            <X className="w-3.5 h-3.5" />
            Reject
          </button>
        </div>
      ) : (
        <div className="text-xs font-semibold">
          {status === "approved" ? (
            <span className="text-emerald-500">✓ Action Approved</span>
          ) : (
            <span className="text-rose-500">✗ Action Rejected</span>
          )}
        </div>
      )}
    </div>
  );
}
