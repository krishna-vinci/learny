import { Compartment, EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { api } from "@/api/client";
import { noteCompletions } from "./completions";
import { buildNoteEditorExtensions } from "./extensions";
import { Toolbar } from "./Toolbar";

export interface CodeMirrorNoteEditorProps {
  set: string;
  value: string;
  onChange: (text: string) => void;
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

  // Mounted once per editor open (remounts only if the CRLF fallback toggles); `value` and
  // `completionCompartment` are read only to build the initial state, not re-applied on
  // every change — that's the external-value effect's and the completions effect's job below.
  // biome-ignore lint/correctness/useExhaustiveDependencies: value/completionCompartment seed the initial state, not re-run triggers
  useEffect(() => {
    if (hasCRLF || !containerRef.current) return;
    const state = EditorState.create({
      doc: value,
      extensions: [
        ...buildNoteEditorExtensions(completionCompartment.of(noteCompletions([], []))),
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

  // Completions are fetched once per editor open and reconfigured into the compartment as
  // soon as they arrive (the editor doesn't wait for them to mount).
  // biome-ignore lint/correctness/useExhaustiveDependencies: completionCompartment is a stable ref, not a value to re-run on
  useEffect(() => {
    const editorView = viewRef.current;
    if (!editorView) return;
    const sources = (sourcesQuery.data ?? []).map((s) => ({ id: s.id, title: s.title }));
    const files = visualsQuery.data?.files ?? [];
    editorView.dispatch({ effects: completionCompartment.reconfigure(noteCompletions(sources, files)) });
  }, [sourcesQuery.data, visualsQuery.data]);

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

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <Toolbar view={view} />
      <div
        ref={containerRef}
        className="min-h-0 flex-1 overflow-auto"
        style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 3rem)" }}
      />
    </div>
  );
}
