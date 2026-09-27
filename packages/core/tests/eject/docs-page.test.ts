/**
 * @file The eject-classes docs page cannot drift from the registry (U3, R6)
 *
 * @description
 * The docs table is hand-written prose; this test is what makes it a
 * contract: every registered construct must be named on the page, in a table
 * row whose Class column matches the registry's classification. Skips ONLY
 * when the docs tree itself is absent (a published-package/standalone test
 * run) — a missing or moved PAGE inside a present docs tree is a failure,
 * not a skip, or a guides rename would silently disarm the drift guard.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { ejectClasses } from "../../src/eject/registrations";

const DOCS_ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../../../docs");
const PAGE = join(DOCS_ROOT, "src/content/docs/guides/eject-classes.mdx");

/** The docs table's human wording for each class. */
const CLASS_LABEL: Record<string, string> = {
  ejects: "ejects",
  fallback: "ejects via fallback",
  "declared-absence": "declared absence",
};

describe("docs/guides/eject-classes.mdx mirrors the registry", () => {
  it.skipIf(!existsSync(DOCS_ROOT))(
    "names every registered construct with its registered class",
    () => {
      expect(
        existsSync(PAGE),
        `docs tree exists but ${PAGE} does not — the drift guard must move with the page`
      ).toBe(true);
      const rows = readFileSync(PAGE, "utf8")
        .split("\n")
        .filter((line) => line.trim().startsWith("|"));

      for (const [construct, definition] of ejectClasses.entries()) {
        const row = rows.find((line) => line.includes(`\`${construct}\``));
        expect(row, `docs table has no row naming \`${construct}\``).toBeDefined();
        expect(
          row!.includes(CLASS_LABEL[definition.class]!),
          `docs row for \`${construct}\` does not state class "${CLASS_LABEL[definition.class]}":\n${row}`
        ).toBe(true);
      }
    }
  );
});
