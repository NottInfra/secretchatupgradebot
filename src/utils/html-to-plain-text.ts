/** Bot HTML templates are small; bound work to avoid accidental DoS on huge strings. */
const MAX_HTML_LENGTH = 65_536;

const BLOCK_END_NEWLINE = new Set([
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
const BLOCK_START_NEWLINE = new Set([
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

type ParsedTag = { name: string; end: number; closing: boolean };

function isAsciiLetterOrDigit(ch: string): boolean {
  const code = ch.charCodeAt(0);
  return (code >= 48 && code <= 57) || (code >= 65 && code <= 90) || (code >= 97 && code <= 122);
}

function isWhitespace(ch: string): boolean {
  return ch === " " || ch === "\t" || ch === "\n" || ch === "\r";
}

function parseTagAt(html: string, start: number): ParsedTag | null {
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

function replaceAnchorTags(html: string): string {
  let out = "";
  let i = 0;
  const lower = html.toLowerCase();

  while (i < html.length) {
    if (
      lower.startsWith("<a", i) &&
      (i + 2 >= html.length || !isAsciiLetterOrDigit(html[i + 2]))
    ) {
      const openEnd = html.indexOf(">", i);
      const closeStart = lower.indexOf("</a>", i);
      if (openEnd < 0 || closeStart < 0 || openEnd > closeStart) {
        out += html[i];
        i += 1;
        continue;
      }

      const href = extractHref(html.slice(i, openEnd + 1));
      const label = html.slice(openEnd + 1, closeStart);
      out += href ? `${label} (${href})` : label;
      i = closeStart + 4;
      continue;
    }

    out += html[i];
    i += 1;
  }

  return out;
}

function extractHref(tagOpen: string): string | undefined {
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

function replaceBrTags(html: string): string {
  let out = "";
  let i = 0;
  const lower = html.toLowerCase();

  while (i < html.length) {
    if (lower.startsWith("<br", i)) {
      const gt = html.indexOf(">", i);
      if (gt >= 0 && gt - i <= 12) {
        const middle = lower.slice(i + 3, gt).trim();
        if (middle === "" || middle === "/" || middle === " /") {
          out += "\n";
          i = gt + 1;
          continue;
        }
      }
    }

    out += html[i];
    i += 1;
  }

  return out;
}

function applyStructuralTags(html: string): string {
  let out = "";
  let i = 0;

  while (i < html.length) {
    if (html[i] === "<") {
      const tag = parseTagAt(html, i);
      if (tag) {
        if (tag.closing && BLOCK_END_NEWLINE.has(tag.name)) {
          out += "\n";
        } else if (!tag.closing && tag.name === "li") {
          out += "- ";
        } else if (!tag.closing && BLOCK_START_NEWLINE.has(tag.name)) {
          out += "\n";
        }
        out += html.slice(i, tag.end);
        i = tag.end;
        continue;
      }
    }

    out += html[i];
    i += 1;
  }

  return out;
}

function stripTags(html: string): string {
  let out = "";
  let i = 0;
  let inTag = false;

  while (i < html.length) {
    const ch = html[i];
    if (ch === "<") {
      inTag = true;
    } else if (ch === ">") {
      inTag = false;
    } else if (!inTag) {
      out += ch;
    }
    i += 1;
  }

  return out;
}

function collapseWhitespace(text: string): string {
  let out = "";
  let i = 0;

  while (i < text.length) {
    if ((text[i] === " " || text[i] === "\t") && i + 1 < text.length && text[i + 1] === "\n") {
      i += 1;
      continue;
    }

    if (text[i] === "\n") {
      let run = 1;
      let j = i + 1;
      while (j < text.length && text[j] === "\n") {
        run += 1;
        j += 1;
      }
      out += run >= 3 ? "\n\n" : "\n".repeat(run);
      i = j;
      continue;
    }

    out += text[i];
    i += 1;
  }

  return out;
}

export function htmlToPlainText(html: string): string {
  const bounded = html.length > MAX_HTML_LENGTH ? html.slice(0, MAX_HTML_LENGTH) : html;

  let text = bounded.replaceAll("\r\n", "\n");
  text = replaceAnchorTags(text);
  text = replaceBrTags(text);
  text = applyStructuralTags(text);
  text = stripTags(text);
  text = text
    .replaceAll("&nbsp;", " ")
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", "\"")
    .replaceAll("&#39;", "'");
  text = collapseWhitespace(text);

  return text.trim();
}
