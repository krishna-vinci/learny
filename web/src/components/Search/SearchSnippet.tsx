import { snippetParts } from "./helpers";

export function SearchSnippet({ snippet }: { snippet: string }) {
  return (
    <>
      {snippetParts(snippet).map((part, index) =>
        part.match ? (
          // biome-ignore lint/suspicious/noArrayIndexKey: immutable ordered text fragments have no identity across snippets.
          <mark key={`${index}-${part.text}`} className="bg-primary/15 text-foreground">
            {part.text}
          </mark>
        ) : (
          part.text
        ),
      )}
    </>
  );
}
