import { Buffer } from "node:buffer";
import { getRemoteClient } from "@/lib/remote-clients";
import { requestRemoteClient } from "@/lib/remote-client-gateway";
import {
  appendControlEvent,
  consumeControlInstruction,
  getControlRun,
  listRunnableControlRuns,
  saveControlArtifact,
  updateControlRun,
  type ControlRun,
} from "@/lib/control-plane";

const inFlight = new Set<string>();
const LOOP_SYMBOL = Symbol.for("metis.control.runtime.started");
const runtimeGlobal = globalThis as typeof globalThis & { [LOOP_SYMBOL]?: boolean };

function remoteJoin(cwd: string, suffix: string) {
  return `${cwd.replace(/[\\/]+$/, "")}/${suffix.replace(/^\/+/, "")}`;
}

function b64(value: string) {
  return Buffer.from(value, "utf8").toString("base64");
}

function buildAgyCommand(input: {
  promptPath: string;
  conversationId?: string;
  model?: string;
  effort?: string;
}) {
  const script = `
const fs=require('fs');
const cp=require('child_process');
const prompt=fs.readFileSync(Buffer.from('${b64(input.promptPath)}','base64').toString(),'utf8');
const args=['-p',prompt,'--output-format','stream-json','--print-timeout',process.env.METIS_CONTROL_AGY_PRINT_TIMEOUT||'6h'];
${input.conversationId ? `args.push('--conversation',Buffer.from('${b64(input.conversationId)}','base64').toString());` : ""}
${input.model ? `args.push('--model',Buffer.from('${b64(input.model)}','base64').toString());` : ""}
${input.effort ? `args.push('--effort',Buffer.from('${b64(input.effort)}','base64').toString());` : ""}
if(process.env.METIS_CONTROL_AGY_SKIP_PERMISSIONS==='1') args.push('--dangerously-skip-permissions');
const command=process.env.METIS_CONTROL_AGY_COMMAND||'agy';
const result=cp.spawnSync(command,args,{encoding:'utf8',env:process.env,maxBuffer:32*1024*1024,windowsHide:true});
if(result.stdout) process.stdout.write(result.stdout);
if(result.stderr) process.stderr.write(result.stderr);
process.exit(Number.isInteger(result.status)?result.status:1);
`;
  return `node -e "eval(Buffer.from('${b64(script)}','base64').toString())"`;
}

function parseAgyOutput(output: string) {
  let conversationId: string | undefined;
  let resultStatus: string | undefined;
  const chunks: string[] = [];
  let parsedAny = false;
  for (const rawLine of output.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    try {
      const event = JSON.parse(line) as Record<string, any>;
      parsedAny = true;
      conversationId = String(
        event.conversation_id || event.conversationId || event.result?.conversation_id || conversationId || "",
      ) || conversationId;
      if (event.event === "step_update" && typeof event.step_update?.text_delta === "string") {
        chunks.push(event.step_update.text_delta);
      }
      if (event.event === "result") {
        resultStatus = typeof event.result?.status === "string" ? event.result.status : resultStatus;
        if (typeof event.result?.response === "string") chunks.push(event.result.response);
        else if (typeof event.response === "string") chunks.push(event.response);
      }
      if (event.type === "text" && typeof event.text === "string") chunks.push(event.text);
    } catch {
      // Some agy versions may still emit human-readable lines around JSON output.
    }
  }
  const text = chunks.join("").trim() || (!parsedAny ? output.trim() : output.trim().slice(-100_000));
  return { text, conversationId, resultStatus };
}

function systemPrompt(run: ControlRun, userPrompt: string, manifestPath: string) {
  return `${userPrompt}\n\n---\nMETIS PERSISTENT CONTROL PLANE\nYou are running as part of a durable background run. The browser/chat that started this run may disappear; continue the real task anyway. Work against the actual workspace and verify changes instead of producing mock/demo results.\n\nRESULT ARTIFACTS\nIf you create screenshots, images, reports, patches, logs, or other files that should be returned to the controller, write a JSON array to this exact path before the turn ends:\n${manifestPath}\nFormat: [{\"path\":\"absolute-or-workspace-file-path\",\"name\":\"optional-name\",\"mimeType\":\"optional-mime-type\"}]\nDo not put credentials or secrets into artifacts.\n\nLOOP COMPLETION\nWhen the requested goal is actually complete and verified, include the exact marker ${run.stopMarker} in your final response. Do not emit that marker merely because one sub-step finished.`;
}

async function collectArtifacts(run: ControlRun, manifestPath: string) {
  let manifest: unknown;
  try {
    const response = await requestRemoteClient({
      ownerId: run.ownerId,
      clientId: run.clientId,
      action: "read_file",
      params: { path: manifestPath, limit: 1_000_000 },
      source: "agent",
      approved: true,
      timeoutMs: 30_000,
    }) as { content?: string };
    manifest = JSON.parse(String(response.content || "[]"));
  } catch {
    return;
  }
  if (!Array.isArray(manifest)) return;
  for (const item of manifest.slice(0, 40)) {
    if (!item || typeof item !== "object" || typeof (item as any).path !== "string") continue;
    const remotePath = String((item as any).path);
    try {
      const response = await requestRemoteClient({
        ownerId: run.ownerId,
        clientId: run.clientId,
        action: "read_file_base64" as any,
        params: { path: remotePath, limit: 20 * 1024 * 1024 },
        source: "agent",
        approved: true,
        timeoutMs: 120_000,
      }) as { data?: string; size?: number };
      if (!response.data) continue;
      const name = typeof (item as any).name === "string"
        ? (item as any).name
        : remotePath.split(/[\\/]/).pop() || "artifact.bin";
      const mimeType = typeof (item as any).mimeType === "string" ? (item as any).mimeType : "application/octet-stream";
      saveControlArtifact({ runId: run.id, ownerId: run.ownerId, name, mimeType, data: Buffer.from(response.data, "base64") });
    } catch (error) {
      appendControlEvent(run.id, run.ownerId, "artifact_error", {
        path: remotePath,
        error: error instanceof Error ? error.message : "Artifact transfer failed",
      });
    }
  }
}

