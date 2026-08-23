import crypto from "node:crypto";

export interface SubagentSpawnParams {
  role: string;
  prompt: string;
  model?: string;
  parentSessionId: string;
  userId?: string;
}

export interface SubagentInstance {
  id: string;
  role: string;
  status: "running" | "completed" | "failed";
  createdAt: number;
  result?: string;
}

const activeSubagents = new Map<string, SubagentInstance>();

export async function spawnSubagent(params: SubagentSpawnParams): Promise<SubagentInstance> {
  const id = crypto.randomUUID();
  const instance: SubagentInstance = {
    id,
    role: params.role,
    status: "running",
    createdAt: Date.now(),
  };
  activeSubagents.set(id, instance);
  return instance;
}

export function getSubagent(id: string): SubagentInstance | undefined {
  return activeSubagents.get(id);
}

export function completeSubagent(id: string, result: string, success = true): void {
  const item = activeSubagents.get(id);
  if (item) {
    item.status = success ? "completed" : "failed";
    item.result = result;
  }
}
