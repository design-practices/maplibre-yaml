/**
 * @file Type-level regression check for framework consumers of `<ml-map>`
 *
 * @description
 * Runs a real `tsc` over consumer-shaped fixtures against the BUILT
 * declarations, resolved the way an app resolves them: through
 * `node_modules/@maplibre-yaml/core` (a symlink to this package, created
 * here) and the package's own `exports` / `typesVersions`. It proves:
 *
 *  1. Core's `HTMLElementTagNameMap["ml-map"]` augmentation ships:
 *     `document.querySelector("ml-map")?.mapReady()` type-checks uncast.
 *  2. The React typings entry `@maplibre-yaml/core/react` works on
 *     `@types/react` 19 AND 18 (core's devDeps carry 18 as `react-types-18`):
 *     src, JSON-string config, typed MLMap ref, slot children everywhere;
 *     object `config` and typed `onml-map:*` props on 19 only; an object
 *     `config` is a type error on 18 (React 18 would stringify it).
 *  3. The `typesVersions` fallback resolves the entry under legacy
 *     `moduleResolution: "node"`, which ignores `exports`.
 *  4. The reference line the "TypeScript with React" docs section prints is
 *     what the fixtures compile with: it is extracted from the docs
 *     VERBATIM, so the published snippet cannot drift from what passes here.
 *
 * Skips when dist/ is absent, like the maplibre subpath test (presubmit's
 * `build && test` ordering guarantees it in the gate).
 */

import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const PKG_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DIST = join(PKG_ROOT, "dist", "react.d.ts");
const FIXTURE = join(PKG_ROOT, "tests", "fixtures", "framework-types");
const DOC = join(
  PKG_ROOT,
  "..",
  "..",
  "docs",
  "src",
  "content",
  "docs",
  "integrations",
  "web-components.mdx"
);

if (process.env.CI && !existsSync(DIST)) {
  throw new Error(
    "dist/react.d.ts missing under CI — the build step must run before tests"
  );
}

/** The single ```ts fence that wires up the React typings. */
function documentedReactTypings(): string {
  const mdx = readFileSync(DOC, "utf8");
  const blocks = [...mdx.matchAll(/```ts\n([\s\S]*?)```/g)]
    .map((m) => m[1])
    .filter((body) => body.includes("@maplibre-yaml/core/react"));
  expect(blocks).toHaveLength(1);
  return blocks[0];
}

/** Consumer layout: the fixture dir sees this package as an installed dep. */
function linkPackage(): void {
  const scope = join(FIXTURE, "node_modules", "@maplibre-yaml");
  mkdirSync(scope, { recursive: true });
  if (!existsSync(join(scope, "core", "package.json"))) {
    symlinkSync(PKG_ROOT, join(scope, "core"), "dir");
  }
}

function tsc(project: string): string {
  const bin = createRequire(join(PKG_ROOT, "package.json")).resolve(
    "typescript/bin/tsc"
  );
  try {
    execFileSync(process.execPath, [bin, "-p", join(FIXTURE, project)], {
      cwd: PKG_ROOT,
      encoding: "utf8",
    });
    return "";
  } catch (error) {
    return String((error as { stdout?: string }).stdout ?? error);
  }
}

describe("framework TypeScript consumers of <ml-map>", () => {
  const prepare = () => {
    linkPackage();
    mkdirSync(join(FIXTURE, "tmp"), { recursive: true });
    writeFileSync(
      join(FIXTURE, "tmp", "docs-react.d.ts"),
      documentedReactTypings()
    );
  };

  it.skipIf(!existsSync(DIST))(
    "@types/react 19: tag-name map + the documented typings import",
    () => {
      prepare();
      expect(tsc("tsconfig.json")).toBe("");
    },
    60_000
  );

  it.skipIf(!existsSync(DIST))(
    "@types/react 18: same consumer code; object config rejected",
    () => {
      prepare();
      expect(tsc("tsconfig.react18.json")).toBe("");
    },
    60_000
  );

  it.skipIf(!existsSync(DIST))(
    'moduleResolution "node": the typesVersions fallback resolves the entry',
    () => {
      prepare();
      expect(tsc("tsconfig.node10.json")).toBe("");
    },
    60_000
  );
});
