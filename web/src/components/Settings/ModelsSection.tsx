// Pre-existing Settings content (T9c models-per-role config), moved here unchanged and
// wrapped in SettingSection so it fits the M3a Memos-style section layout.

import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { toast } from "react-hot-toast";
import { ApiError, api } from "@/api/client";
import { queryKeys, useSettings } from "@/api/queries";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { groupModelsByProvider } from "@/pages/settings-utils";
import SettingSection from "./SettingSection";

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
  { key: "examiner", label: "Examiner", description: "Generates quizzes and problems" },
  { key: "grader", label: "Grader", description: "Grades answers and teach-backs" },
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
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  groups: { provider: string; models: string[] }[];
  allowUnset?: boolean;
}) {
  return (
    <select id={id} className={SELECT_CLASSES} value={value} onChange={(e) => onChange(e.target.value)}>
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

const ModelsSection = () => {
  const { data, isLoading, isError } = useSettings();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const seededFor = useRef<string | null>(null);

  useEffect(() => {
    if (!data) return;
    const signature = JSON.stringify(data.models);
    if (seededFor.current === signature) return;
    seededFor.current = signature;
    setDraft({ default: data.models.default, roles: { ...data.models.roles } });
  }, [data]);

  if (isLoading || isError || !data || !draft) {
    return (
      <SettingSection title="Models">
        <p className={cn("text-sm", isError ? "text-destructive" : "text-muted-foreground")}>
          {isError ? "Failed to load settings." : "Loading…"}
        </p>
      </SettingSection>
    );
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
      toast.error(err instanceof ApiError ? err.message : "Failed to save settings.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <SettingSection
      title="Models"
      description="Which model each agent role uses."
      actions={
        <Button className="h-11 sm:h-8" disabled={!dirty || saving} onClick={() => void handleSave()}>
          {saving ? "Saving…" : "Save"}
        </Button>
      }
    >
      {data.warnings.length > 0 && (
        <div className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning/10 px-3 py-2.5 text-sm text-warning-foreground">
          <ul className="min-w-0 flex-1 space-y-1">
            {data.warnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex flex-col gap-4">
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
    </SettingSection>
  );
};

export default ModelsSection;
