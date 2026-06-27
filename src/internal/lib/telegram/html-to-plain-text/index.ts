import { MAX_HTML_LENGTH } from "./parser.js";
import {
  applyStructuralTags,
  collapseWhitespace,
  decodeHtmlEntities,
  replaceAnchorTags,
  replaceBrTags,
  stripTags
} from "./transforms.js";

export function htmlToPlainText(html: string): string {
  const bounded = html.length > MAX_HTML_LENGTH ? html.slice(0, MAX_HTML_LENGTH) : html;

  let text = bounded.replaceAll("\r\n", "\n");
  text = replaceAnchorTags(text);
  text = replaceBrTags(text);
  text = applyStructuralTags(text);
  text = stripTags(text);
  text = decodeHtmlEntities(text);
  text = collapseWhitespace(text);

  return text.trim();
}
