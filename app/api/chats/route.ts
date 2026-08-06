import { getAuthenticatedUserId, isAuthenticated } from "@/lib/auth";
import { createChat, listChatsForUser, type BrowserContext } from "@/lib/db-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!(await isAuthenticated(req))) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const includeArchived = new URL(req.url).searchParams.get("includeArchived") === "true";
  return Response.json({
    chats: listChatsForUser(
      await getAuthenticatedUserId(req) ?? undefined,
      { includeArchived },
    ),
  });
}

export async function POST(req: Request) {
  if (!(await isAuthenticated(req))) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: {
    title?: string;
    browserContext?: BrowserContext;
    modelId?: string;
    modelParams?: Array<{ id: string; value: string }>;
  } = {};
  try {
    body = (await req.json()) as {
      title?: string;
      browserContext?: BrowserContext;
      modelId?: string;
      modelParams?: Array<{ id: string; value: string }>;
    };
  } catch {
    body = {};
  }

  const chat = createChat(
    body.title,
    body.browserContext,
    await getAuthenticatedUserId(req) ?? undefined,
    {
      id: body.modelId?.trim(),
      params: Array.isArray(body.modelParams) ? body.modelParams : undefined,
    },
  );
  return Response.json({ chat }, { status: 201 });
}
