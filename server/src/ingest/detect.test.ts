import { describe, expect, it } from "vitest";
import { arxivPdfUrl, detectInput } from "./detect.js";
import { UnsupportedInputError } from "./types.js";

const ascii = (text: string): Uint8Array => new TextEncoder().encode(text);

describe("detectInput", () => {
  it("classifies URLs by host service", () => {
    expect(detectInput({ url: "https://en.wikipedia.org/wiki/Linear_algebra" })).toBe("wikipedia");
    expect(detectInput({ url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ" })).toBe("youtube");
    expect(detectInput({ url: "https://youtu.be/dQw4w9WgXcQ" })).toBe("youtube");
    expect(detectInput({ url: "https://arxiv.org/abs/1706.03762" })).toBe("arxiv");
    expect(detectInput({ url: "https://doi.org/10.1000/182" })).toBe("doi");
    expect(detectInput({ url: "https://example.com/blog/post" })).toBe("web");
  });

  it("classifies URLs by file extension", () => {
    expect(detectInput({ url: "https://example.com/paper.pdf" })).toBe("pdf");
    expect(detectInput({ url: "https://example.com/book.epub" })).toBe("epub");
    expect(detectInput({ url: "https://example.com/page.html" })).toBe("web");
    expect(detectInput({ url: "https://example.com/notes.md" })).toBe("markdown");
  });

  it("classifies filenames case-insensitively", () => {
    expect(detectInput({ filename: "BOOK.EPUB" })).toBe("epub");
    expect(detectInput({ filename: "deck.pptx" })).toBe("pptx");
    expect(detectInput({ filename: "photo.JPG" })).toBe("image");
    expect(detectInput({ filename: "talk.mp3" })).toBe("audio");
  });

  it("falls back to the MIME type", () => {
    expect(detectInput({ mime: "application/pdf" })).toBe("pdf");
    expect(detectInput({ mime: "text/html; charset=utf-8" })).toBe("html");
    expect(detectInput({ mime: "audio/mpeg" })).toBe("audio");
  });

  it("sniffs magic bytes", () => {
    expect(detectInput({ bytes: ascii("%PDF-1.4\n...") })).toBe("pdf");
    expect(detectInput({ bytes: ascii("PK\u0003\u0004application/epub+zip") })).toBe("epub");
    expect(detectInput({ bytes: ascii("PK\u0003\u0004xxxxword/document.xml") })).toBe("docx");
    expect(detectInput({ bytes: ascii("<!DOCTYPE html><html></html>") })).toBe("html");
    expect(detectInput({ bytes: ascii("just some plain text") })).toBe("text");
  });

  it("throws when nothing matches", () => {
    expect(() => detectInput({ bytes: new Uint8Array([0x00, 0xff, 0x00]) })).toThrow(UnsupportedInputError);
    expect(() => detectInput({})).toThrow(UnsupportedInputError);
  });
});

describe("arxivPdfUrl", () => {
  it("normalizes arXiv URLs and bare ids to the PDF endpoint", () => {
    expect(arxivPdfUrl("https://arxiv.org/abs/1706.03762")).toBe("https://arxiv.org/pdf/1706.03762");
    expect(arxivPdfUrl("https://arxiv.org/pdf/1706.03762v5.pdf")).toBe("https://arxiv.org/pdf/1706.03762v5");
    expect(arxivPdfUrl("arXiv:1706.03762")).toBe("https://arxiv.org/pdf/1706.03762");
    expect(arxivPdfUrl("1706.03762")).toBe("https://arxiv.org/pdf/1706.03762");
    expect(arxivPdfUrl("math.GT/0309136")).toBe("https://arxiv.org/pdf/math.GT/0309136");
  });

  it("rejects non-arXiv identifiers", () => {
    expect(() => arxivPdfUrl("https://example.com/paper")).toThrow(UnsupportedInputError);
  });
});
