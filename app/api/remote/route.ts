import path from "node:path";
import { randomUUID } from "node:crypto";
import * as pty from "node-pty";
import { getAuthenticatedUserId, isAuthenticated } from "@/lib/auth";
import { callRemoteGatewayTool } from "@/lib/remote-gateway";
import { collectRemoteClientEvents, requestRemoteClient } from "@/lib/remote-client-gateway";
import { config } from "@/lib/config";
import { getUserAgentCwd } from "@/lib/mcp";
import { isInsideWorkspace } from "@/lib/user-isolation";
import { isHostAdmin, requireUserExecutionIdentity } from "@/lib/user-access";

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

function isInside(root: string, candidate: string) {
  return isInsideWorkspace(root, candidate);
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

function gatewayContext(ownerId?: string) {
  const identity = requireUserExecutionIdentity(ownerId);
  return {
    userId: ownerId,
    uid: identity.uid,
    gid: identity.gid,
    osUsername: identity.username,
    workspaceRoot: identity.workspaceRoot,
    home: identity.home,
    allowRoot: config.allowRootAgents,
    isHostAdmin: isHostAdmin(ownerId),
  };
}

export async function GET(req: Request) {
  if (!(await isAuthenticated(req))) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const ownerId = await getAuthenticatedUserId(req) ?? undefined;
  const url = new URL(req.url);
  const clientId = url.searchParams.get("clientId")?.trim();
  if (clientId) {
    const sessionId = url.searchParams.get("sessionId")?.trim() || "";
    if (!sessionId) return Response.json({ error: "Remote terminal session is required" }, { status: 400 });
    const cursor = Number(url.searchParams.get("cursor") || 0);
    const events = await collectRemoteClientEvents(sessionId, 0);
    const chunks = events
      .filter((event) => event.event === "stdout" || event.event === "stderr")
      .map((event, index) => ({ id: cursor + index + 1, data: String(event.data || "") }));
    return Response.json({ chunks, cursor: cursor + chunks.length });
  }
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
  if (!ownerId) return Response.json({ error: "Account context is required" }, { status: 401 });
  let isolation: ReturnType<typeof gatewayContext>;
  try {
    isolation = gatewayContext(ownerId);
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Workspace isolation is required" },
      { status: 403 },
    );
  }

  let body: {
    action?: string;
    path?: string;
    cwd?: string;
    content?: string;
    newPath?: string;
    command?: string;
    timeout?: number;
    sessionId?: string;
    clientId?: string;
    data?: string;
    cols?: number;
    rows?: number;
  };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const defaultCwd = getUserAgentCwd(ownerId);
  const cwd = resolveRemotePath(body.cwd, defaultCwd);
  const targetPath = resolveRemotePath(body.path, cwd);
  if (!isInside(defaultCwd, cwd) || !isInside(defaultCwd, targetPath)) {
    return Response.json({ error: "Path must be inside the agent workspace." }, { status: 400 });
  }

  try {
    cleanupTerminalSessions();
    if (body.clientId) {
      const clientId = body.clientId.trim();
      if (!ownerId) return Response.json({ error: "Account context is required" }, { status: 401 });
      if (body.action === "pty-create") {
        const result = await requestRemoteClient({
          clientId,
          ownerId,
          action: "pty_open",
          approved: true,
          params: { cwd },
        });
        return Response.json(result);
      }
      if (body.action === "pty-input") {
        const result = await requestRemoteClient({
          clientId,
          ownerId,
          action: "pty_input",
          approved: true,
          params: { sessionId: body.sessionId, data: body.data || "" },
        });
        return Response.json({ result });
      }
      if (body.action === "pty-close") {
        const result = await requestRemoteClient({
          clientId,
          ownerId,
          action: "pty_close",
          approved: true,
          params: { sessionId: body.sessionId },
        });
        return Response.json(result);
      }
      if (body.action === "pty-resize") return Response.json({ ok: true });
      return Response.json({ error: "Unsupported remote client terminal action" }, { status: 400 });
    }
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
      const shellName = path.basename(shell);
      const shellArgs = shellName === "bash" || shellName === "zsh" ? ["--login"] : [];
      const terminal = pty.spawn(shell, shellArgs, {
        name: "xterm-256color",
        cols: Math.max(20, Math.min(Number(body.cols) || 80, 240)),
        rows: Math.max(5, Math.min(Number(body.rows) || 24, 100)),
        cwd,
        env: {
          ...process.env,
          HOME: isolation.home || process.env.HOME,
          TERM: "xterm-256color",
          COLORTERM: "truecolor",
        } as Record<string, string>,
        uid: isolation.uid,
        gid: isolation.gid,
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
      const output = await callRemoteGatewayTool("list_directory", { target: "server", path: targetPath }, isolation);
      return Response.json({ path: targetPath, output });
    }
    if (body.action === "read") {
      const output = await callRemoteGatewayTool("read_file", {
        target: "server",
        path: targetPath,
        offset: 1,
        limit: 5000,
      }, isolation);
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
      }, isolation);
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
      }, isolation);
      return Response.json({ cwd, output });
    }
    if (body.action === "mkdir") {
      const output = await callRemoteGatewayTool("execute_command", {
        target: "server",
        command: `mkdir -p -- ${shellQuote(targetPath)}`,
        cwd,
        timeout: 60,
        sudo: false,
      }, isolation);
      return Response.json({ path: targetPath, output });
    }
    if (body.action === "rename") {
      const newPath = resolveRemotePath(body.newPath, cwd);
      if (!isInside(defaultCwd, newPath)) {
        return Response.json({ error: "Path must be inside the agent workspace." }, { status: 400 });
      }
      const output = await callRemoteGatewayTool("execute_command", {
        target: "server",
        command: `mv -- ${shellQuote(targetPath)} ${shellQuote(newPath)}`,
        cwd,
        timeout: 60,
        sudo: false,
      }, isolation);
      return Response.json({ path: targetPath, newPath, output });
    }
    if (body.action === "delete") {
      const output = await callRemoteGatewayTool("execute_command", {
        target: "server",
        command: `rm -rf -- ${shellQuote(targetPath)}`,
        cwd,
        timeout: 60,
        sudo: false,
      }, isolation);
      return Response.json({ path: targetPath, output });
    }
    return Response.json({ error: "Unknown remote action" }, { status: 400 });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Remote action failed" },
      { status: 502 },
    );
  }
}
