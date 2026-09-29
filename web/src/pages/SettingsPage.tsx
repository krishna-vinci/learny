// `/settings` (T9c): models-per-role config + service health, per
// docs/plans/2026-09-29-m1-sources-to-notes.md "T9c Settings".
import type { ServiceHealth } from "@studium/shared";
import { useQueryClient } from "@tanstack/react-query";
import { LogOutIcon, RefreshCwIcon, TriangleAlertIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "react-hot-toast";
import { ApiError, api } from "@/api/client";
import { queryKeys, useSettings } from "@/api/queries";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { groupModelsByProvider } from "./settings-utils";
import { useSignOut } from "./useSignOut";

interface RoleInfo {
  key: string;
  label: string;
  description: string;
  later?: boolean;
}

const ROLES: RoleInfo[] = [
  { key: "tutor", label: "Tutor", description: "Chat & note edits" },
  { key: "librarian", label: "Librarian", description: "Summarizes sources" },
  { key: "drafter", label: "Drafter", description: "Writes chapters" },
  { key: "checker", label: "Checker", description: "Fact-checks chapters on a different model" },
  { key: "cardsmith", label: "Cardsmith", description: "Flashcards (M2)", later: true },
  { key: "critic", label: "Critic", description: "Flashcards (M2)", later: true },
  { key: "scout", label: "Scout", description: "Finds sources", later: true },
  { key: "outliner", label: "Outliner", description: "Plans curricula", later: true },
];

const SELECT_CLASSES = cn(
  "h-11 w-full min-w-0 rounded-md border border-border bg-transparent px-3 text-base shadow-xs",
  "transition-[color,box-shadow] disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50",
  "md:h-8 md:text-sm",
);

interface Draft {
  default: string;
  roles: Record<string, string>;
}

function draftsEqual(a: Draft, b: Draft): boolean {
  if (a.default !== b.default) return false;
  const aKeys = Object.keys(a.roles).filter((k) => a.roles[k]);
  const bKeys = Object.keys(b.roles).filter((k) => b.roles[k]);
  if (aKeys.length !== bKeys.length) return false;
  return aKeys.every((k) => a.roles[k] === b.roles[k]);
}

function ModelSelect({
  id,
  value,
  onChange,
  groups,
  allowUnset,
  disabled,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  groups: { provider: string; models: string[] }[];
  allowUnset?: boolean;
  disabled?: boolean;
}) {
  return (
    <select
      id={id}
      className={SELECT_CLASSES}
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
    >
      {allowUnset && <option value="">uses default</option>}
      {groups.map((group) => (
        <optgroup key={group.provider} label={group.provider}>
          {group.models.map((model) => (
            <option key={model} value={model}>
              {model}
            </option>
          ))}
        </optgroup>
      ))}
    </select>
  );
}

function ServiceRow({ service }: { service: ServiceHealth }) {
  return (
    <li className="flex min-h-11 items-center gap-3 border-b border-border/70 py-2 last:border-b-0">
      <span
        className={cn("size-2.5 shrink-0 rounded-full", service.ok ? "bg-success" : "bg-destructive")}
        aria-hidden="true"
      />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2">
          <span className="truncate font-medium text-foreground">{service.name}</span>
          <span className="text-2xs uppercase tracking-wide text-muted-foreground/70">{service.kind}</span>
        </div>
        <p className="truncate text-sm text-muted-foreground">{service.detail}</p>
      </div>
      {service.tools != null && (
        <span className="shrink-0 text-2xs tabular-nums text-muted-foreground/70">{service.tools} tools</span>
      )}
    </li>
  );
}

function SettingsPage() {
  const { data, isLoading, isError, refetch, isFetching } = useSettings();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const seededFor = useRef<string | null>(null);
  const { signOut, signingOut } = useSignOut();

  useEffect(() => {
    if (!data) return;
    // Re-seed whenever the server's own model config changes under us (e.g. after a
    // successful save), but never clobber in-flight, unsaved edits.
    const signature = JSON.stringify(data.models);
    if (seededFor.current === signature) return;
    seededFor.current = signature;
    setDraft({ default: data.models.default, roles: { ...data.models.roles } });
  }, [data]);

  if (isLoading) {
    return <div className="p-6 text-sm text-muted-foreground">Loading settings…</div>;
  }
  if (isError || !data || !draft) {
    return <div className="p-6 text-sm text-destructive">Failed to load settings.</div>;
  }

  const groups = groupModelsByProvider(data.available);
  const dirty = !draftsEqual(draft, { default: data.models.default, roles: data.models.roles });

  function setRoleValue(role: string, value: string) {
    setDraft((prev) => {
      if (!prev) return prev;
      const roles = { ...prev.roles };
      if (value) roles[role] = value;
      else delete roles[role];
      return { ...prev, roles };
    });
  }

  async function handleSave() {
    if (!draft) return;
    setSaving(true);
    try {
      const result = await api.settings.saveModels(draft);
      queryClient.setQueryData(queryKeys.settings, result);
      toast.success("Saved");
    } catch (err) {
      if (err instanceof ApiError) {
        toast.error(err.message);
      } else {
        toast.error("Failed to save settings.");
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-6 md:px-6">
      <h1 className="text-lg font-semibold text-foreground">Settings</h1>

      {data.warnings.length > 0 && (
        <div className="mt-4 flex items-start gap-2 rounded-md border border-warning/40 bg-warning/10 px-3 py-2.5 text-sm text-warning-foreground">
          <TriangleAlertIcon className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden="true" />
          <ul className="min-w-0 flex-1 space-y-1">
            {data.warnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        </div>
      )}

      <section className="mt-6">
        <h2 className="text-sm font-semibold text-foreground">Models</h2>
        <div className="mt-3 flex flex-col gap-4">
          <div className="rounded-md border border-border/70 p-3">
            <label htmlFor="settings-model-default" className="block font-medium text-foreground">
              Default
            </label>
            <p className="mt-0.5 text-sm text-muted-foreground">Used by any role without its own model.</p>
            <div className="mt-2">
              <ModelSelect
                id="settings-model-default"
                value={draft.default}
                onChange={(value) => setDraft((prev) => (prev ? { ...prev, default: value } : prev))}
                groups={groups}
              />
            </div>
          </div>

          {ROLES.map((role) => (
            <div key={role.key} className="rounded-md border border-border/70 p-3">
              <label
                htmlFor={`settings-model-${role.key}`}
                className="flex items-baseline gap-2 font-medium text-foreground"
              >
                {role.label}
                {role.later && (
                  <span className="rounded-full bg-muted px-1.5 py-0.5 text-2xs font-normal uppercase tracking-wide text-muted-foreground">
                    later
                  </span>
                )}
              </label>
              <p className="mt-0.5 text-sm text-muted-foreground">{role.description}</p>
              <div className="mt-2">
                <ModelSelect
                  id={`settings-model-${role.key}`}
                  value={draft.roles[role.key] ?? ""}
                  onChange={(value) => setRoleValue(role.key, value)}
                  groups={groups}
                  allowUnset
                />
              </div>
            </div>
          ))}
        </div>

        <div className="mt-4 flex justify-end">
          <Button className="h-11 w-full md:h-9 md:w-auto" disabled={!dirty || saving} onClick={handleSave}>
            {saving ? "Saving…" : "Save"}
          </Button>
        </div>
      </section>

      <section className="mt-8">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-foreground">Services</h2>
          <Button variant="outline" size="sm" className="h-11 md:h-7" onClick={() => refetch()} disabled={isFetching}>
            <RefreshCwIcon className={cn("size-3.5", isFetching && "animate-spin")} aria-hidden="true" />
            Refresh
          </Button>
        </div>
        <ul className="mt-3 rounded-md border border-border/70 px-3">
          {data.services.length === 0 && (
            <li className="py-2 text-sm text-muted-foreground">No services configured.</li>
          )}
          {data.services.map((service) => (
            <ServiceRow key={service.name} service={service} />
          ))}
        </ul>
      </section>

      <section className="mt-8">
        <h2 className="text-sm font-semibold text-foreground">Account</h2>
        <Button
          variant="outline"
          className="mt-3 h-11 w-full justify-start md:w-auto"
          onClick={() => void signOut()}
          disabled={signingOut}
        >
          <LogOutIcon className="size-4" aria-hidden="true" />
          {signingOut ? "Signing out…" : "Sign out"}
        </Button>
      </section>
    </div>
  );
}

export default SettingsPage;
