// Adapted from Memos (MIT) — https://github.com/usememos/memos
import { defaultSchema } from "rehype-sanitize";

// Class names remark-math emits on the `<code>` element it represents math as, before
// rehype-katex (which runs after sanitization) replaces it with rendered KaTeX markup.
const KATEX_INLINE_CLASS_NAMES = ["language-math", "math-inline"] as const;
const KATEX_BLOCK_CLASS_NAMES = ["language-math", "math-display"] as const;

/**
 * Sanitization schema for a rendered note body. Extends the default (GitHub-style) schema to
 * allow:
 * - the KaTeX marker classes used before trusted KaTeX rendering runs (see above)
 * - Studium's directive callout (`data-callout`, `data-deeper`) and citation
 *   (`data-citation-src`, `data-citation-page`) attributes, set only by our own remark plugins
 *   in `remarkStudium.ts` — never by note content directly
 * - the `open` attribute on `<details>`, used by the `:::deeper` callout
 *
 * This prevents XSS from note bodies (which may be edited by an agent) while preserving math,
 * table, and directive rendering.
 */
export const SANITIZE_SCHEMA = {
  ...defaultSchema,
  // Don't re-prefix `id`/`name` attributes. remark-rehype already namespaces footnote ids with
  // `user-content-` and emits matching `#user-content-…` hrefs; the default schema's clobbering
  // would prepend a *second* `user-content-` to the ids only (not the hrefs), breaking in-page
  // footnote navigation.
  clobber: [],
  attributes: {
    ...defaultSchema.attributes,
    code: [...(defaultSchema.attributes?.code || []), ["className", ...KATEX_INLINE_CLASS_NAMES, ...KATEX_BLOCK_CLASS_NAMES]],
    div: [...(defaultSchema.attributes?.div || []), ["data*"]],
    sup: [...(defaultSchema.attributes?.sup || []), ["data*"]],
    details: [...(defaultSchema.attributes?.details || []), "open"],
  },
};
