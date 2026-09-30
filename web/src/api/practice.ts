import type {
  PracticeAttemptResult,
  PracticeQuiz,
  PracticeResponse,
  PracticeSummary,
  ProblemSetView,
  TeachBackResult,
} from "@studium/shared";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { openActivityPanel } from "@/components/Activity/activity-store";
import { request } from "./client";
import { useJobs } from "./queries";

const root = (set: string) => `/api/sets/${encodeURIComponent(set)}/practice`;
const segment = encodeURIComponent;
export const practiceKey = (set: string) => ["practice", set] as const;
export const practiceApi = {
  summary: (set: string) => request<PracticeSummary>(root(set)),
  quiz: (set: string, id: string) => request<PracticeQuiz>(`${root(set)}/quizzes/${segment(id)}`),
  problems: (set: string, file: string) => request<ProblemSetView>(`${root(set)}/problems/${segment(file)}`),
  answer: (set: string, id: string, questionId: string, response: PracticeResponse) =>
    request<PracticeAttemptResult | { jobId: string }>(`${root(set)}/quizzes/${segment(id)}/answer`, {
      method: "POST",
      body: JSON.stringify({ questionId, response }),
    }),
  attempt: (set: string, file: string, id: string, response: PracticeResponse) =>
    request<PracticeAttemptResult | { jobId: string }>(
      `${root(set)}/problems/${segment(file)}/${segment(id)}/attempt`,
      { method: "POST", body: JSON.stringify({ response }) },
    ),
  hint: (set: string, file: string, id: string) =>
    request<{ hint: string | null; index: number; remaining: number }>(
      `${root(set)}/problems/${segment(file)}/${segment(id)}/hint`,
      { method: "POST" },
    ),
  reveal: (set: string, file: string, id: string) =>
    request<PracticeAttemptResult>(`${root(set)}/problems/${segment(file)}/${segment(id)}/reveal`, { method: "POST" }),
  teachback: (set: string, body: { note: string; topic?: string; text: string }) =>
    request<TeachBackResult>(`${root(set)}/teachback`, { method: "POST", body: JSON.stringify(body) }),
};
export function usePractice(set: string) {
  return useQuery({ queryKey: practiceKey(set), queryFn: () => practiceApi.summary(set) });
}
export function useRefreshPractice(set: string) {
  const client = useQueryClient();
  return useCallback(() => {
    void client.invalidateQueries({ queryKey: practiceKey(set) });
    void client.invalidateQueries({ queryKey: ["today"] });
  }, [client, set]);
}
export function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Something went wrong. Please try again.";
}
/** A queued grade stays pending until its job settles; submitting twice would log two attempts. */
export function usePracticeAttempt(set: string) {
  const [result, setResult] = useState<PracticeAttemptResult | null>(null);
  const [busy, setBusy] = useState(false);
  const submitting = useRef(false);
  const [error, setError] = useState("");
  const [jobId, setJobId] = useState<string | null>(null);
  const { data: jobs } = useJobs(set);
  const refresh = useRefreshPractice(set);
  useEffect(() => {
    if (!jobId) return;
    const job = jobs?.find((candidate) => candidate.id === jobId);
    if (!job || job.status === "queued" || job.status === "running") return;
    if (job.status === "done" && job.result?.practiceResult) {
      setResult(job.result.practiceResult);
      refresh();
    } else setError(job.error || "Grading did not finish. Please try again.");
    setJobId(null);
    submitting.current = false;
    setBusy(false);
  }, [jobs, jobId, refresh]);
  async function submit(action: () => Promise<PracticeAttemptResult | { jobId: string }>) {
    if (submitting.current) return;
    submitting.current = true;
    setBusy(true);
    setError("");
    try {
      const reply = await action();
      if ("jobId" in reply) setJobId(reply.jobId);
      else {
        setResult(reply);
        submitting.current = false;
        setBusy(false);
        refresh();
      }
    } catch (err) {
      setError(errorMessage(err));
      submitting.current = false;
      setBusy(false);
    }
  }
  return {
    result,
    busy,
    error,
    submit,
    reset: () => {
      setResult(null);
      setError("");
    },
    viewJob: jobId ? () => openActivityPanel(jobId) : undefined,
  };
}
