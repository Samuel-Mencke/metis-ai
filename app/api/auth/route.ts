import { NextResponse } from "next/server";
import { authenticateUser, CHAT_COOKIE } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  let body: { username?: string; password?: string };
  try {
    body = (await req.json()) as { username?: string; password?: string };
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const username = body.username?.trim() || process.env.CHAT_USERNAME?.trim() || "f1shy312";
  const result = authenticateUser(username, body.password ?? "");
  if (!result) {
    return NextResponse.json({ error: "Invalid username or password" }, { status: 401 });
  }

  const proto = req.headers.get("x-forwarded-proto") || "http";
  const res = NextResponse.json({ ok: true });
  res.cookies.set(CHAT_COOKIE, result.token, {
    httpOnly: true,
    sameSite: "lax",
    secure: proto === "https",
    path: "/",
    maxAge: result.maxAge,
  });
  return res;
}

export async function DELETE(req: Request) {
  const proto = req.headers.get("x-forwarded-proto") || "http";
  const res = NextResponse.json({ ok: true });
  res.cookies.set(CHAT_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: proto === "https",
    path: "/",
    maxAge: 0,
  });
  return res;
}
