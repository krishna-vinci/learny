import type { PracticeAttemptResult, PracticeQuestion, PracticeQuiz, PracticeResponse } from "@studium/shared";
import { useEffect, useRef, useState } from "react";
import { practiceApi, usePracticeAttempt } from "@/api/practice";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ErrorNotice, Feedback, fieldClass, Prose } from "./common";

export function parseResponse(question: PracticeQuestion, text: string, selected: string[]): PracticeResponse | null {
  if (question.type === "multi") return selected.length ? selected : null;
  if (question.type === "mcq") return selected[0] ?? null;
  if (!text.trim()) return null;
  if (question.type === "numeric") return Number.isFinite(Number(text)) ? Number(text) : null;
  return text.trim();
}
export function QuizRunner({ set, quiz, onClose }: { set: string; quiz: PracticeQuiz; onClose: () => void }) {
  const [questions, setQuestions] = useState(quiz.questions);
  const [index, setIndex] = useState(0);
  const [text, setText] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [results, setResults] = useState<PracticeAttemptResult[]>([]);
  const grade = usePracticeAttempt(set);
  const heading = useRef<HTMLHeadingElement>(null);
  const feedback = useRef<HTMLDivElement>(null);
  const nextButton = useRef<HTMLButtonElement>(null);
  const question = questions[index];
  useEffect(() => {
    if (index >= 0) heading.current?.focus();
  }, [index]);
  useEffect(() => {
    if (grade.result) {
      feedback.current?.scrollIntoView?.({ block: "nearest" });
      nextButton.current?.focus({ preventScroll: true });
    }
  }, [grade.result]);
  const response = question ? parseResponse(question, text, selected) : null;
  function submit() {
    if (question && response !== null && !grade.busy && !grade.result)
      void grade.submit(() => practiceApi.answer(set, quiz.id, question.id, response));
  }
  function next() {
    if (!grade.result) return;
    setResults((previous) => [...previous, grade.result as PracticeAttemptResult]);
    grade.reset();
    setText("");
    setSelected([]);
    setIndex(index + 1);
  }
  if (!question) {
    const revisit = [...new Set(results.filter((result) => result.verdict !== "right").map((result) => result.topic))];
    const wrong = questions.filter(
      (item) => results.find((result) => result.questionId === item.id)?.verdict === "wrong",
    );
    return (
      <section className="flex flex-col gap-4 rounded-lg border border-border p-5">
        <h2 ref={heading} tabIndex={-1} className="text-lg font-semibold outline-none">
          Quiz complete
        </h2>
        <p className="text-3xl font-semibold">
          {Math.round((results.reduce((sum, item) => sum + item.score, 0) / questions.length) * 100)}%{" "}
          <span className="text-base font-normal text-muted-foreground">score</span>
        </p>
        <p>
          {revisit.length ? `Topics to revisit: ${revisit.join(", ")}` : "All correct. Keep building on what you know."}
        </p>
        <div className="flex flex-wrap gap-2">
          <Button
            className="min-h-11"
            disabled={!wrong.length}
            onClick={() => {
              setQuestions(wrong);
              setResults([]);
              setIndex(0);
            }}
          >
            Retry wrong ones
          </Button>
          <Button variant="outline" className="min-h-11" onClick={onClose}>
            Back to quizzes
          </Button>
        </div>
      </section>
    );
  }
  return (
    <form
      className="flex flex-col gap-5"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
      onKeyDown={(event) => {
        const target = event.target as HTMLElement;
        const typing =
          ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName) &&
          !(target instanceof HTMLInputElement && ["radio", "checkbox"].includes(target.type));
        if (!typing && !event.altKey && !event.ctrlKey && !event.metaKey) {
          if (question.type === "mcq" && /^[1-4]$/.test(event.key) && !grade.result && !grade.busy) {
            const option = question.options?.[Number(event.key) - 1];
            if (option !== undefined) {
              event.preventDefault();
              setSelected([option]);
            }
          }
          if (event.key.toLowerCase() === "n" && grade.result) {
            event.preventDefault();
            next();
          }
        }
        if (event.key === "Enter" && !event.shiftKey && target.tagName !== "BUTTON") {
          event.preventDefault();
          submit();
        }
      }}
    >
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          Question {index + 1} of {questions.length}
        </p>
        <Button variant="quiet" className="min-h-11" disabled={grade.busy} onClick={onClose}>
          Back to quizzes
        </Button>
      </div>
      <div className="h-1 overflow-hidden rounded-full bg-muted" aria-hidden="true">
        <div className="h-full bg-primary transition-all" style={{ width: `${(index / questions.length) * 100}%` }} />
      </div>
      <section className="flex flex-col gap-4 rounded-lg border border-border bg-card p-4 sm:p-5">
        <h2 ref={heading} tabIndex={-1} className="text-sm font-medium text-muted-foreground outline-none">
          {question.topic} ·{" "}
          {question.type === "multi"
            ? "Choose all that apply"
            : question.type === "mcq"
              ? "Choose one answer"
              : "Your answer"}
        </h2>
        {question.type === "cloze" ? (
          <div className="leading-relaxed [&>div]:inline [&_p]:inline">
            <Prose content={question.prompt.split(/_{2,}|\{\{blank\}\}/)[0] ?? ""} />
            <input
              id="quiz-response"
              aria-label="Fill in the blank"
              className={cn(fieldClass, "mx-2 inline-block w-40 align-middle")}
              value={text}
              disabled={!!grade.result || grade.busy}
              onChange={(event) => setText(event.target.value)}
            />
            <Prose
              content={question.prompt
                .split(/_{2,}|\{\{blank\}\}/)
                .slice(1)
                .join(" ")}
            />
          </div>
        ) : (
          <Prose content={question.prompt} />
        )}
        {(question.type === "mcq" || question.type === "multi") && (
          <fieldset className="flex flex-col gap-2" disabled={!!grade.result || grade.busy}>
            <legend className="sr-only">Answer options</legend>
            {question.options?.map((option, optionIndex) => (
              <label
                key={option}
                className={`flex min-h-12 cursor-pointer items-center gap-3 rounded-md border p-3 ${selected.includes(option) ? "border-primary bg-primary/5" : "border-border hover:bg-accent/40"}`}
              >
                <input
                  type={question.type === "mcq" ? "radio" : "checkbox"}
                  name="quiz-option"
                  className="size-4 shrink-0 accent-primary"
                  checked={selected.includes(option)}
                  onChange={() =>
                    setSelected(
                      question.type === "mcq"
                        ? [option]
                        : selected.includes(option)
                          ? selected.filter((item) => item !== option)
                          : [...selected, option],
                    )
                  }
                />
                <span className="text-xs text-muted-foreground" aria-hidden="true">
                  {optionIndex + 1}
                </span>
                <Prose content={option} />
              </label>
            ))}
          </fieldset>
        )}
        {(question.type === "short" || question.type === "numeric") && (
          <div className="flex flex-col gap-2">
            <label htmlFor="quiz-response" className="text-sm font-medium">
              {question.type === "numeric" ? "Value" : "Your answer"}
            </label>
            {question.type === "short" ? (
              <textarea
                id="quiz-response"
                className={fieldClass}
                rows={5}
                value={text}
                disabled={!!grade.result || grade.busy}
                onChange={(event) => setText(event.target.value)}
              />
            ) : (
              <input
                id="quiz-response"
                className={fieldClass}
                type="text"
                inputMode="decimal"
                aria-describedby={question.unit ? "quiz-unit" : undefined}
                value={text}
                disabled={!!grade.result || grade.busy}
                onChange={(event) => setText(event.target.value)}
              />
            )}
            {question.unit && (
              <p id="quiz-unit" className="text-sm text-muted-foreground">
                Unit: {question.unit}
              </p>
            )}
          </div>
        )}
      </section>
      {grade.result && (
        <div ref={feedback} className="scroll-mt-16 scroll-mb-24">
          <Feedback set={set} result={grade.result} />
        </div>
      )}
      <ErrorNotice>{grade.error}</ErrorNotice>
      <div className="sticky bottom-0 z-10 -mx-4 flex min-h-20 items-center gap-3 border-t border-border bg-background px-4 py-3 pe-24 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:mx-0 sm:pe-4">
        {grade.result ? (
          <Button ref={nextButton} className="min-h-11 flex-1 sm:flex-none" onClick={next}>
            {index === questions.length - 1 ? "Finish quiz" : "Next"}
          </Button>
        ) : (
          <Button type="submit" className="min-h-11 flex-1 sm:flex-none" disabled={response === null || grade.busy}>
            {grade.busy ? "Grading…" : "Submit answer"}
          </Button>
        )}
        {grade.viewJob && (
          <Button variant="quiet" className="min-h-11" onClick={grade.viewJob}>
            View progress
          </Button>
        )}
        <span className="hidden text-xs text-muted-foreground sm:block">
          {grade.result
            ? "N to continue"
            : question.type === "mcq"
              ? "1–4 to choose · Enter to submit"
              : question.type === "short"
                ? "Enter to submit · Shift+Enter for a new line"
                : "Enter to submit"}
        </span>
      </div>
    </form>
  );
}
