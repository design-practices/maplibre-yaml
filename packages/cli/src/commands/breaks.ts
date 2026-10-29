/**
 * @file The `mlym breaks` command — class breaks from a whole local data file
 *
 * @description
 * `classify: { method }` computes its breaks in the browser only when the
 * whole dataset is there to read. A FlatGeobuf or PMTiles source read by
 * view never is, and its refusal points here: `mlym breaks` decodes the whole
 * file (GeoParquet, FlatGeobuf or GeoJSON), computes the breaks with core's
 * own classify math, and prints a block that pastes under `classify:` in
 * place of `method:` and `classes:`:
 *
 * ```yaml
 * # population, jenks, 5 classes, from districts.fgb (48 features)
 * # range: 1204 to 19874
 * breaks: [3519, 6702, 10560, 15101]
 * ```
 *
 * The contract (KTD13):
 *
 * - The block goes to stdout; `-f json` prints one JSON object instead.
 * - The flags mean what the `classify:` keys mean, checked by core's classify
 *   schema: `--method` quantile, equal or jenks (default quantile),
 *   `--classes` 2 to 12 (default 5), `--normalize` / `--multiply` for a rate.
 * - Exit 0 with the block; 2 (FILE_NOT_FOUND) for a path that cannot be
 *   read; 1 (VALIDATION_ERROR) for a bad flag, a missing argument or field,
 *   a text field (it names the type and suggests `categories:`), or a file
 *   that is not GeoParquet, FlatGeobuf or GeoJSON; 4 otherwise.
 */

import { defineCommand } from 'citty';
import { readFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import {
  ClassifySchema,
  MAX_CLASS_COUNT,
  DEFAULT_CLASS_COUNT,
  resolveClassify,
  classifyWithData,
  type ClassifyMethod,
} from '@maplibre-yaml/core';
import { decodeFeatureFile } from '../lib/data-loader.js';
import { logger } from '../lib/logger.js';
import { EXIT_CODES, type ExitCode } from '../types.js';

/** A refusal with the exit code the command stops with. */
export class BreaksError extends Error {
  constructor(
    message: string,
    readonly exitCode: ExitCode,
  ) {
    super(message);
    this.name = 'BreaksError';
  }
}

/** What `mlym breaks` was asked for (the flags, as `classify:` keys). */
export interface BreaksOptions {
  field: string;
  /** quantile, equal or jenks (any case); default quantile. */
  method?: string;
  /** 2 to 12; default 5. A string is a flag value not yet read as a number. */
  classes?: number | string;
  normalize?: string;
  multiply?: number | string;
}

/** The breaks and what the data showed. */
export interface BreaksReport {
  file: string;
  format: BreaksFormat;
  field: string;
  normalize?: string;
  multiply?: number;
  method: ClassifyMethod;
  /** The class count asked for; ties can draw fewer (`breaks.length + 1`). */
  classes: number;
  breaks: number[];
  min: number;
  max: number;
  /** Features read. */
  count: number;
  /** Features with no value (or no rate) to classify. */
  noData: number;
}

type BreaksFormat = 'geoparquet' | 'flatgeobuf' | 'geojson';

type Feature = { properties?: Record<string, unknown> | null };

/** The format a path's extension names, or why it is refused. */
function formatOf(path: string): BreaksFormat {
  const lower = path.toLowerCase();
  if (/\.(geo)?parquet$/.test(lower)) return 'geoparquet';
  if (/\.fgb$/.test(lower)) return 'flatgeobuf';
  if (/\.(geo)?json$/.test(lower)) return 'geojson';
  if (/\.pmtiles$/.test(lower)) {
    throw new BreaksError(
      `${path} is a PMTiles archive. Its tiles generalise and drop features, so they cannot give ` +
        'breaks for the whole dataset. Run mlym breaks on the GeoParquet, FlatGeobuf or GeoJSON ' +
        'file the archive was built from.',
      EXIT_CODES.VALIDATION_ERROR,
    );
  }
  throw new BreaksError(
    `${path} is not a file mlym breaks reads. Give it a GeoParquet (.parquet), FlatGeobuf (.fgb) ` +
      'or GeoJSON (.geojson, .json) file.',
    EXIT_CODES.VALIDATION_ERROR,
  );
}

const FLAG_OF: Record<string, string> = {
  field: '--field',
  method: '--method',
  classes: '--classes',
  normalize: '--normalize',
  multiply: '--multiply',
};

/** A flag value read as a number (`undefined` when not given). */
function numberFlag(value: number | string | undefined): number | undefined {
  if (value === undefined || value === '') return undefined;
  return typeof value === 'number' ? value : Number(value);
}

/** The flags, checked by core's classify schema and resolved the way a layer's block is. */
function classifyRecord(options: BreaksOptions) {
  if (!options.field) {
    throw new BreaksError(
      'Name the property to classify with --field, e.g. --field population.',
      EXIT_CODES.VALIDATION_ERROR,
    );
  }
  const classes = numberFlag(options.classes) ?? DEFAULT_CLASS_COUNT;
  if (!Number.isInteger(classes) || classes < 2 || classes > MAX_CLASS_COUNT) {
    throw new BreaksError(
      `--classes must be a whole number from 2 to ${MAX_CLASS_COUNT}, not "${String(options.classes)}".`,
      EXIT_CODES.VALIDATION_ERROR,
    );
  }
  const multiply = numberFlag(options.multiply);
  const config = {
    field: options.field,
    method: options.method ?? 'quantile',
    classes,
    ...(options.normalize ? { normalize: options.normalize } : {}),
    ...(multiply !== undefined ? { multiply } : {}),
  };
  const parsed = ClassifySchema.safeParse(config);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((issue) => {
      const key = String(issue.path[0] ?? '');
      return `${FLAG_OF[key] ?? key}: ${issue.message}`;
    });
    throw new BreaksError([...new Set(lines)].join('\n'), EXIT_CODES.VALIDATION_ERROR);
  }
  return resolveClassify(parsed.data, 'fill');
}

