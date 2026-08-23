import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  try {
    const { requestId, decision, data } = await req.json();
    if (!requestId || !decision) {
      return NextResponse.json({ error: "Missing requestId or decision" }, { status: 400 });
    }
    return NextResponse.json({ ok: true, decision, requestId });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || "Internal error" }, { status: 500 });
  }
}
