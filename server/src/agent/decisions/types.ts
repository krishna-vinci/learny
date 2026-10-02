import type { ClassifierAnswer, ClassifierContext } from "@earendil-works/pi-ai";
export type Answers = Record<string, ClassifierAnswer>;
export interface DecisionSpec<T> {
  mode: "off" | "shadow" | "on";
  threshold: number;
  questions(state: ClassifierContext["state"]): ClassifierContext["questions"];
  fallback(state: ClassifierContext["state"]): T;
  decode(answers: Answers): T;
}
export function probability(a: ClassifierAnswer): number {
  return a.type === "bool" ? Math.max(a.probability, 1 - a.probability) : a.confidence;
}
export function bools(answers: Answers): Record<string, boolean> {
  return Object.fromEntries(
    Object.entries(answers).map(([k, a]) => {
      if (a.type !== "bool") throw new Error("Expected bool");
      return [k, a.probability >= 0.5];
    }),
  );
}
export function choice(answers: Answers, key: string, choices: readonly string[]): string {
  const a = answers[key];
  if (a?.type !== "choice" || !choices.includes(a.choice)) throw new Error("Invalid choice");
  return a.choice;
}
export function candidates(state: ClassifierContext["state"]): { id: string; text: string }[] {
  return Array.isArray(state.candidates) ? (state.candidates as { id: string; text: string }[]) : [];
}