/** Read and decode the whole file to its features. */
async function readFeatures(path: string, format: BreaksFormat): Promise<Feature[]> {
  let bytes: Buffer;
  try {
    bytes = readFileSync(path);
  } catch (error) {
    throw new BreaksError(
      `Could not read ${path} (${(error as NodeJS.ErrnoException).code ?? (error as Error).message}).`,
      EXIT_CODES.FILE_NOT_FOUND,
    );
  }
  let data: unknown;
  if (format === 'geojson') {
    try {
      data = JSON.parse(bytes.toString('utf-8'));
    } catch (error) {
      throw new BreaksError(`${path} is not valid JSON (${(error as Error).message}).`, EXIT_CODES.VALIDATION_ERROR);
    }
  } else {
    try {
      data = await decodeFeatureFile(new Uint8Array(bytes), format, path);
    } catch (error) {
      const name = format === 'geoparquet' ? 'GeoParquet' : 'FlatGeobuf';
      throw new BreaksError(`Could not read ${path} as ${name}: ${(error as Error).message}`, EXIT_CODES.VALIDATION_ERROR);
    }
  }
  const d = data as { type?: unknown; features?: unknown };
  if (d && d.type === 'FeatureCollection' && Array.isArray(d.features)) return d.features as Feature[];
  if (d && d.type === 'Feature') return [d as Feature];
  throw new BreaksError(`${path} is not GeoJSON features (a FeatureCollection or a Feature).`, EXIT_CODES.VALIDATION_ERROR);
}

