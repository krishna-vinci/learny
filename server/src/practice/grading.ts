import type { PracticeResponse, PracticeVerdict, StoredProblem, StoredQuestion } from "@studium/shared";

export function verdict(score: number): PracticeVerdict {
  return score >= 0.8 ? "right" : score >= 0.5 ? "partial" : "wrong";
}
export function normalizeAnswer(text: string): string {
  return text.normalize("NFKC").trim().toLowerCase().replace(/\s+/g, " ");
}

export function validateResponse(question: StoredQuestion | StoredProblem, response: PracticeResponse): void {
  const type = "type" in question ? question.type : question.answerType;
  if (type === "multi") {
    if (
      !Array.isArray(response) ||
      new Set(response).size !== response.length ||
      !("options" in question) ||
      !response.every((r) => question.options.includes(r))
    )
      throw new Error("response must contain distinct offered options");
  } else if (type === "numeric") {
    if (
      Array.isArray(response) ||
      (typeof response === "string" && !response.trim()) ||
      !Number.isFinite(Number(response))
    )
      throw new Error("response must be a finite number");
  } else if (typeof response !== "string") throw new Error("response must be text");
  else if (type === "mcq" && (!("options" in question) || !question.options.includes(response)))
    throw new Error("response must be an offered option");
}

/** Undefined means this answer needs the Grader; no deterministic type runs AI. */
export function deterministicScore(
  question: StoredQuestion | StoredProblem,
  response: PracticeResponse,
): number | undefined {
  validateResponse(question, response);
  const type = "type" in question ? question.type : question.answerType;
  if (type === "numeric" && typeof question.answer === "object" && !Array.isArray(question.answer))
    return Math.abs(Number(response) - question.answer.value) <=
      question.answer.tolerance + Number.EPSILON * Math.max(1, Math.abs(question.answer.value))
      ? 1
      : 0;
  if (type === "mcq") return response === question.answer ? 1 : 0;
  if (type === "cloze")
    return normalizeAnswer(response as string) === normalizeAnswer(question.answer as string) ? 1 : 0;
  if (type === "multi") {
    const selected = response as string[];
    const answer = question.answer as string[];
    if (selected.length === answer.length && selected.every((r) => answer.includes(r))) return 1;
    return selected.length > 0 && selected.every((r) => answer.includes(r)) ? 0.5 : 0;
  }
  return undefined;
}
