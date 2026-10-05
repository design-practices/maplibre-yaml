/**
 * @file The ml-map event reference cannot drift from the element (U9)
 *
 * @description
 * The web-components page's event table is hand-written prose; this test
 * makes it a contract, the same way the eject-classes page is pinned to its
 * registry. Three sources must agree on the event NAMES — the `@fires`
 * JSDoc tags, the `new CustomEvent("ml-map:…")` calls actually dispatched,
 * and the docs table rows — and the table's Detail column must name exactly
 * the keys the dispatch sites put on `detail` (union across a name's
 * dispatch sites, since `ml-map:error` has two shapes). Skips ONLY when the
 * docs tree is absent (published-package test run); a moved page inside a
 * present docs tree fails.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const SOURCE = readFileSync(join(HERE, "../../src/components/ml-map.ts"), "utf8");
const DOCS_ROOT = join(HERE, "../../../../docs");
const PAGE = join(DOCS_ROOT, "src/content/docs/integrations/web-components.mdx");

/** Shorthand or `key:` detail keys inside one `detail: { ... }` literal. */
function detailKeys(body: string): string[] {
  return body
    .split(",")
    .map((part) => part.split(":")[0].trim())
    .filter((key) => /^[A-Za-z_$][\w$]*$/.test(key));
}

/** name → union of detail keys across every dispatch site. */
function dispatched(): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  const re = /new CustomEvent\(\s*"(ml-map:[a-z-]+)",\s*\{[^}]*?detail:\s*\{([^}]*)\}/g;
  for (const m of SOURCE.matchAll(re)) {
    const keys = out.get(m[1]) ?? new Set<string>();
    for (const k of detailKeys(m[2])) keys.add(k);
    out.set(m[1], keys);
  }
  return out;
}

function firesTags(): string[] {
  return [...SOURCE.matchAll(/@fires (ml-map:[a-z-]+)/g)].map((m) => m[1]);
}

/** name → keys named in the Detail column (every `{ … }` group in the cell). */
function documented(page: string): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  const start = page.indexOf("### Event reference");
  expect(start, "the Event reference section is gone from the page").toBeGreaterThan(-1);
  for (const line of page.slice(start).split("\n")) {
    const m = line.match(/^\|\s*`(ml-map:[a-z-]+)`\s*\|([^|]*)\|/);
    if (!m) continue;
    const keys = new Set<string>();
    for (const group of m[2].matchAll(/\{([^}]*)\}/g)) {
      for (const k of detailKeys(group[1])) keys.add(k);
    }
    out.set(m[1], keys);
  }
  return out;
}

const sorted = (xs: Iterable<string>) => [...xs].sort();

describe("ml-map events: @fires, dispatch sites, and the docs table agree", () => {
  it("every dispatched event is declared with @fires, and vice versa", () => {
    const names = sorted(dispatched().keys());
    expect(names.length).toBeGreaterThan(10); // the regex still matches the source
    expect(sorted(new Set(firesTags()))).toEqual(names);
  });

  it("MLMapEventMap (the typed listeners + React props) names exactly the dispatched events", () => {
    const body = SOURCE.match(/export interface MLMapEventMap \{([\s\S]*?)\n\}/);
    expect(body, "MLMapEventMap is gone from ml-map.ts").not.toBeNull();
    const typed = [...body![1].matchAll(/"(ml-map:[a-z-]+)":/g)].map((m) => m[1]);
    expect(sorted(typed)).toEqual(sorted(dispatched().keys()));
  });

  it.skipIf(!existsSync(DOCS_ROOT))(
    "the web-components event table names every event with its detail keys",
    () => {
      expect(
        existsSync(PAGE),
        `docs tree exists but ${PAGE} does not — the drift guard must move with the page`
      ).toBe(true);
      const docs = documented(readFileSync(PAGE, "utf8"));
      const code = dispatched();
      expect(sorted(docs.keys())).toEqual(sorted(code.keys()));
      for (const [name, keys] of code) {
        expect(sorted(docs.get(name) ?? []), `detail keys for ${name}`).toEqual(sorted(keys));
      }
    }
  );
});
