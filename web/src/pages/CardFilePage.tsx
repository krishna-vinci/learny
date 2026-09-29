// `/s/:set/cards/*` (M2 T6): one card file — header actions (approve-all-clean, export,
// sync to Anki) plus the review mode, the main UX: one card at a time, keyboard shortcuts
// on desktop, a big bottom action bar on the phone. See docs/plans/2026-09-29-m2-cards-and-
// review.md "Decisions (fixed)" 1, 6, 8, 9 and the "T6 (Sonnet)" task note.
import { AnkiConnectClient, type CardView, syncCards } from "@studium/shared";
import { useQueryClient } from "@tanstack/react-query";
import { AlertTriangleIcon, CheckIcon, DownloadIcon, PencilIcon, RefreshCwIcon, XIcon } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "react-hot-toast";
import { useNavigate, useParams } from "react-router-dom";
import { ApiError, api, exportUrl } from "@/api/client";
import { queryKeys, useCardFile, useNotes, useSettings } from "@/api/queries";
import { MarkdownView } from "@/components/Reader";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  criticLabel,
  filterCardsByStatus,
  nextCardIndex,
  REVIEW_FILTERS,
  type ReviewFilter,
  renderClozeText,
} from "./cards-utils";

const FILTER_LABEL: Record<ReviewFilter, string> = {
  draft: "Draft",
  approved: "Approved",
  rejected: "Rejected",
  exported: "Exported",
  all: "All",
};

const ANKICONNECT_URL = "http://localhost:8765";
const ANKICONNECT_PROBE_TIMEOUT_MS = 1200;
const DESKTOP_MIN_WIDTH = 768;

