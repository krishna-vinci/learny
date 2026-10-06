import { promises as fs } from "node:fs";
import { parseHTML } from "linkedom";
import { parse } from "yaml";
import { canonicalRel, resolveInRoot } from "../tree/paths.js";

export function reusableLicense(license: string | undefined, allowNonCommercial = true): boolean {
  if (!license) return false;
  const normalized = license.trim().toUpperCase();
  return (
    /^(?:CC BY(?:-NC)?(?:-SA|-ND)?(?: \d(?:\.\d)?)?|CC0(?: \d(?:\.\d)?)?|PUBLIC DOMAIN)$/.test(normalized) &&
    (allowNonCommercial || !normalized.includes("-NC"))
  );
}
export function figureLicense(text: string): string | undefined {
  const url =
    /https?:\/\/creativecommons\.org\/(?:licenses\/(by(?:-(?:nc|nd|sa))*)\/(\d\.\d)|publicdomain\/(zero|mark)\/1\.0)\/?/i.exec(
      text,
    );
  if (url) return url[1] ? `CC ${url[1].toUpperCase()} ${url[2]}` : url[3] === "zero" ? "CC0 1.0" : "public domain";
  const label = /\b(CC BY(?:-(?:NC|ND|SA))*(?: \d\.\d)?|CC0(?: \d\.\d)?|public domain)\b/i.exec(text)?.[1];
  return label ? (label.toLowerCase() === "public domain" ? "public domain" : label.toUpperCase()) : undefined;
}
export function licenseUrl(license: string | undefined): string | undefined {
  const match = /^CC (BY(?:-(?:NC|ND|SA))*) (\d\.\d)$/i.exec(license ?? "");
  if (match) return `https://creativecommons.org/licenses/${match[1]?.toLowerCase()}/${match[2]}/`;
  if (/^CC0/i.test(license ?? "")) return "https://creativecommons.org/publicdomain/zero/1.0/";
  if (license === "public domain") return "https://creativecommons.org/publicdomain/mark/1.0/";
  return undefined;
}
export function plainCredit(html: string): string {
  const { document } = parseHTML(`<div>${html}</div>`);
  for (const node of document.querySelectorAll("[hidden],[style]")) {
    if (
      node.hasAttribute("hidden") ||
      /(?:display\s*:\s*none|visibility\s*:\s*hidden)/i.test(node.getAttribute("style") ?? "")
    )
      node.remove();
  }
  return (document.querySelector("div")?.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 1000);
}
/** Only explicit page statements; per-figure exceptions must override this. */
export function pageImageLicense(html: string, url: string): string | undefined {
  const host = new URL(url).hostname;
  if (/(?:^|\.)wikipedia\.org$/.test(host)) return undefined;
  const { document } = parseHTML(html);
  if (/(?:^|\.)libretexts\.org$/.test(host)) {
    const tags = `${html} ${document.querySelector("#pageTagsHolder")?.textContent ?? ""} ${document.querySelector("#tagsHolder")?.textContent ?? ""}`;
    const tag = /["']license:(ccby(?:nc|nd|sa)*|cc0|publicdomain)["']/i.exec(tags)?.[1]?.toLowerCase();
    const version = /["']licenseversion:(\d)(\d)["']/i.exec(tags);
    if (tag) {
      const label =
        tag === "publicdomain"
          ? "public domain"
          : tag === "cc0"
            ? "CC0"
            : `CC BY${
                tag
                  .slice(4)
                  .match(/nc|nd|sa/g)
                  ?.map((p) => `-${p.toUpperCase()}`)
                  .join("") ?? ""
              }`;
      return `${label}${version && tag !== "publicdomain" ? ` ${version[1]}.${version[2]}` : ""}`;
    }
  }
  const statements: string[] = [];
  for (const node of document.querySelectorAll("a[href],link[rel],meta[name],meta[property]")) {
    if (node.closest("figure")) continue;
    const rel = node.getAttribute("rel") ?? "";
    const name = node.getAttribute("name") ?? node.getAttribute("property") ?? "";
    if (
      /\blicense\b/i.test(rel) ||
      /license|rights/i.test(name) ||
      node.closest("footer") ||
      /\blicen[sc]e|copyright/i.test(node.parentElement?.textContent ?? "")
    )
      statements.push(node.getAttribute("href") ?? node.getAttribute("content") ?? "");
  }
  for (const node of document.querySelectorAll('script[type="application/ld+json"]')) {
    try {
      const walk = (v: unknown): void => {
        if (Array.isArray(v)) {
          for (const x of v) walk(x);
        } else if (v && typeof v === "object")
          for (const [k, value] of Object.entries(v)) {
            if (k === "license" && typeof value === "string") statements.push(value);
            else if (typeof value === "object") walk(value);
          }
      };
      walk(JSON.parse(node.textContent ?? ""));
    } catch {
      /* Invalid schema never grants permission. */
    }
  }
  const explicit = figureLicense(statements.join(" "));
  if (explicit) return explicit;
  if (/all rights reserved/i.test(statements.join(" "))) return "all rights reserved";
  // OpenStax's book illustrations follow its CC BY 4.0 policy, unless individually marked.
  return /(?:^|\.)openstax\.org$/.test(host) ? "CC BY 4.0" : undefined;
}
export async function allowNonCommercial(root: string): Promise<boolean> {
  const rel = "_global/config.yaml";
  if (canonicalRel(root, rel) !== rel) throw new Error("Media config may not be a symlink alias");
  try {
    const config = parse(await fs.readFile(resolveInRoot(root, rel), "utf8"));
    return config?.media?.allowNonCommercial !== false;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return true;
    throw error;
  }
}
