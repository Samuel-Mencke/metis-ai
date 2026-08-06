import { getAuthenticatedUserId, isAuthenticated } from "@/lib/auth";
import { questionLimits, resolveQuestion } from "@/lib/db-questions";
import { updateChat } from "@/lib/db-store";

export const runtime = "nodejs";

export async function POST(req: Request) {
  if (!(await isAuthenticated(req))) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { questionId?: unknown; answers?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const questionId =
    typeof body.questionId === "string" ? body.questionId.trim() : "";
  const answers = Array.isArray(body.answers)
    ? body.answers.filter((answer): answer is string => typeof answer === "string")
    : [];
  const { maxQuestions, maxAnswerLength } = questionLimits();
  if (
    !questionId ||
    answers.length === 0 ||
    answers.length > maxQuestions ||
    answers.some((answer) => !answer.trim() || answer.length > maxAnswerLength)
  ) {
    return Response.json({ error: "Invalid question answers" }, { status: 400 });
  }
  const userId = (await getAuthenticatedUserId(req)) ?? undefined;
  const resolved = resolveQuestion(questionId, answers, userId);
  if (!resolved) {
    return Response.json(
      { error: "Question not found or already answered" },
      { status: 404 },
    );
  }
  // Release the durable UI state immediately. The MCP request will observe
  // the answer independently and continue the agent run.
  updateChat(
    resolved.chatId,
    { runStatus: "running", pendingQuestion: null, badge: null },
    userId,
  );
  return Response.json({ ok: true });
}
