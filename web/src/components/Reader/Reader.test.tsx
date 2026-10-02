import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MarkdownView } from "./MarkdownView";

// `vitest.config.ts` runs with `globals: false`, so @testing-library/react's automatic
// afterEach cleanup (which relies on detecting a global `afterEach`) never registers itself;
// without this, each `render()` below would stack onto the previous test's DOM.
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const SAMPLE = `Inline math $x^2$ and a citation [^src:lib-strang-la#p364].

:::deeper
Hidden depth content.
:::

[^src:lib-strang-la#p364]: Strang, *Introduction to Linear Algebra*, ch. 7.
`;

describe("MarkdownView", () => {
  it("resolves local images from the note and blocks paths outside the set", () => {
    render(
      <MarkdownView
        notePath="alpha/notes/x.md"
        content={
          '![Figure](../assets/fig.svg "Vectors")\n\n![Escape](../../beta/assets/x.png)\n\n![Remote](https://example.org/x.png)'
        }
      />,
    );
    expect(screen.getByAltText("Figure").getAttribute("src")).toBe("/api/sets/alpha/asset?path=assets%2Ffig.svg");
    expect(screen.getByAltText("Figure").getAttribute("loading")).toBe("lazy");
    expect(screen.getByAltText("Figure").className).toContain("bg-white");
    expect(screen.getByText("Vectors")).toBeTruthy();
    expect(screen.queryByAltText("Escape")).toBeNull();
    expect(screen.getByAltText("Remote").getAttribute("src")).toBe("https://example.org/x.png");
  });

  it("renders inline math via KaTeX, loaded on demand", async () => {
    render(<MarkdownView content={SAMPLE} />);
    await waitFor(() => expect(document.querySelector(".katex")).not.toBeNull());
  });

  it("does not load KaTeX for a note without math", async () => {
    render(<MarkdownView content={"Just **prose** with no formulas."} />);
    expect(screen.getByText("prose")).toBeTruthy();
    expect(document.querySelector(".katex")).toBeNull();
  });

  it("renders a `:::deeper` block as a collapsed details element", async () => {
    render(<MarkdownView content={SAMPLE} />);
    await screen.findByText("Hidden depth content.");
    const details = document.querySelector("details");
    expect(details).not.toBeNull();
    expect(details?.open).toBe(false);
    expect(screen.getByText("Deeper")).toBeTruthy();
    expect(screen.getByText("Hidden depth content.")).toBeTruthy();
  });

  it("renders a source citation with tooltip text", async () => {
    render(<MarkdownView content={SAMPLE} />);
    expect(await screen.findByTitle("lib-strang-la, p.364")).toBeTruthy();
  });

  it("shows a directive title in the callout header and as the deeper summary", () => {
    render(
      <MarkdownView
        content={`:::definition{title="Rank"}\nThe number of pivots.\n:::\n\n:::deeper{title="Why it works"}\nProof sketch.\n:::\n\n:::example\nNo title.\n:::\n`}
      />,
    );
    expect(screen.getByText("Definition · Rank")).toBeTruthy();
    expect(screen.getByText("Why it works").tagName).toBe("SUMMARY");
    expect(screen.getByText("Example")).toBeTruthy();
  });

  it("renders a directive title as text, never HTML", () => {
    render(<MarkdownView content={`:::theorem{title="<img src=x onerror=alert(1)>"}\nBody.\n:::\n`} />);
    expect(document.querySelector("img")).toBeNull();
    expect(screen.getByText("Theorem · <img src=x onerror=alert(1)>")).toBeTruthy();
  });
});

it("loads a YouTube player only after tapping, with a local thumbnail and time bounds", async () => {
  const fetch = vi.fn(async () => ({
    ok: true,
    json: async () => [{ id: "lib-video", type: "video", url: "https://youtu.be/dQw4w9WgXcQ", title: "Lecture" }],
  }));
  vi.stubGlobal("fetch", fetch);
  render(<MarkdownView content={'::youtube{src="https://youtu.be/dQw4w9WgXcQ" start=843 end=900}'} />);
  expect(document.querySelector("iframe")).toBeNull();
  expect((await screen.findByAltText("Lecture")).getAttribute("src")).toBe("/api/library/lib-video/thumb");
  fireEvent.click(screen.getByRole("button", { name: "Play video" }));
  expect(document.querySelector("iframe")?.getAttribute("src")).toBe(
    "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?start=843&end=900&autoplay=1",
  );
  expect(screen.getByText("Watch on YouTube").getAttribute("href")).toContain("&t=843s");
  expect(fetch.mock.calls.flat().join(" ")).not.toContain("ytimg");
});
it("degrades invalid YouTube directives to links and still drops raw iframes", () => {
  render(
    <MarkdownView
      content={'::youtube{src="https://youtu.be/invalid" start=-1}\n\n<iframe src="https://example.org"></iframe>'}
    />,
  );
  expect(screen.getByRole("link").getAttribute("href")).toBe("https://youtu.be/invalid");
  expect(document.querySelector("iframe")).toBeNull();
});
it("accepts timestamp citations next to page citations", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: false })),
  );
  render(<MarkdownView content={"Moment [^src:lib-video#t843].\n\n[^src:lib-video#t843]: Video."} />);
  expect(await screen.findByTitle("lib-video, at 14:03")).toBeTruthy();
});

