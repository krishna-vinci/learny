// Plain react-markdown renderer for assistant chat messages. Kept as its own small
// component so it can later be swapped for the Reader's MarkdownView (Task 8) without
// touching the rest of ChatDock.
import "katex/dist/katex.min.css";
import ReactMarkdown from "react-markdown";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";

interface MessageMarkdownProps {
  text: string;
}

function MessageMarkdown({ text }: MessageMarkdownProps) {
  return (
    <div className="studium-prose studium-prose-compact min-w-0 break-words">
      <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex]}>
        {text}
      </ReactMarkdown>
    </div>
  );
}

export default MessageMarkdown;
