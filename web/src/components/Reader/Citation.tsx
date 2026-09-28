// Studium-specific citation tooltip for footnotes shaped like `[^src:<id>#p<n>]`. Not derived
// from Memos, which has no equivalent syntax.
import type { ReactNode } from "react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

export function Citation({ src, page, children }: { src: string; page: string; children?: ReactNode }) {
  const label = `${src}, p.${page}`;
  return (
    <TooltipProvider>
      <Tooltip>
        {/* `title` is a plain-HTML fallback tooltip and keeps the label queryable without
            simulating hover; TooltipContent below renders the richer on-hover popup. */}
        <TooltipTrigger render={<sup className="citation-ref cursor-help" title={label} />}>{children}</TooltipTrigger>
        <TooltipContent>{label}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
