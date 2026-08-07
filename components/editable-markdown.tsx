"use client";

import { memo, useRef } from "react";
import { Markdown } from "@/components/markdown";
import { cn } from "@/lib/utils";

function nodeToMarkdown(node: Node, listDepth = 0): string {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent || "";
  if (node.nodeType !== Node.ELEMENT_NODE) return "";

  const element = node as HTMLElement;
  const children = Array.from(element.childNodes)
    .map((child) => nodeToMarkdown(child, listDepth))
    .join("");
  const tag = element.tagName.toLowerCase();

  if (tag === "br") return "\n";
  if (/^h[1-6]$/.test(tag)) return `${"#".repeat(Number(tag[1]))} ${children.trim()}\n\n`;
  if (tag === "strong" || tag === "b") return `**${children}**`;
  if (tag === "em" || tag === "i") return `*${children}*`;
  if (tag === "del" || tag === "s") return `~~${children}~~`;
  if (tag === "code" && element.parentElement?.tagName.toLowerCase() !== "pre") {
    return `\`${children}\``;
  }
  if (tag === "pre") {
    const code = element.textContent || "";
    const language = element.querySelector("code")?.className.match(/language-([\w-]+)/)?.[1] || "";
    return `\`\`\`${language}\n${code.replace(/\n$/, "")}\n\`\`\`\n\n`;
  }
  if (tag === "a") {
    const href = element.getAttribute("href");
    return href ? `[${children}](${href})` : children;
  }
  if (tag === "li") {
    const marker = element.parentElement?.tagName.toLowerCase() === "ol" ? "1." : "-";
    const indent = "  ".repeat(listDepth);
    return `${indent}${marker} ${children.trim()}\n`;
  }
  if (tag === "ul" || tag === "ol") {
    const items = Array.from(element.children)
      .map((child) => nodeToMarkdown(child, listDepth + 1))
      .join("");
    return `${items}\n`;
  }
  if (tag === "blockquote") {
    return `${children.trim().split("\n").map((line) => `> ${line}`).join("\n")}\n\n`;
  }
  if (tag === "p" || tag === "div" || tag === "section") {
    return `${children.trim()}\n\n`;
  }

  return children;
}

const StableMarkdownPreview = memo(Markdown);

function htmlToMarkdown(element: HTMLElement) {
  return nodeToMarkdown(element)
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

type EditableMarkdownProps = {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  "aria-label"?: string;
};

export function EditableMarkdown({
  value,
  onChange,
  placeholder,
  className,
  "aria-label": ariaLabel,
}: EditableMarkdownProps) {
  const editorRef = useRef<HTMLDivElement>(null);
  const initialValueRef = useRef(value);

  return (
    <div
      ref={editorRef}
      contentEditable
      suppressContentEditableWarning
      role="textbox"
      aria-multiline="true"
      aria-label={ariaLabel}
      data-placeholder={placeholder}
      className={cn(
        "editable-markdown min-h-0 w-full flex-1 overflow-y-auto rounded-md p-2 text-[13px] leading-5 outline-none",
        "[&_.markdown-body_p]:my-2 [&_.markdown-body_ul]:my-2 [&_.markdown-body_ol]:my-2",
        "focus-visible:ring-2 focus-visible:ring-ring/50",
        className,
      )}
      onInput={(event) => {
        const nextValue = htmlToMarkdown(event.currentTarget);
        onChange(nextValue);
      }}
    >
      <StableMarkdownPreview content={initialValueRef.current} />
    </div>
  );
}
