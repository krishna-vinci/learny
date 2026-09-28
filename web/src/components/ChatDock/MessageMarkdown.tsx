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
    <div
      className={
        "min-w-0 break-words text-sm leading-relaxed " +
        "[&_p]:my-2 [&_p:first-child]:mt-0 [&_p:last-child]:mb-0 " +
        "[&_ul]:my-2 [&_ol]:my-2 [&_li]:my-0.5 [&_ul]:ps-5 [&_ol]:ps-5 [&_ul]:list-disc [&_ol]:list-decimal " +
        "[&_pre]:my-2 [&_pre]:overflow-x-auto [&_pre]:rounded-md [&_pre]:bg-muted [&_pre]:p-2 [&_pre]:text-xs " +
        "[&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_code]:py-0.5 [&_code]:text-xs [&_pre_code]:bg-transparent [&_pre_code]:p-0 " +
        "[&_a]:text-primary [&_a]:underline [&_blockquote]:my-2 [&_blockquote]:border-s-2 [&_blockquote]:border-border [&_blockquote]:ps-3 [&_blockquote]:text-muted-foreground"
      }
    >
      <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex]}>
        {text}
      </ReactMarkdown>
    </div>
  );
}

export default MessageMarkdown;
