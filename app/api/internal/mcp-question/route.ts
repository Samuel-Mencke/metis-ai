import { appendRunEvent } from "@/lib/db-jobs";
import {
  createPendingQuestion,
  deletePendingQuestion,
} from "@/lib/db-questions";
import { getChat, updateChat } from "@/lib/db-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 960;

type QuestionInput = {
  question?: unknown;
  multiple?: unknown;
  options?: unknown;
};

function authorized(req: Request) {
  const configured = process.env.MCP_BEARER_TOKEN?.trim() || "";
  const supplied = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
  return Boolean(configured && supplied && configured === supplied);
}

export async function POST(req: Request) {
  if (!authorized(req)) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const chatId = req.headers.get("x-ai-chat-id")?.trim() || "";
  const userId = req.headers.get("x-ai-chat-user-id")?.trim() || undefined;
  const jobId = req.headers.get("x-ai-chat-job-id")?.trim() || "";
  const chat = chatId ? getChat(chatId, userId) : null;
  if (!chat || !jobId) return Response.json({ error: "Invalid chat context" }, { status: 400 });

  const body = (await req.json().catch(() => ({}))) as { questions?: unknown };
  const rawQuestions = Array.isArray(body.questions) ? body.questions : [];
  const questions = rawQuestions
    .filter((item): item is QuestionInput => Boolean(item) && typeof item === "object")
    .map((item) => ({
      question: typeof item.question === "string" ? item.question : "",
      multiple: item.multiple === true,
      options: Array.isArray(item.options) ? item.options.filter((option) => typeof option === "string") : undefined,
    }))
    .filter((item) => item.question.trim());
  if (!questions.length) return Response.json({ error: "At least one question is required" }, { status: 400 });

  const pending = createPendingQuestion(questions, chatId, userId);
  updateChat(chatId, { runStatus: "waiting_input", pendingQuestion: { questionId: pending.questionId, questions: pending.questions } }, userId);
  appendRunEvent(jobId, chatId, userId, "question", {
    questionId: pending.questionId,
    questions: pending.questions,
  });

  const answers = await pending.promise;
  deletePendingQuestion(pending.questionId);
  updateChat(chatId, { runStatus: "running", pendingQuestion: null }, userId);
  return Response.json({ questionId: pending.questionId, answers });
}
