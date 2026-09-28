// Adapted from Memos (MIT) — https://github.com/usememos/memos
import type { HLJSApi, LanguageFn } from "highlight.js";

type LanguageModule = { default: LanguageFn };
type LanguageLoader = () => Promise<LanguageModule>;

// Keep the languages most likely to show up in study notes cheap. Less common languages fall
// back to the complete build, preserving language support without making every note download
// every language definition.
const commonLanguageLoaders = {
  bash: () => import("highlight.js/lib/languages/bash"),
  c: () => import("highlight.js/lib/languages/c"),
  cpp: () => import("highlight.js/lib/languages/cpp"),
  csharp: () => import("highlight.js/lib/languages/csharp"),
  css: () => import("highlight.js/lib/languages/css"),
  diff: () => import("highlight.js/lib/languages/diff"),
  go: () => import("highlight.js/lib/languages/go"),
  java: () => import("highlight.js/lib/languages/java"),
  javascript: () => import("highlight.js/lib/languages/javascript"),
  json: () => import("highlight.js/lib/languages/json"),
  markdown: () => import("highlight.js/lib/languages/markdown"),
  python: () => import("highlight.js/lib/languages/python"),
  rust: () => import("highlight.js/lib/languages/rust"),
  sql: () => import("highlight.js/lib/languages/sql"),
  typescript: () => import("highlight.js/lib/languages/typescript"),
  xml: () => import("highlight.js/lib/languages/xml"),
  yaml: () => import("highlight.js/lib/languages/yaml"),
} satisfies Record<string, LanguageLoader>;

type CommonLanguage = keyof typeof commonLanguageLoaders;

const languageAliases: Record<string, CommonLanguage> = {
  cs: "csharp",
  cxx: "cpp",
  golang: "go",
  htm: "xml",
  html: "xml",
  js: "javascript",
  jsx: "javascript",
  md: "markdown",
  py: "python",
  sh: "bash",
  shell: "bash",
  ts: "typescript",
  tsx: "typescript",
  yml: "yaml",
};

const plainTextLanguages = new Set(["", "plain", "plaintext", "text", "txt"]);
const registeredLanguagePromises = new Map<CommonLanguage, Promise<HLJSApi>>();
let corePromise: Promise<HLJSApi> | undefined;
let fullBuildPromise: Promise<HLJSApi> | undefined;

export const isPlainTextLanguage = (language: string): boolean => plainTextLanguages.has(language.trim().toLowerCase());

export const escapeHtml = (value: string): string =>
  value.replace(/[&<>"']/g, (char) => {
    switch (char) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      default:
        return "&#39;";
    }
  });

const loadCore = (): Promise<HLJSApi> => {
  corePromise ??= import("highlight.js/lib/core").then((module) => module.default);
  return corePromise;
};

const loadCommonLanguage = (language: CommonLanguage): Promise<HLJSApi> => {
  const existingPromise = registeredLanguagePromises.get(language);
  if (existingPromise) {
    return existingPromise;
  }

  const languagePromise = Promise.all([loadCore(), commonLanguageLoaders[language]()]).then(
    ([hljs, languageModule]) => {
      if (!hljs.getLanguage(language)) {
        hljs.registerLanguage(language, languageModule.default);
      }
      return hljs;
    },
  );
  registeredLanguagePromises.set(language, languagePromise);
  return languagePromise;
};

const loadFullBuild = (): Promise<HLJSApi> => {
  fullBuildPromise ??= import("highlight.js").then((module) => module.default);
  return fullBuildPromise;
};

export const highlightCode = async (code: string, language: string): Promise<string> => {
  const normalizedLanguage = language.trim().toLowerCase();
  if (isPlainTextLanguage(normalizedLanguage)) {
    return escapeHtml(code);
  }

  const canonicalLanguage =
    languageAliases[normalizedLanguage] ??
    (Object.hasOwn(commonLanguageLoaders, normalizedLanguage) ? (normalizedLanguage as CommonLanguage) : undefined);

  const hljs = canonicalLanguage ? await loadCommonLanguage(canonicalLanguage) : await loadFullBuild();
  const languageToHighlight = canonicalLanguage ?? normalizedLanguage;
  if (!hljs.getLanguage(languageToHighlight)) {
    return escapeHtml(code);
  }

  return hljs.highlight(code, { language: languageToHighlight }).value;
};
