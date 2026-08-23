import { NextRequest, NextResponse } from "next/server";
import { resolvePendingQuestion } from "@/lib/runtime/toolkits/question";

export async function POST(req: NextRequest) {
  try {
    const { requestId, selectedOption, textInput } = await req.json();
    if (!requestId) {
      return NextResponse.json({ error: "Missing requestId" }, { status: 400 });
    }

    const success = resolvePendingQuestion(requestId, { selectedOption, textInput });
    if (!success) {
      return NextResponse.json({ error: "Question not found or already answered" }, { status: 404 });
    }

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || "Internal error" }, { status: 500 });
  }
}
