import crypto from "node:crypto";
import { runtimeEventBus } from "./event-bus";
import type { ProviderRuntimeEvent } from "./contracts";
import * as fsToolkit from "./toolkits/filesystem";
import * as terminalToolkit from "./toolkits/terminal";
import * as browserToolkit from "./toolkits/browser";
import * as subagentToolkit from "./toolkits/subagent";
import * as questionToolkit from "./toolkits/question";

export interface McpSession {
  sessionId: string;
  cwd: string;
  token: string;
  turnId?: string;
  createdAt: number;
}

const activeMcpSessions = new Map<string, McpSession>();

export function registerMcpSession(params: {
  sessionId: string;
  cwd: string;
  token?: string;
}): McpSession {
  const token = params.token || crypto.randomBytes(24).toString("hex");
  const session: McpSession = {
    sessionId: params.sessionId,
    cwd: params.cwd,
    token,
    createdAt: Date.now(),
  };
  activeMcpSessions.set(params.sessionId, session);
  return session;
}

export function getMcpSession(sessionId: string): McpSession | undefined {
  return activeMcpSessions.get(sessionId);
}

export function updateMcpSessionTurn(sessionId: string, turnId: string): void {
  const session = activeMcpSessions.get(sessionId);
  if (session) session.turnId = turnId;
}

export function deleteMcpSession(sessionId: string): void {
  activeMcpSessions.delete(sessionId);
}

export const METIS_MCP_TOOLS = [
  {
    name: "run_command",
    description: "Run a shell command on the host system within the workspace directory.",
    inputSchema: {
      type: "object",
      properties: {
        command: { type: "string", description: "The exact shell command to execute" },
        timeoutMs: { type: "number", description: "Optional execution timeout in ms (default 120000)" },
      },
      required: ["command"],
    },
  },
  {
    name: "view_file",
    description: "View text file content with 1-indexed line numbering and optional line ranges.",
    inputSchema: {
      type: "object",
      properties: {
        filePath: { type: "string", description: "Path to the file (absolute or relative to cwd)" },
        startLine: { type: "number", description: "1-indexed starting line (inclusive)" },
        endLine: { type: "number", description: "1-indexed ending line (inclusive)" },
      },
      required: ["filePath"],
    },
  },
  {
    name: "write_to_file",
    description: "Create or overwrite a file with full text content.",
    inputSchema: {
      type: "object",
      properties: {
        filePath: { type: "string", description: "Target file path" },
        content: { type: "string", description: "Complete file content to write" },
        overwrite: { type: "boolean", description: "Set to true to overwrite existing files" },
      },
      required: ["filePath", "content"],
    },
  },
  {
    name: "replace_file_content",
    description: "Replace a single contiguous block of code inside an existing file.",
    inputSchema: {
      type: "object",
      properties: {
        filePath: { type: "string", description: "Target file path" },
        targetContent: { type: "string", description: "Exact matching text block to replace" },
        replacementContent: { type: "string", description: "New replacement text block" },
        allowMultiple: { type: "boolean", description: "Replace all occurrences" },
      },
      required: ["filePath", "targetContent", "replacementContent"],
    },
  },
  {
    name: "list_dir",
    description: "List directory contents with names, types, and file sizes.",
    inputSchema: {
      type: "object",
      properties: {
        dirPath: { type: "string", description: "Directory path (defaults to workspace cwd)" },
      },
    },
  },
  {
    name: "find_by_name",
    description: "Find files and directories by glob or filename pattern.",
    inputSchema: {
      type: "object",
      properties: {
        pattern: { type: "string", description: "Glob or filename pattern, e.g. *.ts" },
        searchDirectory: { type: "string", description: "Search root directory" },
        maxDepth: { type: "number", description: "Max directory depth to search" },
      },
      required: ["pattern"],
    },
  },
  {
    name: "grep_search",
    description: "Search text patterns or regex across files using ripgrep.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search term or regex pattern" },
        searchPath: { type: "string", description: "Search directory or file" },
        isRegex: { type: "boolean", description: "Treat query as regular expression" },
        caseInsensitive: { type: "boolean", description: "Perform case-insensitive search" },
      },
      required: ["query"],
    },
  },
  {
    name: "browser_action",
    description: "Interact with the browser or capture a web preview screenshot.",
    inputSchema: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["navigate", "screenshot", "click", "fill"] },
        url: { type: "string", description: "Target URL for navigation" },
        selector: { type: "string", description: "CSS selector for click/fill" },
        text: { type: "string", description: "Input text for fill action" },
      },
      required: ["action"],
    },
  },
  {
    name: "ask_question",
    description: "Prompt the user with an interactive multiple-choice question or text clarification.",
    inputSchema: {
      type: "object",
      properties: {
        prompt: { type: "string", description: "The question prompt to display to the user" },
        options: {
          type: "array",
          items: { type: "string" },
          description: "List of multiple-choice options",
        },
        isMultiSelect: { type: "boolean", description: "Allow multiple option selections" },
      },
      required: ["prompt"],
    },
  },
  {
    name: "invoke_subagent",
    description: "Spawn a child subagent to perform an autonomous task in parallel.",
    inputSchema: {
      type: "object",
      properties: {
        role: { type: "string", description: "2-4 word subagent role title" },
        prompt: { type: "string", description: "Actionable instructions for the subagent" },
      },
      required: ["role", "prompt"],
    },
  },
];

