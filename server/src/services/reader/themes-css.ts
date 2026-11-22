/**
 * Unified reader page shell — reads server/public/reader/themes.json and
 * reader.css to serve the theme token stylesheet (GET /reader/themes.css)
 * and to wrap report body fragments into self-contained pages.
 */
import { readFileSync } from "fs";
import { join } from "path";
import { fileURLToPath } from "url";

/** Theme table entry, mirroring server/public/reader/themes.json. */
interface ReaderTheme {
  id: string;
  name: string;
  scheme: "light" | "dark";
  canvas: string;
  surface: string;
  ink: string;
  inkSecondary: string;
  inkTertiary: string;
  hairline: string;
  accent: string;
  series: string[];
}

const READER_ASSET_DIR = process.env.NOTEONE_PUBLIC_DIR
  || fileURLToPath(new URL("../../../public", import.meta.url));

/** Map one theme table entry onto the token declarations consumed by reader.css. */
function themeTokenDeclarations(theme: ReaderTheme): string {
  const tokens = [
    `--canvas:${theme.canvas}`,
    `--surface:${theme.surface}`,
    `--ink:${theme.ink}`,
    `--ink-secondary:${theme.inkSecondary}`,
    `--ink-tertiary:${theme.inkTertiary}`,
    `--hairline:${theme.hairline}`,
    `--accent:${theme.accent}`,
    ...theme.series.map((color, i) => `--series-${i}:${color}`),
  ];
  return `${tokens.join(";")};color-scheme:${theme.scheme}`;
}

/** Load the theme table from public/reader/themes.json. */
function loadThemes(): ReaderTheme[] {
  return (JSON.parse(
    readFileSync(join(READER_ASSET_DIR, "reader", "themes.json"), "utf-8"),
  ) as { themes: ReaderTheme[] }).themes;
}

/** Render the theme token stylesheet from public/reader/themes.json for GET /reader/themes.css. */
export function themesCss(): string {
  const themes = loadThemes();
  const defaultLight = themes.find((t) => t.id === "defaultLight")!;
  const defaultDark = themes.find((t) => t.id === "defaultDark")!;
  return [
    `:root{${themeTokenDeclarations(defaultLight)}}`,
    `@media (prefers-color-scheme: dark){:root:not([data-theme]){${themeTokenDeclarations(defaultDark)}}}`,
    ...themes.map((t) => `:root[data-theme="${t.id}"]{${themeTokenDeclarations(t)}}`),
  ].join("\n");
}

/** Wrap a body fragment into a self-contained page with themes.css and reader.css inlined. */
export function renderPage(title: string, body: string, lang: string): string {
  const readerCss = readFileSync(join(READER_ASSET_DIR, "reader", "reader.css"), "utf-8");
  return `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(title)}</title><style>${themesCss()}</style><style>${readerCss}</style></head><body>${body}</body></html>`;
}

/** Extract the body fragment served by GET /api/newlore/reports/:date from a rendered page. */
export function reportBodyFromPage(html: string): string {
  const match = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  // Pages without a body tag (legacy or truncated files) come back unchanged.
  return match ? match[1] : html;
}

/** Escape text for safe interpolation into HTML text content. */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
