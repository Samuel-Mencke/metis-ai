"use client";

import React, { useState } from "react";
import { Brain, ChevronDown, ChevronRight } from "lucide-react";

export function ReasoningBlock({ text }: { text: string }) {
  const [isOpen, setIsOpen] = useState(false);
  if (!text) return null;

  return (
    <div className="my-2 rounded-lg border border-purple-500/20 bg-purple-500/5 text-xs overflow-hidden shadow-xs">
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center justify-between px-3 py-2 text-purple-400 hover:text-purple-300 font-medium hover:bg-purple-500/10 transition-colors text-left cursor-pointer"
      >
        <div className="flex items-center gap-2">
          <Brain className="w-3.5 h-3.5" />
          <span>Reasoning / Thought Process</span>
        </div>
        {isOpen ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
      </button>

      {isOpen && (
        <div className="p-3 text-muted-foreground font-mono leading-relaxed whitespace-pre-wrap border-t border-purple-500/10 bg-background/30 max-h-60 overflow-y-auto">
          {text}
        </div>
      )}
    </div>
  );
}
