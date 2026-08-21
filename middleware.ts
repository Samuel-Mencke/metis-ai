import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export function middleware(request: NextRequest) {
  if (request.nextUrl.pathname !== "/prompts.json") {
    return NextResponse.next();
  }
  const value = process.env.METIS_ENABLE_UNCENSORED?.trim().toLowerCase();
  const enabled = value === "1" || value === "true" || value === "yes" || value === "on";
  if (!enabled) {
    return new NextResponse(null, { status: 404 });
  }
  return NextResponse.rewrite(new URL("/api/prompts", request.url));
}

export const config = {
  matcher: ["/prompts.json"],
};
