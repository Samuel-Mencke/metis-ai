"use client";

import {
  Anthropic,
  Antigravity,
  Codex,
  Cursor,
  Gemini,
  GoogleCloud,
  Grok,
  Ollama,
  OpenAI,
  OpenRouter,
  XAI,
} from "@lobehub/icons";
import { cn } from "@/lib/utils";

export function ProviderLogo({
  providerId,
  className,
}: {
  providerId?: string;
  className?: string;
}) {
  const common = cn("size-4 shrink-0", className);
  switch (providerId) {
    case "anthropic":
    case "claude-code":
      return <Anthropic className={common} size={16} />;
    case "google":
      return <Gemini className={common} size={16} />;
    case "antigravity":
      return <Antigravity className={common} size={16} />;
    case "cursor":
      return <Cursor className={common} size={16} />;
    case "openrouter":
      return <OpenRouter className={common} size={16} />;
    case "ollama":
      return <Ollama className={common} size={16} />;
    case "xai":
      return <XAI className={common} size={16} />;
    case "openai":
      return <OpenAI className={common} size={16} />;
    case "codex":
      return <Codex className={common} size={16} />;
    case "google-cloud":
      return <GoogleCloud className={common} size={16} />;
    case "grok":
      return <Grok className={common} size={16} />;
    default:
      return (
        <span className={cn(common, "inline-flex items-center justify-center rounded-full bg-muted text-[9px] font-semibold text-muted-foreground")} aria-hidden="true">
          {providerId?.slice(0, 2).toUpperCase() || "AI"}
        </span>
      );
  }
}