/** Why a field gives no numbers to break: missing, empty, or text. Undefined when it has numbers. */
function fieldProblem(features: Feature[], field: string, flag: string, path: string): string | undefined {
  let key = 0;
  let present = 0;
  let numeric = 0;
  let sample: unknown;
  const names = new Set<string>();
  for (const feature of features) {
    const props = feature?.properties;
    if (!props || typeof props !== 'object') continue;
    if (names.size < 200) for (const name of Object.keys(props)) names.add(name);
    if (!Object.prototype.hasOwnProperty.call(props, field)) continue;
    key++;
    const raw = props[field];
    if (raw === null || raw === undefined || raw === '') continue;
    present++;
    if ((typeof raw === 'number' && !Number.isNaN(raw)) || (typeof raw === 'string' && !Number.isNaN(Number(raw)))) {
      numeric++;
    } else if (sample === undefined) {
      sample = raw;
    }
  }
  if (key === 0) {
    const all = [...names];
    const sameCase = all.find((n) => n.toLowerCase() === field.toLowerCase());
    const shown = all.slice(0, 12).join(', ') + (all.length > 12 ? ', …' : '');
    return (
      `${flag} ${field}: no feature in ${path} has that property.` +
      (sameCase ? ` Did you mean "${sameCase}"?` : '') +
      (all.length > 0 ? ` Its properties: ${shown}.` : ' Its features have no properties.')
    );
  }
  if (present === 0) return `${flag} ${field}: every feature in ${path} has no data there (null or empty), so there are no values to break.`;
  if (numeric === 0) {
    const type = Array.isArray(sample) ? 'list' : typeof sample === 'object' ? 'object' : typeof sample;
    return (
      `${flag} ${field} is a ${type} field (e.g. ${JSON.stringify(sample)}), not a number, so it has no range to break. ` +
      'Classify it with categories: instead (one colour per value), or pick a numeric field.'
    );
  }
  return undefined;
}

/**
 * Compute `classify:` breaks for a field across a whole local file.
 *
 * @remarks
 * Kept separate from the command so it is testable without a process exit;
 * a refusal throws {@link BreaksError} carrying its exit code. The breaks are
 * core's `classifyWithData` over the decoded features — the code a browser
 * runs for a GeoJSON source — so they match what the map would compute.
 */
export async function fileBreaks(file: string, options: BreaksOptions): Promise<BreaksReport> {
  const record = classifyRecord(options);
  const path = resolve(file);
  const format = formatOf(path);
  const features = await readFeatures(path, format);
  if (features.length === 0) {
    throw new BreaksError(`${path} has no features, so there are no values to break.`, EXIT_CODES.VALIDATION_ERROR);
  }
  const problem =
    fieldProblem(features, record.field, '--field', path) ??
    (record.normalize !== undefined ? fieldProblem(features, record.normalize, '--normalize', path) : undefined);
  if (problem) throw new BreaksError(problem, EXIT_CODES.VALIDATION_ERROR);

  const result = classifyWithData(record, { type: 'FeatureCollection', features });
  const stats = result.stats;
  if (!stats || stats.min === undefined || stats.max === undefined) {
    // Every value was there, but no rate was: each divisor is zero or missing.
    throw new BreaksError(
      `${record.field} ÷ ${record.normalize}: no feature has a rate (every ${record.normalize} is zero or no data).`,
      EXIT_CODES.VALIDATION_ERROR,
    );
  }
  return {
    file: path,
    format,
    field: record.field,
    ...(record.normalize !== undefined ? { normalize: record.normalize } : {}),
    ...(record.multiply !== undefined ? { multiply: record.multiply } : {}),
    method: record.method!,
    classes: record.classes!,
    breaks: result.breaks ?? [],
    min: stats.min,
    max: stats.max,
    count: stats.count,
    noData: stats.noData,
  };
}

/** A number as YAML writes it (`.inf` for infinities; JS's shortest round-trip form otherwise). */
function yamlNumber(n: number): string {
  if (n === Infinity) return '.inf';
  if (n === -Infinity) return '-.inf';
  return String(n);
}

