#!/usr/bin/env node
// WCAG AA contrast check over the design tokens in src/index.css (docs/DESIGN.md, docs/UX.md).
// Resolves each theme's tokens (light, dark, sepia, black, and every accent on each), then checks the
// text/background pairs the UI actually uses. Dependency-free: run `pnpm --filter @studium/web check:contrast`.
// Text pairs need 4.5:1; UI/large-text pairs 3:1. Exits 1 when any pair fails.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const css = readFileSync(fileURLToPath(new URL("../src/index.css", import.meta.url)), "utf8");

// --- tiny CSS parser: selector -> declarations ------------------------------------------------
function blocks() {
  const out = [];
  const stripped = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const re = /([^{}]+)\{([^{}]*)\}/g;
  for (const match of stripped.matchAll(re)) {
    // Drop leading `@import …;` / `@media … {` fragments: the selector is what follows the last `;` or `{`.
    const head = match[1].split(";").pop().split("{").pop();
    const selectors = head.split(",").map((selector) => selector.replace(/\s+/g, " ").trim());
    const decls = {};
    for (const decl of match[2].split(";")) {
      const index = decl.indexOf(":");
      if (index > 0 && decl.trim().startsWith("--")) decls[decl.slice(0, index).trim()] = decl.slice(index + 1).trim();
    }
    if (Object.keys(decls).length) out.push({ selectors, decls });
  }
  return out;
}
const ALL = blocks();
const pick = (selector) => ALL.filter((block) => block.selectors.includes(selector)).map((block) => block.decls);

function tokensFor(theme, accent) {
  const map = Object.assign({}, ...pick(":root"));
  if (theme !== "light") Object.assign(map, ...pick(`:root[data-theme="${theme}"]`));
  if (accent !== "blue") Object.assign(map, ...pick(`:root[data-theme="${theme}"][data-accent="${accent}"]`));
  return map;
}

// --- colour parsing ----------------------------------------------------------------------------
const clamp = (x) => Math.min(1, Math.max(0, x));
const toLinear = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const fromLinear = (c) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);

function oklchToRgb(L, C, h) {
  const a = C * Math.cos((h * Math.PI) / 180);
  const b = C * Math.sin((h * Math.PI) / 180);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const r = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
  const g = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
  const bl = -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s;
  return [clamp(fromLinear(r)), clamp(fromLinear(g)), clamp(fromLinear(bl))];
}

function hslToRgb(h, s, l) {
  const k = (n) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [f(0), f(8), f(4)];
}

/** Returns [r, g, b, alpha] in 0..1 (sRGB). */
function parseColor(value, tokens, depth = 0) {
  const text = value.trim();
  const varMatch = /^var\((--[\w-]+)(?:\s*,\s*([^)]+))?\)$/.exec(text);
  if (varMatch) {
    const next = tokens[varMatch[1]] ?? varMatch[2];
    if (next === undefined || depth > 8) throw new Error(`unresolved ${text}`);
    return parseColor(next, tokens, depth + 1);
  }
  const hex = /^#([0-9a-f]{3,8})$/i.exec(text);
  if (hex) {
    let h = hex[1];
    if (h.length <= 4) h = [...h].map((ch) => ch + ch).join("");
    const n = (i) => Number.parseInt(h.slice(i, i + 2), 16) / 255;
    return [n(0), n(2), n(4), h.length === 8 ? n(6) : 1];
  }
  const fn = /^(oklch|hsl|rgb)a?\(([^)]+)\)$/i.exec(text);
  if (fn) {
    const [body, alphaPart] = fn[2].split("/").map((part) => part.trim());
    const nums = body.split(/[\s,]+/).filter(Boolean);
    const alpha =
      alphaPart === undefined
        ? 1
        : alphaPart.endsWith("%")
          ? Number.parseFloat(alphaPart) / 100
          : Number.parseFloat(alphaPart);
    if (fn[1].toLowerCase() === "oklch") {
      const L = nums[0].endsWith("%") ? Number.parseFloat(nums[0]) / 100 : Number.parseFloat(nums[0]);
      return [...oklchToRgb(L, Number.parseFloat(nums[1]), Number.parseFloat(nums[2])), alpha];
    }
    if (fn[1].toLowerCase() === "hsl") {
      return [
        ...hslToRgb(Number.parseFloat(nums[0]), Number.parseFloat(nums[1]) / 100, Number.parseFloat(nums[2]) / 100),
        alpha,
      ];
    }
    return [...nums.slice(0, 3).map((n) => Number.parseFloat(n) / 255), alpha];
  }
  throw new Error(`cannot parse colour: ${text}`);
}

