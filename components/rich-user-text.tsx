"use client";

import { LinkPreview } from "@/components/link-preview";
import { ExternalLink } from "lucide-react";
import { useEffect, useState } from "react";

type Reference = {
  kind?: string;
  id?: string;
  label: string;
  chatId?: string;
  path?: string;
  sessionId?: string;
};

function RichLink({ href, children }: { href: string; children: string }) {
  const [hovered, setHovered] = useState(false);
  const [modifierHeld, setModifierHeld] = useState(false);
  useEffect(() => {
    if (!hovered) return;
    const update = (event: KeyboardEvent) => {
      if (event.key === "Control" || event.key === "Meta") setModifierHeld(true);
    };
    const clear = (event: KeyboardEvent) => {
      if (event.key === "Control" || event.key === "Meta") setModifierHeld(false);
    };
    window.addEventListener("keydown", update);
    window.addEventListener("keyup", clear);
    return () => {
      window.removeEventListener("keydown", update);
      window.removeEventListener("keyup", clear);
    };
  }, [hovered]);
  return (
    <a
      href={href}
      className="inline-flex items-center underline underline-offset-2 hover:text-primary"
      onMouseEnter={(event) => {
        setHovered(true);
        setModifierHeld(event.ctrlKey || event.metaKey);
      }}
      onMouseLeave={() => {
        setHovered(false);
        setModifierHeld(false);
      }}
      onClick={(event) => {
        if (event.ctrlKey || event.metaKey) {
          event.preventDefault();
          window.open(href, "_blank", "noopener,noreferrer");
          return;
        }
        event.preventDefault();
        window.dispatchEvent(new CustomEvent("ai-chat:open-browser", { detail: href }));
      }}
    >
      {children}
      {hovered && modifierHeld ? (
        <ExternalLink className="ml-1 size-3.5 animate-in fade-in text-muted-foreground" aria-label="Ctrl-click opens in a new tab" />
      ) : null}
    </a>
  );
}

export function RichUserText({
  content,
  references = [],
}: {
  content: string;
  references?: Reference[];
}) {
  const labels = references
    .map((reference) => reference.label.trim())
    .filter(Boolean)
    .sort((a, b) => b.length - a.length);
  const pattern = labels.length
    ? new RegExp(`(@(?:${labels.map((label) => label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")}))|(https?:\\/\\/[^\\s]+)`, "g")
    : /(https?:\/\/[^\s]+)/g;
  const parts: Array<{ text: string; kind: "text" | "mention" | "link" }> = [];
  let lastIndex = 0;
  for (const match of content.matchAll(pattern)) {
    const index = match.index ?? 0;
    if (index > lastIndex) parts.push({ text: content.slice(lastIndex, index), kind: "text" });
    parts.push({ text: match[0], kind: match[0].startsWith("@") ? "mention" : "link" });
    lastIndex = index + match[0].length;
  }
  if (lastIndex < content.length) parts.push({ text: content.slice(lastIndex), kind: "text" });

  return (
    <>
      {parts.map((part, index) => {
        if (part.kind === "mention") {
          const reference = references.find(
            (item) => `@${item.label.trim()}` === part.text,
          );
          return (
            <button
              key={`${part.text}-${index}`}
              type="button"
              className="inline cursor-pointer border-0 bg-transparent p-0 text-primary underline underline-offset-2 hover:text-primary/80"
              title={reference ? `Open ${reference.label}` : part.text}
              onClick={() => {
                if (!reference?.kind || !reference.id) return;
                window.dispatchEvent(
                  new CustomEvent("ai-chat:open-reference", {
                    detail: { ...reference, label: reference.label.trim() },
                  }),
                );
              }}
            >
              {part.text}
            </button>
          );
        }
        if (part.kind === "link") {
          return (
            <LinkPreview key={`${part.text}-${index}`} href={part.text}>
              <RichLink href={part.text}>{part.text}</RichLink>
            </LinkPreview>
          );
        }
        return <span key={`${part.text}-${index}`}>{part.text}</span>;
      })}
    </>
  );
}
