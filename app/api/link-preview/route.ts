import { isAuthenticated } from "@/lib/auth";
import { fetchWithValidatedRedirects, readResponseTextBounded } from "@/lib/url-security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function metadata(html: string, key: string) {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = html.match(new RegExp(`<meta[^>]+(?:name|property)=["']${escaped}["'][^>]+content=["']([^"']*)["']`, "i"));
  return match?.[1]?.replace(/\s+/g, " ").trim();
}

export async function GET(req: Request) {
  if (!(await isAuthenticated(req))) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const rawUrl = new URL(req.url).searchParams.get("url") || "";
  try {
    const result = await fetchWithValidatedRedirects(rawUrl, {
      headers: { "User-Agent": "ai-chat-link-preview/1.0" },
      signal: AbortSignal.timeout(5000),
      cache: "no-store",
    });
    const { response } = result;
    const target = result.url;
    if (!response.ok) return Response.json({ title: target.hostname, favicon: `${target.origin}/favicon.ico` });
    const html = await readResponseTextBounded(response, 250_000);
    const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.replace(/\s+/g, " ").trim();
    const description = metadata(html, "description") || metadata(html, "og:description");
    const image = metadata(html, "og:image");
    return Response.json({
      title: title || metadata(html, "og:title") || target.hostname,
      description,
      favicon: `${target.origin}/favicon.ico`,
      image,
    });
  } catch {
    return Response.json({ error: "Invalid, private, or unavailable URL" }, { status: 400 });
  }
}
