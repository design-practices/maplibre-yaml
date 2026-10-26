/**
 * @file A message's `` `code` `` spans as the console shows them
 * @module @maplibre-yaml/core/utils/console-text
 */

/**
 * A message for the console: each `` `code` `` span quoted — `"name"` — so
 * a name stands out in plain text, except a span that holds a double quote
 * of its own (a command such as `` `uv run … python -c "…"` ``), which is
 * left bare so it can be copied and run as shown (ml-cnv.35: quoting it
 * broke the command).
 */
export function consoleText(message: string): string {
  return message.replace(/`([^`]*)`/g, (_, code: string) => (code.includes('"') ? code : `"${code}"`));
}
