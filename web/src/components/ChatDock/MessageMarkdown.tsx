// Chat keeps media as links and resolves the same source citation syntax as notes.
import { Children, isValidElement, type ReactNode, useEffect, useId, useMemo, useState } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkDirective from "remark-directive";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import { NoteImage } from "@/components/Reader/NoteImage";
import { remarkStudiumDirectives } from "@/components/Reader/remarkStudium";
import { RenderBoundary } from "@/components/RenderBoundary";
import { hasMath, useKatex } from "@/lib/katex-loader";

const SOURCE_LABEL = /^src:([a-z0-9][a-z0-9_-]*)(?:#([^\s]+))?$/i;

function withSourceDefinitions(text: string): string {
  // GFM only recognises a reference when its definition exists. Tutor replies often
  // omit definitions; do not turn syntax examples inside code into live citations.
  const prose = text.replace(
    /(^|\n)[ \t]{0,3}(`{3,}|~{3,})[^\n]*\n[\s\S]*?(?:\n[ \t]{0,3}\2[^\n]*(?=\n|$)|$)|`+[^`\n]*`+/g,
    "",
  );
  const defined = new Set([...prose.matchAll(/^\[\^([^\]\n]+)\]:/gm)].map((match) => match[1]?.toLowerCase()));
  const missing = new Map<string, string>();
  for (const match of prose.matchAll(/\[\^([^\]\n]+)\]/g)) {
    const label = match[1] ?? "";
    const source = SOURCE_LABEL.exec(label);
    if (source && !defined.has(label.toLowerCase()))
      missing.set(
        label.toLowerCase(),
        `[${source[1]}](/library/${encodeURIComponent(source[1] ?? "")})${source[2] ? ` (${source[2]})` : ""}`,
      );
  }
  return `${text}\n\n${[...missing].map(([label, definition]) => `[^${label}]: ${definition}`).join("\n")}`;
}

interface CitationNode {
  type: string;
  identifier?: string;
  label?: string;
  children?: CitationNode[];
  data?: { hProperties?: Record<string, unknown> };
}

function remarkChatCitations() {
  return function tag(node: CitationNode): void {
    if (node.type === "footnoteReference") {
      const source = SOURCE_LABEL.exec(node.label ?? node.identifier ?? "");
      if (source) {
        node.data ??= {};
        node.data.hProperties = { "data-citation-src": source[1], "data-citation-locator": source[2] ?? "" };
      }
    }
    for (const child of node.children ?? []) tag(child);
  };
}

function SourceLink({ src, href }: { src: string; href: string }) {
  const [title, setTitle] = useState(src);
  useEffect(() => {
    const controller = new AbortController();
    void fetch(`/api/library/${encodeURIComponent(src)}`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) return;
        const data = (await response.json()) as { source?: { title?: string } };
        if (typeof data.source?.title === "string" && !controller.signal.aborted) setTitle(data.source.title);
      })
      .catch(() => {});
    return () => controller.abort();
  }, [src]);
  return <a href={href}>{title}</a>;
}

interface MessageMarkdownProps {
  text: string;
  notePath?: string;
}

function MessageMarkdown({ text, notePath }: MessageMarkdownProps) {
  const math = hasMath(text);
  const { plugin: katex } = useKatex(math);
  const footnotePrefix = `chat-${useId()}-`;
  const components = useMemo<Components>(
    () => ({
      img: ({ node: _node, ...props }) => <NoteImage {...props} notePath={notePath} localOnly />,
      sup: ({ children, node: _node, ...props }) => {
        const attributes = props as Record<string, unknown>;
        const src = attributes["data-citation-src"];
        if (typeof src !== "string") return <sup {...props}>{children}</sup>;
        const marker = Children.map(children, (child) =>
          isValidElement<{ children?: ReactNode }>(child) ? child.props.children : child,
        );
        return (
          <sup className="citation-ref">
            <a
              href={`/library/${encodeURIComponent(src)}`}
              title={`${src}${attributes["data-citation-locator"] ? `, ${attributes["data-citation-locator"]}` : ""}`}
            >
              {marker}
            </a>
          </sup>
        );
      },
      a: ({ node, children, href, ...props }) => {
        if (node?.properties.dataFootnoteBackref !== undefined) return null;
        const src = href?.match(/^\/library\/([a-z0-9][a-z0-9_-]*)$/i)?.[1];
        if (src && children === src) return <SourceLink src={src} href={href ?? ""} />;
        return (
          <a {...props} href={href}>
            {children}
          </a>
        );
      },
      section: ({ node, ...props }) => (
        <section
          {...props}
          className={
            node?.properties.dataFootnotes !== undefined
              ? "mt-3 border-t border-border/70 pt-2 text-xs [&_li]:my-1 [&_p]:my-0"
              : undefined
          }
        />
      ),
    }),
    [notePath],
  );
  return (
    <div className="studium-prose studium-prose-compact min-w-0 break-words">
      <RenderBoundary fallbackText={text} resetKey={text}>
        <ReactMarkdown
          remarkPlugins={[
            remarkGfm,
            remarkMath,
            remarkDirective,
            [remarkStudiumDirectives, { plainLinks: true, notePath }],
            remarkChatCitations,
          ]}
          remarkRehypeOptions={{
            clobberPrefix: footnotePrefix,
            footnoteLabel: "Sources",
            footnoteLabelProperties: { className: ["text-xs", "font-medium"] },
          }}
          rehypePlugins={katex ? [katex] : []}
          components={components}
        >
          {withSourceDefinitions(text)}
        </ReactMarkdown>
      </RenderBoundary>
    </div>
  );
}

export default MessageMarkdown;
