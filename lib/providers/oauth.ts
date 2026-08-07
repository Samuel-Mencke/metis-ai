import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createHash, randomBytes } from "node:crypto";
import os from "node:os";
import path from "node:path";
import {
  consumeOAuthManualCode,
  getOAuthFlow,
  updateOAuthFlow,
} from "@/lib/oauth-flows";
import {
  getProviderConnectionSecret,
  updateProviderConnection,
} from "@/lib/provider-connections";
import { refreshProviderModels } from "@/lib/providers/discovery";

export type OAuthProviderKey = "codex" | "claude-code" | "antigravity";

type OAuthFlowCallbacks = {
  onAuth: (auth: { url: string; instructions?: string }) => void;
  onProgress: (message: string) => void;
  onManualCodeInput: () => Promise<string>;
  onPrompt: () => Promise<string>;
};

const GEMINI_CLI_CLIENT_ID =
  process.env.GEMINI_CLI_OAUTH_CLIENT_ID ||
  "681255809395-oo8ft2oprdrnp9e3aqf6av3hmdib135j.apps.googleusercontent.com";
const GEMINI_CLI_CLIENT_SECRET =
  process.env.GEMINI_CLI_OAUTH_CLIENT_SECRET ||
  "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";
const GEMINI_CLI_REDIRECT_URI = "http://localhost:8085/oauth2callback";
const GEMINI_CLI_SCOPES = [
  "https://www.googleapis.com/auth/cloud-platform",
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/userinfo.profile",
];

function base64UrlSha256(value: string) {
  return createHash("sha256").update(value).digest("base64url");
}

function parseGeminiCallbackInput(input: string, expectedState: string) {
  let callbackUrl: URL;
  try {
    callbackUrl = new URL(input.trim());
  } catch {
    throw new Error("Paste the complete Google callback URL, including code and state.");
  }
  const code = callbackUrl.searchParams.get("code")?.trim();
  const state = callbackUrl.searchParams.get("state")?.trim();
  const error = callbackUrl.searchParams.get("error")?.trim();
  if (error) throw new Error(`Google OAuth failed: ${error}`);
  if (!code || !state) {
    throw new Error("The callback URL must contain both code and state.");
  }
  if (state !== expectedState) throw new Error("OAuth state mismatch. Start a fresh login.");
  return code;
}

