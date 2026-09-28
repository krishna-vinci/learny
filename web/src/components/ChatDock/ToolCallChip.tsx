import { ChevronDownIcon } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";
import type { StreamingToolCall } from "./reducer";

interface ToolCallChipProps {
  tool: StreamingToolCall;
}

/** A small collapsed chip for one tool call; expands to show its summary on click. */
function ToolCallChip({ tool }: ToolCallChipProps) {
  const [open, setOpen] = useState(false);
  const isError = tool.status === "done" && tool.isError;

  return (
    <div
      className={cn(
        "my-1 w-fit max-w-full rounded-md border text-2xs",
        isError
          ? "border-destructive/40 bg-destructive/10 text-destructive"
          : "border-border/70 bg-muted/50 text-muted-foreground",
      )}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-1 px-2 py-1 text-start"
      >
        <span className="font-medium">{tool.name}</span>
        {tool.status === "running" ? <span className="opacity-70">running…</span> : null}
        {tool.summary ? (
          <ChevronDownIcon className={cn("ms-auto size-3 transition-transform", open && "rotate-180")} />
        ) : null}
      </button>
      {open && tool.summary ? <div className="border-t border-border/50 px-2 py-1">{tool.summary}</div> : null}
    </div>
  );
}

export default ToolCallChip;
