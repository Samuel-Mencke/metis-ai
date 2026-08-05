import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

export const WORKFLOW_TOOLS = Object.freeze([
  "execute_command", "service_control", "docker_ps", "system_info",
  "list_directory", "read_file", "write_file", "electron_test",
  "windows_desktop_job", "windows_ui",
]);
const TOOL_SET = new Set(WORKFLOW_TOOLS);
const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

function plainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
}

export function validateWorkflow({ name, description = "", steps }) {
  if (typeof name !== "string" || !NAME_RE.test(name)) throw new Error("Workflow name must match /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/");
  if (typeof description !== "string" || description.length > 1000) throw new Error("Workflow description must be a string of at most 1000 characters");
  if (!Array.isArray(steps) || steps.length < 1 || steps.length > 25) throw new Error("Workflow steps must contain 1 to 25 steps");
  const normalized = steps.map((step, index) => {
    if (!plainObject(step) || !("tool" in step) || !("arguments" in step) || Object.keys(step).some((key) => !["tool", "arguments"].includes(key))) throw new Error(`Step ${index + 1} must contain only tool and arguments`);
    if (!TOOL_SET.has(step.tool)) throw new Error(`Step ${index + 1} uses disallowed tool: ${String(step.tool)}`);
    if (step.arguments !== undefined && !plainObject(step.arguments)) throw new Error(`Step ${index + 1} arguments must be an object`);
    return { tool: step.tool, arguments: structuredClone(step.arguments || {}) };
  });
  return { name, description, steps: normalized };
}

export class WorkflowStore {
  constructor(filePath = "/home/f1shy312/ai-chat/data/mcp-state/workflows.json") { this.filePath = filePath; this.writeQueue = Promise.resolve(); }
  #serialized(operation) {
    const pending = this.writeQueue.then(operation, operation);
    this.writeQueue = pending.catch(() => {});
    return pending;
  }
  async #read() {
    try {
      const parsed = JSON.parse(await fs.readFile(this.filePath, "utf8"));
      if (!plainObject(parsed) || parsed.version !== 1 || !plainObject(parsed.workflows)) throw new Error("Invalid workflow store format");
      return parsed;
    } catch (error) {
      if (error.code === "ENOENT") return { version: 1, workflows: {} };
      throw error;
    }
  }
  async #write(data) {
    const dir = path.dirname(this.filePath);
    await fs.mkdir(dir, { recursive: true, mode: 0o700 });
    const temp = path.join(dir, `.${path.basename(this.filePath)}.${process.pid}.${randomUUID()}.tmp`);
    let handle;
    try {
      handle = await fs.open(temp, "wx", 0o600);
      await handle.writeFile(JSON.stringify(data, null, 2) + "\n", "utf8");
      await handle.sync();
      await handle.close(); handle = null;
      await fs.rename(temp, this.filePath);
      const dirHandle = await fs.open(dir, "r");
      try { await dirHandle.sync(); } finally { await dirHandle.close(); }
    } finally {
      if (handle) await handle.close().catch(() => {});
      await fs.unlink(temp).catch(() => {});
    }
  }
  async save(input, overwrite = false) {
    return this.#serialized(async () => {
    const workflow = validateWorkflow(input);
    const data = await this.#read();
    if (data.workflows[workflow.name] && !overwrite) throw new Error(`Workflow already exists: ${workflow.name}`);
    const now = new Date().toISOString();
    const existing = data.workflows[workflow.name];
    data.workflows[workflow.name] = { ...workflow, created_at: existing?.created_at || now, updated_at: now };
    await this.#write(data);
    return structuredClone(data.workflows[workflow.name]);
    });
  }
  async list() {
    const data = await this.#read();
    return Object.values(data.workflows).map(({ name, description, steps, created_at, updated_at }) => ({ name, description, step_count: steps.length, created_at, updated_at })).sort((a, b) => a.name.localeCompare(b.name));
  }
  async get(name) {
    if (typeof name !== "string" || !NAME_RE.test(name)) throw new Error("Invalid workflow name");
    const item = (await this.#read()).workflows[name];
    if (!item) throw new Error(`Unknown workflow: ${name}`);
    return validateWorkflow(item);
  }
  async delete(name) {
    return this.#serialized(async () => {
    if (typeof name !== "string" || !NAME_RE.test(name)) throw new Error("Invalid workflow name");
    const data = await this.#read();
    if (!data.workflows[name]) throw new Error(`Unknown workflow: ${name}`);
    delete data.workflows[name];
    await this.#write(data);
    return { ok: true, name };
    });
  }
}

function shorten(value, max = 12000) {
  let text;
  try { text = typeof value === "string" ? value : JSON.stringify(value); } catch { text = String(value); }
  return text.length <= max ? text : `${text.slice(0, max)}…[truncated ${text.length - max} chars]`;
}

export async function runWorkflow(workflow, { dryRun = false, execute }) {
  const valid = validateWorkflow(workflow);
  const started = Date.now();
  const results = [];
  for (let index = 0; index < valid.steps.length; index++) {
    const step = valid.steps[index];
    if (dryRun) { results.push({ index: index + 1, tool: step.tool, status: "validated", duration_ms: 0, arguments: step.arguments }); continue; }
    const stepStarted = Date.now();
    try {
      const output = await execute(step.tool, structuredClone(step.arguments));
      results.push({ index: index + 1, tool: step.tool, status: "success", duration_ms: Date.now() - stepStarted, output: shorten(output) });
    } catch (error) {
      results.push({ index: index + 1, tool: step.tool, status: "failed", duration_ms: Date.now() - stepStarted, error: shorten(error?.message || error) });
      return { ok: false, name: valid.name, dry_run: false, duration_ms: Date.now() - started, stopped_at: index + 1, steps: results };
    }
  }
  return { ok: true, name: valid.name, dry_run: dryRun, duration_ms: Date.now() - started, steps: results };
}
