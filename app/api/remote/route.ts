import path from "node:path";
import { randomUUID } from "node:crypto";
import * as pty from "node-pty";
import { getAuthenticatedUserId, isAuthenticated } from "@/lib/auth";
import { callRemoteGatewayTool } from "@/lib/remote-gateway";
import { config } from "@/lib/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULT_CWD = config.agentCwd;
const terminalSessions = new Map<string, {
  ownerId?: string;
  cwd: string;
  process: pty.IPty;
  chunks: Array<{ id: number; data: string }>;
  nextChunkId: number;
  lastActivity: number;
}>();

function resolveRemotePath(value: unknown, cwd = DEFAULT_CWD) {
  const input = typeof value === "string" && value.trim() ? value.trim() : cwd;
  return path.resolve(input.startsWith("/") ? input : path.join(cwd, input));
}

function shellQuote(value: string) {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function readContent(raw: string) {
  // The gateway may add source line prefixes such as `     123 content`,
  // `123|content`, or `L123:content`.
  // Keep Monaco's own line-number gutter; only strip prefixes from the content.
  const withoutGatewayPrefixes = raw.replace(/^\s*L?\d+(?:\s+|\s*[|:]\s*)/gm, "");
  const lines = withoutGatewayPrefixes.split(/\r?\n/);
  let expected = 1;
  let foundSequentialPrefixes = false;
  const isSequentiallyNumbered = lines.every((line) => {
    if (!line.trim()) return true;
    const match = line.match(/^\s*(\d+)[\t ]+/);
    if (!match || Number(match[1]) !== expected) return false;
    expected += 1;
    foundSequentialPrefixes = true;
    return true;
  });
  if (!isSequentiallyNumbered || !foundSequentialPrefixes) return withoutGatewayPrefixes;
  return lines.map((line) => line.replace(/^\s*\d+[\t ]+/, "")).join("\n");
}

function sessionFor(sessionId: string | null, ownerId?: string) {
  if (!sessionId) return null;
  const session = terminalSessions.get(sessionId);
  if (!session || session.ownerId !== ownerId) return null;
  return session;
}

function cleanupTerminalSessions() {
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  for (const [sessionId, session] of terminalSessions) {
    if (session.lastActivity < cutoff) {
      session.process.kill();
      terminalSessions.delete(sessionId);
    }
  }
}

export async function GET(req: Request) {
  if (!(await isAuthenticated(req))) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const ownerId = await getAuthenticatedUserId(req) ?? undefined;
  const url = new URL(req.url);
  const session = sessionFor(url.searchParams.get("sessionId"), ownerId);
  if (!session) return Response.json({ error: "Terminal session not found" }, { status: 404 });
  session.lastActivity = Date.now();
  const cursor = Number(url.searchParams.get("cursor") || 0);
  const chunks = session.chunks.filter((chunk) => chunk.id > cursor);
  const nextCursor = chunks.at(-1)?.id ?? cursor;
  return Response.json({ chunks, cursor: nextCursor });
}

export async function POST(req: Request) {
  if (!(await isAuthenticated(req))) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const ownerId = await getAuthenticatedUserId(req) ?? undefined;

  let body: {
    action?: string;
    path?: string;
    cwd?: string;
    content?: string;
    newPath?: string;
    command?: string;
    timeout?: number;
    sessionId?: string;
    data?: string;
    cols?: number;
    rows?: number;
  };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const cwd = resolveRemotePath(body.cwd);
  const targetPath = resolveRemotePath(body.path, cwd);

  try {
    cleanupTerminalSessions();
    if (body.action === "pty-attach") {
      const session = sessionFor(body.sessionId || null, ownerId);
      if (!session || session.cwd !== cwd) {
        return Response.json({ error: "Terminal session not found" }, { status: 404 });
      }
      session.lastActivity = Date.now();
      return Response.json({ sessionId: body.sessionId });
    }
    if (body.action === "pty-create") {
      const sessionId = randomUUID();
      const shell = process.env.SHELL?.trim() || "/bin/bash";
      const terminal = pty.spawn(shell, ["--login"], {
        name: "xterm-256color",
        cols: Math.max(20, Math.min(Number(body.cols) || 80, 240)),
        rows: Math.max(5, Math.min(Number(body.rows) || 24, 100)),
        cwd,
        env: {
          ...process.env,
          TERM: "xterm-256color",
          COLORTERM: "truecolor",
        } as Record<string, string>,
      });
      const session = {
        ownerId,
        cwd,
        process: terminal,
        chunks: [] as Array<{ id: number; data: string }>,
        nextChunkId: 1,
        lastActivity: Date.now(),
      };
      terminal.onData((data) => {
        session.chunks.push({ id: session.nextChunkId++, data });
        if (session.chunks.length > 2000) session.chunks.splice(0, session.chunks.length - 2000);
      });
      terminal.onExit(() => terminalSessions.delete(sessionId));
      terminalSessions.set(sessionId, session);
      return Response.json({ sessionId });
    }
    if (body.action === "pty-input") {
      const session = sessionFor(body.sessionId || null, ownerId);
      if (!session || typeof body.data !== "string") {
        return Response.json({ error: "Terminal session not found" }, { status: 404 });
      }
      session.lastActivity = Date.now();
      session.process.write(body.data);
      return Response.json({ ok: true });
    }
    if (body.action === "pty-resize") {
      const session = sessionFor(body.sessionId || null, ownerId);
      if (!session) return Response.json({ error: "Terminal session not found" }, { status: 404 });
      session.lastActivity = Date.now();
      session.process.resize(
        Math.max(20, Math.min(Number(body.cols) || 80, 240)),
        Math.max(5, Math.min(Number(body.rows) || 24, 100)),
      );
      return Response.json({ ok: true });
    }
    if (body.action === "pty-close") {
      const session = sessionFor(body.sessionId || null, ownerId);
      if (session) {
        session.process.kill();
        terminalSessions.delete(body.sessionId!);
      }
      return Response.json({ ok: true });
    }
    if (body.action === "list") {
      const output = await callRemoteGatewayTool("list_directory", { target: "server", path: targetPath });
      return Response.json({ path: targetPath, output });
    }
    if (body.action === "read") {
      const output = await callRemoteGatewayTool("read_file", {
        target: "server",
        path: targetPath,
        offset: 1,
        limit: 5000,
      });
      return Response.json({ path: targetPath, content: readContent(output) });
    }
    if (body.action === "write") {
      if (typeof body.content !== "string") {
        return Response.json({ error: "File content is required" }, { status: 400 });
      }
      const output = await callRemoteGatewayTool("write_file", {
        target: "server",
        path: targetPath,
        content: body.content,
      });
      return Response.json({ path: targetPath, output });
    }
    if (body.action === "exec") {
      if (!body.command?.trim()) {
        return Response.json({ error: "Command is required" }, { status: 400 });
      }
      const output = await callRemoteGatewayTool("execute_command", {
        target: "server",
        command: body.command,
        cwd,
        timeout: Math.max(1, Math.min(body.timeout || 60, 3600)),
        sudo: false,
      });
      return Response.json({ cwd, output });
    }
    if (body.action === "mkdir") {
      const output = await callRemoteGatewayTool("execute_command", {
        target: "server",
        command: `mkdir -p -- ${shellQuote(targetPath)}`,
        cwd,
        timeout: 60,
        sudo: false,
      });
      return Response.json({ path: targetPath, output });
    }
    if (body.action === "rename") {
      const newPath = resolveRemotePath(body.newPath, cwd);
      const output = await callRemoteGatewayTool("execute_command", {
        target: "server",
        command: `mv -- ${shellQuote(targetPath)} ${shellQuote(newPath)}`,
        cwd,
        timeout: 60,
        sudo: false,
      });
      return Response.json({ path: targetPath, newPath, output });
    }
    if (body.action === "delete") {
      const output = await callRemoteGatewayTool("execute_command", {
        target: "server",
        command: `rm -rf -- ${shellQuote(targetPath)}`,
        cwd,
        timeout: 60,
        sudo: false,
      });
      return Response.json({ path: targetPath, output });
    }
    return Response.json({ error: "Unknown remote action" }, { status: 400 });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Remote-Aktion fehlgeschlagen" },
      { status: 502 },
    );
  }
}
