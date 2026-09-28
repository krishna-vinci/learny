import JSZip from "jszip";

function escapePdfString(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

// Wrap into short lines: pdf.js truncates a single very long text run.
function contentStream(text: string): string {
  const words = text.split(/\s+/).filter((word) => word !== "");
  const lines: string[] = [];
  for (let index = 0; index < words.length; index += 8) {
    lines.push(words.slice(index, index + 8).join(" "));
  }
  if (lines.length === 0) lines.push("");
  const body = lines.map((line) => `(${escapePdfString(line)}) Tj T*\n`).join("");
  const stream = `BT /F1 12 Tf 12 TL 72 720 Td\n${body}ET`;
  return `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`;
}

/**
 * Build a minimal multi-page PDF with correct xref offsets so pdf.js can parse
 * it. `info` adds trailer metadata (title/author).
 */
export function makePdf(pageTexts: string[], info: { title?: string; author?: string } = {}): Uint8Array {
  const pageCount = pageTexts.length;
  const objects: string[] = [];
  const firstPageObj = 3;
  const fontObj = firstPageObj + pageCount * 2;
  const usesInfo = info.title !== undefined || info.author !== undefined;
  const infoObj = fontObj + 1;

  const kids = pageTexts.map((_text, index) => `${firstPageObj + index * 2} 0 R`).join(" ");
  objects[1] = "<< /Type /Catalog /Pages 2 0 R >>";
  objects[2] = `<< /Type /Pages /Kids [${kids}] /Count ${pageCount} >>`;
  for (let index = 0; index < pageCount; index++) {
    const pageObj = firstPageObj + index * 2;
    const contentObj = pageObj + 1;
    objects[pageObj] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents ${contentObj} 0 R ` +
      `/Resources << /Font << /F1 ${fontObj} 0 R >> >> >>`;
    objects[contentObj] = contentStream(pageTexts[index] ?? "");
  }
  objects[fontObj] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>";
  if (usesInfo) {
    const title = info.title === undefined ? "" : ` /Title (${escapePdfString(info.title)})`;
    const author = info.author === undefined ? "" : ` /Author (${escapePdfString(info.author)})`;
    objects[infoObj] = `<<${title}${author} >>`;
  }

  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [];
  for (let index = 1; index < objects.length; index++) {
    offsets[index] = Buffer.byteLength(pdf);
    pdf += `${index} 0 obj\n${objects[index]}\nendobj\n`;
  }
  const xrefOffset = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
  for (let index = 1; index < objects.length; index++) {
    pdf += `${String(offsets[index]).padStart(10, "0")} 00000 n \n`;
  }
  const infoRef = usesInfo ? ` /Info ${infoObj} 0 R` : "";
  pdf += `trailer\n<< /Size ${objects.length} /Root 1 0 R${infoRef} >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return new Uint8Array(Buffer.from(pdf, "latin1"));
}

export interface EpubFixture {
  title: string;
  authors: string[];
  chapters: { title: string; body: string }[];
}

/** Build a minimal, valid EPUB archive for extractor tests. */
export async function buildEpub(fixture: EpubFixture): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file("mimetype", "application/epub+zip");
  zip.file(
    "META-INF/container.xml",
    `<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>`,
  );
  const chapters = fixture.chapters.map((chapter, index) => ({
    ...chapter,
    href: `ch${index + 1}.xhtml`,
  }));
  const manifest = chapters
    .map((chapter, index) => `<item id="ch${index + 1}" href="${chapter.href}" media-type="application/xhtml+xml"/>`)
    .join("");
  const spine = chapters.map((_chapter, index) => `<itemref idref="ch${index + 1}"/>`).join("");
  zip.file(
    "OEBPS/content.opf",
    `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>${fixture.title}</dc:title>
    ${fixture.authors.map((author) => `<dc:creator>${author}</dc:creator>`).join("")}
  </metadata>
  <manifest>${manifest}</manifest>
  <spine>${spine}</spine>
</package>`,
  );
  for (const chapter of chapters) {
    zip.file(
      `OEBPS/${chapter.href}`,
      `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml"><head><title>${chapter.title}</title></head>
<body><h2>${chapter.title}</h2><p>${chapter.body}</p></body></html>`,
    );
  }
  return zip.generateAsync({ type: "uint8array" });
}

export interface DocxFixture {
  title: string;
  author: string;
  paragraphs: { text: string; heading?: boolean }[];
}

/** Build a minimal DOCX package for extractor tests. */
export async function buildDocx(fixture: DocxFixture): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file(
    "[Content_Types].xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
</Types>`,
  );
  zip.file(
    "_rels/.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
</Relationships>`,
  );
  zip.file(
    "docProps/core.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/">
  <dc:title>${fixture.title}</dc:title>
  <dc:creator>${fixture.author}</dc:creator>
</cp:coreProperties>`,
  );
  const body = fixture.paragraphs
    .map((paragraph) => {
      const style = paragraph.heading === true ? `<w:pPr><w:pStyle w:val="Heading1"/></w:pPr>` : "";
      return `<w:p>${style}<w:r><w:t xml:space="preserve">${paragraph.text}</w:t></w:r></w:p>`;
    })
    .join("");
  zip.file(
    "word/document.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}<w:sectPr/></w:body></w:document>`,
  );
  return zip.generateAsync({ type: "uint8array" });
}
