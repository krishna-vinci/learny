// Studium-specific markdown extensions: directive callouts (`:::definition`, `:::theorem`,
// `:::example`, `:::deeper`) and source citations (`[^src:<id>#p<n>]`). Not derived from Memos,
// which has no equivalent syntax.
import { parseYoutubeVideo, resolveNoteMedia, type YouTubeVideo, youtubeDirective } from "@studium/shared/media";
import { SKIP, visit } from "unist-util-visit";

// `unist-util-visit`'s own `Node` type comes from `@types/unist`, a nested dependency not
// resolvable as a direct import here; this minimal shape is structurally compatible with it
// (every mdast/hast node has at least a `type` string) and is all the plugins below need.
interface MinimalNode {
  type: string;
  children?: MinimalNode[];
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
      } else if (directive.type === "leafDirective" && (directive.name === "artifact" || directive.name === "visual")) {
        // A declaration reaching prose is misplaced: collectable ones are stripped from the body
        // by chapterVisuals before the reader renders it. Chat keeps a plain link to the file.
        const src = directive.attributes?.src;
        const media =
          typeof src === "string"
            ? resolveNoteMedia(options.notePath, src, directive.name === "visual" ? "visual" : "html")
            : null;
        if (options.plainLinks) {
          if (media) {
            directive.data.hName = "a";
            directive.data.hProperties = { href: `/api/sets/${media.set}/file?path=${encodeURIComponent(media.path)}` };
            directive.children = [{ type: "text", value: title ?? "Interactive figure" }];
          } else {
            directive.data.hName = "div";
            directive.data.hProperties = { "data-visual-misplaced": "true" };
            directive.children = [{ type: "text", value: "(interactive figure unavailable)" }];
          }
        } else {
          directive.data.hName = "div";
          directive.data.hProperties = { "data-visual-misplaced": "true" };
          directive.children = [];
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

/** Preserve links/labels and add block players outside prose/heading phrasing. */
export function remarkStudiumVideos() {
  return (tree: MinimalNode) => {
    const definitions = new Map<string, string>();
    visit(tree, (node) => {
      if (node.type !== "definition") return;
      if (typeof node.identifier === "string" && typeof node.url === "string")
        definitions.set(node.identifier.toUpperCase(), node.url);
    });
    // Footnotes and table cells keep plain links: a player there clutters citations and breaks
    // narrow tables on phones.
    const plainOnly = new WeakSet<MinimalNode>();
    visit(tree, (node) => {
      if (node.type !== "footnoteDefinition" && node.type !== "table") return;
      visit(node, (child) => {
        plainOnly.add(child as MinimalNode);
      });
    });
    visit(tree, (node, index, parent) => {
      if (!["paragraph", "heading"].includes(node.type) || plainOnly.has(node)) return;
      const block = parent as MinimalNode | undefined;
      if (index === undefined || !block || !Array.isArray(block.children)) return;
      const videos = new Map<string, YouTubeVideo>();
      function add(url: string): YouTubeVideo | null {
        const video = parseYoutubeVideo(url);
        if (video) videos.set(`${video.id}/${video.start}/${video.end ?? ""}`, video);
        return video;
      }
      function scan(node: MinimalNode): void {
        if (node.type === "link" && typeof node.url === "string") {
          add(node.url);
          return;
        }
        if (node.type === "linkReference" && typeof node.identifier === "string") {
          add(definitions.get(node.identifier.toUpperCase()) ?? "");
          return;
        }
        if (!Array.isArray(node.children)) return;
        const children = node.children as MinimalNode[];
        for (let i = 0; i < children.length; i++) {
          const child = children[i];
          if (!child) continue;
          if (child.type !== "text" || typeof child.value !== "string") {
            scan(child);
            continue;
          }
          // GFM handles http(s)/www autolinks; this also covers scheme-less pasted shares.
          const text = child.value;
          const parts: MinimalNode[] = [];
          let offset = 0;
          for (const match of text.matchAll(
            /(?:^|[\s(])((?:(?:https?:)?\/\/)?(?:(?:www|m|music)\.)?(?:youtube(?:-nocookie)?\.com|youtu\.be)\/[^\s<>"']+)/gi,
          )) {
            const raw = (match[1] ?? "").replace(/[.,!?:;)\]]+$/, "");
            const video = add(raw);
            if (!video) continue;
            const start = match.index + match[0].indexOf(match[1] ?? "");
            parts.push(
              { type: "text", value: text.slice(offset, start) },
              {
                type: "link",
                url: `https://www.youtube.com/watch?v=${video.id}&t=${video.start}s`,
                children: [{ type: "text", value: raw }],
              },
            );
            offset = start + raw.length;
          }
          if (parts.length) {
            parts.push({ type: "text", value: text.slice(offset) });
            children.splice(i, 1, ...parts);
            i += parts.length - 1;
          }
        }
      }
      scan(node);
      const adjacent = [block.children[index - 1], block.children[index + 1]]
        .filter((item) => item?.type === "leafDirective" && item.name === "youtube")
        .map((item) => youtubeDirective((item as DirectiveNode).attributes ?? {}));
      const embeds = [...videos.values()]
        .filter((video) => !adjacent.some((directive) => directive?.id === video.id && directive.start === video.start))
        .map((video) => ({
          type: "youtubeEmbed",
          children: [],
          data: {
            hName: "div",
            hProperties: {
              "data-youtube": video.id,
              "data-start": String(video.start),
              ...(video.end === undefined ? {} : { "data-end": String(video.end) }),
            },
          },
        }));
      block.children.splice(index + 1, 0, ...embeds);
      return [SKIP, index + 1 + embeds.length];
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

function elementText(node: MinimalNode): string {
  if (node.type === "text") return typeof node.value === "string" ? node.value : "";
  return (node.children ?? []).map(elementText).join("");
}

/**
 * `NoteImage` prints an image's `Credit:` title below it, and agents sometimes also write the
 * same credit as its own paragraph. Drop that paragraph when it just repeats the image title
 * so the reader (and the book, which shares the convention) does not show the credit twice.
 */
export function rehypeDedupeCredits() {
  return (tree: MinimalNode) => {
    visit(tree, (node) => {
      const children = node.children;
      if (!children) return;
      for (let index = 0; index < children.length; index++) {
        const child = children[index];
        if (child?.type !== "element") continue;
        const image = child.tagName === "img" ? child : child.tagName === "p" ? findImage(child) : undefined;
        const title = (image?.properties as Record<string, unknown> | undefined)?.title;
        if (typeof title !== "string" || !/^Credit:\s*\S/.test(title)) continue;
        // Markdown leaves whitespace text nodes between blocks; skip them.
        let nextIndex = index + 1;
        while (
          nextIndex < children.length &&
          children[nextIndex]?.type === "text" &&
          !String(children[nextIndex]?.value ?? "").trim()
        )
          nextIndex++;
        const next = children[nextIndex];
        if (next?.type === "element" && next.tagName === "p" && elementText(next).trim() === title.trim())
          children.splice(nextIndex, 1);
      }
    });
  };
}

function findImage(node: MinimalNode): MinimalNode | undefined {
  if (node.type === "element" && node.tagName === "img") return node;
  for (const child of node.children ?? []) {
    const found = findImage(child);
    if (found) return found;
  }
  return undefined;
}
