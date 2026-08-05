import dns from "node:dns/promises";
import { isAuthenticated } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isPrivateAddress(address: string) {
  return (
    address === "::1" ||
    address.startsWith("127.") ||
    address.startsWith("10.") ||
    address.startsWith("192.168.") ||
    address.startsWith("169.254.") ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(address) ||
    address.startsWith("fc") ||
    address.startsWith("fd") ||
    address.startsWith("fe80:")
  );
}

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
  let target: URL;
  try {
    target = new URL(rawUrl);
    if (!["http:", "https:"].includes(target.protocol)) throw new Error("Unsupported protocol");
    if (["localhost", "localhost.localdomain"].includes(target.hostname.toLowerCase())) {
      throw new Error("Private host");
    }
    const addresses = await dns.lookup(target.hostname, { all: true });
    if (addresses.some(({ address }) => isPrivateAddress(address))) throw new Error("Private host");
  } catch {
    return Response.json({ error: "Invalid or private URL" }, { status: 400 });
  }

  try {
    const response = await fetch(target, {
      headers: { "User-Agent": "ai-chat-link-preview/1.0" },
      signal: AbortSignal.timeout(5000),
      cache: "no-store",
    });
    if (!response.ok) return Response.json({ title: target.hostname, favicon: `${target.origin}/favicon.ico` });
    const html = (await response.text()).slice(0, 250_000);
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
    return Response.json({ title: target.hostname, favicon: `${target.origin}/favicon.ico` });
  }
}
