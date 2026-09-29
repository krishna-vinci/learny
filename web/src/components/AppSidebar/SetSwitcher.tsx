// Modeled on Memos' SpaceSwitcher.tsx (MIT) — https://github.com/usememos/memos
// Memos switches between Spaces via a Popover + Select tied to SpaceContext; Studium
// has one flat list of study sets, so this is a single DropdownMenu over GET /api/sets.
import { ChevronsUpDownIcon, LibraryBigIcon, PlusIcon } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useSets } from "@/api/queries";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { NewSetDialog } from "../NewSetDialog";
import { sidebarSurfaceVariants } from "./sidebar-layout";

interface Props {
  currentSet?: string;
  className?: string;
}

function SetSwitcher({ currentSet, className }: Props) {
  const navigate = useNavigate();
  const { data: sets = [] } = useSets();
  const selected = sets.find((set) => set.slug === currentSet);
  const label = selected?.title ?? currentSet ?? "Select a set";
  const [newSetOpen, setNewSetOpen] = useState(false);

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          aria-label={`Switch study set: ${label}`}
          title={label}
          className={cn(
            "text-start transition-colors hover:bg-sidebar-accent/65 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/40",
            sidebarSurfaceVariants({ role: "headerBrand" }),
            className,
          )}
        >
          <span className="flex size-6 shrink-0 items-center justify-center">
            <LibraryBigIcon className="size-4 text-muted-foreground" strokeWidth={1.8} />
          </span>
          <span data-sidebar-label className="min-w-0 flex-1 truncate text-[15px] font-semibold leading-5">
            {label}
          </span>
          <ChevronsUpDownIcon
            aria-hidden="true"
            className="size-3 shrink-0 text-muted-foreground/70"
            strokeWidth={1.8}
          />
        </DropdownMenuTrigger>
        <DropdownMenuContent className="w-[min(15rem,calc(100vw-1rem))]">
          {sets.length === 0 && <div className="px-2 py-1.5 text-sm text-muted-foreground">No study sets yet</div>}
          {sets.map((set) => (
            <DropdownMenuItem key={set.slug} onSelect={() => navigate(`/s/${set.slug}`)}>
              <span className="min-w-0 flex-1 truncate">{set.title}</span>
              {set.slug === currentSet && <span className="text-xs text-muted-foreground">current</span>}
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => setNewSetOpen(true)}>
            <PlusIcon className="size-3.5 text-muted-foreground" aria-hidden="true" />
            <span className="min-w-0 flex-1 truncate">New study set…</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <NewSetDialog open={newSetOpen} onOpenChange={setNewSetOpen} />
    </>
  );
}

export default SetSwitcher;