async function runAntigravityOAuthLogin(
  authFile: string,
  callbacks: OAuthFlowCallbacks,
  configuredProjectId?: string,
) {
  const verifier = randomBytes(32).toString("base64url");
  const state = randomBytes(32).toString("base64url");
  const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  authUrl.searchParams.set("client_id", GEMINI_CLI_CLIENT_ID);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("redirect_uri", GEMINI_CLI_REDIRECT_URI);
  authUrl.searchParams.set("scope", GEMINI_CLI_SCOPES.join(" "));
  authUrl.searchParams.set("code_challenge", base64UrlSha256(verifier));
  authUrl.searchParams.set("code_challenge_method", "S256");
  authUrl.searchParams.set("state", state);
  authUrl.searchParams.set("access_type", "offline");
  authUrl.searchParams.set("prompt", "consent");

  callbacks.onAuth({
    url: authUrl.toString(),
    instructions: "Open the link, sign in with Google, then paste the complete localhost callback URL here.",
  });
  const callbackInput = await callbacks.onManualCodeInput();
  const code = parseGeminiCallbackInput(callbackInput, state);
  const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" },
    body: new URLSearchParams({
      client_id: GEMINI_CLI_CLIENT_ID,
      client_secret: GEMINI_CLI_CLIENT_SECRET,
      code,
      grant_type: "authorization_code",
      redirect_uri: GEMINI_CLI_REDIRECT_URI,
      code_verifier: verifier,
    }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!tokenResponse.ok) {
    throw new Error(`Google OAuth token exchange failed (${tokenResponse.status}).`);
  }
  const tokens = await tokenResponse.json() as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
  };
  if (!tokens.access_token || !tokens.refresh_token) {
    throw new Error("Google OAuth did not return both access and refresh tokens.");
  }
  const userInfoResponse = await fetch("https://www.googleapis.com/oauth2/v1/userinfo?alt=json", {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
    signal: AbortSignal.timeout(10_000),
  }).catch(() => null);
  const userInfo = userInfoResponse?.ok
    ? await userInfoResponse.json() as { email?: string }
    : {};
  const initialAuth = {
    "google-gemini-cli": {
      type: "oauth",
      access: tokens.access_token,
      refresh: tokens.refresh_token,
      expires: Date.now() + Math.max(60, tokens.expires_in || 3_600) * 1_000,
      ...(userInfo.email ? { email: userInfo.email } : {}),
    },
  };
  await writeFile(authFile, `${JSON.stringify(initialAuth, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  callbacks.onProgress("Google OAuth complete; discovering Cloud Code project…");
  return ensureAntigravityProjectId(authFile, configuredProjectId);
}

const CLOUD_CODE_ENDPOINTS = [
  "https://cloudcode-pa.googleapis.com",
  "https://daily-cloudcode-pa.sandbox.googleapis.com",
  "https://autopush-cloudcode-pa.sandbox.googleapis.com",
];

async function resolveCloudCodeProject(accessToken: string, configuredProjectId?: string) {
  for (const endpoint of CLOUD_CODE_ENDPOINTS) {
    try {
      const response = await fetch(`${endpoint}/v1internal:loadCodeAssist`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
          "User-Agent": "Mozilla/5.0 Antigravity/1.18.3",
          "X-Goog-Api-Client": "google-cloud-sdk vscode_cloudshelleditor/0.1",
          "Client-Metadata": JSON.stringify({
            ideType: "ANTIGRAVITY",
            platform: process.platform === "win32" ? "WINDOWS" : "MACOS",
            pluginType: "GEMINI",
          }),
        },
        body: JSON.stringify({
          metadata: {
            ideType: "ANTIGRAVITY",
            platform: process.platform === "win32" ? "WINDOWS" : "MACOS",
            pluginType: "GEMINI",
          },
          ...(configuredProjectId
            ? { cloudaicompanionProject: configuredProjectId }
            : {}),
        }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) continue;
      const payload = await response.json() as {
        cloudaicompanionProject?: string | { id?: string };
        currentTier?: { id?: string };
        allowedTiers?: Array<{ id?: string; isDefault?: boolean }>;
      };
      const project = payload.cloudaicompanionProject;
      const projectId = typeof project === "string" ? project : project?.id;
      if (projectId?.trim()) return projectId.trim();

      const tierId =
        payload.currentTier?.id ||
        payload.allowedTiers?.find((tier) => tier.isDefault)?.id ||
        payload.allowedTiers?.find((tier) => tier.id === "free-tier")?.id;
      if (!tierId) continue;

      const onboardResponse = await fetch(`${endpoint}/v1internal:onboardUser`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
          "User-Agent": "Mozilla/5.0 Antigravity/1.18.3",
          "X-Goog-Api-Client": "google-cloud-sdk vscode_cloudshelleditor/0.1",
          "Client-Metadata": JSON.stringify({
            ideType: "ANTIGRAVITY",
            platform: process.platform === "win32" ? "WINDOWS" : "MACOS",
            pluginType: "GEMINI",
          }),
        },
        body: JSON.stringify({
          tierId,
          metadata: {
            ideType: "ANTIGRAVITY",
            platform: process.platform === "win32" ? "WINDOWS" : "MACOS",
            pluginType: "GEMINI",
          },
          ...(tierId !== "free-tier" && configuredProjectId
            ? { cloudaicompanionProject: configuredProjectId }
            : {}),
        }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!onboardResponse.ok) continue;
      let operation = await onboardResponse.json() as {
        done?: boolean;
        name?: string;
        response?: { cloudaicompanionProject?: { id?: string } };
      };
      if (!operation.done && operation.name) {
        for (let attempt = 0; attempt < 10; attempt += 1) {
          await delay(1_000);
          const operationResponse = await fetch(
            `${endpoint}/v1internal/${operation.name}`,
            {
              headers: {
                Authorization: `Bearer ${accessToken}`,
                "Content-Type": "application/json",
              },
              signal: AbortSignal.timeout(10_000),
            },
          );
          if (!operationResponse.ok) break;
          operation = await operationResponse.json() as typeof operation;
          if (operation.done) break;
        }
      }
      const managedProjectId = operation.response?.cloudaicompanionProject?.id;
      if (managedProjectId?.trim()) return managedProjectId.trim();
      if (configuredProjectId && tierId !== "free-tier") return configuredProjectId;
    } catch {
      // Try the next Cloud Code endpoint.
    }
  }
  return "";
}

export async function ensureAntigravityProjectId(authFile: string, configuredProjectId?: string) {
  const content = await readFile(authFile, "utf8");
  const data = JSON.parse(content) as Record<string, Record<string, unknown>>;
  const record = data["google-gemini-cli"];
  if (!record) throw new Error("Antigravity OAuth credentials are missing.");
  if (typeof record.projectId === "string" && record.projectId.trim()) return content;
  const access = typeof record.access === "string" ? record.access : "";
  if (!access) {
    throw new Error("Antigravity OAuth did not return an access token for automatic project discovery.");
  }
  const projectId = await resolveCloudCodeProject(access, configuredProjectId);
  if (!projectId) {
    throw new Error(
      "This Google account requires a Google Cloud project for Cloud Code Assist. Add the project ID to the Antigravity OAuth connection and reconnect.",
    );
  }
  const next = {
    ...data,
    "google-gemini-cli": {
      ...record,
      projectId,
    },
  };
  const serialized = `${JSON.stringify(next, null, 2)}\n`;
  await writeFile(authFile, serialized, { encoding: "utf8", mode: 0o600 });
  return serialized;
}

export async function createOAuthProvider(key: OAuthProviderKey, authFile: string) {
  const {
    createAnthropicOAuth,
    createGeminiCliOAuth,
    createOpenAICodexOAuth,
  } = await import("ai-sdk-oauth-providers");
  if (key === "codex") return createOpenAICodexOAuth({ authFile });
  if (key === "claude-code") return createAnthropicOAuth({ authFile });
  return createGeminiCliOAuth({
    authFile,
    fetch: async (input, init) => {
      const headers = new Headers(init?.headers);
      headers.set(
        "User-Agent",
        "Mozilla/5.0 Antigravity/1.18.3 Chrome/138.0.7204.235",
      );
      headers.set("X-Goog-Api-Client", "google-cloud-sdk vscode_cloudshelleditor/0.1");
      headers.set(
        "Client-Metadata",
        JSON.stringify({
          ideType: "ANTIGRAVITY",
          platform: process.platform === "win32" ? "WINDOWS" : "MACOS",
          pluginType: "GEMINI",
        }),
      );
      if (typeof init?.body === "string") {
        try {
          const body = JSON.parse(init.body) as { project?: unknown };
          if (typeof body.project === "string" && body.project) {
            headers.set("x-goog-user-project", body.project);
          }
        } catch {
          // Leave non-JSON bodies untouched.
        }
      }
      return fetch(input, { ...init, headers });
    },
  });
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function waitForOAuthManualCode(flowId: string, ownerId: string) {
  const deadline = Date.now() + 5 * 60_000;
  while (Date.now() < deadline) {
    const flow = getOAuthFlow(flowId, ownerId);
    if (!flow || flow.status === "cancelled") {
      throw new Error("OAuth flow was cancelled.");
    }
    const code = consumeOAuthManualCode(flowId, ownerId);
    if (code) return code;
    await delay(250);
  }
  throw new Error("OAuth code input timed out.");
}

export async function runOAuthFlow(input: {
  flowId: string;
  ownerId: string;
  connectionId: string;
  providerKey: OAuthProviderKey;
  deviceAuth?: boolean;
}) {
  const credential = getProviderConnectionSecret(input.connectionId, input.ownerId);
  if (!credential) throw new Error("OAuth connection not found.");
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "ai-chat-oauth-"));
  const authFile = path.join(tempDir, "oauth.json");
  await writeFile(authFile, credential.secret || "{}\n", { encoding: "utf8", mode: 0o600 });

  const callbacks: OAuthFlowCallbacks = {
    onAuth: (auth: { url: string; instructions?: string }) => {
      const userCode = auth.instructions?.match(
        /(?:enter\s+(?:the\s+)?code|code)\s*[:：]\s*([A-Z0-9][A-Z0-9-]{4,})/i,
      )?.[1];
      updateOAuthFlow(input.flowId, input.ownerId, {
        status: "awaiting_auth",
        authUrl: auth.url,
        instructions: auth.instructions,
        ...(userCode ? { userCode } : {}),
      });
    },
    onProgress: (message: string) => {
      updateOAuthFlow(input.flowId, input.ownerId, {
        status: "awaiting_auth",
        instructions: message,
      });
    },
    onManualCodeInput: async () => {
      updateOAuthFlow(input.flowId, input.ownerId, {
        status: "awaiting_code",
        instructions: "Paste the authorization code or complete callback URL returned by the provider.",
      });
      return waitForOAuthManualCode(input.flowId, input.ownerId);
    },
    onPrompt: async () => {
      updateOAuthFlow(input.flowId, input.ownerId, {
        status: "awaiting_code",
        instructions: "Paste the authorization code or the complete callback URL returned by the provider.",
      });
      return waitForOAuthManualCode(input.flowId, input.ownerId);
    },
  };

  try {
    const authData = input.providerKey === "antigravity"
      ? await (async () => {
          const { runOfficialAntigravityOAuthFlow } = await import("@/lib/providers/official-antigravity");
          return runOfficialAntigravityOAuthFlow({
            flowId: input.flowId,
            ownerId: input.ownerId,
          });
        })()
      : await (async () => {
          const provider = await createOAuthProvider(input.providerKey, authFile);
          await provider.auth.login(
            callbacks as Parameters<typeof provider.auth.login>[0],
            { deviceAuth: input.deviceAuth === true },
          );
          return readFile(authFile, "utf8");
        })();
    if (input.providerKey === "antigravity" && !authData) {
      throw new Error(
        "Antigravity OAuth did not return a usable Cloud Code project.",
      );
    }
    updateProviderConnection(input.connectionId, input.ownerId, {
      secret: authData,
      enabled: true,
      config: typeof credential.config.project === "string"
        ? { project: credential.config.project }
        : {},
    });
    if (input.providerKey === "codex") {
      const savedConnection = getProviderConnectionSecret(input.connectionId, input.ownerId);
      if (savedConnection) await refreshProviderModels(savedConnection).catch(() => undefined);
    }
    updateOAuthFlow(input.flowId, input.ownerId, {
      status: "completed",
      instructions: "OAuth connection completed.",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "OAuth login failed.";
    updateOAuthFlow(input.flowId, input.ownerId, {
      status: "error",
      error: message.slice(0, 500),
    });
  } finally {
    await rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
  }
}
