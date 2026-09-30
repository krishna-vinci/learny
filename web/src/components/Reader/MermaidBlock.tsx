// Adapted from Memos (MIT) — https://github.com/usememos/memos
import { useEffect, useState } from "react";
import { useResolvedTheme } from "@/lib/reading-prefs";
import { cn } from "@/lib/utils";
import { extractCodeContent } from "./utils";

/** Mermaid ships its own themes; map Studium's resolved theme to the closest one — "dark"
 * for dark/black (both dark surfaces), "neutral" for sepia (works on a warm background
 * better than "default", which assumes white), "default" for light. */
function mermaidThemeFor(resolved: "light" | "dark" | "sepia" | "black"): "default" | "dark" | "neutral" {
  if (resolved === "dark" || resolved === "black") return "dark";
  if (resolved === "sepia") return "neutral";
  return "default";
}

interface MermaidBlockProps {
  children?: React.ReactNode;
  className?: string;
}

const formatErrorMessage = (err: unknown): string => {
  const msg = err instanceof Error ? err.message : "Failed to render diagram";
  if (/no diagram type detected/i.test(msg)) {
    return `${msg} — check that the diagram type is valid (e.g. sequenceDiagram, classDiagram, erDiagram)`;
  }
  return msg;
};

export const MermaidBlock = ({ children, className }: MermaidBlockProps) => {
  const [svg, setSvg] = useState<string>("");
  const [error, setError] = useState<string>("");
  const resolvedTheme = useResolvedTheme();

  const codeContent = extractCodeContent(children);

  useEffect(() => {
    if (!codeContent) {
      setSvg("");
      setError("");
      return;
    }

    let cancelled = false;

    const renderDiagram = async () => {
      try {
        const { default: mermaid } = await import("mermaid");
        // Text is measured against the final glyphs, so webfonts must be loaded first. The Font
        // Loading API is absent in some environments (jsdom).
        await document.fonts?.ready;
        if (cancelled) return;

        mermaid.initialize({
          startOnLoad: false,
          theme: mermaidThemeFor(resolvedTheme),
          securityLevel: "strict",
          fontFamily: getComputedStyle(document.body).fontFamily || "sans-serif",
          suppressErrorRendering: true,
        });

        // Re-initializing changes mermaid's *next* render, not any already-rendered SVG, so a
        // fresh id (rather than reusing one) avoids mermaid's own "diagram already rendered"
        // guard from skipping the re-render when the theme changes.
        const id = `mermaid-${Math.random().toString(36).substring(7)}`;
        const { svg: renderedSvg } = await mermaid.render(id, codeContent);
        if (cancelled) return;

        setSvg(renderedSvg);
        setError("");
      } catch (err) {
        if (cancelled) return;
        console.error("Failed to render mermaid diagram:", err);
        setSvg("");
        setError(formatErrorMessage(err));
      }
    };

    void renderDiagram();

    return () => {
      cancelled = true;
    };
  }, [codeContent, resolvedTheme]);

  if (error) {
    return (
      <div className="w-full">
        <div className="mb-2 whitespace-normal break-words text-sm text-destructive">Mermaid Error: {error}</div>
        <code className="language-mermaid block whitespace-pre text-sm">{codeContent}</code>
      </div>
    );
  }

  if (!svg) return null;

  return (
    <div
      className={cn("mermaid-diagram my-2 flex w-full items-center justify-center overflow-x-auto", className)}
      // Mermaid's SVG is generated locally from the note's own code fence, not remote/user HTML,
      // and is never passed through the rehype-sanitize pipeline used for the rest of the body.
      // biome-ignore lint/security/noDangerouslySetInnerHtml: locally rendered mermaid SVG.
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
};