async function runIteration(run: ControlRun) {
  const client = getRemoteClient(run.clientId, run.ownerId);
  if (!client) throw new Error("Remote client no longer exists");
  if (client.policy.mode !== "full_access") {
    throw new Error("Autonomous control runs require the selected remote client policy to be full_access");
  }
  if (client.status !== "online") throw new Error("Remote client is offline");

  const latest = getControlRun(run.id, run.ownerId);
  if (!latest || latest.cancelRequested) return;
  const explicitInstruction = consumeControlInstruction(run.id, run.ownerId);
  const turnPrompt = latest.iteration === 0
    ? latest.prompt
    : explicitInstruction || latest.loopPrompt;
  const controlDir = remoteJoin(latest.cwd, `.metis-control/${latest.id}`);
  const promptPath = remoteJoin(controlDir, `prompt-${latest.iteration + 1}.txt`);
  const manifestPath = remoteJoin(controlDir, "artifacts.json");
  const fullPrompt = systemPrompt(latest, turnPrompt, manifestPath);

  updateControlRun(latest.id, latest.ownerId, { state: "running", error: null, nextRunAt: null });
  appendControlEvent(latest.id, latest.ownerId, "iteration_started", { iteration: latest.iteration + 1 });
  await requestRemoteClient({
    ownerId: latest.ownerId,
    clientId: latest.clientId,
    action: "write_file",
    params: { path: promptPath, content: fullPrompt },
    source: "agent",
    approved: true,
    timeoutMs: 30_000,
  });

  const command = buildAgyCommand({
    promptPath,
    conversationId: latest.conversationId,
    model: latest.model,
    effort: latest.effort,
  });
  const raw = await requestRemoteClient({
    ownerId: latest.ownerId,
    clientId: latest.clientId,
    action: "execute_command",
    params: { command, cwd: latest.cwd, timeout: 6 * 60 * 60_000 },
    source: "agent",
    approved: true,
    timeoutMs: 6 * 60 * 60_000 + 60_000,
  }) as { stdout?: string; stderr?: string; exitCode?: number };
  const output = `${raw.stdout || ""}${raw.stderr ? `\n${raw.stderr}` : ""}`.trim();
  const parsed = parseAgyOutput(output);
  const iteration = latest.iteration + 1;
  const resultText = parsed.text || output;
  const refreshed = getControlRun(latest.id, latest.ownerId);
  if (!refreshed) return;
  await collectArtifacts(refreshed, manifestPath);
  appendControlEvent(latest.id, latest.ownerId, "iteration_completed", {
    iteration,
    conversationId: parsed.conversationId || refreshed.conversationId,
    resultStatus: parsed.resultStatus,
    text: resultText.slice(-20_000),
  });

  const cancelled = getControlRun(latest.id, latest.ownerId)?.cancelRequested;
  if (cancelled) {
    updateControlRun(latest.id, latest.ownerId, {
      state: "cancelled", iteration, resultText, unread: true,
      conversationId: parsed.conversationId || refreshed.conversationId || null,
      finishedAt: new Date().toISOString(),
    });
    return;
  }
  const doneMarker = resultText.includes(refreshed.stopMarker);
  const reachedLimit = refreshed.maxIterations > 0 && iteration >= refreshed.maxIterations;
  if (!refreshed.autoContinue || doneMarker || reachedLimit) {
    updateControlRun(latest.id, latest.ownerId, {
      state: "completed", iteration, resultText, unread: true,
      conversationId: parsed.conversationId || refreshed.conversationId || null,
      finishedAt: new Date().toISOString(),
    });
    appendControlEvent(latest.id, latest.ownerId, "completed", { doneMarker, reachedLimit });
    return;
  }
  const nextRunAt = new Date(Date.now() + refreshed.intervalSeconds * 1000).toISOString();
  updateControlRun(latest.id, latest.ownerId, {
    state: "sleeping", iteration, resultText, unread: true,
    conversationId: parsed.conversationId || refreshed.conversationId || null,
    nextRunAt,
  });
}

async function tick() {
  for (const run of listRunnableControlRuns()) {
    if (inFlight.has(run.id)) continue;
    inFlight.add(run.id);
    void runIteration(run).catch((error) => {
      const message = error instanceof Error ? error.message : "Control iteration failed";
      appendControlEvent(run.id, run.ownerId, "iteration_error", { error: message });
      const current = getControlRun(run.id, run.ownerId);
      if (!current || current.cancelRequested) return;
      const transient = /offline|disconnect|timed out|ECONN|network/i.test(message);
      if (transient) {
        updateControlRun(run.id, run.ownerId, {
          state: "sleeping", error: message,
          nextRunAt: new Date(Date.now() + 30_000).toISOString(),
        });
      } else {
        updateControlRun(run.id, run.ownerId, {
          state: "failed", error: message, unread: true, finishedAt: new Date().toISOString(),
        });
      }
    }).finally(() => inFlight.delete(run.id));
  }
}

export function startControlRuntime() {
  if (runtimeGlobal[LOOP_SYMBOL]) return;
  runtimeGlobal[LOOP_SYMBOL] = true;
  setInterval(() => { void tick(); }, 2_000).unref();
  void tick();
}
