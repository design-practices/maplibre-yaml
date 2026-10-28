/**
 * @file Greedy line filling, for the lists the printers wrap
 * @module @maplibre-yaml/core/convert/wrap
 *
 * @description
 * JSON, YAML and TOML wrap a list that holds no table or mapping (an
 * expression) the same way: as many items to a line as fit, an item too long
 * for a line of its own on its own. Each printer renders the items and the
 * punctuation around the lines; this decides which items share a line.
 *
 * Part of the lazy `convert` chunk: core is imported for types only.
 */

/** The column every printer wraps at. */
export const WIDTH = 80;

/** A line of items (`a, b, c`), or one item too long for a line of its own, beside its one-line text. */
export type FilledLine<T> = string | { item: T; text: string };

/**
 * `items` filled into lines at `indent`: as many to a line as fit within
 * {@link WIDTH}, each line keeping a column for a trailing comma. An item
 * whose one-line text (`textOf`) is too long for a line of its own comes
 * back by itself, for the printer to wrap.
 */
export function fillLines<T>(items: readonly T[], indent: number, textOf: (item: T) => string): Array<FilledLine<T>> {
  const lines: Array<FilledLine<T>> = [];
  let line = "";
  for (const item of items) {
    const text = textOf(item);
    if (indent + text.length + 1 > WIDTH) {
      if (line) lines.push(line);
      line = "";
      lines.push({ item, text });
    } else if (line !== "" && indent + line.length + 2 + text.length + 1 > WIDTH) {
      lines.push(line);
      line = text;
    } else {
      line = line === "" ? text : `${line}, ${text}`;
    }
  }
  if (line) lines.push(line);
  return lines;
}
