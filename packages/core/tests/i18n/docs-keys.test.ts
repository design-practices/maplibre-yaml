/**
 * The "Accessibility & languages" guide lists every UI string key with its
 * English text, so authors can translate from it: a key added to the table
 * without a docs row fails here. Skips only when the docs tree is absent (a
 * standalone package test run).
 */
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_STRINGS } from "../../src/i18n";

const DOCS_ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../../../docs");
const PAGE = join(DOCS_ROOT, "src/content/docs/guides/accessibility-languages.mdx");

describe("docs/guides/accessibility-languages.mdx lists every string key", () => {
  it.skipIf(!existsSync(DOCS_ROOT))("one table row per key, with its English opening", () => {
    const page = readFileSync(PAGE, "utf8");
    for (const [key, english] of Object.entries(DEFAULT_STRINGS)) {
      const row = page.split("\n").find((line) => line.startsWith(`| \`${key}\` |`));
      expect(row, `no table row for ${key}`).toBeDefined();
      // The row quotes the English text's first words (placeholders are
      // shown as code there, so compare the part before the first brace).
      const opening = english.split(/[{`]/)[0]!.trim().slice(0, 20);
      expect(row!, `${key} row should quote "${opening}"`).toContain(opening);
    }
  });
});
