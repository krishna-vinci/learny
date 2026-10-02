// Set sources are selected by default; the full library remains available to browse.
import { useEffect, useRef, useState } from "react";
import { useLibrary, useSetSources } from "@/api/queries";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export interface SourcePickerProps {
  set?: string;
  selected: string[];
  onChange: (ids: string[]) => void;
  label?: string;
}

export function SourcePicker({ set, selected, onChange, label = "Sources" }: SourcePickerProps) {
  const library = useLibrary();
  const own = useSetSources(set);
  const [browse, setBrowse] = useState(false);
  const [query, setQuery] = useState("");
  const initialized = useRef(false);
  useEffect(() => {
    if (!set || !own.data || initialized.current) return;
    initialized.current = true;
    if (selected.length === 0) onChange(own.data.map((source) => source.id));
  }, [set, own.data, selected, onChange]);
  const sources = (set && !browse ? (own.data ?? []) : (library.data ?? [])).filter((source) =>
    `${source.title} ${source.authors.join(" ")} ${source.id}`.toLowerCase().includes(query.toLowerCase()),
  );

  function toggle(id: string) {
    onChange(selected.includes(id) ? selected.filter((candidate) => candidate !== id) : [...selected, id]);
  }

  return (
    <div>
      <Label>{label}</Label>
      {set && (
        <div className="mt-1 flex flex-wrap gap-2 border-b border-border/70 pb-2">
          <Button
            type="button"
            variant="quiet"
            className="h-11"
            aria-pressed={!browse}
            onClick={() => {
              setBrowse(false);
              setQuery("");
            }}
          >
            This set
          </Button>
          <Button
            type="button"
            variant="quiet"
            className="h-11"
            aria-pressed={browse}
            onClick={() => {
              setBrowse(true);
              setQuery("");
            }}
          >
            All sources
          </Button>
          <span className="self-center text-xs text-muted-foreground">{selected.length} selected</span>
        </div>
      )}
      {(!set || browse) && (
        <Input
          className="mt-2 h-11"
          aria-label="Search sources"
          placeholder="Search sources…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      )}
      {(set && !browse ? own.isError : library.isError) && (
        <p role="alert" className="mt-2 text-sm text-destructive">
          Couldn't load sources. Try reopening this form.
        </p>
      )}
      <ul className="mt-1 max-h-40 overflow-y-auto rounded-md border border-border/70 p-1">
        {sources.map((source) => (
          <li key={source.id}>
            <label className="flex min-h-11 cursor-pointer items-center gap-2 rounded px-2 text-sm hover:bg-accent/40 md:min-h-8">
              <input type="checkbox" checked={selected.includes(source.id)} onChange={() => toggle(source.id)} />
              <span className="min-w-0 flex-1 truncate">{source.title}</span>
            </label>
          </li>
        ))}
      </ul>
      {sources.length === 0 && !(set && !browse ? own.isLoading : library.isLoading) && (
        <p className="mt-1 text-xs text-muted-foreground">
          {set && !browse ? "No sources linked yet. Browse All sources to choose material." : "No matching sources."}
        </p>
      )}
    </div>
  );
}
