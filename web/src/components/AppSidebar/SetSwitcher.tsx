// Modeled on Memos' SpaceSwitcher.tsx (MIT) — https://github.com/usememos/memos
// Memos switches between Spaces via a Popover + Select tied to SpaceContext; Studium
// has one flat list of study sets. Desktop gets a DropdownMenu (acts as a popover) with
// every set and a checkmark on the current one; on the phone the same control is a plain
// link to `/sets` (the full "All study sets" page) — easier to hit with a thumb than a
// popup anchored to the top-left corner, and explicitly one of the two mobile patterns
// this was designed around.
import { CheckIcon, ChevronsUpDownIcon, LibraryBigIcon, PlusIcon } from "lucide-react";
import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useSets } from "@/api/queries";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import { cn } from "@/lib/utils";
import { NewSetDialog } from "../NewSetDialog";
import { sidebarSurfaceVariants } from "./sidebar-layout";

const DESKTOP_QUERY = "(min-width: 768px)";

interface Props {
  currentSet?: string;
  className?: string;
}

const triggerClasses = (className?: string) =>
  cn(
    "text-start transition-colors hover:bg-sidebar-accent/65 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/40",
    sidebarSurfaceVariants({ role: "headerBrand" }),
    className,
  );

function SetSwitcher({ currentSet, className }: Props) {
  const navigate = useNavigate();
  const isDesktop = useMediaQuery(DESKTOP_QUERY);
  const { data: sets = [] } = useSets();
  const selected = sets.find((set) => set.slug === currentSet);
  const label = selected?.title ?? currentSet ?? "Select a set";
  const [newSetOpen, setNewSetOpen] = useState(false);

  const brand = (
    <>
      <span className="flex size-6 shrink-0 items-center justify-center">
        <LibraryBigIcon className="size-4 text-muted-foreground" strokeWidth={1.8} />
      </span>
      <span data-sidebar-label className="min-w-0 flex-1 truncate text-[15px] font-semibold leading-5">
        {label}
      </span>
      <ChevronsUpDownIcon aria-hidden="true" className="size-3 shrink-0 text-muted-foreground/70" strokeWidth={1.8} />
    </>
  );

  if (!isDesktop) {
    return (
      <Link to="/sets" aria-label={`Switch study set: ${label}`} title={label} className={triggerClasses(className)}>
        {brand}
      </Link>
    );
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          aria-label={`Switch study set: ${label}`}
          title={label}
          className={triggerClasses(className)}
        >
          {brand}
        </DropdownMenuTrigger>
        <DropdownMenuContent className="w-[min(15rem,calc(100vw-1rem))]">
          {sets.length === 0 && <div className="px-2 py-1.5 text-sm text-muted-foreground">No study sets yet</div>}
          {sets.map((set) => (
            <DropdownMenuItem key={set.slug} onClick={() => navigate(`/s/${set.slug}`)}>
              <span className="min-w-0 flex-1 truncate">{set.title}</span>
              {set.slug === currentSet && <CheckIcon className="size-3.5 shrink-0 text-primary" aria-hidden="true" />}
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => navigate("/sets")}>
            <LibraryBigIcon className="size-3.5 text-muted-foreground" aria-hidden="true" />
            <span className="min-w-0 flex-1 truncate">All study sets</span>
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => setNewSetOpen(true)}>
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
