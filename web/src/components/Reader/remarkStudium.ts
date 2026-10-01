// Studium-specific markdown extensions: directive callouts (`:::definition`, `:::theorem`,
// `:::example`, `:::deeper`) and source citations (`[^src:<id>#p<n>]`). Not derived from Memos,
// which has no equivalent syntax.
import { resolveNoteMedia, youtubeDirective } from "@studium/shared/media";
import { visit } from "unist-util-visit";

// `unist-util-visit`'s own `Node` type comes from `@types/unist`, a nested dependency not
// resolvable as a direct import here; this minimal shape is structurally compatible with it
// (every mdast/hast node has at least a `type` string) and is all the plugins below need.
interface MinimalNode {
  type: string;
  [key: string]: unknown;
}

const CALLOUT_DIRECTIVES = new Set(["definition", "theorem", "example"]);
const CITATION_PATTERN = /^src:([^#]+)#([pt])(\d+)$/;

interface DirectiveNode extends MinimalNode {
  type: "containerDirective" | "leafDirective" | "textDirective";
  name: string;
  attributes?: Record<string, string | null | undefined> | null;
  data?: { hName?: string; hProperties?: Record<string, unknown> };
}

const MAX_TITLE_CHARS = 200;

/** `{title="Rank"}` on a directive; plain text only (the reader renders it as a React text node). */
function directiveTitle(directive: DirectiveNode): string | undefined {
  const title = directive.attributes?.title;
  if (typeof title !== "string") return undefined;
  const trimmed = title.trim().slice(0, MAX_TITLE_CHARS);
  return trimmed === "" ? undefined : trimmed;
}

/**
 * remark-directive only parses `:::name` blocks into generic directive nodes; it does not know
 * how to render them. Setting `data.hName`/`data.hProperties` here is the documented hook
 * mdast-util-to-hast (via remark-rehype) uses to turn an otherwise-unknown node into a real
 * element, while leaving its children (already-parsed markdown) to render normally inside it.
 */
export function remarkStudiumDirectives(options: { plainLinks?: boolean; notePath?: string } = {}) {
  return (tree: MinimalNode) => {
    visit(tree, (node) => {
      if (node.type !== "containerDirective" && node.type !== "leafDirective" && node.type !== "textDirective") {
        return;
      }
      const directive = node as DirectiveNode;
      directive.data ??= {};
      const title = directiveTitle(directive);
      const titleProps = title === undefined ? {} : { "data-title": title };
      if (directive.type === "leafDirective" && directive.name === "youtube") {
        const video = youtubeDirective(directive.attributes ?? {});
        if (video && !options.plainLinks) {
          directive.data.hName = "div";
          directive.data.hProperties = {
            "data-youtube": video.id,
            "data-start": String(video.start),
            ...(video.end === undefined ? {} : { "data-end": String(video.end) }),
          };
        } else {
          directive.data.hName = "a";
          directive.data.hProperties = { href: directive.attributes?.src ?? "" };
          directive.children = [{ type: "text", value: directive.attributes?.src ?? "(video unavailable)" }];
        }
      } else if (directive.type === "leafDirective" && directive.name === "artifact") {
        const src = directive.attributes?.src;
        const poster = directive.attributes?.poster;
        const media = typeof src === "string" ? resolveNoteMedia(options.notePath, src, "html") : null;
        const image = typeof poster === "string" ? resolveNoteMedia(options.notePath, poster, "poster") : null;
        if (media && (poster === undefined || image)) {
          if (options.plainLinks) {
            directive.data.hName = "a";
            directive.data.hProperties = { href: `/api/sets/${media.set}/file?path=${encodeURIComponent(media.path)}` };
            directive.children = [{ type: "text", value: title ?? "Interactive figure" }];
          } else {
            directive.data.hName = "div";
            directive.data.hProperties = {
              "data-artifact": `${media.set}/${media.path}`,
              ...(image ? { "data-artifact-poster": `${image.set}/${image.path}` } : {}),
              "data-artifact-title": title ?? "Interactive figure",
            };
          }
        } else {
          directive.data.hName = "div";
          directive.data.hProperties = { "data-artifact-unavailable": "true" };
          directive.children = [{ type: "text", value: "(interactive figure unavailable)" }];
        }
      } else if (CALLOUT_DIRECTIVES.has(directive.name)) {
        directive.data.hName = "div";
        directive.data.hProperties = { "data-callout": directive.name, ...titleProps };
      } else if (directive.name === "deeper") {
        directive.data.hName = "div";
        directive.data.hProperties = { "data-deeper": "true", ...titleProps };
      }
    });
  };
}

interface FootnoteReferenceNode extends MinimalNode {
  type: "footnoteReference";
  identifier: string;
  label?: string;
  data?: { hProperties?: Record<string, unknown> };
}

/**
 * Tags footnote references shaped like `[^src:<id>#p<n>]` (parsed as ordinary GFM footnotes by
 * remark-gfm) so `MarkdownView` can render them as citation superscripts with a `<id>, p.<n>`
 * tooltip instead of a plain numbered footnote link. mdast-util-to-hast's footnote-reference
 * handler applies `data.hProperties` to the outer `<sup>` it builds, not the inner `<a>`, so
 * `MarkdownView` matches on `sup` rather than `a`.
 */
export function remarkStudiumCitations() {
  return (tree: MinimalNode) => {
    visit(tree, (node) => {
      if (node.type !== "footnoteReference") return;
      const ref = node as FootnoteReferenceNode;
      const label = ref.label ?? ref.identifier;
      const match = CITATION_PATTERN.exec(label);
      if (!match) return;
      ref.data ??= {};
      ref.data.hProperties = {
        ...ref.data.hProperties,
        "data-citation-src": match[1],
        "data-citation-page": match[2] === "p" ? match[3] : "",
        "data-citation-time": match[2] === "t" ? match[3] : "",
      };
    });
  };
}