it("renders a lazy inline chart and falls back to readable code on invalid JSON", async () => {
  vi.doMock("@/lib/vega-loader", () => ({
    createChartView: (_code: string, _width: number, _colors: unknown, container: HTMLElement) => {
      JSON.parse(_code);
      const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      container.append(svg);
      return { runAsync: async () => {}, finalize: () => {} };
    },
  }));
  const view = render(<MarkdownView content={'```vega-lite\n{"data":{"values":[{"x":1}]},"mark":"point"}\n```'} />);
  await waitFor(() => expect(document.querySelector('[aria-label="Data chart"] svg')).not.toBeNull());
  view.rerender(<MarkdownView content={"```vega-lite\n{bad json}\n```"} />);
  expect(await screen.findByText("Chart couldn't be drawn")).toBeTruthy();
  expect(screen.getByText("{bad json}")).toBeTruthy();
  vi.doUnmock("@/lib/vega-loader");
});

it("runs an artifact only after tapping with an exact sandbox and first-document CSP", async () => {
  const { ARTIFACT_CSP } = await import("./ArtifactBlock");
  const fetch = vi.fn(async () => ({
    ok: true,
    json: async () => ({ raw: "<!doctype html><script>fetch('https://example.org')</script>" }),
  }));
  vi.stubGlobal("fetch", fetch);
  render(
    <MarkdownView
      notePath="alpha/notes/x.md"
      content={'::artifact{src="../artifacts/demo.html" poster="../artifacts/demo.svg" title="Explore vectors"}'}
    />,
  );
  expect((await screen.findByAltText("Explore vectors")).getAttribute("src")).toBe(
    "/api/sets/alpha/asset?path=artifacts%2Fdemo.svg",
  );
  expect(document.querySelector("iframe")).toBeNull();
  expect(fetch).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Run" }));
  await waitFor(() => expect(document.querySelector("iframe")).not.toBeNull());
  expect(document.querySelector("iframe")?.getAttribute("sandbox")).toBe("allow-scripts");
  expect(document.querySelector("iframe")?.getAttribute("srcdoc")).toBe(
    `${ARTIFACT_CSP}<!doctype html><script>fetch('https://example.org')</script>`,
  );
  expect(fetch).toHaveBeenCalledWith("/api/sets/alpha/file?path=artifacts%2Fdemo.html");
});
it("rejects artifacts outside the set, under notes or with the wrong extension", () => {
  for (const src of ["../../beta/artifacts/x.html", "../notes/x.html", "../artifacts/x.js"]) {
    const view = render(<MarkdownView notePath="alpha/notes/x.md" content={`::artifact{src="${src}"}`} />);
    expect(screen.getByText("(interactive figure unavailable)")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Run" })).toBeNull();
    view.unmount();
  }
});
it("shows an artifact fetch failure and allows retry", async () => {
  const fetch = vi
    .fn()
    .mockRejectedValueOnce(new Error("offline"))
    .mockResolvedValueOnce({ ok: true, json: async () => ({ raw: "<p>Ready</p>" }) });
  vi.stubGlobal("fetch", fetch);
  render(<MarkdownView notePath="alpha/notes/x.md" content={'::artifact{src="../artifacts/demo.html"}'} />);
  fireEvent.click(screen.getByRole("button", { name: "Run" }));
  expect(await screen.findByRole("alert")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Try again" }));
  await waitFor(() => expect(document.querySelector("iframe")).not.toBeNull());
});

it.each([
  ["https://youtube.com/watch?v=dQw4w9WgXcQ&t=843", 843],
  ["https://youtu.be/dQw4w9WgXcQ?si=abc&t=14m3s", 843],
  ["https://m.youtube.com/watch?v=dQw4w9WgXcQ#t=2385", 2385],
  ["https://music.youtube.com/watch?v=dQw4w9WgXcQ&list=abc", 0],
  ["https://youtube.com/shorts/dQw4w9WgXcQ", 0],
  ["https://youtube.com/embed/dQw4w9WgXcQ?start=12&end=20", 12],
  ["https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ", 0],
  ["https://www.youtu.be/dQw4w9WgXcQ", 0],
])("embeds ordinary Markdown video links %s after a click", async (url, start) => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: false })),
  );
  const { container } = render(<MarkdownView content={`Watch [this **lecture**](${url}) for the example.`} />);
  const button = await screen.findByRole("button", { name: "Play video" });
  expect(screen.getByRole("link", { name: "this lecture" }).getAttribute("href")).toBe(url);
  expect(container.querySelector("p section, p div, a section")).toBeNull();
  expect(container.querySelector("iframe")).toBeNull();
  fireEvent.click(button);
  const iframe = container.querySelector("iframe");
  expect(iframe?.getAttribute("src")).toContain(`/embed/dQw4w9WgXcQ?start=${start}`);
  expect(iframe?.getAttribute("referrerpolicy")).toBe("strict-origin-when-cross-origin");
});
it.each([
  "https://youtu.be/dQw4w9WgXcQ?t=12",
  "<https://youtu.be/dQw4w9WgXcQ?t=12>",
  "youtu.be/dQw4w9WgXcQ?t=12",
  "www.youtube.com/watch?v=dQw4w9WgXcQ&t=12",
  "[Lecture][video]\n\n[video]: https://youtu.be/dQw4w9WgXcQ?t=12",
  "> [Lecture](https://youtu.be/dQw4w9WgXcQ?t=12)",
  "- [Lecture](https://youtu.be/dQw4w9WgXcQ?t=12)",
  '::youtube{src="https://youtu.be/dQw4w9WgXcQ?t=12"}',
])("embeds pasted, reference and directive forms: %s", async (content) => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: false })),
  );
  render(<MarkdownView content={content} />);
  fireEvent.click(await screen.findByRole("button", { name: "Play video" }));
  expect(document.querySelector("iframe")?.getAttribute("src")).toContain("?start=12");
});
it("leaves code, channel links, lookalikes and hostile HTML inert", async () => {
  render(
    <MarkdownView
      content={
        '`https://youtu.be/dQw4w9WgXcQ`\n\n```md\nhttps://youtu.be/dQw4w9WgXcQ\n```\n\n[Channel](https://youtube.com/unesco)\n\n[Fake](https://youtube.com.evil.test/watch?v=dQw4w9WgXcQ)\n\n::youtube{src="javascript:alert(1)"}\n\n<div data-youtube="dQw4w9WgXcQ"><script>alert(1)</script></div>'
      }
    />,
  );
  await screen.findByText("Channel");
  expect(screen.queryByRole("button", { name: "Play video" })).toBeNull();
  expect(document.querySelector("iframe, script, [href^='javascript:']")).toBeNull();
});
it("deduplicates a repeated moment in one paragraph and keeps distinct moments", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: false })),
  );
  render(
    <MarkdownView
      content={
        "[One](https://youtu.be/dQw4w9WgXcQ?t=12) and [same](https://youtube.com/watch?v=dQw4w9WgXcQ&t=12), then [two](https://youtu.be/dQw4w9WgXcQ?t=20)."
      }
    />,
  );
  await waitFor(() => expect(screen.getAllByRole("button", { name: "Play video" })).toHaveLength(2));
});

