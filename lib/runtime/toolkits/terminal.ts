import { spawn } from "node:child_process";
import path from "node:path";

export interface CommandExecutionResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
  killed: boolean;
}

export async function runCommand(params: {
  command: string;
  cwd: string;
  timeoutMs?: number;
  signal?: AbortSignal;
  onStdout?: (chunk: string) => void;
  onStderr?: (chunk: string) => void;
}): Promise<CommandExecutionResult> {
  const startedAt = Date.now();
  const timeoutMs = params.timeoutMs || 120_000;

  return new Promise<CommandExecutionResult>((resolve, reject) => {
    let stdoutAcc = "";
    let stderrAcc = "";
    let isKilled = false;

    const child = spawn("bash", ["-c", params.command], {
      cwd: params.cwd,
      env: {
        ...process.env,
        PAGER: "cat",
        CI: "1",
        TERM: "xterm-256color",
      },
      stdio: ["pipe", "pipe", "pipe"],
    });

    const timer = setTimeout(() => {
      isKilled = true;
      child.kill("SIGTERM");
      setTimeout(() => {
        if (!child.killed) child.kill("SIGKILL");
      }, 3000);
    }, timeoutMs);

    const onAbort = () => {
      isKilled = true;
      child.kill("SIGTERM");
      clearTimeout(timer);
    };

    if (params.signal) {
      if (params.signal.aborted) {
        onAbort();
      } else {
        params.signal.addEventListener("abort", onAbort, { once: true });
      }
    }

    child.stdout.on("data", (chunk: Buffer) => {
      const text = chunk.toString("utf8");
      stdoutAcc += text;
      params.onStdout?.(text);
    });

    child.stderr.on("data", (chunk: Buffer) => {
      const text = chunk.toString("utf8");
      stderrAcc += text;
      params.onStderr?.(text);
    });

    child.on("error", (err) => {
      clearTimeout(timer);
      if (params.signal) params.signal.removeEventListener("abort", onAbort);
      reject(err);
    });

    child.on("close", (code) => {
      clearTimeout(timer);
      if (params.signal) params.signal.removeEventListener("abort", onAbort);
      resolve({
        exitCode: code ?? (isKilled ? 137 : 1),
        stdout: stdoutAcc,
        stderr: stderrAcc,
        durationMs: Date.now() - startedAt,
        killed: isKilled,
      });
    });
  });
}
