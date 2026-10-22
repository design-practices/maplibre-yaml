/**
 * Render one line of gallery note text to HTML: `code` spans and
 * [text](href) links, everything else escaped. The notes in
 * src/data/gallery.mjs are author-written; this keeps them short markdown
 * instead of HTML strings.
 */
const escape = (s) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function inline(text) {
  let out = "";
  const re = /`([^`]+)`|\[([^\]]+)\]\(([^)\s]+)\)/g;
  let last = 0;
  for (const m of text.matchAll(re)) {
    out += escape(text.slice(last, m.index));
    if (m[1] !== undefined) out += `<code>${escape(m[1])}</code>`;
    else out += `<a href="${escape(m[3])}">${inline(m[2])}</a>`;
    last = m.index + m[0].length;
  }
  return out + escape(text.slice(last));
}
