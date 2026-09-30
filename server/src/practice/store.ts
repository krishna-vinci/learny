import { randomBytes } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import {
  type PracticeLog,
  PracticeLogSchema,
  type PracticeQuiz,
  type PracticeSummary,
  type ProblemSetView,
  type StoredProblem,
  type StoredProblemSet,
  StoredProblemSetSchema,
  type StoredQuestion,
  type StoredQuiz,
  StoredQuizSchema,
  type TeachBackResult,
  type WeakSpot,
  WeakSpotSchema,
} from "@studium/shared";
import type { EventHub } from "../events.js";
import { writeTextLocked } from "../tree/edit.js";
import { type Author, commitPaths } from "../tree/git.js";
import type { FileLocks } from "../tree/lock.js";
import { canonicalRel, PathError, resolveInRoot } from "../tree/paths.js";
import { isSetSlug } from "../tree/read.js";
import { isDue, rebuildWeakSpots } from "./weak-spots.js";

export function practiceId(prefix: string): string {
  return `${prefix}-${randomBytes(4).toString("hex")}`;
}
export class PracticeError extends Error {
  constructor(
    readonly code: "not_found" | "invalid",
    message: string,
  ) {
    super(message);
  }
}
export interface PracticeStoreDeps {
  root: string;
  locks: FileLocks;
  hub?: EventHub;
  commit?: boolean;
  onWrite?: (rel: string) => void;
}
const QUIZ_ID = /^quiz-[0-9a-f]{8}$/;
const PROBLEM_FILE = /^[0-9]{2,}-[a-z0-9][a-z0-9-]*\.md$/;

export function questionView(q: StoredQuestion) {
  return {
    id: q.id,
    type: q.type,
    prompt: q.prompt,
    note: q.note,
    anchor: q.anchor,
    topic: q.topic,
    difficulty: q.difficulty,
    ...(q.src === undefined ? {} : { src: q.src }),
    ...("options" in q ? { options: q.options } : {}),
    ...("unit" in q ? { unit: q.unit } : {}),
  };
}
export function problemView(p: StoredProblem) {
  return {
    id: p.id,
    statement: p.statement,
    note: p.note,
    anchor: p.anchor,
    topic: p.topic,
    difficulty: p.difficulty,
    ...(p.src === undefined ? {} : { src: p.src }),
    answerType: p.answerType,
    hintCount: p.hints.length,
  };
}
function renderProblems(problems: StoredProblemSet): string {
  return `# Problems: ${problems.note}\n\n\`\`\`json\n${JSON.stringify(problems, null, 2)}\n\`\`\`\n`;
}

