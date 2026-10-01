// Adapted from Memos (MIT) — https://github.com/usememos/memos
import { isValidElement, type ReactElement, type ReactNode } from "react";

/**
 * Extracts code content from a react-markdown code element.
 * Handles the nested structure where code is passed as children.
 */
export const extractCodeContent = (children: ReactNode): string => {
  const codeElement = isValidElement(children) ? (children as ReactElement<{ children?: ReactNode }>) : null;
  return String(codeElement?.props.children || "").replace(/\n$/, "");
};

/**
 * Extracts the language identifier from a code block's className.
 * react-markdown uses the format "language-xxx" for code blocks.
 */
export const extractLanguage = (className: string): string => {
  const match = /language-([\w-]+)/.exec(className);
  return match?.[1] ?? "";
};
