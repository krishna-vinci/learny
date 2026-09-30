// Plain react-markdown renderer for assistant chat messages. Kept as its own small
// component so it can later be swapped for the Reader's MarkdownView (Task 8) without
// touching the rest of ChatDock.
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import { hasMath, useKatex } from "@/lib/katex-loader";

interface MessageMarkdownProps {
  text: string;
}

function MessageMarkdown({ text }: MessageMarkdownProps) {
  const math = hasMath(text);
  const katex = useKatex(math);
  return (
    <div className="studium-prose studium-prose-compact min-w-0 break-words">
      <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={katex ? [katex] : []}>
        {text}
      </ReactMarkdown>
    </div>
  );
}

export default MessageMarkdown;
