import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import * as pty from "node-pty";
import { config } from "@/lib/config";
import { updateOAuthFlow } from "@/lib/oauth-flows";
import { updateProviderConnection } from "@/lib/provider-connections";
import { waitForOAuthManualCode } from "@/lib/providers/oauth";

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function stripTerminalControl(value: string) {
  return value
    .replace(/\u001b\][^\u0007]*(?:\u0007|\u001b\\)/g, "")
    .replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, "")
    .replace(/\r/g, "");
}

function findAuthorizationUrl(value: string) {
  const start = value.indexOf("https://accounts.google.com/");
  if (start < 0) return undefined;
  const compact = value.slice(start).replace(/\s+/g, "");
  const queryStart = compact.indexOf("?");
  if (queryStart >= 0) {
    const base = compact.slice(0, queryStart);
    const query = compact.slice(queryStart + 1);
    const names = [
      "client_id",
      "response_type",
      "redirect_uri",
      "scope",
      "code_challenge",
      "code_challenge_method",
      "state",
      "access_type",
      "prompt",
    ];
    const params = new URLSearchParams();
    for (const name of names) {
      const match = query.match(new RegExp(`${name}=([A-Za-z0-9%._~:/+\\-]+)`));
      if (!match?.[1]) continue;
      try {
        const decoded = decodeURIComponent(match[1]);
        if (name === "scope") {
          const scopes = decoded
            .replace(/\+/g, " ")
            .split(/\s+/)
            .filter(Boolean)
            .filter((scope) => scope !== "https://www.googleapis.com/auth/aicode");
          params.set(name, scopes.join(" "));
        } else {
          params.set(name, decoded);
        }
      } catch {
        params.set(name, match[1]);
      }
    }
    if (params.get("response_type") && params.get("client_id") && params.get("state")) {
      return `${base}?${params.toString()}`;
    }
  }
  const match = value.match(/https:\/\/accounts\.google\.com\/[^\s"'<>]+/);
  const candidate = match?.[0]?.replace(/[),.;]+$/, "");
  if (!candidate) return undefined;
  try {
    const parsed = new URL(candidate);
    if (
      parsed.searchParams.get("response_type") &&
      parsed.searchParams.get("client_id") &&
      parsed.searchParams.get("state")
    ) {
      return parsed.toString();
    }
  } catch {
    // Wait for the next PTY chunk to complete the URL.
  }
  return undefined;
}

function normalizeCode(value: string) {
  const trimmed = value.trim();
  try {
    const parsed = new URL(trimmed);
    return parsed.searchParams.get("code")?.trim() || trimmed;
  } catch {
    return trimmed;
  }
}

function officialAgyPath() {
  return (
    process.env.AGY_CLI_PATH?.trim() ||
    path.join(os.homedir(), ".local", "bin", "agy") ||
    "agy"
  );
}

function isAuthTokenFile(value: unknown) {
  if (!value || typeof value !== "object") return false;
  const token = (value as { token?: unknown }).token;
  return Boolean(
    token &&
      typeof token === "object" &&
      typeof (token as { access_token?: unknown }).access_token === "string",
  );
}

export async function runOfficialAntigravityOAuthFlow(input: {
  flowId: string;
  ownerId: string;
}) {
  const tempHome = await mkdtemp(path.join(os.tmpdir(), "ai-chat-agy-"));
  const tokenFile = path.join(
    tempHome,
    ".gemini",
    "antigravity-cli",
    "antigravity-oauth-token",
  );
  const command = officialAgyPath();
  if (command !== "agy" && !existsSync(command)) {
    await rm(tempHome, { recursive: true, force: true });
    throw new Error(`Official Antigravity CLI was not found at ${command}.`);
  }

  const environment = {
    ...process.env,
    HOME: tempHome,
    USERPROFILE: tempHome,
    XDG_CONFIG_HOME: path.join(tempHome, ".config"),
    XDG_CACHE_HOME: path.join(tempHome, ".cache"),
    PATH: `${path.dirname(command)}:${process.env.PATH || ""}`,
    TERM: "xterm-256color",
    SSH_CONNECTION: "198.51.100.10 50000 198.51.100.20 22",
    SSH_CLIENT: "198.51.100.10 50000 22",
    SSH_TTY: "/dev/pts/0",
  };

  const terminal = pty.spawn(command, ["-i", "Authenticate this Antigravity session."], {
    name: "xterm-256color",
    cols: 1000,
    rows: 50,
    cwd: config.agentCwd,
    env: environment as Record<string, string>,
  });
  let output = "";
  let urlSent = false;
  let codeWaiter: Promise<void> | undefined;
  let selectedGoogleOAuth = false;
  let stopped = false;
  let exited = false;
  let exitCode: number | undefined;

  const finish = () => {
    if (stopped) return;
    stopped = true;
    try {
      terminal.kill();
    } catch {
      // The CLI may already have exited.
    }
  };

  const waitForCodeAndSubmit = () => {
    if (codeWaiter) return;
    codeWaiter = waitForOAuthManualCode(input.flowId, input.ownerId)
      .then((value) => {
        terminal.write(`${normalizeCode(value)}\r`);
      })
      .catch((error) => {
        updateOAuthFlow(input.flowId, input.ownerId, {
          status: "error",
          error: error instanceof Error ? error.message : "Antigravity code input failed.",
        });
        finish();
      });
  };

  const exitPromise = new Promise<void>((resolve) => {
    terminal.onExit((event) => {
      exited = true;
      exitCode = event.exitCode;
      resolve();
    });
  });

  terminal.onData((chunk) => {
    output = `${output}${stripTerminalControl(chunk)}`.slice(-12_000);
    const url = findAuthorizationUrl(output);
    if (url && !urlSent) {
      urlSent = true;
      updateOAuthFlow(input.flowId, input.ownerId, {
        status: "awaiting_code",
        authUrl: url,
        instructions: "Open the official Antigravity link, finish Google login, then paste the displayed authorization code.",
      });
      waitForCodeAndSubmit();
    }
    if (!selectedGoogleOAuth && /select login method|google oauth/i.test(output)) {
      selectedGoogleOAuth = true;
      terminal.write("1\r");
    }
  });

  const timeout = Date.now() + 10 * 60_000;
  while (Date.now() < timeout && !stopped && !exited) {
    if (existsSync(tokenFile)) {
      try {
        const tokenData = await readFile(tokenFile, "utf8");
        if (isAuthTokenFile(JSON.parse(tokenData))) {
          finish();
          await exitPromise;
          await rm(tempHome, { recursive: true, force: true });
          return tokenData;
        }
      } catch {
        // The CLI may be writing the token file; try again.
      }
    }
    await delay(250);
  }

  finish();
  await exitPromise;
  await rm(tempHome, { recursive: true, force: true });
  if (exited && exitCode !== 0) {
    throw new Error("Official Antigravity CLI exited before completing login.");
  }
  throw new Error("Official Antigravity login timed out.");
}

export async function runOfficialAntigravityJob(context: {
  userId: string;
  connectionId: string;
  secret: string;
  modelId: string;
  effort?: string;
  prompt: string;
  signal: AbortSignal;
  onText: (value: string) => void;
  onStream: (data: Record<string, unknown>) => void;
}) {
  const tempHome = await mkdtemp(path.join(os.tmpdir(), "ai-chat-agy-run-"));
  const tokenFile = path.join(
    tempHome,
    ".gemini",
    "antigravity-cli",
    "antigravity-oauth-token",
  );
  const command = officialAgyPath();
  if (command !== "agy" && !existsSync(command)) {
    await rm(tempHome, { recursive: true, force: true });
    throw new Error(`Official Antigravity CLI was not found at ${command}.`);
  }
  await mkdir(path.dirname(tokenFile), { recursive: true, mode: 0o700 });
  await writeFile(tokenFile, context.secret, { encoding: "utf8", mode: 0o600 });

  const terminal = pty.spawn(
    command,
    [
      "-p",
      context.prompt,
      "--model",
      context.modelId,
      ...(context.effort ? ["--effort", context.effort] : []),
      "--print-timeout",
      "30m",
    ],
    {
      name: "xterm-256color",
      cols: 1000,
      rows: 50,
      cwd: config.agentCwd,
      env: {
        ...process.env,
        HOME: tempHome,
        USERPROFILE: tempHome,
        XDG_CONFIG_HOME: path.join(tempHome, ".config"),
        XDG_CACHE_HOME: path.join(tempHome, ".cache"),
        PATH: `${path.dirname(command)}:${process.env.PATH || ""}`,
        TERM: "xterm-256color",
        SSH_CONNECTION: "198.51.100.10 50000 198.51.100.20 22",
        SSH_CLIENT: "198.51.100.10 50000 22",
        SSH_TTY: "/dev/pts/0",
      } as Record<string, string>,
    },
  );
  let output = "";
  const killOnAbort = () => {
    try {
      terminal.kill();
    } catch {
      // The CLI may already have exited.
    }
  };
  context.signal.addEventListener("abort", killOnAbort, { once: true });
  const exit = new Promise<number | undefined>((resolve) => {
    terminal.onExit((event) => resolve(event.exitCode));
  });
  terminal.onData((chunk) => {
    const cleanChunk = stripTerminalControl(chunk);
    output = `${output}${cleanChunk}`.slice(-100_000);
    if (cleanChunk.trim()) context.onStream({ type: "cli-output", text: cleanChunk });
  });
  try {
    const exitCode = await exit;
    if (context.signal.aborted) throw new Error("Antigravity run cancelled.");
    if (exitCode !== 0) {
      const detail = output.trim().replace(/\s+/g, " ").slice(-1_000);
      throw new Error(
        detail
          ? `Official Antigravity CLI run failed: ${detail}`
          : "Official Antigravity CLI run failed.",
      );
    }
    const refreshed = await readFile(tokenFile, "utf8").catch(() => context.secret);
    if (refreshed !== context.secret) {
      updateProviderConnection(context.connectionId, context.userId, {
        secret: refreshed,
        enabled: true,
      });
    }
    const text = output.trim();
    if (text) context.onText(text);
  } finally {
    context.signal.removeEventListener("abort", killOnAbort);
    await rm(tempHome, { recursive: true, force: true }).catch(() => undefined);
  }
}
