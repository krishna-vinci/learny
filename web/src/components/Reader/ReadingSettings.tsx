// B1: the reading-settings control behind the note toolbar's **Aa** button. On the phone
// it opens a bottom sheet portalled to <body> (same pattern as the activity panel's
// sheet: backdrop tap + Escape close); on desktop a small popover anchored to the
// button. Both render the same content: a live preview paragraph, segmented controls for
// text size / line width / typeface / line spacing, and Reset. Every change goes straight
// into the reading-prefs store, which re-renders the note behind the panel too.
import { MinusIcon, PlusIcon, RotateCcwIcon, XIcon } from "lucide-react";
import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Button } from "@/components/ui/button";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import {
  READING_FONT_SIZES,
  READING_LEADINGS,
  READING_MEASURES,
  type ReadingFontSize,
  type ReadingLeading,
  type ReadingMeasure,
  type ReadingTypeface,
  readingPrefsVars,
  resetReadingPrefs,
  setReadingPrefs,
  useReadingPrefs,
} from "@/lib/reading-prefs";
import { cn } from "@/lib/utils";

const MEASURE_LABELS: Record<ReadingMeasure, string> = { 60: "Narrow", 72: "Medium", 90: "Wide" };
const LEADING_LABELS: Record<ReadingLeading, string> = { 1.5: "Compact", 1.7: "Normal", 1.9: "Relaxed" };

interface SegmentOption<T extends string | number> {
  value: T;
  label: ReactNode;
  /** Accessible name when the visible label is a glyph (the size group's "A"s). */
  ariaLabel?: string;
  title?: string;
}

function SegmentedGroup<T extends string | number>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: SegmentOption<T>[];
  onChange: (value: T) => void;
}) {
  return (
    <fieldset
      aria-label={label}
      className="flex min-w-0 items-stretch gap-1 rounded-lg border border-border/70 bg-muted/40 p-1"
    >
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <button
            key={String(option.value)}
            type="button"
            aria-pressed={selected}
            aria-label={option.ariaLabel}
            title={option.title}
            onClick={() => onChange(option.value)}
            className={cn(
              "min-h-11 min-w-11 flex-1 rounded-md px-1.5 py-2 text-sm font-medium transition-colors md:min-h-0 md:min-w-9 md:py-1",
              selected
                ? "bg-card text-foreground shadow-xs"
                : "text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            {option.label}
          </button>
        );
      })}
    </fieldset>
  );
}

function SettingsRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      {children}
    </div>
  );
}

export function ReadingSettingsContent() {
  const prefs = useReadingPrefs();
  const sizeIndex = READING_FONT_SIZES.indexOf(prefs.fontSize);

  const sizeOptions: SegmentOption<ReadingFontSize>[] = READING_FONT_SIZES.map((size, index) => ({
    value: size,
    ariaLabel: `Text size ${size} pixels`,
    title: `${size} px`,
    label: (
      <span aria-hidden="true" style={{ fontSize: `${10 + index * 2}px` }} className="font-semibold leading-none">
        A
      </span>
    ),
  }));

  const measureOptions: SegmentOption<ReadingMeasure>[] = READING_MEASURES.map((measure) => ({
    value: measure,
    title: `${measure}ch`,
    label: MEASURE_LABELS[measure],
  }));

  const typefaceOptions: SegmentOption<ReadingTypeface>[] = [
    { value: "sans", label: <span>Sans</span> },
    { value: "serif", label: <span style={{ fontFamily: "var(--font-serif)" }}>Serif</span> },
  ];

  const leadingOptions: SegmentOption<ReadingLeading>[] = READING_LEADINGS.map((leading) => ({
    value: leading,
    title: leading.toFixed(1),
    label: LEADING_LABELS[leading],
  }));

  return (
    <div className="flex flex-col gap-4">
      {/* Live preview: the same vars the note gets, scoped to this box. */}
      <div
        aria-hidden="true"
        className="rounded-lg border border-border/70 bg-background px-4 py-3"
        style={readingPrefsVars(prefs)}
      >
        <p
          className="text-foreground"
          style={{
            fontSize: "var(--reader-font-size)",
            lineHeight: "var(--reader-leading)",
            fontFamily: "var(--reader-font)",
          }}
        >
          Singular values measure how a matrix stretches space — set in your reading type.
        </p>
      </div>

      <SettingsRow label="Text size">
        <div className="flex items-center gap-1.5">
          <Button
            variant="outline"
            aria-label="Smaller text"
            className="size-11 shrink-0 md:size-8"
            disabled={sizeIndex <= 0}
            onClick={() => setReadingPrefs({ fontSize: READING_FONT_SIZES[sizeIndex - 1] })}
          >
            <MinusIcon />
          </Button>
          <SegmentedGroup
            label="Text size"
            value={prefs.fontSize}
            options={sizeOptions}
            onChange={(fontSize) => setReadingPrefs({ fontSize })}
          />
          <Button
            variant="outline"
            aria-label="Larger text"
            className="size-11 shrink-0 md:size-8"
            disabled={sizeIndex >= READING_FONT_SIZES.length - 1}
            onClick={() => setReadingPrefs({ fontSize: READING_FONT_SIZES[sizeIndex + 1] })}
          >
            <PlusIcon />
          </Button>
        </div>
      </SettingsRow>

      <SettingsRow label="Line width">
        <SegmentedGroup
          label="Line width"
          value={prefs.measure}
          options={measureOptions}
          onChange={(measure) => setReadingPrefs({ measure })}
        />
      </SettingsRow>

      <SettingsRow label="Typeface">
        <SegmentedGroup
          label="Typeface"
          value={prefs.typeface}
          options={typefaceOptions}
          onChange={(typeface) => setReadingPrefs({ typeface })}
        />
      </SettingsRow>

      <SettingsRow label="Line spacing">
        <SegmentedGroup
          label="Line spacing"
          value={prefs.leading}
          options={leadingOptions}
          onChange={(leading) => setReadingPrefs({ leading })}
        />
      </SettingsRow>

      <Button variant="outline" size="sm" className="h-11 md:h-7" onClick={resetReadingPrefs}>
        <RotateCcwIcon />
        Reset
      </Button>
    </div>
  );
}

