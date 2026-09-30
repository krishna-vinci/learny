// `/settings` and `/settings/:section` (M3a T6 slice a): Memos-style section layout.
// Desktop gets a left-hand section nav (like Memos' Setting.tsx sidebar); phone gets a
// section list that drills into one section at a time with a back button, since there's
// no room for a persistent side nav at 390px.
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import { Navigate, useNavigate, useParams } from "react-router-dom";
import { useCurrentUser } from "@/api/queries";
import {
  DEFAULT_SETTING_SECTION,
  isSettingSectionKey,
  SETTING_GROUP_LABELS,
  SETTINGS_SECTIONS,
  type SettingSectionDefinition,
  type SettingSectionGroup,
} from "@/components/Settings/settingSections";
import { Button } from "@/components/ui/button";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import { cn } from "@/lib/utils";

function SectionNavItem({
  section,
  active,
  onClick,
}: {
  section: SettingSectionDefinition;
  active: boolean;
  onClick: () => void;
}) {
  const Icon = section.icon;
  return (
    <button
      type="button"
      className={cn(
        "flex min-h-11 w-full items-center justify-between gap-2 rounded-md px-3 text-start text-sm transition-colors",
        active ? "bg-accent text-accent-foreground" : "text-foreground hover:bg-accent/60",
      )}
      onClick={onClick}
      aria-current={active ? "page" : undefined}
    >
      <span className="flex min-w-0 items-center gap-2.5">
        <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <span className="truncate">{section.label}</span>
      </span>
      <ChevronRightIcon className="size-4 shrink-0 text-muted-foreground/60 md:hidden" aria-hidden="true" />
    </button>
  );
}

const GROUP_ORDER: SettingSectionGroup[] = ["personal", "learning", "admin"];

/** The section list with a small heading per group (empty groups, e.g. Admin for members, are skipped). */
function GroupedNav({
  sections,
  activeKey,
  onOpen,
}: {
  sections: SettingSectionDefinition[];
  activeKey?: string;
  onOpen: (key: string) => void;
}) {
  return (
    <div className="flex flex-col gap-4">
      {GROUP_ORDER.map((group) => {
        const items = sections.filter((section) => section.group === group);
        if (items.length === 0) return null;
        return (
          <div key={group}>
            <h2 className="px-3 pb-1 text-2xs font-medium uppercase tracking-wide text-muted-foreground">
              {SETTING_GROUP_LABELS[group]}
            </h2>
            <div className="flex flex-col gap-0.5">
              {items.map((section) => (
                <SectionNavItem
                  key={section.key}
                  section={section}
                  active={section.key === activeKey}
                  onClick={() => onOpen(section.key)}
                />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function SettingsPage() {
  const params = useParams<{ section?: string }>();
  const navigate = useNavigate();
  const { user, isLoading } = useCurrentUser();
  const isDesktop = useMediaQuery("(min-width: 768px)");

  if (isLoading) return null;
  if (!user) return null; // AuthGate handles the redirect; avoid a flash of admin-only content.

  const isAdmin = user.role === "ADMIN";
  const visibleSections = SETTINGS_SECTIONS.filter((section) => section.scope === "basic" || isAdmin);
  const requested = params.section;
  const activeKey =
    requested && isSettingSectionKey(requested) && visibleSections.some((s) => s.key === requested)
      ? requested
      : undefined;

  // Desktop always shows nav + content; fall back to the default section for the index route.
  if (isDesktop) {
    const effectiveKey = activeKey ?? DEFAULT_SETTING_SECTION;
    const active = visibleSections.find((s) => s.key === effectiveKey) ?? visibleSections[0];
    const ActiveComponent = active?.component;
    return (
      <div className="mx-auto flex w-full max-w-5xl gap-8 px-6 py-8">
        <nav className="w-56 shrink-0">
          <GroupedNav
            sections={visibleSections}
            activeKey={effectiveKey}
            onOpen={(key) => navigate(`/settings/${key}`)}
          />
        </nav>
        <div className="min-w-0 flex-1">{ActiveComponent && <ActiveComponent />}</div>
      </div>
    );
  }

  // Phone: no section in the URL → the drill-in list. A section in the URL → its content
  // full-screen with a back button.
  if (!activeKey) {
    return (
      <div className="w-full px-4 py-4">
        <h1 className="mb-3 text-lg font-semibold text-foreground">Settings</h1>
        <GroupedNav sections={visibleSections} onOpen={(key) => navigate(`/settings/${key}`)} />
      </div>
    );
  }

  const active = visibleSections.find((s) => s.key === activeKey);
  if (!active) return <Navigate to="/settings" replace />;
  const ActiveComponent = active.component;

  return (
    <div className="w-full px-4 py-4">
      <Button variant="ghost" size="sm" className="mb-2 h-11 -ms-2 px-2" onClick={() => navigate("/settings")}>
        <ChevronLeftIcon className="size-4" aria-hidden="true" />
        Settings
      </Button>
      <ActiveComponent />
    </div>
  );
}

export default SettingsPage;
