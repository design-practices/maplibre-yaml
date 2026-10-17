/**
 * @file Write `dist/scrollytelling.css` from the element's stylesheet source.
 * @module @maplibre-yaml/core/scripts/emit-scrollytelling-css
 *
 * @description
 * `<ml-scrollytelling>` injects `SCROLLYTELLING_CSS` itself, which is all a
 * plain-HTML page needs. A server-rendered story (Astro's `<Scrollytelling>`)
 * is on the page before any script runs, so it imports the same rules as a
 * file -- `@maplibre-yaml/core/scrollytelling.css` -- to be styled from the
 * first paint. Generated on build from the one TypeScript source, so the two
 * can never drift; never hand-edit the output.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { SCROLLYTELLING_CSS } from "../src/scrollytelling/styles";

const out = join(dirname(fileURLToPath(import.meta.url)), "..", "dist", "scrollytelling.css");
mkdirSync(dirname(out), { recursive: true });
writeFileSync(
  out,
  `/* @maplibre-yaml/core: <ml-scrollytelling> and chapter styles (generated from src/scrollytelling/styles.ts) */\n${SCROLLYTELLING_CSS.trim()}\n`
);
console.log(`wrote ${out}`);
