"use client";

import {
  memo,
  useLayoutEffect,
  useRef,
  useState,
  type PointerEventHandler,
} from "react";
import { Markdown } from "@/components/markdown";
import { cn } from "@/lib/utils";

function nodeToMarkdown(node: Node, listDepth = 0): string {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent || "";
  if (node.nodeType !== Node.ELEMENT_NODE) return "";

  const element = node as HTMLElement;
  const mermaid = element.getAttribute("data-mermaid-source")
    || (element.getAttribute("data-editor-control") === "mermaid"
      ? element.querySelector("[data-mermaid-source]")?.getAttribute("data-mermaid-source")
      : "");
  if (mermaid) return `\`\`\`mermaid\n${mermaid.replace(/\n$/, "")}\n\`\`\`\n\n`;
  if (element.closest("[data-editor-control]")) return "";
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
    const codeElement = element.querySelector("code");
    const code = codeElement?.textContent || "";
    const language = codeElement?.className.match(/language-([\w-]+)/)?.[1] || "";
    return `\`\`\`${language}\n${code.replace(/\n$/, "")}\n\`\`\`\n\n`;
  }
  if (tag === "button") return "";
  if (tag === "input" && element instanceof HTMLInputElement && element.type === "checkbox") {
    return element.checked ? "[x] " : "[ ] ";
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

function selectionOffsets(element: HTMLElement) {
  const selection = window.getSelection();
  if (!selection?.rangeCount) return null;
  const range = selection.getRangeAt(0);
  if (!element.contains(range.commonAncestorContainer)) return null;
  const beforeStart = range.cloneRange();
  beforeStart.selectNodeContents(element);
  beforeStart.setEnd(range.startContainer, range.startOffset);
  const beforeEnd = range.cloneRange();
  beforeEnd.selectNodeContents(element);
  beforeEnd.setEnd(range.endContainer, range.endOffset);
  return {
    start: beforeStart.toString().length,
    end: beforeEnd.toString().length,
  };
}

function restoreSelection(element: HTMLElement, offsets: { start: number; end: number } | null) {
  if (!offsets) return;
  const selection = window.getSelection();
  if (!selection) return;
  const range = document.createRange();
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  let node: Node | null;
  let position = 0;
  let startNode: Node | null = null;
  let startOffset = 0;
  let endNode: Node | null = null;
  let endOffset = 0;
  while ((node = walker.nextNode())) {
    const length = node.textContent?.length || 0;
    if (!startNode && offsets.start <= position + length) {
      startNode = node;
      startOffset = Math.max(0, offsets.start - position);
    }
    if (!endNode && offsets.end <= position + length) {
      endNode = node;
      endOffset = Math.max(0, offsets.end - position);
      break;
    }
    position += length;
  }
  if (!startNode || !endNode) {
    const last = element.lastChild;
    if (!last) return;
    range.selectNodeContents(element);
    range.collapse(false);
  } else {
    range.setStart(startNode, Math.min(startOffset, startNode.textContent?.length || 0));
    range.setEnd(endNode, Math.min(endOffset, endNode.textContent?.length || 0));
  }
  selection.removeAllRanges();
  selection.addRange(range);
}

type EditableMarkdownProps = {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  "aria-label"?: string;
  onPointerDown?: PointerEventHandler<HTMLDivElement>;
  interactiveTasks?: boolean;
};

export function EditableMarkdown({
  value,
  onChange,
  placeholder,
  className,
  "aria-label": ariaLabel,
  onPointerDown,
  interactiveTasks = false,
}: EditableMarkdownProps) {
  const editorRef = useRef<HTMLDivElement>(null);
  const localValueRef = useRef(value);
  const pendingSelectionRef = useRef<{ start: number; end: number } | null>(null);
  const [previewValue, setPreviewValue] = useState(value);
  const [renderVersion, setRenderVersion] = useState(0);

  useLayoutEffect(() => {
    if (value === localValueRef.current) return;
    const editor = editorRef.current;
    pendingSelectionRef.current =
      editor && document.activeElement === editor ? selectionOffsets(editor) : null;
    localValueRef.current = value;
    setPreviewValue(value);
    setRenderVersion((current) => current + 1);
  }, [value]);

  useLayoutEffect(() => {
    const editor = editorRef.current;
    const offsets = pendingSelectionRef.current;
    if (!editor || !offsets) return;
    pendingSelectionRef.current = null;
    restoreSelection(editor, offsets);
  }, [renderVersion]);

  return (
    <div
      ref={editorRef}
      contentEditable
      suppressContentEditableWarning
      role="textbox"
      aria-multiline="true"
      aria-label={ariaLabel}
      data-placeholder={placeholder}
      onPointerDown={onPointerDown}
      className={cn(
        "editable-markdown min-h-0 w-full flex-1 overflow-y-auto rounded-md p-2 text-[13px] leading-5 outline-none",
        "[&_.markdown-body_p]:my-2 [&_.markdown-body_ul]:my-2 [&_.markdown-body_ol]:my-2",
        "focus-visible:ring-2 focus-visible:ring-ring/50",
        className,
      )}
      onInput={(event) => {
        const nextValue = htmlToMarkdown(event.currentTarget);
        localValueRef.current = nextValue;
        onChange(nextValue);
      }}
    >
      {previewValue ? (
        <StableMarkdownPreview
          key={renderVersion}
          content={previewValue}
          interactiveTasks={interactiveTasks}
        />
      ) : null}
    </div>
  );
}
