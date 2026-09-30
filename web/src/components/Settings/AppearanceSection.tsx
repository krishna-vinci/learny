// Slice C: theme/accent pickers plus the reading-comfort defaults from Slice B, all
// backed by the same `studium.reading-prefs` blob (lib/reading-prefs.ts). The reading
// controls are the exact same component the Reader's Aa button opens
// (ReadingSettingsContent) — reused here rather than re-implemented, so there's one
// segmented-control implementation for both places.
import { CheckIcon } from "lucide-react";
import { ReadingSettingsContent } from "@/components/Reader/ReadingSettings";
import {
  ACCENTS,
  type Accent,
  DEFAULT_READING_PREFS,
  setReadingPrefs,
  THEMES,
  type Theme,
  useReadingPrefs,
} from "@/lib/reading-prefs";
import { cn } from "@/lib/utils";
import SettingGroup from "./SettingGroup";
import SettingSection from "./SettingSection";

interface ThemePreview {
  label: string;
  background: string;
  foreground: string;
  accentDot: string;
}

// Hand-picked approximations of each theme's key tokens for the swatch preview only —
// these cards need to show all 5 themes side by side regardless of which one is active,
// so they can't rely on the live `[data-theme]`-scoped CSS variables (those only apply to
// the real <html data-theme> element, not an arbitrary nested div).
const THEME_PREVIEWS: Record<Theme, ThemePreview> = {
  system: {
    label: "System",
    background: "linear-gradient(135deg, oklch(0.9818 0.0054 95.0986) 50%, oklch(0.24 0.008 255) 50%)",
    foreground: "oklch(0.4 0.01 255)",
    accentDot: "oklch(0.45 0.08 250)",
  },
  light: {
    label: "Light",
    background: "oklch(0.9818 0.0054 95.0986)",
    foreground: "oklch(0.2438 0.0269 95.7226)",
    accentDot: "oklch(0.45 0.08 250)",
  },
  dark: {
    label: "Dark",
    background: "oklch(0.24 0.008 255)",
    foreground: "oklch(0.9 0.006 255)",
    accentDot: "oklch(0.66 0.11 250)",
  },
  sepia: {
    label: "Sepia",
    background: "oklch(0.95 0.03 85)",
    foreground: "oklch(0.32 0.025 75)",
    accentDot: "oklch(0.4 0.08 250)",
  },
  black: {
    label: "Black",
    background: "#000",
    foreground: "oklch(0.9 0.006 255)",
    accentDot: "oklch(0.7 0.11 250)",
  },
};

const ACCENT_SWATCHES: Record<Accent, { label: string; color: string }> = {
  blue: { label: "Blue", color: "oklch(0.45 0.08 250)" },
  teal: { label: "Teal", color: "oklch(0.45 0.09 195)" },
  green: { label: "Green", color: "oklch(0.45 0.11 145)" },
  amber: { label: "Amber", color: "oklch(0.45 0.12 75)" },
  rose: { label: "Rose", color: "oklch(0.45 0.14 350)" },
  violet: { label: "Violet", color: "oklch(0.45 0.13 300)" },
};

function ThemeCard({ theme, selected, onSelect }: { theme: Theme; selected: boolean; onSelect: () => void }) {
  const preview = THEME_PREVIEWS[theme];
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onSelect}
      className={cn(
        "flex flex-col items-stretch gap-2 rounded-lg border p-2 text-start transition-colors",
        selected ? "border-primary ring-2 ring-primary/40" : "border-border/70 hover:border-border",
      )}
    >
      <div
        className="relative flex h-14 items-center justify-center rounded-md border border-border/40"
        style={{ background: preview.background }}
      >
        <span className="text-xs font-medium" style={{ color: preview.foreground }}>
          Aa
        </span>
        <span
          aria-hidden="true"
          className="absolute end-1.5 bottom-1.5 size-2.5 rounded-full"
          style={{ backgroundColor: preview.accentDot }}
        />
        {selected && (
          <span className="absolute start-1.5 top-1.5 flex size-4 items-center justify-center rounded-full bg-primary text-primary-foreground">
            <CheckIcon className="size-2.5" />
          </span>
        )}
      </div>
      <span className="text-xs font-medium text-foreground">{preview.label}</span>
    </button>
  );
}

function AccentSwatch({ accent, selected, onSelect }: { accent: Accent; selected: boolean; onSelect: () => void }) {
  const swatch = ACCENT_SWATCHES[accent];
  return (
    <button
      type="button"
      aria-pressed={selected}
      aria-label={swatch.label}
      title={swatch.label}
      onClick={onSelect}
      className={cn(
        "relative flex size-11 shrink-0 items-center justify-center rounded-full border-2 transition-colors md:size-9",
        selected ? "border-foreground" : "border-transparent hover:border-border",
      )}
    >
      <span className="size-8 rounded-full md:size-7" style={{ backgroundColor: swatch.color }} aria-hidden="true" />
      {selected && (
        <CheckIcon className="absolute inset-0 m-auto size-4 text-white mix-blend-difference" aria-hidden="true" />
      )}
    </button>
  );
}

const AppearanceSection = () => {
  const prefs = useReadingPrefs();

  return (
    <SettingSection title="Appearance" description="Theme, accent colour and reading defaults for this device.">
      <SettingGroup title="Theme" description="System follows this device's OS setting.">
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
          {THEMES.map((theme) => (
            <ThemeCard
              key={theme}
              theme={theme}
              selected={prefs.theme === theme}
              onSelect={() => setReadingPrefs({ theme })}
            />
          ))}
        </div>
      </SettingGroup>

      <SettingGroup title="Accent" description="Colours buttons, links and highlights." showSeparator>
        <div className="flex flex-wrap gap-2">
          {ACCENTS.map((accent) => (
            <AccentSwatch
              key={accent}
              accent={accent}
              selected={prefs.accent === accent}
              onSelect={() => setReadingPrefs({ accent })}
            />
          ))}
        </div>
      </SettingGroup>

      <SettingGroup
        title="Reading defaults"
        description="Text size, line width, typeface and line spacing for notes on this device."
        showSeparator
      >
        <ReadingSettingsContent />
      </SettingGroup>

      {(prefs.theme !== DEFAULT_READING_PREFS.theme || prefs.accent !== DEFAULT_READING_PREFS.accent) && (
        <button
          type="button"
          className="min-h-11 self-start text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline md:min-h-0"
          onClick={() => setReadingPrefs({ theme: DEFAULT_READING_PREFS.theme, accent: DEFAULT_READING_PREFS.accent })}
        >
          Reset theme and accent to defaults
        </button>
      )}
    </SettingSection>
  );
};

export default AppearanceSection;
