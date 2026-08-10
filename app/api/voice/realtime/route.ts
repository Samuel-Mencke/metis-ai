import { getAuthenticatedUserId, isAuthenticated } from "@/lib/auth";
import { getGlobalModelSettings } from "@/lib/db-store";
import { getProviderConnectionSecret } from "@/lib/provider-connections";
import { normalizeVoiceSettings } from "@/lib/shared-context";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  if (!(await isAuthenticated(req))) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const ownerId = await getAuthenticatedUserId(req);
  if (!ownerId) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const settings = getGlobalModelSettings(ownerId);
  const voice = normalizeVoiceSettings(settings.voiceInput);
  const body = await req.json().catch(() => ({})) as { modelId?: unknown; connectionId?: unknown };
  const connectionId = typeof body.connectionId === "string" ? body.connectionId : voice.connectionId;
  const credential = connectionId ? getProviderConnectionSecret(connectionId, ownerId) : null;
  const apiKey = credential?.secret || process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) return Response.json({ error: "No OpenAI voice API key is configured." }, { status: 400 });
  const model = typeof body.modelId === "string" && body.modelId.trim()
    ? body.modelId.trim()
    : voice.modelId || "gpt-realtime-whisper";
  const response = await fetch("https://api.openai.com/v1/realtime/client_secrets", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ session: { type: "realtime", model } }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) return Response.json({ error: payload?.error?.message || "Could not create realtime voice session." }, { status: response.status });
  return Response.json(payload);
}
