"use client";

import {
  memo,
  useEffect,
  useRef,
  useState,
  type AnchorHTMLAttributes,
  type HTMLAttributes,
  type InputHTMLAttributes,
} from "react";
import ReactMarkdown, { defaultUrlTransform } from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import hljs from "highlight.js/lib/common";
import "katex/dist/katex.min.css";
import "highlight.js/styles/github-dark.css";
import { normalizeMath, splitStreamingMath } from "@/lib/math";
import { LinkPreview } from "@/components/link-preview";
import { Link2 } from "lucide-react";
import { cn } from "@/lib/utils";

export { normalizeMath, splitStreamingMath } from "@/lib/math";

function MarkdownLink({
  href,
  children,
  ...props
}: AnchorHTMLAttributes<HTMLAnchorElement>) {
  const isWebUrl = Boolean(href && /^https?:\/\//i.test(href));
  const isSubagentUrl = Boolean(href && /^subagent:\/\//i.test(href));
  const workspaceMatch = href?.match(/^workspace:\/\/(plan|canvas)\/([^/?#]+)(?:[?#].*)?$/i);
  const noteMatch = href?.match(/^note:\/\/([^/?#]+)(?:[?#].*)?$/i);
  const childText = typeof children === "string"
    ? children
    : Array.isArray(children)
      ? children.filter((child): child is string => typeof child === "string").join("")
      : "";
  const sourceTitle = childText.match(/^(?:source|quelle)\s*[:\-]\s*(.+)$/i)?.[1]?.trim();
  const link = (
    <a
      {...props}
      href={workspaceMatch ? `#workspace-${workspaceMatch[2]}` : noteMatch ? `#note-${noteMatch[1]}` : href}
      className={cn(
        props.className,
        sourceTitle && "inline-flex items-center gap-1 rounded-full border border-border/60 bg-secondary/60 px-1.5 py-0.5 text-[11px] font-medium no-underline hover:bg-secondary",
      )}
      onClick={(event) => {
        if (workspaceMatch) {
          event.preventDefault();
          event.stopPropagation();
          window.dispatchEvent(
            new CustomEvent("ai-chat:open-workspace", {
              detail: {
                type: workspaceMatch[1].toLowerCase(),
                id: decodeURIComponent(workspaceMatch[2]),
              },
            }),
          );
          return;
        }
        if (noteMatch) {
          event.preventDefault();
          event.stopPropagation();
          window.dispatchEvent(
            new CustomEvent("ai-chat:open-note", {
              detail: { id: decodeURIComponent(noteMatch[1]) },
            }),
          );
          return;
        }
        if (isSubagentUrl && href) {
          event.preventDefault();
          window.dispatchEvent(
            new CustomEvent("ai-chat:open-subagent", {
              detail: href.slice("subagent://".length),
            }),
          );
          return;
        }
        if (!isWebUrl || !href) return;
        event.preventDefault();
        window.dispatchEvent(new CustomEvent("ai-chat:open-browser", { detail: href }));
      }}
    >
      {sourceTitle ? (
        <>
          <Link2 className="size-3 shrink-0" aria-hidden="true" />
          {sourceTitle}
        </>
      ) : children}
    </a>
  );
  return isWebUrl && href ? <LinkPreview href={href}>{link}</LinkPreview> : link;
}

const markdownComponents = { a: MarkdownLink };

function transformMarkdownUrl(url: string) {
  if (/^(workspace|note|subagent):\/\//i.test(url)) return url;
  return defaultUrlTransform(url);
}

function CodeBlock({
  className,
  children,
  inline,
  ...props
}: HTMLAttributes<HTMLElement> & { inline?: boolean }) {
  const code = String(children).replace(/\n$/, "");
  const isInline = inline ?? (!className && !code.includes("\n"));
  const [copied, setCopied] = useState(false);
  if (isInline) {
    return (
      <code className={className} {...props}>
        {children}
      </code>
    );
  }
  const declaredLanguage = className?.match(/language-([\w-]+)/)?.[1];
  const detectedLanguage =
    declaredLanguage && hljs.getLanguage(declaredLanguage)
      ? declaredLanguage
      : hljs.highlightAuto(code).language;
  const highlighted = detectedLanguage
    ? hljs.highlight(code, { language: detectedLanguage }).value
    : hljs.highlightAuto(code).value;
  return (
    <div className="group relative">
      <pre className="markdown-code-block" {...props}>
        <div className="mb-1.5 flex items-center justify-between text-[10px] font-sans uppercase tracking-wide text-muted-foreground/70">
          <span>{detectedLanguage || "text"}</span>
        </div>
        <code
          className={className}
          dangerouslySetInnerHTML={{ __html: highlighted }}
        />
      </pre>
      <button
        type="button"
        className="absolute top-2 right-2 rounded border border-border/50 bg-background/80 px-2 py-1 text-[10px] text-muted-foreground opacity-100 transition-opacity hover:text-foreground md:opacity-0 md:group-hover:opacity-100"
        onClick={() => {
          void navigator.clipboard.writeText(code).then(() => {
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1200);
          });
        }}
      >
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}

function TaskCheckbox({
  interactive,
  checked,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { interactive?: boolean }) {
  const [value, setValue] = useState(Boolean(checked));
  useEffect(() => {
    setValue(Boolean(checked));
  }, [checked]);
  return (
    <input
      {...props}
      type="checkbox"
      checked={value}
      disabled={!interactive}
      contentEditable={false}
      onChange={(event) => {
        setValue(event.currentTarget.checked);
        if (interactive) {
          event.currentTarget.closest(".editable-markdown")?.dispatchEvent(
            new InputEvent("input", { bubbles: true, inputType: "insertReplacementText" }),
          );
        }
      }}
    />
  );
}

export const Markdown = memo(function Markdown({
  content,
  streaming = false,
  interactiveTasks = false,
}: {
  content: string;
  streaming?: boolean;
  interactiveTasks?: boolean;
}) {
  const markdownComponentsWithCode = {
    ...markdownComponents,
    code: CodeBlock,
    input: (props: InputHTMLAttributes<HTMLInputElement>) => (
      <TaskCheckbox {...props} interactive={interactiveTasks} />
    ),
  };
  if (streaming) {
    const { ready, pending } = splitStreamingMath(content);
    return (
      <div className="markdown-body">
        {ready ? (
          <ReactMarkdown
            remarkPlugins={[remarkGfm, remarkMath]}
            rehypePlugins={[
              [rehypeKatex, { throwOnError: false, strict: "ignore" }],
            ]}
            urlTransform={transformMarkdownUrl}
            components={markdownComponentsWithCode}
          >
            {ready}
          </ReactMarkdown>
        ) : null}
        {pending ? (
          <span className="whitespace-pre-wrap text-muted-foreground/80">
            {pending}
          </span>
        ) : null}
      </div>
    );
  }

  return (
    <div className="markdown-body">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[
          [rehypeKatex, { throwOnError: false, strict: "ignore" }],
        ]}
        urlTransform={transformMarkdownUrl}
        components={markdownComponentsWithCode}
      >
        {normalizeMath(content)}
      </ReactMarkdown>
    </div>
  );
});

export const StreamingMarkdown = memo(function StreamingMarkdown({ content }: { content: string }) {
  const targetRef = useRef(content);
  const displayedRef = useRef("");
  const visibleTokenRef = useRef("");
  const [displayed, setDisplayed] = useState("");
  const [visibleToken, setVisibleToken] = useState("");

  useEffect(() => {
    targetRef.current = content;
    if (!content.startsWith(displayedRef.current)) {
      displayedRef.current = "";
      visibleTokenRef.current = "";
      setDisplayed("");
      setVisibleToken("");
    }
  }, [content]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (visibleTokenRef.current) {
        const token = visibleTokenRef.current;
        visibleTokenRef.current = "";
        displayedRef.current += token;
        setDisplayed(displayedRef.current);
        setVisibleToken("");
        return;
      }

      const remainder = targetRef.current.slice(displayedRef.current.length);
      if (!remainder) return;
      const token = remainder.match(/^\s*\S+\s*/)?.[0] || remainder[0];
      visibleTokenRef.current = token;
      setVisibleToken(token);
    }, 45);

    return () => window.clearInterval(timer);
  }, []);

  return (
    <div className="streaming-markdown">
      <Markdown content={displayed} streaming />
      {visibleToken ? (
        <span className="streaming-token-fade whitespace-pre-wrap">
          {visibleToken}
        </span>
      ) : null}
    </div>
  );
});
