// Level / deadline / sources fields for the "Let the agent plan it" flows
// (`NewSetDialog` and the set home's `PlanSetSheet`). The goal field lives with the caller.
import { SourcePicker } from "@/components/SourcePicker";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

export interface PlanOptionsValue {
  level: number | null;
  deadline: string;
  sources: string[];
}

export const EMPTY_PLAN_OPTIONS: PlanOptionsValue = { level: null, deadline: "", sources: [] };

/** The optional fields of a `plan-set` job request. */
export function planOptionsBody(value: PlanOptionsValue): { level?: number; deadline?: string; sources?: string[] } {
  return {
    ...(value.level === null ? {} : { level: value.level }),
    ...(value.deadline === "" ? {} : { deadline: value.deadline }),
    ...(value.sources.length === 0 ? {} : { sources: value.sources }),
  };
}

export function PlanOptions({
  value,
  onChange,
  idPrefix,
  set,
}: {
  value: PlanOptionsValue;
  onChange: (value: PlanOptionsValue) => void;
  idPrefix: string;
  set?: string;
}) {
  return (
    <>
      <fieldset className="min-w-0">
        <legend className="text-sm font-medium text-foreground">Level (optional)</legend>
        <div className="mt-1 flex gap-1">
          {[1, 2, 3, 4, 5].map((level) => (
            <button
              key={level}
              type="button"
              aria-pressed={value.level === level}
              onClick={() => onChange({ ...value, level: value.level === level ? null : level })}
              className={cn(
                "flex h-11 flex-1 items-center justify-center rounded-md border text-sm font-medium md:h-8",
                value.level === level
                  ? "border-primary bg-primary/15 text-primary"
                  : "border-border text-muted-foreground hover:bg-accent/40",
              )}
            >
              {level}
            </button>
          ))}
        </div>
        <p className="mt-1 text-xs text-muted-foreground">1 is new to the topic, 5 is advanced.</p>
      </fieldset>
      <div>
        <Label htmlFor={`${idPrefix}-deadline`}>Deadline (optional)</Label>
        <Input
          id={`${idPrefix}-deadline`}
          type="date"
          className="mt-1 h-11 md:h-8"
          value={value.deadline}
          onChange={(event) => onChange({ ...value, deadline: event.target.value })}
        />
      </div>
      <SourcePicker
        set={set}
        label="Sources (optional)"
        selected={value.sources}
        onChange={(sources) => onChange({ ...value, sources })}
      />
    </>
  );
}