it("keeps a portable link next to its explicit segment without duplicating the player", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: false })),
  );
  render(
    <MarkdownView
      content={
        '[Watch at 14:03](https://youtu.be/dQw4w9WgXcQ?t=843)\n\n::youtube{src="https://youtu.be/dQw4w9WgXcQ" start=843 end=900}'
      }
    />,
  );
  expect(await screen.findByRole("button", { name: "Play video" })).toBeTruthy();
  expect(screen.getAllByRole("button", { name: "Play video" })).toHaveLength(1);
  expect(screen.getByRole("link", { name: "Watch at 14:03" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Play video" }));
  expect(document.querySelector("iframe")?.getAttribute("src")).toContain("start=843&end=900");
});

it("validates the player component props even outside the Markdown pipeline", async () => {
  const { YouTubeEmbed } = await import("./YouTubeEmbed");
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: false })),
  );
  render(<YouTubeEmbed id={'x" onload="alert(1)'} start={0} />);
  expect(screen.getByText("(video unavailable)")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Play video" })).toBeNull();
  expect(document.querySelector("iframe")).toBeNull();
});

it("embeds heading videos but keeps table and footnote links plain", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: false })),
  );
  const { container } = render(
    <MarkdownView
      content={
        "## [Lecture](https://youtu.be/dQw4w9WgXcQ)\n\n| Video |\n| --- |\n| [Example](https://youtu.be/dQw4w9WgXcQ?t=12) |\n\nSee the talk.[^v]\n\n[^v]: Talk, https://youtu.be/dQw4w9WgXcQ?t=30"
      }
    />,
  );
  await waitFor(() => expect(screen.getAllByRole("button", { name: "Play video" })).toHaveLength(1));
  expect(container.querySelector("h2 section, tr > section, tr > div")).toBeNull();
  expect(container.querySelector("td section, td [data-youtube]")).toBeNull();
  expect(container.querySelector("td a[href*='youtu']")).not.toBeNull();
  expect(container.querySelector("section[data-footnotes] [data-youtube], .footnotes [data-youtube]")).toBeNull();
});
