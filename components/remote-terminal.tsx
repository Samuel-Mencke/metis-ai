"use client";

import { useEffect, useRef, useState } from "react";
import { LoaderCircle, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import "@xterm/xterm/css/xterm.css";

type RemoteTerminalProps = {
  cwd: string;
  sessionId?: string;
  onSessionIdChange: (sessionId: string) => void;
};

export function RemoteTerminal({ cwd, sessionId, onSessionIdChange }: RemoteTerminalProps) {
  const terminalElementRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<import("@xterm/xterm").Terminal | null>(null);
  const fitAddonRef = useRef<import("@xterm/addon-fit").FitAddon | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const cursorRef = useRef(0);
  const [starting, setStarting] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let disposed = false;
    let pollTimer: number | null = null;
    let dataDisposable: { dispose: () => void } | null = null;
    let resizeDisposable: { dispose: () => void } | null = null;

    async function start() {
      if (!terminalElementRef.current) return;
      const [{ Terminal }, { FitAddon }] = await Promise.all([
        import("@xterm/xterm"),
        import("@xterm/addon-fit"),
      ]);
      if (disposed || !terminalElementRef.current) return;

      const terminal = new Terminal({
        cursorBlink: true,
        cursorStyle: "block",
        convertEol: true,
        scrollback: 10_000,
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
        fontSize: 13,
        theme: {
          background: "#09090b",
          foreground: "#e4e4e7",
          cursor: "#e4e4e7",
          selectionBackground: "#3f3f46",
        },
      });
      const fitAddon = new FitAddon();
      terminal.loadAddon(fitAddon);
      terminal.open(terminalElementRef.current);
      fitAddon.fit();
      terminalRef.current = terminal;
      fitAddonRef.current = fitAddon;

      const size = { cols: terminal.cols, rows: terminal.rows };
      let response = sessionId
        ? await fetch("/api/remote", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "pty-attach", sessionId, cwd, ...size }),
          })
        : null;
      if (!response?.ok) {
        response = await fetch("/api/remote", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "pty-create", cwd, ...size }),
        });
      }
      const data = (await response.json()) as { sessionId?: string; error?: string };
      if (!response.ok || !data.sessionId) throw new Error(data.error || "Terminal konnte nicht gestartet werden");
      sessionIdRef.current = data.sessionId;
      onSessionIdChange(data.sessionId);
      setStarting(false);

      dataDisposable = terminal.onData((input) => {
        void fetch("/api/remote", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "pty-input", sessionId: data.sessionId, data: input }),
        });
      });
      resizeDisposable = terminal.onResize(({ cols, rows }) => {
        void fetch("/api/remote", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "pty-resize", sessionId: data.sessionId, cols, rows }),
        });
      });

      const poll = async () => {
        if (disposed) return;
        try {
          const pollResponse = await fetch(`/api/remote?sessionId=${encodeURIComponent(data.sessionId!)}&cursor=${cursorRef.current}`, { cache: "no-store" });
          if (pollResponse.ok) {
            const pollData = (await pollResponse.json()) as { chunks?: Array<{ id: number; data: string }>; cursor?: number };
            for (const chunk of pollData.chunks || []) terminal.write(chunk.data);
            if (typeof pollData.cursor === "number") cursorRef.current = pollData.cursor;
          }
        } catch {
          // The next poll will retry while the PTY is alive.
        }
        pollTimer = window.setTimeout(() => void poll(), 80);
      };
      void poll();
    }

    void start().catch((nextError) => {
      if (!disposed) {
        setStarting(false);
        setError(nextError instanceof Error ? nextError.message : "Terminal konnte nicht gestartet werden");
      }
    });

    const resizeObserver = new ResizeObserver(() => fitAddonRef.current?.fit());
    if (terminalElementRef.current) resizeObserver.observe(terminalElementRef.current);
    return () => {
      disposed = true;
      if (pollTimer) window.clearTimeout(pollTimer);
      resizeObserver.disconnect();
      dataDisposable?.dispose();
      resizeDisposable?.dispose();
      terminalRef.current?.dispose();
      terminalRef.current = null;
      sessionIdRef.current = null;
    };
  }, [cwd]);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <div className="flex items-center gap-2">
        <Input
          value={cwd}
          readOnly
          aria-label="Remote working directory"
          className="h-8 min-w-0 flex-1 font-mono text-xs"
        />
        <Button type="button" size="icon-sm" variant="ghost" onClick={() => terminalRef.current?.clear()} aria-label="Clear terminal">
          <RotateCcw className="size-3.5" />
        </Button>
      </div>
      <div ref={terminalElementRef} className="min-h-0 flex-1 overflow-hidden rounded-md bg-[#09090b] p-2" aria-label="Remote terminal">
        {starting ? <LoaderCircle className="size-4 animate-spin text-muted-foreground" /> : null}
      </div>
      {error ? <p className="whitespace-pre-wrap text-xs text-destructive">{error}</p> : null}
    </div>
  );
}
