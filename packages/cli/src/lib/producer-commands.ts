/**
 * @file Shell commands out of a large-file hint (large data round 2 U7, U5)
 * @module @maplibre-yaml/cli/lib/producer-commands
 *
 * @description
 * The browser's large-file hints name a command per route, built by core's
 * `components/student-messages.ts` (`sortedParquetCommand`,
 * `indexedFlatGeobufCommand`, `pmtilesCommand`, `overviewsCommand`, exported
 * from `@maplibre-yaml/core`). `mlym prepare` prints those same builders'
 * commands, so an author sees one command per route whether it comes from
 * the page, the CLI or the Large data guide. A hint wraps each command in
 * backticks; {@link shellCommands} lifts them out.
 */

/** The shell commands in a hint: its backtick-quoted spans, in order. */
export function shellCommands(hint: string): string[] {
  return [...hint.matchAll(/`([^`]+)`/g)].map((m) => m[1]!);
}