/** The block to paste under `classify:`: comment lines with what was computed, then `breaks: [...]`. */
export function formatBreaks(report: BreaksReport): string {
  const what =
    report.normalize !== undefined
      ? `${report.field} ÷ ${report.normalize}${report.multiply !== undefined ? ` × ${report.multiply}` : ''}`
      : report.field;
  const features = `${report.count} feature${report.count === 1 ? '' : 's'}${
    report.noData > 0 ? `, ${report.noData} no data` : ''
  }`;
  const lines = [
    `# ${what}, ${report.method}, ${report.classes} classes, from ${basename(report.file)} (${features})`,
    `# range: ${yamlNumber(report.min)} to ${yamlNumber(report.max)}`,
  ];
  const drawn = report.breaks.length + 1;
  if (drawn < report.classes) {
    lines.push(
      `# ties in the data leave ${drawn} class${drawn === 1 ? '' : 'es'}, fewer than the ${report.classes} asked for`,
    );
  }
  lines.push(`breaks: [${report.breaks.map(yamlNumber).join(', ')}]`);
  return lines.join('\n') + '\n';
}

/** `--format` values; `human` is accepted as `text`, as `validate` spells it. */
const OUTPUT_FORMATS = ['text', 'json', 'human'] as const;

export const breaksCommand = defineCommand({
  meta: {
    name: 'breaks',
    description: 'Compute classify breaks for a field from a whole GeoParquet, FlatGeobuf or GeoJSON file',
  },
  args: {
    file: {
      type: 'positional',
      required: false,
      description: 'Path to a local .parquet, .fgb, .geojson or .json file',
    },
    field: {
      type: 'string',
      description: 'The numeric property to classify (as classify: field:)',
    },
    method: {
      type: 'string',
      default: 'quantile',
      description: 'quantile, equal or jenks',
    },
    classes: {
      type: 'string',
      default: String(DEFAULT_CLASS_COUNT),
      description: `How many classes, 2 to ${MAX_CLASS_COUNT}`,
    },
    normalize: {
      type: 'string',
      description: 'Divide the field by this property to break a rate (as classify: normalize:)',
    },
    multiply: {
      type: 'string',
      description: 'Multiply the rate, e.g. 100000 for "per 100,000" (with --normalize)',
    },
    format: {
      type: 'string',
      alias: 'f',
      default: 'text',
      description: 'Output format: text (a block to paste under classify:), or json',
    },
  },
  async run({ args }) {
    const outputFormat = String(args.format ?? 'text').toLowerCase();
    const json = outputFormat === 'json';
    const fail = (exitCode: number, message: string): never => {
      if (json) process.stdout.write(JSON.stringify({ success: false, errors: [{ message }] }, null, 2) + '\n');
      else for (const line of message.split('\n')) logger.error(line);
      return process.exit(exitCode);
    };
    if (!(OUTPUT_FORMATS as readonly string[]).includes(outputFormat)) {
      fail(EXIT_CODES.VALIDATION_ERROR, `--format must be text or json, not "${String(args.format)}".`);
    }
    if (!args.file) {
      fail(EXIT_CODES.VALIDATION_ERROR, 'Name a data file: mlym breaks <file> --field <name>.');
    }

    let report: BreaksReport;
    try {
      report = await fileBreaks(String(args.file), {
        field: String(args.field ?? ''),
        method: args.method as string | undefined,
        classes: args.classes as string | undefined,
        normalize: args.normalize as string | undefined,
        multiply: args.multiply as string | undefined,
      });
    } catch (error) {
      if (error instanceof BreaksError) return fail(error.exitCode, error.message);
      return fail(EXIT_CODES.UNKNOWN_ERROR, `mlym breaks failed: ${(error as Error).message}`);
    }
    if (json) {
      process.stdout.write(JSON.stringify({ success: true, ...report }, null, 2) + '\n');
      return;
    }
    process.stdout.write(formatBreaks(report));
  },
});
