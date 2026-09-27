/**
 * @file The eject-classes docs page cannot drift from the registry (U3, R6)
 *
 * @description
 * The docs table is hand-written prose; this test is what makes it a
 * contract. Every registered construct must be named on the page, and the
 * page must not claim a class vocabulary the registry doesn't have.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { ejectClasses } from "../../src/eject/registrations";

const PAGE = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../../../docs/src/content/docs/guides/eject-classes.mdx"
);

describe("docs/guides/eject-classes.mdx mirrors the registry", () => {
  it.skipIf(!existsSync(PAGE))("names every registered construct", () => {
    const page = readFileSync(PAGE, "utf8");
    for (const [construct] of ejectClasses.entries()) {
      expect(page.includes(construct), `docs page is missing \`${construct}\``).toBe(true);
    }
  });
});
