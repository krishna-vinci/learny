type Token = { marker: string; html: string; block: boolean };

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function tokenise(markdown: string): { text: string; tokens: Token[] } {
  const tokens: Token[] = [];
  const add = (html: string, block: boolean): string => {
    const marker = `\u0000STUDIUM${tokens.length}\u0000`;
    tokens.push({ marker, html, block });
    return marker;
  };

  let text = markdown.replace(
    /```([a-z0-9_-]*)[ \t]*\r?\n([\s\S]*?)```/gi,
    (_match, language: string, code: string) => {
      const className = language === "" ? "" : ` class="language-${language.toLowerCase()}"`;
      return `\n${add(`<pre><code${className}>${escapeHtml(code.replace(/\r?\n$/, ""))}</code></pre>`, true)}\n`;
    },
  );

  text = text.replace(/\$\$([\s\S]*?)\$\$/g, (_match, math: string) => {
    return `\n${add(`\\[${escapeHtml(math.trim())}\\]`, true)}\n`;
  });

  text = text.replace(/`([^`\n]+)`/g, (_match, code: string) => add(`<code>${escapeHtml(code)}</code>`, false));
  text = text.replace(/(^|[^\\$])\$(?!\s|\$)([^$\n]*?\S)\$(?!\$)/g, (_match, prefix: string, math: string) => {
    return `${prefix}${add(`\\(${escapeHtml(math)}\\)`, false)}`;
  });

  return { text, tokens };
}

function restoreTokens(value: string, tokens: Token[]): string {
  let restored = value;
  for (const token of tokens) restored = restored.replaceAll(token.marker, token.html);
  return restored;
}

function inlineMarkdown(value: string, tokens: Token[]): string {
  let html = escapeHtml(value);
  html = html.replace(/\[([^\]]+)]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2">$1</a>');
  html = html.replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>");
  html = html.replace(/__([^_\n]+)__/g, "<strong>$1</strong>");
  html = html.replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, "$1<em>$2</em>");
  html = html.replace(/(^|[^_])_([^_\n]+)_(?!_)/g, "$1<em>$2</em>");
  return restoreTokens(
    html,
    tokens.filter((token) => !token.block),
  );
}

/** Convert the deliberately small Markdown subset used in cards to Anki-safe HTML. */
export function markdownToAnkiHtml(markdown: string): string {
  const normalised = markdown.replaceAll("\r\n", "\n").trim();
  if (normalised === "") return "";

  const { text, tokens } = tokenise(normalised);
  const blockTokens = new Map(tokens.filter((token) => token.block).map((token) => [token.marker, token.html]));
  const lines = text.split("\n");
  const output: string[] = [];
  let paragraph: string[] = [];
  let listType: "ul" | "ol" | null = null;
  let listItems: string[] = [];

  const flushParagraph = () => {
    if (paragraph.length === 0) return;
    output.push(`<p>${inlineMarkdown(paragraph.join(" ").trim(), tokens)}</p>`);
    paragraph = [];
  };
  const flushList = () => {
    if (listType === null) return;
    output.push(
      `<${listType}>${listItems.map((item) => `<li>${inlineMarkdown(item, tokens)}</li>`).join("")}</${listType}>`,
    );
    listType = null;
    listItems = [];
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    const block = blockTokens.get(line);
    if (block !== undefined) {
      flushParagraph();
      flushList();
      output.push(block);
      continue;
    }
    if (line === "") {
      flushParagraph();
      flushList();
      continue;
    }

    const heading = /^(#{1,6})\s+(.+)$/.exec(line);
    if (heading?.[1] !== undefined && heading[2] !== undefined) {
      flushParagraph();
      flushList();
      const level = heading[1].length;
      output.push(`<h${level}>${inlineMarkdown(heading[2], tokens)}</h${level}>`);
      continue;
    }

    const unordered = /^[-+*]\s+(.+)$/.exec(line);
    const ordered = /^\d+[.)]\s+(.+)$/.exec(line);
    const nextListType = unordered !== null ? "ul" : ordered !== null ? "ol" : null;
    if (nextListType !== null) {
      flushParagraph();
      if (listType !== null && listType !== nextListType) flushList();
      listType = nextListType;
      listItems.push((unordered?.[1] ?? ordered?.[1]) as string);
      continue;
    }

    flushList();
    paragraph.push(line);
  }

  flushParagraph();
  flushList();
  return output.join("\n");
}

export { escapeHtml };
