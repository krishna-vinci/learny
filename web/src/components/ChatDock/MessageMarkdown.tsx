// Plain react-markdown renderer for assistant chat messages. Kept as its own small
// component so it can later be swapped for the Reader's MarkdownView (Task 8) without
// touching the rest of ChatDock.
import ReactMarkdown from "react-markdown";
import remarkDirective from "remark-directive";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import { NoteImage } from "@/components/Reader/NoteImage";
import { remarkStudiumDirectives } from "@/components/Reader/remarkStudium";
import { RenderBoundary } from "@/components/RenderBoundary";
import { hasMath, useKatex } from "@/lib/katex-loader";

interface MessageMarkdownProps {
  text: string;
  notePath?: string;
}

function MessageMarkdown({ text, notePath }: MessageMarkdownProps) {
  const math = hasMath(text);
  const { plugin: katex } = useKatex(math);
  return (
    <div className="studium-prose studium-prose-compact min-w-0 break-words">
      <RenderBoundary fallbackText={text} resetKey={text}>
        <ReactMarkdown
          remarkPlugins={[
            remarkGfm,
            remarkMath,
            remarkDirective,
            [remarkStudiumDirectives, { plainLinks: true, notePath }],
          ]}
          rehypePlugins={katex ? [katex] : []}
          components={{ img: ({ node: _node, ...props }) => <NoteImage {...props} notePath={notePath} localOnly /> }}
        >
          {text}
        </ReactMarkdown>
      </RenderBoundary>
    </div>
  );
}

export default MessageMarkdown;
