/**
 * @file The producer commands `mlym prepare` prints (large data round 2 U7)
 * @module @maplibre-yaml/cli/lib/producer-commands
 *
 * @description
 * The browser's large-file hints name a command per route (core's
 * `components/student-messages.ts`: `sortedParquetCommand`,
 * `indexedFlatGeobufCommand`, `pmtilesCommand`), so an author sees one
 * command per route whether it comes from the page or from `mlym prepare`.
 * This module hands the CLI core's builders, and lifts the shell commands out
 * of a hint's text ({@link shellCommands}).
 *
 * Core exports the builders from 0.10 (`index.ts`). Until the installed
 * core carries them, the copies below stand in, verbatim; the CLI test
 * compares both against core's source, so they cannot drift. Delete the
 * copies once every supported core exports the builders.
 */

import * as core from '@maplibre-yaml/core';

interface Builders {
  commandStem(url: string, ext: string): string;
  sortedParquetCommand(url: string): string;
  indexedFlatGeobufCommand(url: string): string;
  pmtilesCommand(url: string, format: string): string;
}

/** The file name at the end of a URL, for command examples. */
function fileNameOf(url: string): string {
  const path = url.replace(/[?#].*$/, '');
  return path.slice(path.lastIndexOf('/') + 1) || path;
}

function commandFileName(url: string, ext: string): string {
  return /^(blob|data):/i.test(url) ? `data.${ext}` : fileNameOf(url);
}

/** Core's builders as of 0.10, for a core that does not export them yet. */
const local: Builders = {
  commandStem(url, ext) {
    const name = commandFileName(url, ext);
    const dot = name.lastIndexOf('.');
    return (dot > 0 ? name.slice(0, dot) : name).replace(/[^A-Za-z0-9_-]/g, '_') || 'data';
  },
  sortedParquetCommand(url) {
    return (
      `\`uvx --from geoparquet-io==1.7.0 gpio sort hilbert ${commandFileName(url, 'parquet')} ` +
      `${local.commandStem(url, 'parquet')}-hilbert.parquet --row-group-size 10000 --add-bbox\``
    );
  },
  indexedFlatGeobufCommand(url) {
    return `\`ogr2ogr -f FlatGeobuf -lco SPATIAL_INDEX=YES ${local.commandStem(url, 'fgb')}-indexed.fgb ${commandFileName(url, 'fgb')}\``;
  },
  pmtilesCommand(url, format) {
    const gp = format === 'geoparquet';
    const stem = local.commandStem(url, gp ? 'parquet' : 'fgb');
    const input = gp ? commandFileName(url, 'parquet') : `${stem}.parquet`;
    const first = gp
      ? ''
      : `\`uvx --from geoparquet-io==1.7.0 gpio convert geoparquet ${commandFileName(url, 'fgb')} ${stem}.parquet\`, then `;
    return (
      first +
      `\`uv run --with tylertoo==0.8.0 python -c "import tylertoo as t; t.overview('${input}', '${stem}-ov.parquet', ` +
      `min_zoom=0, max_zoom=14, collapse_square=True); t.export_pmtiles('${stem}-ov.parquet', '${stem}.pmtiles', ` +
      `layer_name='${stem}', tile_size_limit=None)"\` (the parcel recipe; MapLibre draws zoom 14's tiles further in)`
    );
  },
};

const shared = core as unknown as Partial<Builders>;

/** Core's builder when the installed core exports it, else the copy. */
const pick = <K extends keyof Builders>(name: K): Builders[K] =>
  (typeof shared[name] === 'function' ? shared[name] : local[name]) as Builders[K];

export const commandStem = pick('commandStem');
export const sortedParquetCommand = pick('sortedParquetCommand');
export const indexedFlatGeobufCommand = pick('indexedFlatGeobufCommand');
export const pmtilesCommand = pick('pmtilesCommand');

/** The shell commands in a hint: its backtick-quoted spans, in order. */
export function shellCommands(hint: string): string[] {
  return [...hint.matchAll(/`([^`]+)`/g)].map((m) => m[1]!);
}
