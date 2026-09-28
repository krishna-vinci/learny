// Not present in Memos (which uses @base-ui/react); this is a small native equivalent
// that relies on the themed scrollbar rules in index.css.
import * as React from "react";
import { cn } from "@/lib/utils";

const ScrollArea = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, children, ...props }, ref) => (
    <div ref={ref} data-slot="scroll-area" className={cn("overflow-auto [scrollbar-width:thin]", className)} {...props}>
      {children}
    </div>
  ),
);
ScrollArea.displayName = "ScrollArea";

export { ScrollArea };
