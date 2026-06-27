export const MAX_HTML_LENGTH = 65_536;

export const BLOCK_END_NEWLINE = new Set([
  "p",
  "div",
  "section",
  "article",
  "li",
  "ul",
  "ol",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6"
]);

export const BLOCK_START_NEWLINE = new Set([
  "p",
  "div",
  "section",
  "article",
  "ul",
  "ol",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6"
]);

export type ParsedTag = { name: string; end: number; closing: boolean };

export function isAsciiLetterOrDigit(ch: string): boolean {
  const code = ch.codePointAt(0);
  if (code === undefined) return false;
  return (code >= 48 && code <= 57) || (code >= 65 && code <= 90) || (code >= 97 && code <= 122);
}

export function isWhitespace(ch: string): boolean {
  return ch === " " || ch === "\t" || ch === "\n" || ch === "\r";
}

export function parseTagAt(html: string, start: number): ParsedTag | null {
  if (html[start] !== "<") return null;

  let i = start + 1;
  if (i >= html.length) return null;

  let closing = false;
  if (html[i] === "/") {
    closing = true;
    i += 1;
  }

  const nameStart = i;
  while (i < html.length && isAsciiLetterOrDigit(html[i])) i += 1;
  if (i === nameStart) return null;

  const name = html.slice(nameStart, i).toLowerCase();
  while (i < html.length && html[i] !== ">") i += 1;
  if (i >= html.length) return null;

  return { name, end: i + 1, closing };
}

export function extractHref(tagOpen: string): string | undefined {
  const lower = tagOpen.toLowerCase();
  const hrefIdx = lower.indexOf("href=");
  if (hrefIdx < 0) return undefined;

  let i = hrefIdx + 5;
  while (i < tagOpen.length && isWhitespace(tagOpen[i])) i += 1;

  const quote = tagOpen[i];
  if (quote !== '"' && quote !== "'") return undefined;

  const valueStart = i + 1;
  i = valueStart;
  while (i < tagOpen.length && tagOpen[i] !== quote) i += 1;
  if (i >= tagOpen.length) return undefined;

  return tagOpen.slice(valueStart, i);
}
