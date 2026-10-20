/**
 * The cloud-native guide's "Host your own basemap" steps (ml-aot.116): the
 * extract command a student copies must make a file GitHub accepts. Without
 * `--maxzoom` the New York example is about 95 MB, over GitHub's 25 MB web
 * upload and close to its 100 MB push limit.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const GUIDE = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "src/content/docs/guides/cloud-native-data.mdx"
);
const text = readFileSync(GUIDE, "utf8");

test("every pmtiles extract command caps the zoom", () => {
  const commands = [...text.matchAll(/pmtiles extract[^\n\\]*(?:\\\n[^\n\\]*)*/g)].map((m) => m[0]);
  assert.ok(commands.length > 0, "the guide shows an extract command");
  for (const command of commands) assert.match(command, /--maxzoom=\d+/, command);
});

test("the size advice names the real sizes, GitHub's limits and how to go smaller", () => {
  assert.match(text, /about 12 MB/);
  assert.match(text, /about 95 MB/);
  assert.match(text, /25 MB/);
  assert.match(text, /100 MB/);
  assert.match(text, /--bbox/);
});
