import { Compartment, EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { api } from "@/api/client";
import { noteCompletions } from "./completions";
import { buildNoteEditorExtensions } from "./extensions";
import { buildLivePreview } from "./livePreview";
import { Toolbar } from "./Toolbar";

export interface CodeMirrorNoteEditorProps {
  set: string;
  value: string;
  onChange: (text: string) => void;
}

const SHOW_MARKDOWN_KEY = "studium:note-editor:show-markdown";

/** Whether the "Show markdown" toggle (Toolbar.tsx) starts on — i.e. live preview starts
 * off. Wrapped in try/catch: private browsing, a full storage quota or a disabled-storage
 * policy must not break opening the editor. */
function readShowMarkdown(): boolean {
  try {
    return localStorage.getItem(SHOW_MARKDOWN_KEY) === "1";
  } catch {
    return false;
  }
}

function writeShowMarkdown(value: boolean): void {
  try {
    localStorage.setItem(SHOW_MARKDOWN_KEY, value ? "1" : "0");
  } catch {
    // Private browsing / quota / disabled storage: the toggle still works for this
    // session, it just won't be remembered.
  }
}

/** The note editor's CodeMirror 6 surface. Mounts one `EditorView` on `value` and reports
 * every document change back through `onChange`; the save/conflict/discard flow around it
 * (Reader.tsx's `NoteEditor`) owns everything else. */
export default function CodeMirrorNoteEditor({ set, value, onChange }: CodeMirrorNoteEditorProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const [view, setView] = useState<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  // Only this component's own dispatched changes should feed back into `onChange`; track
  // the text we last reported so an external `value` update (the conflict "Overwrite" path
  // keeps `draft`, nothing else changes it) doesn't bounce back as a second onChange call.
  const lastReported = useRef(value);
  const completionCompartment = useRef(new Compartment()).current;
  const livePreviewCompartment = useRef(new Compartment()).current;
  const [showMarkdown, setShowMarkdown] = useState(() => readShowMarkdown());

  // CodeMirror normalises `\r\n` to `\n`, which would make a save silently rewrite a note's
  // line endings. A note with `\r` anywhere keeps the plain textarea instead, so saves stay
  // byte-exact.
  const hasCRLF = value.includes("\r");

  const sourcesQuery = useQuery({
    queryKey: ["note-editor", "sources", set],
    queryFn: () => api.sets.sources(set),
    enabled: !hasCRLF,
  });
  const visualsQuery = useQuery({
    queryKey: ["note-editor", "visuals", set],
    queryFn: () => api.sets.visuals(set),
    enabled: !hasCRLF,
  });

  // Mounted once per editor open (remounts only if the CRLF fallback toggles); `value`,
  // `completionCompartment`, `livePreviewCompartment` and `showMarkdown` are read only to
  // build the initial state, not re-applied on every change — that's the external-value
  // effect's and the completions/live-preview effect's job below.
  // biome-ignore lint/correctness/useExhaustiveDependencies: these seed the initial state, not re-run triggers
  useEffect(() => {
    if (hasCRLF || !containerRef.current) return;
    const state = EditorState.create({
      doc: value,
      extensions: [
        ...buildNoteEditorExtensions(
          completionCompartment.of(noteCompletions([], [])),
          livePreviewCompartment.of(showMarkdown ? [] : buildLivePreview(new Map())),
        ),
        EditorView.updateListener.of((update) => {
          if (!update.docChanged) return;
          const text = update.state.doc.toString();
          lastReported.current = text;
          onChangeRef.current(text);
        }),
      ],
    });
    const editorView = new EditorView({ state, parent: containerRef.current });
    viewRef.current = editorView;
    setView(editorView);
    return () => {
      editorView.destroy();
      viewRef.current = null;
      setView(null);
    };
  }, [hasCRLF]);

  // Completions and citation titles (for live-preview's citation chips) are fetched once
  // per editor open and reconfigured into their compartments as soon as they arrive (the
  // editor doesn't wait for them to mount), and again whenever the "Show markdown" toggle
  // flips — reconfiguring to `[]` removes every live-preview widget/replace in one step.
  // biome-ignore lint/correctness/useExhaustiveDependencies: completionCompartment/livePreviewCompartment are stable refs, not re-run triggers
  useEffect(() => {
    const editorView = viewRef.current;
    if (!editorView) return;
    const sources = (sourcesQuery.data ?? []).map((s) => ({ id: s.id, title: s.title }));
    const files = visualsQuery.data?.files ?? [];
    const citationTitles = new Map(sources.map((s) => [s.id, s.title]));
    editorView.dispatch({
      effects: [
        completionCompartment.reconfigure(noteCompletions(sources, files)),
        livePreviewCompartment.reconfigure(showMarkdown ? [] : buildLivePreview(citationTitles)),
      ],
    });
  }, [sourcesQuery.data, visualsQuery.data, showMarkdown]);

  // An external `value` change (the conflict banner's "Overwrite" keeps `draft`, nothing
  // else changes it) replaces the doc only when it actually differs — otherwise every
  // render would stomp the cursor/selection the user is actively editing with.
  useEffect(() => {
    const editorView = viewRef.current;
    if (!editorView || value === lastReported.current) return;
    lastReported.current = value;
    const current = editorView.state.doc.toString();
    if (current === value) return;
    editorView.dispatch({ changes: { from: 0, to: current.length, insert: value } });
  }, [value]);

  if (hasCRLF) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <p className="shrink-0 border-b border-border/70 bg-muted px-4 py-1.5 text-xs text-muted-foreground">
          This note uses Windows line endings; using the plain editor.
        </p>
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          spellCheck={false}
          className="min-h-0 flex-1 resize-none border-0 bg-background px-4 py-3 font-mono text-sm text-foreground outline-none"
          style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 1rem)" }}
        />
      </div>
    );
  }

  function toggleShowMarkdown() {
    setShowMarkdown((prev) => {
      const next = !prev;
      writeShowMarkdown(next);
      return next;
    });
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <Toolbar view={view} showMarkdown={showMarkdown} onToggleShowMarkdown={toggleShowMarkdown} />
      <div
        ref={containerRef}
        className="min-h-0 flex-1 overflow-auto"
        style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 3rem)" }}
      />
    </div>
  );
}
