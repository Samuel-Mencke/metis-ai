"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

type LinkPreviewProps = {
  href: string;
  children: ReactNode;
};

type Preview = {
  title?: string;
  description?: string;
  favicon?: string;
  image?: string;
};

export function LinkPreview({ href, children }: LinkPreviewProps) {
  const [open, setOpen] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [loading, setLoading] = useState(false);
  const timerRef = useRef<number | null>(null);

  useEffect(() => () => {
    if (timerRef.current) window.clearTimeout(timerRef.current);
  }, []);

  function show() {
    setOpen(true);
    if (preview || loading) return;
    timerRef.current = window.setTimeout(async () => {
      setLoading(true);
      try {
        const response = await fetch(`/api/link-preview?url=${encodeURIComponent(href)}`, {
          cache: "force-cache",
        });
        if (response.ok) setPreview((await response.json()) as Preview);
      } finally {
        setLoading(false);
      }
    }, 220);
  }

  return (
    <span className="relative inline" onMouseEnter={show} onMouseLeave={() => setOpen(false)}>
      {children}
      {open ? (
        <span
          role="tooltip"
          className="pointer-events-none absolute bottom-full left-0 z-50 mb-2 block w-72 rounded-xl border border-border/70 bg-popover p-3 text-left text-popover-foreground shadow-xl"
        >
          {loading ? (
            <span className="text-xs text-muted-foreground">Link wird geladen…</span>
          ) : (
            <span className="flex gap-2.5">
              {preview?.favicon ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={preview.favicon} alt="" className="mt-0.5 size-4 shrink-0 rounded-sm" />
              ) : null}
              <span className="min-w-0">
                {preview?.image ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={preview.image} alt="" className="mb-2 h-20 w-full rounded-md object-cover" />
                ) : null}
                <span className="block truncate text-xs font-medium">
                  {preview?.title || href}
                </span>
                {preview?.description ? (
                  <span className="mt-1 block line-clamp-3 text-[11px] leading-4 text-muted-foreground">
                    {preview.description}
                  </span>
                ) : (
                  <span className="mt-1 block truncate text-[11px] text-muted-foreground">{href}</span>
                )}
              </span>
            </span>
          )}
        </span>
      ) : null}
    </span>
  );
}
