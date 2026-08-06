import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import type { ChatMessage, ToolPart } from "@/lib/store";

const MAX_ROLLBACK_BYTES = 10 * 1024 * 1024;

export type RevertFileResult =
  | { status: "reverted"; path: string; action: "write" | "delete" }
  | { status: "conflict"; path: string; reason: string }
  | { status: "warning"; path: string; reason: string };

function isInside(root: string, candidate: string) {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

export function resolveAgentPath(rawPath: string, agentCwd: string): string | null {
  if (!rawPath.trim()) return null;
  const root = path.resolve(agentCwd);
  const candidate = path.resolve(root, rawPath);
  if (!isInside(root, candidate) || candidate === root) return null;

  try {
    const realRoot = realpathSync(root);
    const existing = existsSync(candidate)
      ? candidate
      : path.dirname(candidate);
    const realExisting = realpathSync(existing);
    if (!isInside(realRoot, realExisting)) return null;
  } catch {
    return null;
  }
  return candidate;
}

function readCurrent(filePath: string): string | undefined {
  if (!existsSync(filePath)) return undefined;
  try {
    const stat = statSync(filePath);
    if (!stat.isFile() || stat.size > MAX_ROLLBACK_BYTES) return undefined;
    return readFileSync(filePath, "utf8");
  } catch {
    return undefined;
  }
}

function writeRollback(filePath: string, content: string, mode?: number) {
  if (Buffer.byteLength(content, "utf8") > MAX_ROLLBACK_BYTES) {
    throw new Error("rollback content exceeds size limit");
  }
  mkdirSync(path.dirname(filePath), { recursive: true });
  const temp = `${filePath}.${process.pid}.${Date.now()}.revert`;
  writeFileSync(temp, content, { encoding: "utf8", mode: mode ?? 0o644 });
  if (mode !== undefined) chmodSync(temp, mode);
  renameSync(temp, filePath);
}

export function revertEditTool(tool: ToolPart, agentCwd: string): RevertFileResult {
  const filePath = tool.path ? resolveAgentPath(tool.path, agentCwd) : null;
  const displayPath = tool.path || tool.name;
  if (!filePath) {
    return { status: "warning", path: displayPath, reason: "path is outside the agent workspace" };
  }

  const before = tool.diff?.before;
  const after = tool.diff?.after;
  if (typeof before !== "string" && typeof after !== "string") {
    return { status: "conflict", path: displayPath, reason: "no complete before/after snapshot" };
  }
  const current = readCurrent(filePath);
  if (current !== after) {
    return { status: "conflict", path: displayPath, reason: "current file differs from recorded result" };
  }

  try {
    if (typeof before === "string") {
      const mode = existsSync(filePath) ? statSync(filePath).mode & 0o777 : undefined;
      writeRollback(filePath, before, mode);
      return { status: "reverted", path: displayPath, action: "write" };
    }
    if (existsSync(filePath)) unlinkSync(filePath);
    return { status: "reverted", path: displayPath, action: "delete" };
  } catch (error) {
    return {
      status: "warning",
      path: displayPath,
      reason: error instanceof Error ? error.message : "could not write rollback",
    };
  }
}

export function revertMessages(
  messages: ChatMessage[],
  startIndex: number,
  agentCwd: string,
) {
  const revertedFiles: RevertFileResult[] = [];
  const nonReversibleNames: string[] = [];
  let canvasUpdated = false;

  for (let i = messages.length - 1; i >= startIndex; i -= 1) {
    const message = messages[i];
    if (message.role === "assistant" && message.content.includes("```canvas")) {
      canvasUpdated = true;
    }
    for (const tool of message.tools ?? []) {
      if (tool.kind === "edit") {
        revertedFiles.push(revertEditTool(tool, agentCwd));
      } else {
        nonReversibleNames.push(tool.name);
      }
    }
  }

  return {
    revertedFiles,
    nonReversibleNames,
    canvasUpdated,
  };
}
