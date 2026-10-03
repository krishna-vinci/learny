// Live-preview math rendering (item 3 of the formatted-text-while-typing follow-up):
// replaces `$…$`/`$$…$$` with a KaTeX widget when the cursor is outside it. Lazy-loads
// `katex` the same way `web/src/lib/katex-loader.ts` lazy-loads `rehype-katex` (lib/
// katex-loader.ts itself wraps `rehype-katex`, which renders through a hast tree for
// React — not usable from a CodeMirror widget, so this loads the `katex` package's own
// `renderToString` directly, reusing that file's lazy-import-the-CSS trick).

import { StateEffect } from "@codemirror/state";
import { type EditorView, WidgetType } from "@codemirror/view";

type KatexModule = typeof import("katex");

let katexModule: KatexModule | null = null;
let katexPending: Promise<KatexModule> | null = null;
const waitingViews = new Set<EditorView>();

/** Dispatched at every view waiting on a katex load once it resolves, so livePreview.ts's
 * ViewPlugin rebuilds its decorations and swaps the loading placeholder for the real
 * render — a widget already in the DOM doesn't re-run `toDOM` on its own. */
export const katexReadyEffect = StateEffect.define<void>();

function loadKatexModule(): Promise<KatexModule> {
  katexPending ??= Promise.all([import("katex"), import("katex/dist/katex.min.css")]).then(
    ([mod]) => {
      katexModule = mod;
      for (const view of waitingViews) view.dispatch({ effects: katexReadyEffect.of(undefined) });
      waitingViews.clear();
      return mod;
    },
    (error: unknown) => {
      katexPending = null;
      waitingViews.clear();
      throw error;
    },
  );
  return katexPending;
}

/** True when katex is already loaded. Otherwise kicks off (or joins) the load and
 * registers `view` to be notified (via `katexReadyEffect`) once it resolves. */
export function ensureKatexLoaded(view: EditorView): boolean {
  if (katexModule) return true;
  waitingViews.add(view);
  loadKatexModule().catch(() => {
    console.warn("studium: katex failed to load; showing math source instead");
  });
  return false;
}

const renderCache = new Map<string, string>();

function renderKatex(mod: KatexModule, src: string, displayMode: boolean): string {
  const key = `${displayMode ? "d" : "i"}:${src}`;
  const cached = renderCache.get(key);
  if (cached !== undefined) return cached;
  let html: string;
  try {
    html = mod.default.renderToString(src, { throwOnError: false, output: "html", displayMode });
  } catch (error) {
    console.warn("studium: katex render failed; showing math source instead", error);
    html = "";
  }
  renderCache.set(key, html);
  return html;
}

/** Replaces a `$…$`/`$$…$$` span with its rendered form. Clicking it places the cursor at
 * the start of the math source (`sourceFrom`), which — combined with livePreview.ts hiding
 * the widget whenever the cursor sits inside the span — is enough to "open" it for editing. */
export class MathWidget extends WidgetType {
  constructor(
    readonly src: string,
    readonly displayMode: boolean,
    readonly sourceFrom: number,
  ) {
    super();
  }

  override eq(other: MathWidget): boolean {
    return other.src === this.src && other.displayMode === this.displayMode;
  }

  toDOM(view: EditorView): HTMLElement {
    const wrap = document.createElement(this.displayMode ? "div" : "span");
    wrap.className = `cm-sm-math-widget${this.displayMode ? " cm-sm-math-widget-block" : ""}`;
    if (katexModule) {
      wrap.innerHTML = renderKatex(katexModule, this.src, this.displayMode);
    } else {
      wrap.textContent = this.displayMode ? `$$${this.src}$$` : `$${this.src}$`;
      wrap.classList.add("cm-sm-math-loading");
      ensureKatexLoaded(view);
    }
    wrap.addEventListener("mousedown", (event) => {
      event.preventDefault();
      view.dispatch({ selection: { anchor: this.sourceFrom } });
      view.focus();
    });
    return wrap;
  }

  override ignoreEvent(): boolean {
    return false;
  }
}