export async function handleMcpToolCall(params: {
  sessionId: string;
  name: string;
  args: Record<string, unknown>;
}): Promise<{ content: Array<{ type: "text"; text: string }>; isError?: boolean }> {
  const session = getMcpSession(params.sessionId);
  const cwd = session?.cwd || process.cwd();
  const turnId = session?.turnId || "turn_default";
  const itemId = crypto.randomUUID();

  runtimeEventBus.publish(params.sessionId, {
    type: "item.started",
    turnId,
    itemId,
    itemType: "mcp_tool_call",
    title: `${params.name}`,
    input: params.args,
    timestamp: Date.now(),
  });

  try {
    let resultPayload: unknown;

    switch (params.name) {
      case "run_command": {
        const cmd = String(params.args.command || "");
        const res = await terminalToolkit.runCommand({
          command: cmd,
          cwd,
          timeoutMs: typeof params.args.timeoutMs === "number" ? params.args.timeoutMs : 120_000,
          onStdout: (chunk) => {
            runtimeEventBus.publish(params.sessionId, {
              type: "content.delta",
              turnId,
              itemId,
              kind: "command_output",
              text: chunk,
              timestamp: Date.now(),
            });
          },
        });
        resultPayload = res;
        break;
      }
      case "view_file": {
        resultPayload = await fsToolkit.viewFile({
          filePath: String(params.args.filePath || ""),
          cwd,
          startLine: typeof params.args.startLine === "number" ? params.args.startLine : undefined,
          endLine: typeof params.args.endLine === "number" ? params.args.endLine : undefined,
        });
        break;
      }
      case "write_to_file": {
        resultPayload = await fsToolkit.writeToFile({
          filePath: String(params.args.filePath || ""),
          cwd,
          content: String(params.args.content || ""),
          overwrite: Boolean(params.args.overwrite),
        });
        break;
      }
      case "replace_file_content": {
        resultPayload = await fsToolkit.replaceFileContent({
          filePath: String(params.args.filePath || ""),
          cwd,
          targetContent: String(params.args.targetContent || ""),
          replacementContent: String(params.args.replacementContent || ""),
          allowMultiple: Boolean(params.args.allowMultiple),
        });
        break;
      }
      case "list_dir": {
        resultPayload = await fsToolkit.listDir({
          dirPath: String(params.args.dirPath || "."),
          cwd,
        });
        break;
      }
      case "find_by_name": {
        resultPayload = await fsToolkit.findByName({
          pattern: String(params.args.pattern || "*"),
          searchDirectory: String(params.args.searchDirectory || "."),
          cwd,
          maxDepth: typeof params.args.maxDepth === "number" ? params.args.maxDepth : undefined,
        });
        break;
      }
      case "grep_search": {
        resultPayload = await fsToolkit.grepSearch({
          query: String(params.args.query || ""),
          searchPath: String(params.args.searchPath || "."),
          cwd,
          isRegex: Boolean(params.args.isRegex),
          caseInsensitive: Boolean(params.args.caseInsensitive),
        });
        break;
      }
      case "browser_action": {
        resultPayload = await browserToolkit.executeBrowserAction({
          action: (params.args.action as any) || "screenshot",
          url: typeof params.args.url === "string" ? params.args.url : undefined,
          selector: typeof params.args.selector === "string" ? params.args.selector : undefined,
          text: typeof params.args.text === "string" ? params.args.text : undefined,
        });
        break;
      }
      case "ask_question": {
        const prompt = String(params.args.prompt || "");
        const rawOptions = Array.isArray(params.args.options) ? params.args.options : [];
        const options = rawOptions.map((opt) => ({ value: String(opt), label: String(opt) }));
        const reqId = crypto.randomUUID();

        runtimeEventBus.publish(params.sessionId, {
          type: "request.opened",
          turnId,
          requestId: reqId,
          requestType: "tool_user_input",
          payload: {
            id: reqId,
            prompt,
            options,
            isMultiSelect: Boolean(params.args.isMultiSelect),
            allowCustomInput: true,
          },
          timestamp: Date.now(),
        });

        const ans = await questionToolkit.registerPendingQuestion(reqId, {
          id: reqId,
          prompt,
          options,
          isMultiSelect: Boolean(params.args.isMultiSelect),
          allowCustomInput: true,
        });

        runtimeEventBus.publish(params.sessionId, {
          type: "request.resolved",
          turnId,
          requestId: reqId,
          decision: "answered",
          data: ans,
          timestamp: Date.now(),
        });

        resultPayload = ans;
        break;
      }
      case "invoke_subagent": {
        resultPayload = await subagentToolkit.spawnSubagent({
          role: String(params.args.role || "Assistant"),
          prompt: String(params.args.prompt || ""),
          parentSessionId: params.sessionId,
        });
        break;
      }
      default: {
        throw new Error(`Unknown MCP tool: ${params.name}`);
      }
    }

    runtimeEventBus.publish(params.sessionId, {
      type: "item.completed",
      turnId,
      itemId,
      status: "completed",
      result: resultPayload,
      timestamp: Date.now(),
    });

    return {
      content: [{ type: "text", text: typeof resultPayload === "string" ? resultPayload : JSON.stringify(resultPayload, null, 2) }],
    };
  } catch (err: any) {
    const errorMsg = err?.message || String(err);
    runtimeEventBus.publish(params.sessionId, {
      type: "item.completed",
      turnId,
      itemId,
      status: "failed",
      error: errorMsg,
      timestamp: Date.now(),
    });
    return {
      content: [{ type: "text", text: `Error executing ${params.name}: ${errorMsg}` }],
      isError: true,
    };
  }
}
