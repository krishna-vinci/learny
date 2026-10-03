import type { EditorView } from "@codemirror/view";
import {
  BoldIcon,
  CodeIcon,
  Heading1Icon,
  ItalicIcon,
  LinkIcon,
  ListIcon,
  MessageSquareIcon,
  PlusIcon,
  QuoteIcon,
  SigmaIcon,
} from "lucide-react";
import { useEffect, useState } from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import type { CalloutName, FormattingCommand } from "./formatting";
import { runFormattingCommand } from "./formatting";

/** The on-screen keyboard's inset below the toolbar, so a phone keeps it above the
 * keyboard instead of under it (`window.visualViewport` reports the keyboard-shrunk
 * viewport; its gap from `window.innerHeight` is the keyboard height). 0 on desktop,
 * where there's no soft keyboard to dodge. */
function useKeyboardInset(): number {
  const [inset, setInset] = useState(0);
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const update = () => setInset(Math.max(0, window.innerHeight - vv.height - vv.offsetTop));
    update();
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    return () => {
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
    };
  }, []);
  return inset;
}

const buttonClass =
  "inline-flex h-11 min-w-11 shrink-0 items-center justify-center rounded-md text-foreground hover:bg-accent md:h-8 md:min-w-8 focus-visible:outline-2 focus-visible:outline-ring";

function ToolbarButton({ label, icon, onClick }: { label: string; icon: React.ReactNode; onClick: () => void }) {
  return (
    <button type="button" aria-label={label} title={label} className={buttonClass} onClick={onClick}>
      {icon}
    </button>
  );
}

function ToolbarMenu({
  label,
  icon,
  items,
}: {
  label: string;
  icon: React.ReactNode;
  items: { label: string; onClick: () => void }[];
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger aria-label={label} title={label} className={buttonClass}>
        {icon}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        {items.map((item) => (
          <DropdownMenuItem key={item.label} className="min-h-11 md:min-h-0" onClick={item.onClick}>
            {item.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

const CALLOUT_LABELS: Record<CalloutName, string> = {
  definition: "Definition",
  theorem: "Theorem",
  example: "Example",
  deeper: "Go deeper",
};

/** The note editor's one-row formatting toolbar. Buttons run `formatting.ts` commands on
 * the live CodeMirror view and refocus it. Phones: fixed to the bottom of the overlay,
 * above the on-screen keyboard (`useKeyboardInset`) and `env(safe-area-inset-bottom)`.
 * Desktop (≥768px): a static row under the header, back in the normal flow. */
export function Toolbar({
  view,
  className,
  showMarkdown,
  onToggleShowMarkdown,
}: {
  view: EditorView | null;
  className?: string;
  /** Whether live preview (items 2–4: hidden markup, math/citation/visual widgets) is off,
   * showing raw markdown instead. Item 1's styling stays either way. */
  showMarkdown?: boolean;
  onToggleShowMarkdown?: () => void;
}) {
  const keyboardInset = useKeyboardInset();

  function run(command: FormattingCommand, calloutName?: CalloutName) {
    if (!view) return;
    runFormattingCommand(view, command, { calloutName });
    view.focus();
  }

  return (
    <div
      className={cn(
        "fixed inset-x-0 bottom-0 z-10 flex shrink-0 items-center gap-1 overflow-x-auto border-t border-border/70 bg-background px-2 py-1",
        "md:static md:inset-auto md:border-t-0 md:border-b md:px-1 md:py-1",
        className,
      )}
      style={{ paddingBottom: `calc(env(safe-area-inset-bottom, 0px) + ${keyboardInset}px)` }}
    >
      <ToolbarButton label="Bold" icon={<BoldIcon className="size-4" />} onClick={() => run("bold")} />
      <ToolbarButton label="Italic" icon={<ItalicIcon className="size-4" />} onClick={() => run("italic")} />
      <ToolbarMenu
        label="Heading"
        icon={<Heading1Icon className="size-4" />}
        items={[
          { label: "Heading 1", onClick: () => run("heading1") },
          { label: "Heading 2", onClick: () => run("heading2") },
          { label: "Heading 3", onClick: () => run("heading3") },
        ]}
      />
      <ToolbarMenu
        label="List"
        icon={<ListIcon className="size-4" />}
        items={[
          { label: "Bullet list", onClick: () => run("bulletList") },
          { label: "Numbered list", onClick: () => run("orderedList") },
          { label: "Task list", onClick: () => run("taskList") },
        ]}
      />
      <ToolbarButton label="Link" icon={<LinkIcon className="size-4" />} onClick={() => run("link")} />
      <ToolbarMenu
        label="Math"
        icon={<SigmaIcon className="size-4" />}
        items={[
          { label: "Inline math", onClick: () => run("inlineMath") },
          { label: "Display math", onClick: () => run("displayMath") },
        ]}
      />
      <ToolbarButton label="Citation" icon={<QuoteIcon className="size-4" />} onClick={() => run("citation")} />
      <ToolbarMenu
        label="Callout"
        icon={<MessageSquareIcon className="size-4" />}
        items={(Object.keys(CALLOUT_LABELS) as CalloutName[]).map((name) => ({
          label: CALLOUT_LABELS[name],
          onClick: () => run("callout", name),
        }))}
      />
      <ToolbarMenu
        label="Insert"
        icon={<PlusIcon className="size-4" />}
        items={[
          { label: "Visual", onClick: () => run("visual") },
          { label: "YouTube moment", onClick: () => run("youtube") },
          { label: "Table", onClick: () => run("table") },
        ]}
      />
      {onToggleShowMarkdown && (
        <button
          type="button"
          aria-label="Show markdown"
          aria-pressed={!!showMarkdown}
          title="Show markdown"
          className={cn(buttonClass, "ms-auto", showMarkdown && "bg-accent text-accent-foreground")}
          onClick={onToggleShowMarkdown}
        >
          <CodeIcon className="size-4" />
        </button>
      )}
    </div>
  );
}
