/**
 * Metis Runtime Contracts — Canonical event types, lifecycle states, and item schemas.
 * Standardizes turn, item, tool, approval, and plan events across all provider backends.
 */

export type ItemLifecycleStatus = "inProgress" | "completed" | "failed" | "declined";

export type ToolLifecycleItemType =
  | "command_execution"
  | "file_change"
  | "mcp_tool_call"
  | "subagent_spawn"
  | "web_search"
  | "browser_action"
  | "image_view"
  | "question_prompt";

export const TOOL_LIFECYCLE_ITEM_TYPES: readonly ToolLifecycleItemType[] = [
  "command_execution",
  "file_change",
  "mcp_tool_call",
  "subagent_spawn",
  "web_search",
  "browser_action",
  "image_view",
  "question_prompt",
] as const;

export function isToolLifecycleItemType(value: string): value is ToolLifecycleItemType {
  return (TOOL_LIFECYCLE_ITEM_TYPES as readonly string[]).includes(value);
}

export type CanonicalItemType =
  | "user_message"
  | "assistant_message"
  | "reasoning"
  | "plan"
  | ToolLifecycleItemType
  | "review_entered"
  | "review_exited"
  | "context_compaction"
  | "error"
  | "unknown";

export type CanonicalRequestType =
  | "command_execution_approval"
  | "file_change_approval"
  | "apply_patch_approval"
  | "exec_command_approval"
  | "tool_user_input"
  | "unknown";

export interface CanonicalPlanStep {
  id: string;
  title: string;
  status: "pending" | "inProgress" | "completed";
}

export interface DiffFileChange {
  path: string;
  oldPath?: string;
  status: "added" | "modified" | "deleted";
  diff: string;
  additions?: number;
  deletions?: number;
}

export interface UserInputOption {
  value: string;
  label?: string;
  description?: string;
}

export interface UserInputQuestionPayload {
  id: string;
  prompt: string;
  header?: string;
  options?: UserInputOption[];
  isMultiSelect?: boolean;
  allowCustomInput?: boolean;
}

export interface ApprovalRequestPayload {
  id: string;
  requestType: CanonicalRequestType;
  title: string;
  description?: string;
  command?: string;
  cwd?: string;
  files?: DiffFileChange[];
  details?: Record<string, unknown>;
}

export type ProviderRuntimeEvent =
  | {
      type: "session.started";
      sessionId: string;
      provider: string;
      modelId: string;
      timestamp: number;
    }
  | {
      type: "turn.started";
      turnId: string;
      timestamp: number;
    }
  | {
      type: "turn.plan.updated";
      turnId: string;
      steps: CanonicalPlanStep[];
      timestamp: number;
    }
  | {
      type: "item.started";
      turnId: string;
      itemId: string;
      itemType: CanonicalItemType;
      title: string;
      input?: unknown;
      timestamp: number;
    }
  | {
      type: "content.delta";
      turnId: string;
      itemId: string;
      kind: "assistant_text" | "reasoning_text" | "command_output" | "diff";
      text: string;
      timestamp: number;
    }
  | {
      type: "item.updated";
      turnId: string;
      itemId: string;
      status?: ItemLifecycleStatus;
      title?: string;
      output?: unknown;
      timestamp: number;
    }
  | {
      type: "item.completed";
      turnId: string;
      itemId: string;
      status: ItemLifecycleStatus;
      result?: unknown;
      error?: string;
      timestamp: number;
    }
  | {
      type: "request.opened";
      turnId: string;
      requestId: string;
      requestType: CanonicalRequestType;
      payload: ApprovalRequestPayload | UserInputQuestionPayload;
      timestamp: number;
    }
  | {
      type: "request.resolved";
      turnId: string;
      requestId: string;
      decision: "approved" | "rejected" | "answered";
      data?: unknown;
      timestamp: number;
    }
  | {
      type: "turn.diff.updated";
      turnId: string;
      files: DiffFileChange[];
      timestamp: number;
    }
  | {
      type: "tool.progress";
      turnId: string;
      itemId: string;
      step?: number;
      totalSteps?: number;
      message?: string;
      timestamp: number;
    }
  | {
      type: "tool.summary";
      turnId: string;
      summary: string;
      timestamp: number;
    }
  | {
      type: "turn.completed";
      turnId: string;
      usage?: {
        inputTokens?: number;
        outputTokens?: number;
        totalTokens?: number;
      };
      timestamp: number;
    }
  | {
      type: "turn.error";
      turnId: string;
      message: string;
      fatal: boolean;
      timestamp: number;
    };
