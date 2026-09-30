// "Docs site" tab of `AddSourceSheet`: map a documentation site (Firecrawl), pick pages, and
// queue them as ingest jobs (`POST /api/library/site-map` then `/site-import`). Imported pages
// show up through the normal ingest jobs and the activity UI.
import type { SiteImportResponse, SiteMapPage } from "@studium/shared";
import { Loader2Icon } from "lucide-react";
import { useMemo, useState } from "react";
import { api } from "@/api/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { friendlyMessage } from "@/lib/friendly-errors";

/** Mirror of the server's per-import cap (`POST /api/library/site-import`). */
const MAX_IMPORT_PAGES = 100;
/** Pages fetched from the map; the learner narrows them with the filter box. */
const MAP_LIMIT = 300;

function pageLabel(page: SiteMapPage): string {
  if (page.title?.trim()) return page.title.trim();
  try {
    const url = new URL(page.url);
    return `${url.pathname}${url.search}` || url.host;
  } catch {
    return page.url;
  }
}

function pagePath(page: SiteMapPage): string {
  try {
    const url = new URL(page.url);
    return `${url.host}${url.pathname}${url.search}`;
  } catch {
    return page.url;
  }
}

export function DocsSiteTab({ defaultSet, onClose }: { defaultSet?: string | null; onClose: () => void }) {
  const [siteUrl, setSiteUrl] = useState("");
  const [search, setSearch] = useState("");
  const [pages, setPages] = useState<SiteMapPage[] | null>(null);
  const [finding, setFinding] = useState(false);
  const [findError, setFindError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [linkToSet, setLinkToSet] = useState(!!defaultSet);
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<SiteImportResponse | null>(null);

  const visible = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    if (!pages) return [];
    if (!needle) return pages;
    return pages.filter((page) => `${page.title ?? ""} ${page.url}`.toLowerCase().includes(needle));
  }, [pages, filter]);

  async function findPages() {
    setFinding(true);
    setFindError(null);
    setPages(null);
    setSelected(new Set());
    setFilter("");
    try {
      const response = await api.library.siteMap({
        url: siteUrl.trim(),
        ...(search.trim() ? { search: search.trim() } : {}),
        limit: MAP_LIMIT,
      });
      setPages(response.pages);
    } catch (error) {
      setFindError(friendlyMessage(error, "Could not list that site's pages."));
    } finally {
      setFinding(false);
    }
  }

  function toggle(url: string) {
    setSelected((previous) => {
      const next = new Set(previous);
      if (next.has(url)) next.delete(url);
      else if (next.size < MAX_IMPORT_PAGES) next.add(url);
      return next;
    });
  }

  function selectAllVisible() {
    setSelected((previous) => {
      const next = new Set(previous);
      for (const page of visible) {
        if (next.size >= MAX_IMPORT_PAGES) break;
        next.add(page.url);
      }
      return next;
    });
  }

  async function importSelected() {
    setImporting(true);
    setImportError(null);
    try {
      setOutcome(
        await api.library.siteImport({
          urls: [...selected],
          ...(linkToSet && defaultSet ? { set: defaultSet } : {}),
        }),
      );
    } catch (error) {
      setImportError(friendlyMessage(error, "Import failed."));
    } finally {
      setImporting(false);
    }
  }

  if (outcome) {
    return (
      <div className="flex flex-col gap-3 text-sm">
        <p className="font-medium text-foreground">
          {outcome.queued} {outcome.queued === 1 ? "page" : "pages"} queued
        </p>
        <p className="text-xs text-muted-foreground">
          They are added as ingest jobs, a few at a time. Follow progress in Activity.
        </p>
        {outcome.skipped.length > 0 && (
          <div>
            <p className="text-xs font-medium text-foreground">Skipped ({outcome.skipped.length})</p>
            <ul className="mt-1 max-h-48 overflow-y-auto rounded-md border border-border/70 px-2">
              {outcome.skipped.map((entry) => (
                <li key={entry.url} className="border-b border-border/70 py-1.5 text-xs last:border-b-0">
                  <span className="block break-all text-foreground">{entry.url}</span>
                  <span className="text-muted-foreground">{entry.reason}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
        <Button className="h-11 w-full sm:h-8" onClick={onClose}>
          Done
        </Button>
      </div>
    );
  }

  const atCap = selected.size >= MAX_IMPORT_PAGES;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-2">
        <Input
          type="url"
          placeholder="https://docs.example.com"
          aria-label="Documentation site URL"
          value={siteUrl}
          onChange={(event) => setSiteUrl(event.target.value)}
          className="h-11"
        />
        <Input
          placeholder="Only pages matching… (optional)"
          aria-label="Search filter for the site map"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          className="h-11"
        />
        <Button className="h-11 w-full sm:h-8" disabled={finding || siteUrl.trim() === ""} onClick={findPages}>
          {finding ? <Loader2Icon className="animate-spin" aria-hidden="true" /> : null}
          {finding ? "Finding…" : "Find pages"}
        </Button>
        {findError && <p className="text-xs text-destructive">{findError}</p>}
        {pages === null && !finding && !findError && (
          <p className="text-xs text-muted-foreground">
            Lists the pages of a documentation site so you can import several at once.
          </p>
        )}
      </div>

      {pages !== null && pages.length === 0 && <p className="text-sm text-muted-foreground">No pages found.</p>}

      {pages !== null && pages.length > 0 && (
        <>
          <Input
            placeholder="Filter pages…"
            aria-label="Filter pages"
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            className="h-11"
          />
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span>
              {selected.size} of {pages.length} selected
            </span>
            <span className="ms-auto flex gap-1">
              <Button variant="outline" size="sm" className="h-9 sm:h-7" onClick={selectAllVisible}>
                Select all
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-9 sm:h-7"
                disabled={selected.size === 0}
                onClick={() => setSelected(new Set())}
              >
                Select none
              </Button>
            </span>
          </div>
          {atCap && (
            <p className="rounded-md border border-warning/40 bg-warning/10 px-2 py-1.5 text-xs text-foreground">
              Imports are limited to {MAX_IMPORT_PAGES} pages at a time. Import these, then find more.
            </p>
          )}
          <ul className="max-h-[40vh] overflow-y-auto rounded-md border border-border/70 p-1">
            {visible.map((page) => {
              const checked = selected.has(page.url);
              return (
                <li key={page.url}>
                  <label className="flex min-h-11 cursor-pointer items-start gap-2 rounded px-2 py-1.5 text-sm hover:bg-accent/40 sm:min-h-8">
                    <input
                      type="checkbox"
                      className="mt-1 size-4 shrink-0"
                      checked={checked}
                      disabled={!checked && atCap}
                      onChange={() => toggle(page.url)}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-foreground">{pageLabel(page)}</span>
                      <span className="block truncate text-xs text-muted-foreground">{pagePath(page)}</span>
                    </span>
                  </label>
                </li>
              );
            })}
            {visible.length === 0 && <li className="px-2 py-3 text-sm text-muted-foreground">No pages match.</li>}
          </ul>

          {defaultSet && (
            <label className="flex min-h-11 cursor-pointer items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="size-4 shrink-0"
                checked={linkToSet}
                onChange={(event) => setLinkToSet(event.target.checked)}
              />
              Also link to set ({defaultSet})
            </label>
          )}
          {importError && <p className="text-xs text-destructive">{importError}</p>}
          <Button className="h-11 w-full sm:h-8" disabled={importing || selected.size === 0} onClick={importSelected}>
            {importing ? "Importing…" : `Import ${selected.size} ${selected.size === 1 ? "page" : "pages"}`}
          </Button>
        </>
      )}
    </div>
  );
}
