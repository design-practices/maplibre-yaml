/**
 * @file Plain-language YAML indentation errors
 * @module @maplibre-yaml/core/parser/yaml-errors
 *
 * @description
 * The `yaml` library reports indentation slips in parser terms ("Nested
 * mappings are not allowed in compact mappings", "All mapping items must
 * start at the same column") and often at the line ABOVE the mistake: a key
 * indented one space too far under `- id: the-met` is reported at the
 * `- id:` line. Students hit these in the first hour (ml-aot.52). This finds
 * the line whose key is out of step with the line above it and says that,
 * with both columns, in the same words the browser card and `mlym validate`
 * print.
 */

/** The yaml-library error codes that are, in practice, indentation slips. */
const INDENT_CODES = new Set(["BLOCK_AS_IMPLICIT_KEY", "BAD_INDENT", "MULTILINE_IMPLICIT_KEY"]);

interface LineInfo {
  /** 1-based line number. */
  line: number;
  /** 1-based column where the line's key starts (after a `- ` marker). */
  keyColumn: number;
  /** The key, when the line is `key:` or `- key:`. */
  key?: string;
  /** Whether the line opens a list item (`- …`). */
  listItem: boolean;
}

/** A line that carries content (not blank, not a whole-line comment). */
function info(lines: string[], index: number): LineInfo | undefined {
  const text = lines[index];
  if (text === undefined) return undefined;
  if (/^\s*(#.*)?$/.test(text)) return undefined;
  const m = /^( *)(- +)?(.*)$/.exec(text)!;
  const indent = m[1]!.length;
  const dash = m[2]?.length ?? 0;
  const rest = m[3]!;
  const key = /^([^\s:#"'{[][^:#]*?):(\s|$)/.exec(rest)?.[1];
  return { line: index + 1, keyColumn: indent + dash + 1, key, listItem: dash > 0 };
}

function previous(lines: string[], index: number): LineInfo | undefined {
  for (let i = index - 1; i >= 0; i--) {
    const found = info(lines, i);
    if (found) return found;
  }
  return undefined;
}

function next(lines: string[], index: number): LineInfo | undefined {
  for (let i = index + 1; i < lines.length; i++) {
    const found = info(lines, i);
    if (found) return found;
  }
  return undefined;
}

const name = (l: LineInfo) => (l.key !== undefined ? `"${l.key}:"` : `line ${l.line}`);

/** Whether `reference` is a key of a list item (`- id: …` or a key lined up under it). */
function inListItem(lines: string[], reference: LineInfo): boolean {
  if (reference.listItem) return true;
  for (let i = reference.line - 2; i >= 0; i--) {
    const l = info(lines, i);
    if (!l) continue;
    if (l.listItem && l.keyColumn === reference.keyColumn) return true;
    if (l.keyColumn < reference.keyColumn) return false;
  }
  return false;
}

function message(lines: string[], culprit: LineInfo, reference: LineInfo): string {
  return (
    `Line ${culprit.line} is indented differently from line ${reference.line} above it: ` +
    `${name(culprit)} starts in column ${culprit.keyColumn}, but ${name(reference)} ` +
    `starts in column ${reference.keyColumn}. Keys that belong together must start in ` +
    `the same column` +
    (inListItem(lines, reference)
      ? `: in a list item, every key lines up under the first one after "- ". `
      : ". ") +
    `Indent with spaces.`
  );
}

/**
 * Explain a quote inside a quoted value (`description: "a "walk" here"`),
 * which the yaml library reports as "Unexpected scalar at node end"
 * (ml-aot.62), or return `undefined` when the line isn't that.
 *
 * @param yaml - The source text.
 * @param reportedLine - The 1-based line the library reported.
 */
export function explainQuoteError(
  yaml: string,
  reportedLine: number | undefined
): { message: string; line: number; column: number } | undefined {
  if (reportedLine === undefined) return undefined;
  const text = yaml.split(/\r?\n/)[reportedLine - 1];
  if (text === undefined) return undefined;
  const m = /^(\s*(?:-\s+)?)([^\s:#"'][^:#]*?):\s+(["'])/.exec(text);
  if (!m) return undefined;
  const key = m[2]!;
  const quote = m[3]! as '"' | "'";
  const valueStart = m[0].length; // index just after the opening quote
  // Where the quoted value ends, honouring the escapes each style allows.
  let end = -1;
  for (let i = valueStart; i < text.length; i++) {
    const c = text[i];
    if (quote === '"' && c === "\\") {
      i++;
      continue;
    }
    if (c === quote) {
      if (quote === "'" && text[i + 1] === "'") {
        i++;
        continue;
      }
      end = i;
      break;
    }
  }
  if (end < 0) return undefined;
  const after = text.slice(end + 1).trim();
  if (after === "" || after.startsWith("#")) return undefined;
  const word = /^\S+/.exec(text.slice(end + 1))?.[0] ?? "";
  const escape = quote === '"' ? '\\"' : "''";
  const other = quote === '"' ? "single" : "double";
  return {
    message:
      `Line ${reportedLine}: a ${quote} inside a ${quote}…${quote} value ends it early — the value ` +
      `of "${key}:" stops at the ${quote} before ${word}. Use ${other} quotes around the whole ` +
      `value, or write ${escape} for each ${quote} inside it.`,
    line: reportedLine,
    column: end + 1,
  };
}

/**
 * Explain a YAML indentation error, or return `undefined` to keep the
 * library's message.
 *
 * @param yaml - The source text.
 * @param code - The yaml library's error code.
 * @param reportedLine - The 1-based line the library reported.
 */
export function explainIndentationError(
  yaml: string,
  code: string,
  reportedLine: number | undefined
): { message: string; line: number; column: number } | undefined {
  if (reportedLine === undefined) return undefined;
  const lines = yaml.split(/\r?\n/);
  const reported = info(lines, reportedLine - 1);
  if (!reported) return undefined;
  const isMissingDash = code === "MISSING_CHAR" && /^\s/.test(lines[reportedLine - 1] ?? "");

  if (code === "BAD_INDENT" || isMissingDash) {
    // The reported line itself is out of step with the one above it.
    const above = previous(lines, reportedLine - 1);
    if (!above || above.keyColumn === reported.keyColumn) return undefined;
    return { message: message(lines, reported, above), line: reported.line, column: reported.keyColumn };
  }

  if (INDENT_CODES.has(code)) {
    // Reported at a `key: value` line, the slip is usually the NEXT line,
    // indented deeper than a sibling key should be.
    const after = next(lines, reportedLine - 1);
    const hasValue = /:\s+\S/.test((lines[reportedLine - 1] ?? "").replace(/#.*$/, ""));
    if (after && hasValue && after.keyColumn > reported.keyColumn && after.key !== undefined) {
      return { message: message(lines, after, reported), line: after.line, column: after.keyColumn };
    }
    // A value that itself contains ": " (`title: Note: read this`).
    const value = /:\s+(.*)$/.exec(lines[reportedLine - 1] ?? "")?.[1];
    if (value && /:\s/.test(value) && !/^["']/.test(value)) {
      return {
        message:
          `Line ${reported.line} has a second ": " inside the value of ${name(reported)}. ` +
          `Put a value that contains a colon in quotes, e.g. ${reported.key ?? "key"}: "${value.trim()}".`,
        line: reported.line,
        column: reported.keyColumn,
      };
    }
  }
  return undefined;
}
