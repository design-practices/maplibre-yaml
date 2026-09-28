/**
 * @file Local TypeDoc plugin for the generated TypeScript API reference.
 *
 * Adjustments, each keeping the output a pure function of the source:
 *
 * 1. `@fires` -> one "Events" table. `<ml-map>` (MLMap) documents its DOM
 *    events with one `@fires <name> - <what>` tag per event; TypeDoc renders
 *    each block tag as its own section (sixteen consecutive "## Fires"
 *    headings). They are rewritten, after comment parsing, into a single
 *    `@events` block holding a table in source order — still tracking the
 *    JSDoc exactly, with no second list to keep in sync.
 * 2. The repo's `@file` / `@description` file-header convention is folded
 *    into the summary, so module pages open with prose rather than "## File"
 *    and "## Description" headings.
 * 3. Module landing pages are written as `index.md` (see `entryFileName` in
 *    astro.config.mjs); typedoc-plugin-markdown links them as `.../index/`,
 *    which Starlight serves at `.../`. Links are rewritten to match.
 * 4. maplibre-gl's `Map$1` (its bundled-.d.ts name) is shown as
 *    `maplibregl.Map`, linked to the MapLibre API docs.
 */

import { CommentTag, Converter, PageEvent } from "typedoc";

const MAPLIBRE_MAP_URL = "https://maplibre.org/maplibre-gl-js/docs/API/classes/Map/";

/** Escape a cell for a GFM table row. */
function cell(text) {
  return text.replace(/\|/g, "\\|").replace(/\s*\n\s*/g, " ").trim();
}

/** "ml-map:load - Map loaded" -> ["ml-map:load", "Map loaded"] */
function splitFires(text) {
  const match = /^\s*(\S+)\s*(?:-\s*)?([\s\S]*)$/.exec(text);
  return match ? [match[1], match[2] ?? ""] : [text.trim(), ""];
}

/**
 * Fold the repo's `@file <one-liner>` + `@description <body>` file-header
 * convention into the comment summary, so module pages open with prose
 * instead of "## File" / "## Description" headings.
 */
function foldFileHeader(comment) {
  const take = (name) => {
    const tags = comment.blockTags.filter((tag) => tag.tag === name);
    comment.blockTags = comment.blockTags.filter((tag) => tag.tag !== name);
    return tags.flatMap((tag) => tag.content);
  };
  const file = take("@file");
  const description = take("@description");
  const parts = [...comment.summary];
  for (const block of [file, description]) {
    if (block.length === 0) continue;
    if (parts.length > 0) parts.push({ kind: "text", text: "\n\n" });
    parts.push(...block);
  }
  comment.summary = parts;
}

/** @param {import("typedoc").Application} app */
export function load(app) {
  app.converter.on(Converter.EVENT_RESOLVE_BEGIN, (context) => {
    for (const reflection of Object.values(context.project.reflections)) {
      const comment = reflection.comment;
      if (!comment) continue;
      foldFileHeader(comment);
      const fires = comment.blockTags.filter((tag) => tag.tag === "@fires");
      if (fires.length === 0) continue;

      const rows = fires.map((tag) => {
        const raw = tag.content.map((part) => part.text).join("");
        const [name, description] = splitFires(raw);
        return `| \`${cell(name)}\` | ${cell(description)} |`;
      });
      const table = [
        "Dispatched on the element as `CustomEvent`s; listen with `addEventListener`.",
        "",
        "| Event | When |",
        "| --- | --- |",
        ...rows,
      ].join("\n");

      comment.blockTags = comment.blockTags.filter((tag) => tag.tag !== "@fires");
      comment.blockTags.push(new CommentTag("@events", [{ kind: "text", text: table }]));
    }
  });

  app.renderer.on(PageEvent.END, (page) => {
    if (typeof page.contents !== "string") return;
    page.contents = page.contents
      .replace(/(\]\([^)\s]*?)\/index\/((?:#[^)\s]*)?\))/g, "$1/$2")
      // maplibre-gl's bundled .d.ts declares its map class as `Map$1` (a
      // rollup rename to dodge the global `Map`); show the name users know.
      .replace(/`Map\$1`/g, `[\`maplibregl.Map\`](${MAPLIBRE_MAP_URL})`);
  });
}
