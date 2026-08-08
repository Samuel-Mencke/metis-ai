import { timingSafeEqual } from "node:crypto";

export function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

export function bearerToken(req: Request): string | null {
  const header = req.headers.get("authorization")?.trim() || "";
  const match = /^Bearer\s+(.+)$/i.exec(header);
  return match?.[1].trim() || null;
}

export function bearerTokenMatches(req: Request, configured: string | undefined): boolean {
  const expected = configured?.trim() || "";
  const supplied = bearerToken(req);
  return Boolean(expected && supplied && safeEqual(expected, supplied));
}