/** Phone bottom sheet, portalled to <body> like the activity panel's. */
function ReadingSettingsSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  if (!open) return null;
  return createPortal(
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label="Reading settings">
      <button
        type="button"
        aria-label="Close reading settings"
        className="absolute inset-0 bg-overlay/50"
        onClick={onClose}
      />
      <div
        className="absolute inset-x-0 bottom-0 flex max-h-[85dvh] flex-col overflow-hidden rounded-t-xl border-t border-border bg-popover text-popover-foreground shadow-2xl"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        <div className="flex h-12 shrink-0 items-center justify-between border-b border-border/70 px-4">
          <h2 className="text-sm font-semibold text-foreground">Reading</h2>
          <Button variant="quiet" size="icon-compact" onClick={onClose} aria-label="Close reading settings">
            <XIcon />
          </Button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          <ReadingSettingsContent />
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** The toolbar control: bottom sheet on the phone, popover on desktop. */
export function ReadingSettingsControl() {
  const isDesktop = useMediaQuery("(min-width: 768px)");
  const [open, setOpen] = useState(false);

  // Crossing the breakpoint while open would leave a stale panel; close instead.
  // biome-ignore lint/correctness/useExhaustiveDependencies: isDesktop is a trigger to close on breakpoint change, not a value read in the body
  useEffect(() => {
    setOpen(false);
  }, [isDesktop]);

  return (
    <div className="relative">
      <Button
        variant={open ? "secondary" : "outline"}
        size="sm"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label="Reading settings"
        className="h-11 min-w-11 md:h-7 md:min-w-0"
        onClick={() => setOpen((value) => !value)}
      >
        Aa
      </Button>
      {!isDesktop && <ReadingSettingsSheet open={open} onClose={() => setOpen(false)} />}
      {isDesktop && open && (
        <>
          <button
            type="button"
            aria-label="Close reading settings"
            tabIndex={-1}
            className="fixed inset-0 z-40 cursor-default"
            onClick={() => setOpen(false)}
          />
          <div
            role="dialog"
            aria-label="Reading settings"
            className="absolute end-0 top-full z-50 mt-2 flex max-h-[28rem] w-[21rem] flex-col overflow-hidden rounded-lg border border-border bg-popover text-popover-foreground shadow-lg"
          >
            <div className="flex shrink-0 items-center justify-between border-b border-border/70 px-4 py-2.5">
              <h2 className="text-sm font-semibold text-foreground">Reading</h2>
              <Button
                variant="quiet"
                size="icon-compact"
                onClick={() => setOpen(false)}
                aria-label="Close reading settings"
              >
                <XIcon />
              </Button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-4">
              <ReadingSettingsContent />
            </div>
          </div>
        </>
      )}
    </div>
  );
}
