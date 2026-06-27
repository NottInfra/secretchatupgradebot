import {
  BLOCK_END_NEWLINE,
  BLOCK_START_NEWLINE,
  extractHref,
  isAsciiLetterOrDigit,
  parseTagAt
} from "./parser.js";

export function replaceAnchorTags(html: string): string {
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

export function replaceBrTags(html: string): string {
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

export function applyStructuralTags(html: string): string {
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

export function stripTags(html: string): string {
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

export function collapseWhitespace(text: string): string {
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

export function decodeHtmlEntities(text: string): string {
  return text
    .replaceAll("&nbsp;", " ")
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", "\"")
    .replaceAll("&#39;", "'");
}
