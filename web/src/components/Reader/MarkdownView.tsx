// Adapted from Memos (MIT) — https://github.com/usememos/memos
// (MathMarkdownRenderer.tsx, MemoMarkdownRenderer.tsx, pipeline.ts, and index.tsx composed into
// one renderer for a whole note body: Memos' mention/tag/attachment/theme machinery is stripped,
// and Studium's directive callouts + source citations are added via remarkStudium.ts.)
// Slice C: no longer imports highlight.js/styles/github.css (light-only). The `.hljs-*`
// token colours are themed via CSS variables in index.css instead (see the "Code
// highlighting" block there).
import { type ComponentProps, memo } from "react";
import type { Components } from "react-markdown";
import ReactMarkdown from "react-markdown";
import rehypeSanitize from "rehype-sanitize";
import remarkDirective from "remark-directive";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import { RenderBoundary } from "@/components/RenderBoundary";
import { hasMath, useKatex } from "@/lib/katex-loader";
import { cn } from "@/lib/utils";
import { Citation } from "./Citation";
import { CodeBlock } from "./CodeBlock";
import { SANITIZE_SCHEMA } from "./constants";
import { Callout, Deeper } from "./Directives";
import { remarkStudiumCitations, remarkStudiumDirectives } from "./remarkStudium";
import { Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow } from "./Table";

type MarkdownRehypePlugins = NonNullable<ComponentProps<typeof ReactMarkdown>["rehypePlugins"]>;

export interface MarkdownViewProps {
  content: string;
  className?: string;
}

const asProps = (value: object): Record<string, unknown> => value as Record<string, unknown>;

const markdownComponents: Components = {
  // The only `<div>`s the pipeline ever produces are the ones remarkStudiumDirectives creates
  // for `:::definition`/`:::theorem`/`:::example`/`:::deeper` blocks (see that file) — note
  // bodies contain no raw HTML (rehype-raw is not in the pipeline).
  div: ({ children, node: _node, ...rest }) => {
    const props = asProps(rest);
    const callout = props["data-callout"];
    const rawTitle = props["data-title"];
    const title = typeof rawTitle === "string" ? rawTitle : undefined;
    if (typeof callout === "string") {
      return (
        <Callout name={callout} title={title}>
          {children}
        </Callout>
      );
    }
    if (props["data-deeper"] !== undefined) {
      return <Deeper title={title}>{children}</Deeper>;
    }
    return <div {...rest}>{children}</div>;
  },
  // Citations (`[^src:<id>#p<n>]`) are tagged by remarkStudiumCitations on the `<sup>` that
  // wraps the footnote-reference link (see that file for why `sup` and not `a`).
  sup: ({ children, node: _node, ...rest }) => {
    const props = asProps(rest);
    const src = props["data-citation-src"];
    const page = props["data-citation-page"];
    if (typeof src === "string" && typeof page === "string") {
      return (
        <Citation src={src} page={page}>
          {children}
        </Citation>
      );
    }
    return <sup {...rest}>{children}</sup>;
  },
  pre: CodeBlock,
  table: ({ children, node: _node, ...props }) => <Table {...props}>{children}</Table>,
  thead: ({ children, node: _node, ...props }) => <TableHead {...props}>{children}</TableHead>,
  tbody: ({ children, node: _node, ...props }) => <TableBody {...props}>{children}</TableBody>,
  tr: ({ children, node: _node, ...props }) => <TableRow {...props}>{children}</TableRow>,
  th: ({ children, node: _node, ...props }) => <TableHeaderCell {...props}>{children}</TableHeaderCell>,
  td: ({ children, node: _node, ...props }) => <TableCell {...props}>{children}</TableCell>,
};

function MarkdownViewComponent({ content, className }: MarkdownViewProps) {
  // KaTeX loads only for notes that contain math; others never pay for it.
  const math = hasMath(content);
  const katex = useKatex(math);
  const katexPlugins: MarkdownRehypePlugins = katex ? [katex] : [];
  if (math && !katex) return <div className={cn("studium-prose h-24 w-full", className)} aria-busy="true" />;
  return (
    <div className={cn("studium-prose w-full break-words text-foreground", className)}>
      <RenderBoundary fallbackText={content} resetKey={content}>
        <ReactMarkdown
          remarkPlugins={[remarkMath, remarkGfm, remarkDirective, remarkStudiumDirectives, remarkStudiumCitations]}
          rehypePlugins={[[rehypeSanitize, SANITIZE_SCHEMA], ...katexPlugins]}
          components={markdownComponents}
        >
          {content}
        </ReactMarkdown>
      </RenderBoundary>
    </div>
  );
}

/** Reusable renderer for a Studium note body — also used by the chat dock (Task 9) to render
 * assistant messages. */
export const MarkdownView = memo(
  MarkdownViewComponent,
  (previous, next) => previous.content === next.content && previous.className === next.className,
);
