"use client";

import { LinkPreview } from "@/components/link-preview";

type Reference = {
  kind?: string;
  id?: string;
  label: string;
  chatId?: string;
  path?: string;
  sessionId?: string;
};

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
              <a
                href={part.text}
                className="underline underline-offset-2 hover:text-primary"
                onClick={(event) => {
                  event.preventDefault();
                  window.dispatchEvent(new CustomEvent("ai-chat:open-browser", { detail: part.text }));
                }}
              >
                {part.text}
              </a>
            </LinkPreview>
          );
        }
        return <span key={`${part.text}-${index}`}>{part.text}</span>;
      })}
    </>
  );
}
