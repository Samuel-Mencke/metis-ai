import type { UserInputQuestionPayload } from "../contracts";

interface PendingQuestion {
  payload: UserInputQuestionPayload;
  resolve: (answer: { selectedOption?: string; textInput?: string }) => void;
  reject: (err: Error) => void;
}

const pendingQuestions = new Map<string, PendingQuestion>();

export function registerPendingQuestion(
  requestId: string,
  payload: UserInputQuestionPayload,
): Promise<{ selectedOption?: string; textInput?: string }> {
  return new Promise((resolve, reject) => {
    pendingQuestions.set(requestId, { payload, resolve, reject });
  });
}

export function resolvePendingQuestion(
  requestId: string,
  answer: { selectedOption?: string; textInput?: string },
): boolean {
  const entry = pendingQuestions.get(requestId);
  if (!entry) return false;
  pendingQuestions.delete(requestId);
  entry.resolve(answer);
  return true;
}

export function getPendingQuestion(requestId: string): UserInputQuestionPayload | undefined {
  return pendingQuestions.get(requestId)?.payload;
}
