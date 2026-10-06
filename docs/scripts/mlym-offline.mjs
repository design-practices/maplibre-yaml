#!/usr/bin/env node
/**
 * @file `mlym`, with the docs site's own origin served from `docs/public`.
 *
 * The launch page's exported panes are `mlym emit --with-fallbacks` output,
 * produced at docs build time (see classics-export.mjs). The classic
 * documents name their textures by their deployed URLs
 * (https://docs.maplibre-yaml.org/classics/...), because emit fetches
 * images at compile time and a downloaded document must work anywhere.
 * At build time those files are not deployed yet — the build is what
 * deploys them — so this wrapper answers fetches for that ONE origin from
 * the files that ship with the build. Every other URL goes to the real
 * fetch, and nothing else about the CLI changes: same binary, same
 * arguments, same output bytes as a networked run against the live site.
 *
 * Usage: node docs/scripts/mlym-offline.mjs <mlym args…>
 */
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, normalize } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const SITE = "https://docs.maplibre-yaml.org";
const PUBLIC = join(dirname(fileURLToPath(import.meta.url)), "..", "public");

const realFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (url.startsWith(`${SITE}/`)) {
    const rel = normalize(decodeURIComponent(new URL(url).pathname)).replace(/^([/\\]|\.\.[/\\])+/, "");
    const file = join(PUBLIC, rel);
    if (!file.startsWith(PUBLIC)) return new Response("forbidden", { status: 403 });
    try {
      return new Response(await readFile(file), { status: 200 });
    } catch {
      return new Response("not found", { status: 404, statusText: "Not Found" });
    }
  }
  return realFetch(input, init);
};

const require = createRequire(import.meta.url);
const cli = join(dirname(require.resolve("@maplibre-yaml/cli/package.json")), "dist/cli.js");
process.argv = [process.argv[0], cli, ...process.argv.slice(2)];
await import(pathToFileURL(cli).href);
