/**
 * Turns core's parser result into editor diagnostics (design D3, §3).
 *
 * One source of truth: `YAMLParser.safeParseAny`. Its errors and warnings
 * carry a line and column; this module turns them into character ranges,
 * moves a range onto the value a message quotes, and turns "Did you mean …?"
 * into a quick fix. It adds only two kinds of its own, both `info`: what
 * `!html` and `click.emit` do on `<ml-map>` (they are inert there), which the
 * parser can't know because they are valid.
 *
 * Framework-free (Q6): ranges are plain offsets, so any editor can show them.
 */

/** @typedef {"error" | "warning" | "info"} Severity */
/**
 * @typedef {object} Diagnostic
 * @property {number} from
 * @property {number} to
 * @property {Severity} severity
 * @property {string} message
 * @property {number} line 1-based line of `from`
 * @property {string} [code] the parser's error code (`yaml-syntax`, …)
 * @property {{ label: string, insert: string }} [fix] replaces from..to
 * @property {string} [href] a docs page that explains it
 */

/** 1-based line and column to a 0-based offset, clamped to the text. */
export function lineColToOffset(text, line, column) {
  let off = 0;
  for (let i = 1; i < line; i++) {
    const n = text.indexOf("\n", off);
    if (n < 0) return text.length;
    off = n + 1;
  }
  const lineEnd = text.indexOf("\n", off) === -1 ? text.length : text.indexOf("\n", off);
  return Math.min(off + Math.max(0, (column || 1) - 1), lineEnd);
}

/** 1-based line number of an offset. */
export function lineOf(text, offset) {
  let n = 1;
  for (let i = text.indexOf("\n"); i !== -1 && i < offset; i = text.indexOf("\n", i + 1)) n++;
  return n;
}

/** The end of the token (a key or a plain scalar) that starts at `from`. */
function tokenEnd(text, from) {
  const m = /^[^\s:,\]}#]+/.exec(text.slice(from));
  return from + (m ? m[0].length : 0);
}

/** How far (in lines) a quoted value may sit below the reported position. */
const VALUE_SEARCH_LINES = 30;

/**
 * The parser's message, without what the editor already shows: the code
 * frame and the "at line N, column M" a YAML syntax error carries.
 */
export function cleanMessage(message) {
  const first = String(message).split("\n")[0];
  return first.replace(/ at line \d+, column \d+:?\s*$/, "").replace(/:\s*$/, "");
}

/** The suggestion a message offers: the `suggestion` field, or its "Did you mean "x"?". */
function suggestionOf(e) {
  if (e.suggestion) return String(e.suggestion);
  const m = /Did you mean "([^"\n]+)"\?/.exec(e.message);
  return m ? m[1] : undefined;
}

/**
 * Diagnostics for one parse.
 *
 * @param {string} text the document as written
 * @param {{ result: { errors: any[], warnings: any[] } }} parsed what
 *   `YAMLParser.safeParseAny(text)` returned
 * @returns {Diagnostic[]}
 */
export function toDiagnostics(text, parsed) {
  const out = [];
  const push = (e, severity) => {
    let from = e.line ? lineColToOffset(text, e.line, e.column) : 0;
    let to = tokenEnd(text, from);
    const suggestion = suggestionOf(e);

    // A message that quotes the bad value ("circel") but is positioned on
    // the object around it (the layer's "- id:" line): move the range onto
    // that value when it is close below, so the squiggle and the quick fix
    // land on the token to change.
    const quoted = /"([^"\n]{1,60})"/.exec(e.message);
    if (quoted && text.slice(from, to) !== quoted[1]) {
      const re = new RegExp(`(^|[\\s:"'\\[,])(${quoted[1].replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})(?=$|[\\s:"',\\]#])`, "m");
      const rest = text.slice(from);
      const hit = re.exec(rest);
      if (hit) {
        const at = from + hit.index + hit[1].length;
        if (lineOf(text, at) - lineOf(text, from) <= VALUE_SEARCH_LINES) {
          from = at;
          to = at + quoted[1].length;
        }
      }
    }
    if (to <= from) {
      // Nothing to underline at the position (end of a line, a blank line):
      // mark one character, or the end of the text.
      to = Math.min(from + 1, text.length);
      if (text[from] === "\n") to = from;
    }

    /** @type {Diagnostic} */
    const d = {
      from,
      to,
      severity,
      message: cleanMessage(e.message),
      line: lineOf(text, from),
    };
    if (e.code) d.code = e.code;
    if (suggestion && /did you mean/i.test(e.message) && text.slice(from, to) !== suggestion && to > from) {
      d.fix = { label: `Change to ${suggestion}`, insert: suggestion };
    }
    out.push(d);
  };
  for (const e of parsed.result.errors ?? []) push(e, "error");
  for (const w of parsed.result.warnings ?? []) push(w, w.kind === "note" ? "info" : "warning");
  return out;
}

/**
 * Teaching notes for what a shared or pasted document can't do on
 * `<ml-map>`: raw HTML (`!html`) is shown as text, and a `click.emit` host
 * event does nothing, because the element always runs documents untrusted.
 * Made here, not by the parser, so they never duplicate a parser message.
 *
 * @returns {Diagnostic[]}
 */
export function trustNotes(text) {
  const out = [];
  const lines = text.split("\n");
  let off = 0;
  lines.forEach((line, i) => {
    const code = line.replace(/(^|\s)#.*$/, "");
    const html = code.indexOf("!html");
    if (html !== -1) {
      out.push({
        from: off + html,
        to: off + html + 5,
        severity: "info",
        message: "Shown as text on <ml-map>: raw HTML only runs on a page that trusts the document.",
        line: i + 1,
        href: "/guides/popups/#choose-what-the-popup-shows",
      });
    }
    const emit = /^(\s*)(- +)?emit:/.exec(code);
    if (emit) {
      const at = off + emit[1].length + (emit[2]?.length ?? 0);
      out.push({
        from: at,
        to: at + 4,
        severity: "info",
        message: "Does nothing on <ml-map>: listen for ml-map:layer-click on the page instead.",
        line: i + 1,
        href: "/guides/popups/#emit",
      });
    }
    off += line.length + 1;
  });
  return out;
}

/**
 * Quiet while typing (§3.1 rule 4): a YAML syntax error on the line being
 * typed is held back until the author pauses or leaves the line, so `pi`
 * with no colon yet doesn't flash red. Errors on other lines show at once.
 *
 * @param {Diagnostic[]} list
 * @param {number | null} cursorLine 1-based, or null when nothing is held
 * @returns {{ shown: Diagnostic[], held: Diagnostic[] }}
 */
export function holdWhileTyping(list, cursorLine) {
  if (cursorLine == null) return { shown: list, held: [] };
  const shown = [];
  const held = [];
  for (const d of list) {
    if (d.code === "yaml-syntax" && d.line === cursorLine) held.push(d);
    else shown.push(d);
  }
  return { shown, held };
}

/** "2 errors, 1 warning", or "" when there is nothing to report. */
export function summarize(list) {
  const n = (sev) => list.filter((d) => d.severity === sev).length;
  const plural = (k, word) => `${k} ${word}${k === 1 ? "" : "s"}`;
  const parts = [];
  if (n("error")) parts.push(plural(n("error"), "error"));
  if (n("warning")) parts.push(plural(n("warning"), "warning"));
  return parts.join(", ");
}