const over = (top, bottom) => {
  const a = top[3];
  return [0, 1, 2].map((i) => top[i] * a + bottom[i] * (1 - a)).concat(1);
};
const luminance = ([r, g, b]) => 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
const ratio = (fg, bg) => {
  const [hi, lo] = [luminance(fg), luminance(bg)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

// --- the pairs the UI uses ---------------------------------------------------------------------
// [label, foreground token, background token, minimum, fgAlpha?, bgAlpha tint over `--background`?]
const TEXT = 4.5;
const UI = 3;
const PAIRS = [
  ["body text", "--foreground", "--background", TEXT],
  ["card text", "--card-foreground", "--card", TEXT],
  ["popover text", "--popover-foreground", "--popover", TEXT],
  ["muted text on page", "--muted-foreground", "--background", TEXT],
  ["muted text on card", "--muted-foreground", "--card", TEXT],
  ["muted text on muted", "--muted-foreground", "--muted", TEXT],
  ["primary button", "--primary-foreground", "--primary", TEXT],
  ["secondary button", "--secondary-foreground", "--secondary", TEXT],
  ["accent (hover/selected)", "--accent-foreground", "--accent", TEXT],
  ["destructive button", "--destructive-foreground", "--destructive", TEXT],
  ["link / primary on page", "--primary", "--background", TEXT],
  ["destructive text on page", "--destructive", "--background", TEXT],
  ["sidebar text", "--sidebar-foreground", "--sidebar", TEXT],
  ["sidebar selected row", "--sidebar-accent-foreground", "--sidebar-accent", TEXT],
  ["muted text on sidebar", "--muted-foreground", "--sidebar", TEXT],
  ["code text", "--code-fg", "--code-bg", TEXT],
  ["code keyword", "--code-keyword", "--code-bg", TEXT],
  ["code string", "--code-string", "--code-bg", TEXT],
  ["code comment", "--code-comment", "--code-bg", TEXT],
  ["code number", "--code-number", "--code-bg", TEXT],
  ["focus ring on page", "--ring", "--background", UI],
  // Badges: coloured ink on a 15% tint of the same colour over the page.
  ["badge success", "--success", "--success", TEXT, 0.15],
  ["badge / notice warning", "--warning-ink", "--warning", TEXT, 0.15],
  ["warning notice on page (10%)", "--warning-ink", "--warning", TEXT, 0.1],
  ["solid success", "--success-foreground", "--success", TEXT],
  ["solid warning", "--warning-foreground", "--warning", TEXT],
  ["badge destructive", "--destructive", "--destructive", TEXT, 0.15],
  ["badge tint (primary)", "--primary", "--primary", TEXT, 0.15],
];

const THEMES = ["light", "dark", "sepia", "black"];
const ACCENTS = ["blue", "teal", "green", "amber", "rose", "violet"];
const failures = [];
let checked = 0;

for (const theme of THEMES) {
  for (const accent of ACCENTS) {
    const tokens = tokensFor(theme, accent);
    // Accent only changes --primary/--ring/--accent*: other pairs are identical, so check them once.
    const pairs = accent === "blue" ? PAIRS : PAIRS.filter(([label]) => /primary|link|ring|tint/i.test(label));
    for (const [label, fgToken, bgToken, min, tint] of pairs) {
      try {
        const page = parseColor("var(--background)", tokens);
        const bgRaw = parseColor(`var(${bgToken})`, tokens);
        const bg = tint
          ? over([bgRaw[0], bgRaw[1], bgRaw[2], tint], over(page, [1, 1, 1, 1]))
          : over(bgRaw, over(page, [1, 1, 1, 1]));
        const fg = over(parseColor(`var(${fgToken})`, tokens), bg);
        const r = ratio(fg, bg);
        checked += 1;
        if (r < min)
          failures.push(
            `${theme}/${accent}: ${label} ${r.toFixed(2)}:1 (needs ${min}:1) [${fgToken} on ${bgToken}${tint ? ` @${tint * 100}%` : ""}]`,
          );
      } catch (error) {
        failures.push(`${theme}/${accent}: ${label}: ${error.message}`);
      }
    }
  }
}

console.log(`Checked ${checked} token pairs across ${THEMES.length} themes and ${ACCENTS.length} accents.`);
if (failures.length) {
  console.log(`\n${failures.length} below AA:`);
  for (const line of failures) console.log(`  ✗ ${line}`);
  process.exit(1);
}
console.log("All pairs meet WCAG AA.");
