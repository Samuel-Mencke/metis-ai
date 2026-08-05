import { isAuthenticated } from "@/lib/auth";
import { getChat } from "@/lib/db-store";
import { readUpload } from "@/lib/uploads";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ chatId: string; name: string }> };

export async function GET(req: Request, { params }: Params) {
  if (!(await isAuthenticated(req))) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { chatId, name } = await params;
  const chat = getChat(chatId);
  if (!chat) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  const storedName = decodeURIComponent(name);
  const meta = chat.messages
    .flatMap((m) => m.attachments ?? [])
    .find((a) => a.storedName === storedName);

  const buf = readUpload(chatId, storedName);
  if (!buf) {
    return Response.json({ error: "File not found" }, { status: 404 });
  }

  const mime = meta?.mimeType || "application/octet-stream";
  return new Response(new Uint8Array(buf), {
    headers: {
      "Content-Type": mime,
      "Content-Length": String(buf.length),
      "Cache-Control": "private, max-age=3600",
      "Content-Disposition": `inline; filename="${encodeURIComponent(meta?.name || storedName)}"`,
    },
  });
}
