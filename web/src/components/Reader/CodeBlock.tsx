// Adapted from Memos (MIT) — https://github.com/usememos/memos
import { CheckIcon, CopyIcon } from "lucide-react";
import { isValidElement, type ReactElement, type ReactNode, useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { escapeHtml, highlightCode, isPlainTextLanguage } from "./highlight";
import { MermaidBlock } from "./MermaidBlock";
import { extractCodeContent, extractLanguage } from "./utils";

interface CodeBlockProps {
  children?: ReactNode;
  className?: string;
  node?: unknown;
}

export const CodeBlock = ({ children, className, node: _node, ...props }: CodeBlockProps) => {
  const codeElement = isValidElement(children) ? (children as ReactElement<{ className?: string }>) : null;
  const codeClassName = codeElement?.props.className || "";
  const codeContent = extractCodeContent(children);
  const language = extractLanguage(codeClassName);

  // If it's a mermaid block, render with MermaidBlock component.
  if (language === "mermaid") {
    return (
      <pre className="relative">
        <MermaidBlock className={cn(className)} {...props}>
          {children}
        </MermaidBlock>
      </pre>
    );
  }

  // Keying on the inputs remounts the block when they change, so highlight state can never be
  // shown against a different code content.
  return <HighlightedCodeBlock key={`${language}\u0000${codeContent}`} codeContent={codeContent} language={language} />;
};

interface HighlightedCodeBlockProps {
  codeContent: string;
  language: string;
}

const HighlightedCodeBlock = ({ codeContent, language }: HighlightedCodeBlockProps) => {
  const [copied, setCopied] = useState(false);
  const [highlightedCode, setHighlightedCode] = useState<string>();
  const renderedCode = highlightedCode ?? escapeHtml(codeContent);

  useEffect(() => {
    if (isPlainTextLanguage(language)) {
      // The escaped fallback already is the final output; skip the async round-trip.
      return;
    }

    let cancelled = false;

    void highlightCode(codeContent, language)
      .then((value) => {
        if (!cancelled) {
          setHighlightedCode(value);
        }
      })
      .catch(() => {
        // Keep the escaped plain-text fallback when a language chunk cannot load.
      });

    return () => {
      cancelled = true;
    };
  }, [codeContent, language]);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(codeContent);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error("Failed to copy code:", err);
    }
  };

  return (
    <pre className="relative my-2 overflow-hidden rounded-lg border border-border bg-muted/20">
      <div className="flex items-center justify-between border-b border-border bg-muted/30 px-2 py-1">
        <span className="select-none text-xs text-foreground">{language || "text"}</span>
        <button
          type="button"
          onClick={handleCopy}
          className={cn(
            "inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs",
            "transition-colors duration-200",
            "hover:bg-accent active:scale-95",
            copied ? "text-primary" : "text-muted-foreground hover:text-foreground",
          )}
          aria-label={copied ? "Copied" : "Copy code"}
          title={copied ? "Copied!" : "Copy code"}
        >
          {copied ? (
            <>
              <CheckIcon className="h-3.5 w-3.5" />
              <span>Copied</span>
            </>
          ) : (
            <>
              <CopyIcon className="h-3.5 w-3.5" />
              <span>Copy</span>
            </>
          )}
        </button>
      </div>

      <div className="overflow-x-auto">
        <code
          className={cn("block px-3 py-2 text-sm leading-relaxed", `language-${language}`)}
          // The highlighted output is from highlight.js against this block's own code content
          // (escaped as a fallback before highlighting resolves), not raw untrusted HTML.
          // biome-ignore lint/security/noDangerouslySetinnerHTML: highlight.js-produced markup or the escaped fallback.
          dangerouslySetInnerHTML={{ __html: renderedCode }}
        />
      </div>
    </pre>
  );
};
