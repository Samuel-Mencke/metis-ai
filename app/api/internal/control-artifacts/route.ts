import { authenticateRemoteClient } from "@/lib/remote-clients";
import { getControlRun, saveControlArtifact } from "@/lib/control-plane";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_ARTIFACT_BYTES = 25 * 1024 * 1024;

function authenticate(req: Request) {
  const header = req.headers.get("authorization") || "";
  if (!header.startsWith("Remote ")) return null;
  const value = header.slice(7);
  const separator = value.indexOf(":");
  if (separator < 1) return null;
  return authenticateRemoteClient(value.slice(0, separator), value.slice(separator + 1));
}

export async function POST(req: Request) {
  const auth = authenticate(req);
  if (!auth) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const runId = req.headers.get("x-control-run-id")?.trim() || "";
  const run = runId ? getControlRun(runId, auth.ownerId) : null;
  if (!run || run.clientId !== auth.clientId) return Response.json({ error: "Control run not found for this client" }, { status: 404 });
  const declaredSize = Number(req.headers.get("content-length") || 0);
  if (declaredSize > MAX_ARTIFACT_BYTES) return Response.json({ error: "Artifact is too large" }, { status: 413 });
  const bytes = Buffer.from(await req.arrayBuffer());
  if (bytes.length > MAX_ARTIFACT_BYTES) return Response.json({ error: "Artifact is too large" }, { status: 413 });
  const encodedName = req.headers.get("x-artifact-name") || "artifact.bin";
  let name = encodedName;
  try { name = decodeURIComponent(encodedName); } catch {}
  const mimeType = req.headers.get("content-type")?.split(";")[0]?.trim() || "application/octet-stream";
  const artifact = saveControlArtifact({ runId, ownerId: auth.ownerId, name, mimeType, data: bytes });
  return Response.json({ artifact: { id: artifact.id, runId: artifact.runId, name: artifact.name, mimeType: artifact.mimeType, size: artifact.size, createdAt: artifact.createdAt } });
}
