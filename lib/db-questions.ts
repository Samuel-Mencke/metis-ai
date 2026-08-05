import { randomUUID } from "node:crypto";
import { getDatabase } from "@/lib/sqlite";
import type { AgentQuestion, QuestionOption } from "@/lib/questions";

export function questionLimits() {
  return { maxQuestions: 8, maxAnswerLength: 4_000 };
}

export function createPendingQuestion(
  input: Array<{ question: string; options?: Array<QuestionOption | string> }>,
  chatId: string,
  userId?: string,
) {
  const questions: AgentQuestion[] = input.slice(0, 8).map((item) => ({
    id: randomUUID(),
    question: item.question.trim().slice(0, 2_000),
    ...(item.options?.length ? { options: item.options.slice(0, 12).map((option) =>
      typeof option === "string" ? { label: option.slice(0, 500), value: option.slice(0, 500) } : option,
    ) } : {}),
  })).filter((item) => item.question);
  const questionId = randomUUID();
  getDatabase().prepare(
    "INSERT INTO pending_questions (question_id, chat_id, user_id, data, created_at) VALUES (?, ?, ?, ?, ?)",
  ).run(questionId, chatId, userId ?? null, JSON.stringify({ questionId, questions }), new Date().toISOString());
  let stopped = false;
  const promise = (async () => {
    const deadline = Date.now() + 15 * 60 * 1000;
    while (!stopped && Date.now() < deadline) {
      const row = getDatabase().prepare("SELECT data FROM pending_questions WHERE question_id = ?").get(questionId) as { data?: string } | undefined;
      const data = row?.data ? JSON.parse(row.data) as { answers?: string[] } : {};
      if (data.answers?.length) return data.answers;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    return questions.map(() => "[No answer received before the question timed out.]");
  })();
  return { questionId, questions, promise, stop: () => { stopped = true; } };
}

export function resolveQuestion(
  questionId: string,
  answers: string[],
  userId?: string,
): { chatId: string } | false {
  const db = getDatabase();
  const row = db.prepare(
    "SELECT chat_id as chatId, data, user_id as userId FROM pending_questions WHERE question_id = ?",
  ).get(questionId) as { chatId?: string; data?: string; userId?: string } | undefined;
  if (!row?.data) return false;
  if (userId && row.userId && row.userId !== userId) return false;
  const data = JSON.parse(row.data) as { questions: AgentQuestion[] };
  if (answers.length !== data.questions.length || answers.some((answer) => !answer.trim())) return false;
  db.prepare("UPDATE pending_questions SET data = ? WHERE question_id = ?")
    .run(JSON.stringify({ ...data, answers: answers.map((answer) => answer.trim().slice(0, 4_000)) }), questionId);
  return row.chatId ? { chatId: row.chatId } : false;
}

export function deletePendingQuestion(questionId: string) {
  getDatabase().prepare("DELETE FROM pending_questions WHERE question_id = ?").run(questionId);
}