/** `cards/03-svd.md` -> `Studium::<set>::03-svd`, matching the server's `.apkg`/sync deck naming. */
function deckNameFor(cardFilePath: string, set: string): string {
  return `Studium::${set}::${cardFilePath.replace(/^cards\//, "").replace(/\.md$/, "")}`;
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * A minimal client-side Markdown -> Anki HTML approximation for the browser sync path only
 * (bold/italic/code, paragraph breaks, `$…$`/`$$…$$` -> MathJax `\(…\)`/`\[…\]`). The
 * server's export/`sync` routes use the fuller converter in `server/src/anki/html.ts`; this
 * one just needs to produce a reasonable card face when AnkiConnect is reachable directly
 * from the browser, on the same machine as desktop Anki.
 */
function mdToAnkiHtml(markdown: string): string {
  const escaped = escapeHtml(markdown);
  const withInline = escaped
    .replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>")
    .replace(/\*([^*]+)\*/g, "<i>$1</i>")
    .replace(/`([^`]+)`/g, "<code>$1</code>");
  const withMath = withInline
    .replace(/\$\$([\s\S]+?)\$\$/g, (_m, expr: string) => `\\[${expr}\\]`)
    .replace(/\$([^$\n]+?)\$/g, (_m, expr: string) => `\\(${expr}\\)`);
  return withMath
    .split(/\n{2,}/)
    .map((para) => `<p>${para.replace(/\n/g, "<br>")}</p>`)
    .join("");
}

function fieldsForCard(card: CardView, notePath: string | null): Record<string, string> {
  const common = {
    CardId: escapeHtml(card.id),
    Source: card.src ? escapeHtml(card.src) : "",
    NoteLink: escapeHtml(notePath ?? ""),
  };
  return card.type === "basic"
    ? { Front: mdToAnkiHtml(card.q ?? ""), Back: mdToAnkiHtml(card.a ?? ""), ...common }
    : { Text: mdToAnkiHtml(card.text ?? ""), Extra: mdToAnkiHtml(card.extra ?? ""), ...common };
}

type SyncMode = "probing" | "browser" | "server" | "hidden";

/** Fields the review textareas edit, keyed by the card's type. */
interface EditState {
  q: string;
  a: string;
  text: string;
  extra: string;
}

function editStateFor(card: CardView): EditState {
  return { q: card.q ?? "", a: card.a ?? "", text: card.text ?? "", extra: card.extra ?? "" };
}

function StatusPill({ status }: { status: CardView["status"] }) {
  const classes: Record<CardView["status"], string> = {
    draft: "bg-muted text-muted-foreground",
    approved: "bg-success/15 text-success",
    rejected: "bg-destructive/15 text-destructive",
    exported: "bg-primary/15 text-primary",
  };
  return (
    <span className={cn("rounded-full px-2 py-0.5 text-2xs font-medium uppercase tracking-wide", classes[status])}>
      {status}
    </span>
  );
}

function CardFace({ card, revealed }: { card: CardView; revealed: boolean }) {
  if (card.type === "cloze") {
    return (
      <div className="space-y-4">
        <MarkdownView content={renderClozeText(card.text ?? "", revealed)} />
        {revealed && card.extra && (
          <div className="border-t border-border/70 pt-3 text-sm text-muted-foreground">
            <MarkdownView content={card.extra} />
          </div>
        )}
      </div>
    );
  }
  return (
    <div className="space-y-4">
      <MarkdownView content={card.q ?? ""} />
      {revealed && (
        <div className="border-t border-border/70 pt-3">
          <MarkdownView content={card.a ?? ""} />
        </div>
      )}
    </div>
  );
}

function EditForm({
  card,
  value,
  onChange,
}: {
  card: CardView;
  value: EditState;
  onChange: (next: EditState) => void;
}) {
  const fieldClasses =
    "mt-1 w-full resize-none rounded-md border border-border bg-transparent px-3 py-2 text-base outline-none placeholder:text-muted-foreground md:text-sm";
  if (card.type === "cloze") {
    return (
      <div className="space-y-3">
        <div>
          <label className="text-sm font-medium text-foreground" htmlFor="edit-text">
            Text
          </label>
          <textarea
            id="edit-text"
            className={fieldClasses}
            rows={5}
            value={value.text}
            onChange={(e) => onChange({ ...value, text: e.target.value })}
          />
        </div>
        <div>
          <label className="text-sm font-medium text-foreground" htmlFor="edit-extra">
            Extra
          </label>
          <textarea
            id="edit-extra"
            className={fieldClasses}
            rows={3}
            value={value.extra}
            onChange={(e) => onChange({ ...value, extra: e.target.value })}
          />
        </div>
      </div>
    );
  }
  return (
    <div className="space-y-3">
      <div>
        <label className="text-sm font-medium text-foreground" htmlFor="edit-q">
          Q
        </label>
        <textarea
          id="edit-q"
          className={fieldClasses}
          rows={3}
          value={value.q}
          onChange={(e) => onChange({ ...value, q: e.target.value })}
        />
      </div>
      <div>
        <label className="text-sm font-medium text-foreground" htmlFor="edit-a">
          A
        </label>
        <textarea
          id="edit-a"
          className={fieldClasses}
          rows={3}
          value={value.a}
          onChange={(e) => onChange({ ...value, a: e.target.value })}
        />
      </div>
    </div>
  );
}

function CardFilePage() {
  const params = useParams<{ set: string; "*": string }>();
  const set = params.set as string;
  const path = params["*"] ? `cards/${params["*"]}` : undefined;
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const { data: detail, isLoading, isError } = useCardFile(set, path);
  const { data: notes = [] } = useNotes(set);
  const { data: settings } = useSettings();

  const [filter, setFilter] = useState<ReviewFilter>("draft");
  const [index, setIndex] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState<EditState | null>(null);
  const [busy, setBusy] = useState(false);
  const [approvingAll, setApprovingAll] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncMode, setSyncMode] = useState<SyncMode>("probing");

  const cards = detail?.cards ?? [];
  const filtered = useMemo(() => filterCardsByStatus(cards, filter), [cards, filter]);
  const current = filtered[index];

  // Switching tabs is user-triggered, so reset directly rather than syncing from a
  // useEffect keyed on `filter` (which wouldn't fire for a same-length switch anyway).
  function selectFilter(next: ReviewFilter) {
    setFilter(next);
    setIndex(0);
    setRevealed(false);
    setEditing(false);
  }

  // Clamp the index whenever the filtered list shrinks (a status change removes the
  // current card from the tab it was reviewed under).
  useEffect(() => {
    setIndex((i) => (filtered.length === 0 ? 0 : Math.min(i, filtered.length - 1)));
  }, [filtered.length]);

  useEffect(() => {
    setEditValue(current ? editStateFor(current) : null);
  }, [current]);

  const ankiServiceOk = settings?.services.some((s) => s.name.toLowerCase().includes("anki") && s.ok) ?? false;

  // Sync-mode detection: probe local AnkiConnect only on desktop widths; otherwise (or on
  // failure) fall back to the server route if `GET /api/settings` reports it healthy, else
  // hide the button entirely (decision 9 / T6 task note).
  useEffect(() => {
    let cancelled = false;
    if (typeof window === "undefined" || window.innerWidth < DESKTOP_MIN_WIDTH) {
      setSyncMode(ankiServiceOk ? "server" : "hidden");
      return;
    }
    const client = new AnkiConnectClient({ url: ANKICONNECT_URL, timeoutMs: ANKICONNECT_PROBE_TIMEOUT_MS });
    client
      .version()
      .then(() => {
        if (!cancelled) setSyncMode("browser");
      })
      .catch(() => {
        if (!cancelled) setSyncMode(ankiServiceOk ? "server" : "hidden");
      });
    return () => {
      cancelled = true;
    };
  }, [ankiServiceOk]);

  const invalidate = () => {
    if (path) queryClient.invalidateQueries({ queryKey: queryKeys.cardFile(set, path) });
    queryClient.invalidateQueries({ queryKey: queryKeys.cardFiles(set) });
  };

  async function patch(id: string, body: Parameters<typeof api.cards.patch>[2]) {
    setBusy(true);
    try {
      await api.cards.patch(set, id, body);
      invalidate();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to update the card.");
    } finally {
      setBusy(false);
    }
  }

  async function approve() {
    if (!current) return;
    await patch(current.id, { status: "approved" });
  }

  async function reject() {
    if (!current) return;
    await patch(current.id, { status: "rejected" });
  }

  function skip() {
    setIndex((i) => nextCardIndex(filtered.length, i, 1));
    setRevealed(false);
  }

  function startEdit() {
    if (!current) return;
    setEditValue(editStateFor(current));
    setEditing(true);
  }

  async function saveEdit() {
    if (!current || !editValue) return;
    const body =
      current.type === "cloze" ? { text: editValue.text, extra: editValue.extra } : { q: editValue.q, a: editValue.a };
    await patch(current.id, body);
    setEditing(false);
  }

  function goTo(direction: 1 | -1) {
    setIndex((i) => nextCardIndex(filtered.length, i, direction));
    setRevealed(false);
    setEditing(false);
  }

  // The keydown listener below reads these through a ref (updated every render) rather
  // than depending on the functions directly, since they're plain closures recreated on
  // every render — putting them in the effect's dependency array would resubscribe the
  // DOM listener on every render instead of only when the guard conditions change.
  const actionsRef = useRef({ approve, reject, startEdit, goTo });
  actionsRef.current = { approve, reject, startEdit, goTo };

  // Desktop keyboard shortcuts: a approve, r reject, e edit, j/k or arrows navigate, space
  // reveals. Disabled while an edit textarea (or any other input) has focus.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      const typing = target?.tagName === "INPUT" || target?.tagName === "TEXTAREA";
      if (typing || editing || busy || !current) return;
      const actions = actionsRef.current;
      if (event.key === " ") {
        event.preventDefault();
        setRevealed((r) => !r);
      } else if (event.key === "a") {
        void actions.approve();
      } else if (event.key === "r") {
        void actions.reject();
      } else if (event.key === "e") {
        actions.startEdit();
      } else if (event.key === "j" || event.key === "ArrowRight" || event.key === "ArrowDown") {
        actions.goTo(1);
      } else if (event.key === "k" || event.key === "ArrowLeft" || event.key === "ArrowUp") {
        actions.goTo(-1);
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [current, editing, busy]);

  async function approveAllClean() {
    if (!path) return;
    setApprovingAll(true);
    try {
      const result = await api.cards.approveClean(set, path);
      toast.success(`Approved ${result.approved} critic-clean card${result.approved === 1 ? "" : "s"}`);
      invalidate();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to approve cards.");
    } finally {
      setApprovingAll(false);
    }
  }

  async function syncViaBrowser() {
    if (!detail || !path) return;
    const syncable = cards.filter((card) => card.status === "approved" || card.status === "exported");
    if (syncable.length === 0) {
      toast.error("No approved cards to sync.");
      return;
    }
    setSyncing(true);
    try {
      const client = new AnkiConnectClient({ url: ANKICONNECT_URL, timeoutMs: 10_000 });
      const deck = deckNameFor(path, set);
      const result = await syncCards(client, syncable, {
        deckFor: () => deck,
        toFields: (card) => fieldsForCard(card, detail.note),
      });
      const ids = Object.keys(result.ankiIds);
      if (ids.length > 0) await api.cards.markExported(set, ids, result.ankiIds);
      if (result.failed.length > 0) toast.error(`Synced with ${result.failed.length} failure(s).`);
      else toast.success(`Synced: ${result.added} added, ${result.updated} updated.`);
      invalidate();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Sync to Anki failed.");
    } finally {
      setSyncing(false);
    }
  }

  async function syncViaServer() {
    setSyncing(true);
    try {
      const result = await api.anki.syncServer(set, path);
      if (result.failed.length > 0) toast.error(`Synced with ${result.failed.length} failure(s).`);
      else toast.success(`Synced: ${result.added} added, ${result.updated} updated.`);
      invalidate();
    } catch (err) {
      if (err instanceof ApiError && err.status === 503) {
        setSyncMode("hidden");
        toast.error("AnkiConnect isn't configured on the server.");
      } else {
        toast.error(err instanceof ApiError ? err.message : "Sync to Anki failed.");
      }
    } finally {
      setSyncing(false);
    }
  }

  function handleSyncClick() {
    if (syncMode === "browser") void syncViaBrowser();
    else if (syncMode === "server") void syncViaServer();
  }

  if (isLoading) {
    return <div className="p-6 text-sm text-muted-foreground">Loading cards…</div>;
  }
  if (isError || !detail) {
    return <div className="p-6 text-sm text-destructive">Failed to load this card file.</div>;
  }

  const chapterTitle = detail.note ? (notes.find((n) => n.path === detail.note)?.title ?? detail.note) : "Cards";
  const cleanDraftCount = cards.filter((c) => c.status === "draft" && c.critic?.verdict === "ok").length;

  return (
    <div className="mx-auto w-full max-w-3xl px-4 pb-28 pt-6 md:px-6 md:pb-6">
      <div className="flex items-center gap-2">
        <Button variant="outline" size="sm" className="h-11 md:h-7" onClick={() => navigate(`/s/${set}/cards`)}>
          Back
        </Button>
        <h1 className="min-w-0 flex-1 truncate text-lg font-semibold text-foreground">{chapterTitle}</h1>
      </div>

      {detail.stale && (
        <p className="mt-3 flex items-center gap-1.5 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm text-warning-foreground">
          <AlertTriangleIcon className="size-4 shrink-0" />
          Stale — the note changed since these cards were last reviewed.
        </p>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() => void approveAllClean()}
          disabled={approvingAll || cleanDraftCount === 0}
        >
          <CheckIcon />
          {approvingAll ? "Approving…" : `Approve all critic-clean (${cleanDraftCount})`}
        </Button>
        <a
          href={exportUrl(set, { note: detail.note ?? undefined })}
          className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
        >
          <DownloadIcon />
          Export .apkg
        </a>
        {syncMode === "browser" || syncMode === "server" ? (
          <Button variant="outline" size="sm" onClick={handleSyncClick} disabled={syncing}>
            <RefreshCwIcon className={syncing ? "animate-spin" : undefined} />
            {syncing ? "Syncing…" : "Sync to Anki"}
          </Button>
        ) : syncMode === "hidden" ? (
          <span className="text-2xs text-muted-foreground">
            Use Export .apkg to import into AnkiDroid / AnkiMobile / desktop Anki.
          </span>
        ) : null}
      </div>

      <div className="mt-4 flex gap-1 overflow-x-auto border-b border-border/70">
        {REVIEW_FILTERS.map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => selectFilter(f)}
            className={cn(
              "min-h-11 shrink-0 border-b-2 px-3 py-2 text-sm font-medium md:min-h-8",
              filter === f
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {FILTER_LABEL[f]}
          </button>
        ))}
      </div>

      {filtered.length === 0 || !current ? (
        <p className="mt-6 text-sm text-muted-foreground">
          No {filter === "all" ? "" : FILTER_LABEL[filter].toLowerCase()} cards.
        </p>
      ) : (
        <div className="mt-4">
          <div className="flex items-center justify-between text-sm text-muted-foreground">
            <span>
              {index + 1} / {filtered.length}
            </span>
            <StatusPill status={current.status} />
          </div>

          {editing && editValue ? (
            <div className="mt-3 min-h-[16rem] rounded-lg border border-border/70 p-5">
              <EditForm card={current} value={editValue} onChange={setEditValue} />
            </div>
          ) : (
            <>
              {/* A plain (non-interactive) container: `CardFace` can render a code block
                  with its own copy button (CodeBlock.tsx), and this can't be a <button>
                  itself — nested <button>s are invalid HTML and the outer one would
                  swallow the inner one's clicks. The reveal control below is the real,
                  separate interactive element; `space` also reveals (desktop shortcut). */}
              <div className="mt-3 min-h-[16rem] rounded-lg border border-border/70 p-5">
                <CardFace card={current} revealed={revealed} />
              </div>
              <button
                type="button"
                className="mt-2 w-full rounded-md border border-dashed border-border/70 py-2 text-sm text-muted-foreground hover:text-foreground"
                onClick={() => setRevealed((r) => !r)}
              >
                {revealed ? "Hide answer" : "Tap to reveal (space)"}
              </button>
            </>
          )}

          <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            {current.src && <span>src: {current.src}</span>}
            {criticLabel(current.critic) && (
              <span className={current.critic?.verdict === "reject" ? "text-warning-foreground" : undefined}>
                critic: {criticLabel(current.critic)}
              </span>
            )}
          </div>

          {editing ? (
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => setEditing(false)} disabled={busy}>
                Cancel
              </Button>
              <Button size="sm" onClick={() => void saveEdit()} disabled={busy}>
                Save
              </Button>
            </div>
          ) : (
            <div className="mt-4 hidden items-center justify-between md:flex">
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={() => goTo(-1)}>
                  Prev (k)
                </Button>
                <Button variant="outline" size="sm" onClick={() => goTo(1)}>
                  Next (j)
                </Button>
                <Button variant="outline" size="sm" onClick={skip}>
                  Skip
                </Button>
              </div>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={startEdit} disabled={busy}>
                  <PencilIcon /> Edit (e)
                </Button>
                <Button variant="destructive" size="sm" onClick={() => void reject()} disabled={busy}>
                  <XIcon /> Reject (r)
                </Button>
                <Button size="sm" onClick={() => void approve()} disabled={busy}>
                  <CheckIcon /> Approve (a)
                </Button>
              </div>
            </div>
          )}
        </div>
      )}

      {!editing && current && (
        <div
          className="fixed inset-x-0 bottom-0 z-20 flex items-center gap-2 border-t border-border/70 bg-background px-4 py-3 md:hidden"
          style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 0.75rem)" }}
        >
          <Button
            variant="destructive"
            className="h-12 flex-1 text-base"
            onClick={() => void reject()}
            disabled={busy}
            aria-label="Reject"
          >
            <XIcon className="size-5" />
          </Button>
          <Button
            variant="outline"
            className="h-12 flex-1 text-base"
            onClick={startEdit}
            disabled={busy}
            aria-label="Edit"
          >
            <PencilIcon className="size-5" />
          </Button>
          <Button className="h-12 flex-1 text-base" onClick={() => void approve()} disabled={busy} aria-label="Approve">
            <CheckIcon className="size-5" />
          </Button>
        </div>
      )}
    </div>
  );
}

export default CardFilePage;
