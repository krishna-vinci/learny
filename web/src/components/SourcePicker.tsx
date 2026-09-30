// Checklist of library sources (id + title), shared by "New chapter" and "Plan with the agent".
// Reads the same Library query the Library pages use, so results share a cache.
import { useLibrary } from "@/api/queries";
import { Label } from "@/components/ui/label";

export interface SourcePickerProps {
  selected: string[];
  onChange: (ids: string[]) => void;
  label?: string;
}

export function SourcePicker({ selected, onChange, label = "Sources" }: SourcePickerProps) {
  const { data: sources = [] } = useLibrary();
  if (sources.length === 0) return null;

  function toggle(id: string) {
    onChange(selected.includes(id) ? selected.filter((candidate) => candidate !== id) : [...selected, id]);
  }

  return (
    <div>
      <Label>{label}</Label>
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
    </div>
  );
}
