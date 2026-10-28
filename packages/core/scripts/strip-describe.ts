/**
 * @file Drop zod `.describe(…)` text from the CDN bundle (ml-7qa, KTD1)
 * @module @maplibre-yaml/core/scripts/strip-describe
 *
 * @description
 * The schemas carry hundreds of `.describe("…")` calls. Nothing in the
 * browser reads a zod description at runtime: the JSON Schema emitter, the
 * docs reference, Astro collections and map-party read them from source or
 * from the npm build. So the CDN build `register.browser.js` removes every
 * call from `src/schemas/*.ts` as it loads the file (esbuild `onLoad`), and
 * the npm build and `index.browser.js` keep them.
 *
 * A call is removed only when its argument is a string literal, or a `+`
 * concatenation of them (a template literal without `${…}` counts). Every
 * other argument — a constant, a call, a template with an interpolation —
 * fails the build, naming the line, rather than shipping the text silently
 * or dropping an expression with side effects: each file's count of
 * `.describe(` must equal the count removed.
 *
 * Shared by `tsup.config.ts` (the plugin) and
 * `tests/build/strip-describe.test.ts` (the transform and the plugin).
 */

import { readFileSync } from "node:fs";

/** One string literal: "…", '…', or a template literal with no `${…}`. */
const STRING = String.raw`(?:"(?:[^"\\\n]|\\[\s\S])*"|'(?:[^'\\\n]|\\[\s\S])*'|\x60(?:[^\x60\\$]|\\[\s\S]|\$(?!\{))*\x60)`;

/** `.describe(<string> [+ <string>]… [,])`, whitespace and newlines allowed. */
const DESCRIBE_CALL = new RegExp(String.raw`\.describe\(\s*${STRING}(?:\s*\+\s*${STRING})*\s*,?\s*\)`, "g");

/** Every `.describe(` in a file, removable or not. */
const DESCRIBE_OPEN = /\.describe\(/g;

export interface StripResult {
  code: string;
  /** How many calls were removed (= how many the file had). */
  removed: number;
}

/**
 * `source` with every `.describe(…)` call removed.
 *
 * @throws when a call's argument is not a plain string (see the file doc);
 * the message names `file` and the line of the first such call.
 */
export function stripDescribe(source: string, file: string): StripResult {
  const calls = [...source.matchAll(DESCRIBE_CALL)].map((m) => [m.index!, m.index! + m[0].length] as const);
  const left = [...source.matchAll(DESCRIBE_OPEN)].find((m) => !calls.some(([from, to]) => m.index! >= from && m.index! < to));
  if (left) {
    const line = source.slice(0, left.index).split("\n").length;
    const total = source.match(DESCRIBE_OPEN)!.length;
    throw new Error(
      `strip-describe: ${file}:${line} — ${total} .describe( calls, but only ${calls.length} take a plain string. ` +
        `The first that does not: ${source.slice(left.index, left.index + 80).split("\n")[0]} ` +
        `Give .describe() a string literal (or "a" + "b"), or teach scripts/strip-describe.ts the new form.`
    );
  }
  return { code: source.replace(DESCRIBE_CALL, ""), removed: calls.length };
}

/** The schema sources the plugin rewrites. */
export const SCHEMA_FILE = /[\\/]src[\\/]schemas[\\/][^\\/]+\.ts$/;

/** The esbuild plugin (hand-typed, as tsup.config.ts's others are). */
export const stripDescribePlugin = {
  name: "maplibre-yaml-strip-describe",
  setup(build: {
    onLoad: (
      o: { filter: RegExp },
      cb: (args: { path: string }) => { contents: string; loader: "ts" } | undefined
    ) => void;
  }) {
    build.onLoad({ filter: SCHEMA_FILE }, (args) => ({
      contents: stripDescribe(readFileSync(args.path, "utf8"), args.path).code,
      loader: "ts",
    }));
  },
};
