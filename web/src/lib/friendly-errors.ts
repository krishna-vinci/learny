// One place that turns server and network errors into plain sentences with a fix
// (docs/UX.md rule 8: "what happened, what to do", never a status code, path or env var).
// Everything user-facing that shows an error goes through `friendlyError`.
import { ApiError, UnauthorizedError } from "@/api/client";
import { OfflineError } from "@/lib/offline";

export interface FriendlyError {
  /** One or two plain sentences. */
  message: string;
  /** A fix the UI can offer as a button, when there is one. */
  action?: { label: string; to: string };
  /** True when retrying the same thing may work without the learner changing anything. */
  retryable: boolean;
}

const GENERIC = "Something went wrong. Please try again.";

function textOf(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error) return error.message;
  return typeof error === "string" ? error : "";
}

interface Rule {
  test: (text: string, error: unknown) => boolean;
  result: FriendlyError;
}

// Order matters: the first match wins.
const RULES: Rule[] = [
  {
    test: (_text, error) => error instanceof OfflineError,
    result: { message: "You're offline. Reconnect to save changes.", retryable: true },
  },
  {
    test: (_text, error) => error instanceof UnauthorizedError || (error instanceof ApiError && error.status === 401),
    result: {
      message: "You've been signed out. Sign in again to continue.",
      action: { label: "Sign in", to: "/auth" },
      retryable: false,
    },
  },
  {
    test: (text) => /AI features are disabled/i.test(text),
    result: { message: "Ask your admin to enable AI for your account.", retryable: false },
  },
  {
    test: (text) => /This set has no sources yet|Couldn't add any of the plan's sources/i.test(text),
    result: {
      message: "This set needs a source before chapters can be drafted. Add one in the Library, then retry.",
      action: { label: "Add a source", to: "/library" },
      retryable: false,
    },
  },
  {
    test: (text) => /firecrawl/i.test(text),
    result: {
      message: "Adding whole sites isn't set up on this server. You can still add single pages.",
      retryable: false,
    },
  },
  {
    test: (text) => /(pandoc|typst)[^.]*(missing|not found|enoent|binary)|binary is missing/i.test(text),
    result: {
      message: "Making PDF books isn't set up on this server yet. Ask whoever runs it to install the book tools.",
      retryable: false,
    },
  },
  {
    test: (text) => /\b429\b|rate[\s_-]?limit|usage limit|quota|too many requests|overloaded/i.test(text),
    result: { message: "The AI is busy right now. Give it a minute, then try again.", retryable: true },
  },
  {
    test: (text) => /invalid_api_key|incorrect api key|unauthorized.*model|api key/i.test(text),
    result: {
      message: "The AI service rejected this server's key. Ask your admin to check the model settings.",
      action: { label: "Open settings", to: "/settings/models" },
      retryable: false,
    },
  },
  {
    test: (text) => /unknown model|model .* not found|no model/i.test(text),
    result: {
      message: "No AI model is set up for this step. Ask your admin to choose one in settings.",
      action: { label: "Open settings", to: "/settings/models" },
      retryable: false,
    },
  },
  {
    test: (text) => /failed to fetch|networkerror|load failed|network request failed/i.test(text),
    result: { message: "Can't reach the server. Check your connection and try again.", retryable: true },
  },
  {
    test: (text) => /private|localhost|not a public|blocked address|ssrf|assertPublicUrl/i.test(text),
    result: { message: "That address can't be opened from here. Use a public web page.", retryable: false },
  },
  {
    test: (text) => /too large|413|file is too large/i.test(text),
    result: { message: "That file is too large. Try a smaller one (up to 100 MB).", retryable: false },
  },
  {
    test: (text) => /must create exactly|did not update|did not create|produced no|empty (?:note|draft)/i.test(text),
    result: {
      message: "The assistant couldn't finish this. Try again, or add a little more detail.",
      retryable: true,
    },
  },
  {
    test: (text) => /timed out|timeout|aborted/i.test(text),
    result: { message: "That took too long and was stopped. Try again.", retryable: true },
  },
  {
    test: (_text, error) => error instanceof ApiError && error.status === 409,
    result: { message: "That's already in progress. Wait for it to finish.", retryable: true },
  },
  {
    test: (_text, error) => error instanceof ApiError && error.status === 404,
    result: { message: "That isn't there any more. It may have been moved or deleted.", retryable: false },
  },
  {
    test: (_text, error) => error instanceof ApiError && error.status >= 500,
    result: { message: "The server ran into a problem. Try again in a moment.", retryable: true },
  },
];

/** Plain-language version of any error (a thrown value, an `ApiError`, or a job's `error` string). */
export function friendlyError(error: unknown, fallback: string = GENERIC): FriendlyError {
  const text = textOf(error);
  const rule = RULES.find((candidate) => candidate.test(text, error));
  if (rule) return rule.result;
  // A short, sentence-like server message is already readable (e.g. "Title is required").
  if (error instanceof ApiError && error.status >= 400 && error.status < 500 && /^[A-Z][^\n]{3,140}[.!]?$/.test(text)) {
    return { message: /[.!?]$/.test(text) ? text : `${text}.`, retryable: false };
  }
  return { message: fallback, retryable: true };
}

/** Shorthand for call sites that only need the sentence. */
export function friendlyMessage(error: unknown, fallback?: string): string {
  return friendlyError(error, fallback).message;
}
