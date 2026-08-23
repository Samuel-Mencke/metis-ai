import type {
  ProviderRuntimeEvent,
  CanonicalPlanStep,
  DiffFileChange,
  ApprovalRequestPayload,
  UserInputQuestionPayload,
  ItemLifecycleStatus,
} from "./contracts";

export interface TimelineToolItem {
  id: string;
  name: string;
  status: ItemLifecycleStatus;
  input?: unknown;
  output?: unknown;
  error?: string;
  stdoutDelta?: string;
  timestamp: number;
}

export interface TimelineToolGroup {
  kind: "tool_group";
  id: string;
  status: ItemLifecycleStatus;
  tools: TimelineToolItem[];
  summary: string;
}

export interface TimelineMessageItem {
  kind: "message";
  id: string;
  role: "user" | "assistant";
  text: string;
  reasoningText?: string;
}

export interface TimelinePlanItem {
  kind: "plan";
  id: string;
  steps: CanonicalPlanStep[];
}

export interface TimelineApprovalItem {
  kind: "approval";
  id: string;
  requestId: string;
  payload: ApprovalRequestPayload | UserInputQuestionPayload;
  status: "pending" | "approved" | "rejected" | "answered";
}

export interface TimelineDiffItem {
  kind: "diff";
  id: string;
  files: DiffFileChange[];
}

export type TimelineItem =
  | TimelineMessageItem
  | TimelineToolGroup
  | TimelinePlanItem
  | TimelineApprovalItem
  | TimelineDiffItem;

export interface TimelineState {
  items: TimelineItem[];
  activeTurnId?: string;
  isRunning: boolean;
  totalUsage?: {
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
  };
}

export function createInitialTimelineState(): TimelineState {
  return {
    items: [],
    isRunning: false,
  };
}

export function timelineReducer(
  state: TimelineState,
  event: ProviderRuntimeEvent,
): TimelineState {
  const items = [...state.items];

  switch (event.type) {
    case "turn.started": {
      return {
        ...state,
        activeTurnId: event.turnId,
        isRunning: true,
      };
    }

    case "content.delta": {
      const last = items[items.length - 1];
      if (event.kind === "assistant_text") {
        if (last && last.kind === "message" && last.role === "assistant") {
          items[items.length - 1] = {
            ...last,
            text: last.text + event.text,
          };
        } else {
          items.push({
            kind: "message",
            id: event.itemId,
            role: "assistant",
            text: event.text,
          });
        }
      } else if (event.kind === "reasoning_text") {
        if (last && last.kind === "message" && last.role === "assistant") {
          items[items.length - 1] = {
            ...last,
            reasoningText: (last.reasoningText || "") + event.text,
          };
        } else {
          items.push({
            kind: "message",
            id: event.itemId,
            role: "assistant",
            text: "",
            reasoningText: event.text,
          });
        }
      } else if (event.kind === "command_output") {
        // Append stdout delta to the latest tool inside the active tool group
        if (last && last.kind === "tool_group") {
          const tools = [...last.tools];
          const toolIdx = tools.findIndex((t) => t.id === event.itemId);
          if (toolIdx >= 0) {
            tools[toolIdx] = {
              ...tools[toolIdx],
              stdoutDelta: (tools[toolIdx].stdoutDelta || "") + event.text,
            };
            items[items.length - 1] = {
              ...last,
              tools,
            };
          }
        }
      }
      return { ...state, items };
    }

    case "item.started": {
      if (event.itemType === "mcp_tool_call" || event.itemType === "command_execution" || event.itemType === "file_change") {
        const newTool: TimelineToolItem = {
          id: event.itemId,
          name: event.title,
          status: "inProgress",
          input: event.input,
          timestamp: event.timestamp,
        };

        const last = items[items.length - 1];
        if (last && last.kind === "tool_group") {
          const tools = [...last.tools, newTool];
          items[items.length - 1] = {
            ...last,
            status: "inProgress",
            tools,
            summary: `Used ${tools.length} ${tools.length === 1 ? "tool" : "tools"}`,
          };
        } else {
          items.push({
            kind: "tool_group",
            id: `group_${event.itemId}`,
            status: "inProgress",
            tools: [newTool],
            summary: `Used 1 tool`,
          });
        }
      }
      return { ...state, items };
    }

    case "item.completed": {
      const last = items[items.length - 1];
      if (last && last.kind === "tool_group") {
        const tools = [...last.tools];
        const idx = tools.findIndex((t) => t.id === event.itemId);
        if (idx >= 0) {
          tools[idx] = {
            ...tools[idx],
            status: event.status,
            output: event.result,
            error: event.error,
          };
          const allCompleted = tools.every((t) => t.status === "completed");
          const anyFailed = tools.some((t) => t.status === "failed");
          items[items.length - 1] = {
            ...last,
            status: anyFailed ? "failed" : allCompleted ? "completed" : "inProgress",
            tools,
          };
        }
      }
      return { ...state, items };
    }

    case "turn.plan.updated": {
      const existingIdx = items.findIndex((i) => i.kind === "plan");
      const planItem: TimelinePlanItem = {
        kind: "plan",
        id: `plan_${event.turnId}`,
        steps: event.steps,
      };
      if (existingIdx >= 0) {
        items[existingIdx] = planItem;
      } else {
        items.push(planItem);
      }
      return { ...state, items };
    }

    case "turn.diff.updated": {
      items.push({
        kind: "diff",
        id: `diff_${event.turnId}_${Date.now()}`,
        files: event.files,
      });
      return { ...state, items };
    }

    case "request.opened": {
      items.push({
        kind: "approval",
        id: event.requestId,
        requestId: event.requestId,
        payload: event.payload,
        status: "pending",
      });
      return { ...state, items };
    }

    case "request.resolved": {
      const reqIdx = items.findIndex((i) => i.kind === "approval" && i.requestId === event.requestId);
      if (reqIdx >= 0) {
        const item = items[reqIdx] as TimelineApprovalItem;
        items[reqIdx] = {
          ...item,
          status: event.decision === "approved" ? "approved" : event.decision === "answered" ? "answered" : "rejected",
        };
      }
      return { ...state, items };
    }

    case "turn.completed": {
      return {
        ...state,
        isRunning: false,
        totalUsage: event.usage,
      };
    }

    case "turn.error": {
      return {
        ...state,
        isRunning: false,
      };
    }

    default:
      return state;
  }
}