export class PracticeStore {
  constructor(
    readonly deps: PracticeStoreDeps,
    readonly set: string,
  ) {
    if (!isSetSlug(set)) throw new PracticeError("invalid", "invalid set");
  }
  confined(rel: string): string {
    const abs = resolveInRoot(this.deps.root, rel);
    if (canonicalRel(this.deps.root, rel) !== rel) throw new PathError(`Practice paths must not be aliases: ${rel}`);
    return abs;
  }
  async text(rel: string, optional = false): Promise<string> {
    try {
      return await fs.readFile(this.confined(rel), "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        if (optional) return "";
        throw new PracticeError("not_found", `file not found: ${rel}`);
      }
      throw error;
    }
  }
  async checkSet(): Promise<void> {
    await this.text(`${this.set}/PLAN.md`);
  }
  async checkNote(note: string): Promise<void> {
    if (!/^notes\/[a-z0-9][a-z0-9._-]*\.md$/.test(note)) throw new PracticeError("invalid", "invalid note");
    await this.text(`${this.set}/${note}`);
  }
  quizPath(id: string): string {
    if (!QUIZ_ID.test(id)) throw new PracticeError("invalid", "invalid quiz id");
    return `${this.set}/practice/quizzes/${id}.json`;
  }
  problemPath(file: string): string {
    if (!PROBLEM_FILE.test(file)) throw new PracticeError("invalid", "invalid problem file");
    return `${this.set}/practice/problems/${file}`;
  }
  async writeLocked(rel: string, holder: string, content: string): Promise<void> {
    await fs.mkdir(path.dirname(this.confined(rel)), { recursive: true });
    await writeTextLocked(this.deps.root, this.deps.locks, holder, rel, content, (candidate) => candidate === rel);
    this.deps.onWrite?.(rel);
  }
  async commit(paths: string[], author: Author, action: string): Promise<string | null> {
    if (this.deps.commit === false) return null;
    const subject = `${author}: ${action}`;
    const sha = await commitPaths(this.deps.root, paths, subject, author);
    if (sha !== null) this.deps.hub?.publish({ type: "commit", sha, subject, author });
    return sha;
  }
  async writeNew(rel: string, content: string, author: Author): Promise<string | null> {
    const holder = practiceId(author);
    return this.deps.locks.withLock(rel, holder, async () => {
      if ((await this.text(rel, true)) !== "") throw new PracticeError("invalid", "practice file already exists");
      await this.writeLocked(rel, holder, content);
      return this.commit([rel], author, "generate practice");
    });
  }
  async saveQuiz(quiz: StoredQuiz): Promise<string | null> {
    const parsed = StoredQuizSchema.parse(quiz);
    await this.checkSet();
    for (const q of parsed.questions) await this.checkNote(q.note);
    return this.writeNew(this.quizPath(parsed.id), `${JSON.stringify(parsed, null, 2)}\n`, "examiner");
  }
  async readQuiz(id: string): Promise<StoredQuiz> {
    const quiz = StoredQuizSchema.parse(JSON.parse(await this.text(this.quizPath(id))));
    if (quiz.id !== id) throw new PracticeError("invalid", "quiz id mismatch");
    return quiz;
  }
  async quizView(id: string): Promise<PracticeQuiz> {
    const q = await this.readQuiz(id);
    return { id: q.id, title: q.title, createdAt: q.createdAt, questions: q.questions.map(questionView) };
  }
  async saveProblems(file: string, problems: StoredProblemSet): Promise<string | null> {
    const parsed = StoredProblemSetSchema.parse(problems);
    await this.checkSet();
    await this.checkNote(parsed.note);
    const rel = this.problemPath(file);
    const holder = practiceId("examiner");
    return this.deps.locks.withLock(rel, holder, async () => {
      await this.writeLocked(rel, holder, renderProblems(parsed));
      return this.commit([rel], "examiner", "generate problems");
    });
  }
  async readProblems(file: string): Promise<StoredProblemSet> {
    const text = await this.text(this.problemPath(file));
    const json = /^```json\n([\s\S]*?)\n```$/m.exec(text)?.[1];
    if (json === undefined) throw new PracticeError("invalid", "malformed problem set");
    return StoredProblemSetSchema.parse(JSON.parse(json));
  }
  async problemsView(file: string): Promise<ProblemSetView> {
    const p = await this.readProblems(file);
    return { file, note: p.note, createdAt: p.createdAt, problems: p.problems.map(problemView) };
  }
  async revealHint(file: string, id: string): Promise<{ hint: string | null; index: number; remaining: number }> {
    const rel = this.problemPath(file);
    const holder = practiceId("hint");
    return this.deps.locks.withLock(rel, holder, async () => {
      const problems = await this.readProblems(file);
      const p = problems.problems.find((p) => p.id === id);
      if (!p) throw new PracticeError("not_found", "problem not found");
      const index = p.hintsRevealed;
      if (index >= p.hints.length) return { hint: null, index, remaining: 0 };
      p.hintsRevealed += 1;
      await this.writeLocked(rel, holder, renderProblems(problems));
      await this.commit([rel], "user", "reveal practice hint");
      return { hint: p.hints[index] as string, index, remaining: p.hints.length - p.hintsRevealed };
    });
  }
  async logs(): Promise<PracticeLog[]> {
    const text = await this.text(`${this.set}/log/practice.jsonl`, true);
    return text
      .split("\n")
      .filter((line) => line.trim())
      .map((line) => PracticeLogSchema.parse(JSON.parse(line)));
  }
  async derive(): Promise<WeakSpot[]> {
    return rebuildWeakSpots(await this.logs(), await this.text(`${this.set}/log/quiz.md`, true));
  }
  async readWeakSpots(): Promise<WeakSpot[]> {
    const text = await this.text(`${this.set}/practice/weak-spots.json`, true);
    return text === "" ? this.derive() : WeakSpotSchema.array().parse(JSON.parse(text));
  }
  async writeWeak(holder: string): Promise<string> {
    const rel = `${this.set}/practice/weak-spots.json`;
    await this.deps.locks.withLock(rel, holder, async () => {
      await this.writeLocked(rel, holder, `${JSON.stringify(await this.derive(), null, 2)}\n`);
    });
    return rel;
  }
  async rebuild(): Promise<WeakSpot[]> {
    const holder = practiceId("rebuild");
    return this.deps.locks.withLock(`${this.set}/log/practice.jsonl`, holder, async () => {
      const rel = await this.writeWeak(holder);
      await this.commit([rel], "system", "rebuild weak spots");
      return this.readWeakSpots();
    });
  }
  async record(
    raw: PracticeLog,
    author: Author = "user",
    teachback?: { result: TeachBackResult; text: string },
  ): Promise<void> {
    let entry = PracticeLogSchema.parse(raw);
    const holder = practiceId("attempt");
    const log = `${this.set}/log/practice.jsonl`;
    await this.deps.locks.withLock(log, holder, async () => {
      const paths: string[] = [];
      if (entry.chatLogLine !== undefined) {
        const quizLog = `${this.set}/log/quiz.md`;
        await this.deps.locks.withLock(quizLog, holder, async () => {
          const text = await this.text(quizLog, true);
          await this.writeLocked(
            quizLog,
            holder,
            `${text || "# Quiz log\n\n"}${text && !text.endsWith("\n") ? "\n" : ""}${entry.chatLogLine}\n`,
          );
        });
        paths.push(quizLog);
      }
      if (entry.kind === "problem" && !entry.revealed) {
        const revealed = (await this.logs()).some(
          (item) => item.problemFile === entry.problemFile && item.questionId === entry.questionId && item.revealed,
        );
        if (revealed) {
          const score = Math.min(0.5, entry.score);
          entry = {
            ...entry,
            score,
            revealed: true,
            gap: entry.gap || "Solution previously revealed",
            result:
              typeof entry.result === "object" && entry.result !== null
                ? { ...entry.result, score, verdict: score >= 0.5 ? "partial" : "wrong", revealed: true }
                : entry.result,
          };
          Object.assign(raw, entry);
        }
      }
      if (teachback) {
        const rel = `${this.set}/practice/teachback/${teachback.result.id}.md`;
        if (!/^tb-[0-9a-f]{8}$/.test(teachback.result.id)) throw new PracticeError("invalid", "invalid teachback id");
        await this.deps.locks.withLock(rel, holder, async () => {
          await this.writeLocked(
            rel,
            holder,
            `# Teach-back: ${teachback.result.topic}\n\n\`\`\`json\n${JSON.stringify(teachback, null, 2)}\n\`\`\`\n`,
          );
        });
        paths.push(rel);
      }
      const previous = await this.text(log, true);
      if (previous !== "" && !previous.endsWith("\n"))
        throw new PracticeError("invalid", "practice log has an incomplete line");
      await this.writeLocked(log, holder, `${previous}${JSON.stringify(entry)}\n`);
      paths.push(log);
      paths.push(await this.writeWeak(holder));
      await this.commit(paths, author, "record practice result");
    });
  }
  async files(directory: string): Promise<string[]> {
    try {
      return (await fs.readdir(this.confined(`${this.set}/practice/${directory}`))).sort();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
  }
  async summary(now = new Date()): Promise<PracticeSummary> {
    const logs = await this.logs();
    const quizzes = await Promise.all(
      (await this.files("quizzes"))
        .filter((file) => /^quiz-[0-9a-f]{8}\.json$/.test(file))
        .map(async (file) => {
          const quiz = await this.readQuiz(file.slice(0, -5));
          return {
            id: quiz.id,
            title: quiz.title,
            createdAt: quiz.createdAt,
            questionCount: quiz.questions.length,
            attempts: logs
              .filter((l) => l.quizId === quiz.id && l.result !== undefined)
              .map((l) => l.result as PracticeSummary["quizzes"][number]["attempts"][number]),
          };
        }),
    );
    const problemSets = await Promise.all(
      (await this.files("problems"))
        .filter((file) => PROBLEM_FILE.test(file))
        .map(async (file) => {
          const p = await this.readProblems(file);
          return { file, note: p.note, createdAt: p.createdAt, problemCount: p.problems.length };
        }),
    );
    const spots = await this.readWeakSpots();
    return {
      quizzes,
      problemSets,
      teachbacks: logs
        .filter((l) => l.kind === "teachback" && l.result !== undefined)
        .map((l) => l.result as TeachBackResult),
      weakSpots: spots,
      dueCount: spots.filter((spot) => isDue(spot, now)).length,
    };
  }
}
