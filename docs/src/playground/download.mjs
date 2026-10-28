/**
 * "Download" (design D7): the document as a folder that works on its own,
 * `my-map/index.html` + `map.yaml` (or `story.yaml`; `.json` or `.toml` for
 * a document in that format) + `README.txt`. The page zips these in the
 * browser with fflate, loaded on click.
 */
import { zipSync, strToU8 } from "fflate";
import { mapPage, storyPage, readme } from "./download-template.mjs";

/** @typedef {"yaml" | "json" | "toml"} Format */

export const SITE = "https://docs.maplibre-yaml.org";

/** Keys whose value names a file the map fetches. */
const FILE_KEYS = new Set(["url", "data", "mapStyle", "style", "image", "src", "icon", "sprite", "glyphs", "basemap"]);
/** A site-root path: /data/…, /configs/…, /gallery-assets/… (a tile template too). */
const ROOT_PATH = /^\/[\w-][\w./{}%-]*$/;
/** A relative path to a data or image file, as the docs configs write them. */
const RELATIVE_FILE = /^(?:\.\/)?[\w-][\w./-]*\.(geojson|json|csv|tsv|fgb|pmtiles|parquet|geoparquet|tif|tiff|png|jpe?g|gif|svg|webp|mvt|pbf)$/i;
/** `key: value` or `- value`, optionally quoted, optionally with a comment. */
const LINE = /^(\s*(?:- +)?)(?:([\w$-]+)(:[ \t]+))?(["']?)([^\s"'#][^\s"'#]*)\4([ \t]*(?:#.*)?)$/;

/** The docs-site URL for a path a file key or a list item holds, or null to leave it. */
function siteUrl(value, { fileKey, listItem }, site) {
  if ((fileKey || listItem) && ROOT_PATH.test(value)) return site + value;
  if (fileKey && RELATIVE_FILE.test(value)) return `${site}/${value.replace(/^\.\//, "")}`;
  return null;
}

/** YAML: one `key: value` or `- value` per line. */
function rewriteYaml(text, site) {
  return text
    .split("\n")
    .map((line) => {
      const m = LINE.exec(line);
      if (!m) return line;
      const [, lead, key, colon = "", quote, value, tail] = m;
      const next = siteUrl(value, { fileKey: key !== undefined && FILE_KEYS.has(key), listItem: !key && /-\s+$/.test(lead) }, site);
      return next === null ? line : `${lead}${key ?? ""}${colon}${quote}${next}${quote}${tail}`;
    })
    .join("\n");
}

/**
 * JSON and TOML: a quoted string after `"key":` / `key =` (a bare, quoted or
 * dotted key, its last part counting), or a string item in a list. Strings
 * hold no newline in either, so a line at a time; a TOML comment is left
 * alone.
 */
const KEY_VALUE = {
  json: /("([\w$-]+)"\s*:\s*)(")((?:[^"\\\n]|\\.)*)"/g,
  toml: /((?:^|[\s{,.])["']?([\w$-]+)["']?\s*=\s*)(["'])([^"'\n]*)\3/g,
};
const LIST_ITEM = /([[,]\s*)(["'])(\/[\w-][\w./{}%-]*)\2(?=\s*[,\]])/g;

function rewriteStrings(text, format, site) {
  return text
    .split("\n")
    .map((line) => {
      // TOML: leave a comment as it is (a `#` outside a string).
      let code = line;
      let comment = "";
      if (format === "toml") {
        const hash = commentStart(line);
        if (hash !== -1) [code, comment] = [line.slice(0, hash), line.slice(hash)];
      }
      code = code.replace(KEY_VALUE[format], (all, lead, key, quote, value) => {
        const next = siteUrl(value, { fileKey: FILE_KEYS.has(key), listItem: false }, site);
        return next === null ? all : `${lead}${quote}${next}${quote}`;
      });
      code = code.replace(LIST_ITEM, (all, lead, quote, value) => `${lead}${quote}${site}${value}${quote}`);
      return code + comment;
    })
    .join("\n");
}

/** Where a TOML line's comment starts (a `#` outside a string), or -1. */
function commentStart(line) {
  let quote = "";
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quote) {
      if (c === "\\" && quote === '"') i++;
      else if (c === quote) quote = "";
    } else if (c === '"' || c === "'") quote = c;
    else if (c === "#") return i;
  }
  return -1;
}

/**
 * Point the docs site's own paths at the docs site, so the map still finds
 * its data when it runs from the reader's folder. The preview resolves
 * `/data/…` and `data/…` against the docs site; a downloaded page would
 * look in its own folder instead. Full URLs are left alone, and so are
 * comments and the rest of the text: only the path changes.
 */
export function rewriteSiteUrls(text, site = SITE, format = "yaml") {
  return format === "json" || format === "toml" ? rewriteStrings(text, format, site) : rewriteYaml(text, site);
}

const schemaUrl = (kind) => `${SITE}/schema/latest/${kind === "scrollytelling" ? "scrollytelling" : "map"}.schema.json`;

/**
 * The document with its editor schema hint, in its format's spelling, unless
 * it has one: the YAML modeline the docs configs start with, a JSON
 * `"$schema"` key, or a TOML `#:schema` first line.
 */
function withSchemaHint(text, kind, format) {
  const url = schemaUrl(kind);
  if (format === "toml") return /^#:schema\s/m.test(text) ? text : `#:schema ${url}\n${text}`;
  if (format === "json") {
    const open = /^\s*\{/.exec(text);
    const rest = open ? text.slice(open[0].length) : "";
    if (!open || /^\s*\}/.test(rest) || /"\$schema"\s*:/.test(text)) return text;
    const entry = `"$schema": "${url}",`;
    const newline = /^[ \t]*\r?\n([ \t]*)/.exec(rest);
    return open[0] + (newline ? `\n${newline[1]}${entry}` : ` ${entry}`) + rest;
  }
  return /^#\s*yaml-language-server:/m.test(text) ? text : `# yaml-language-server: $schema=${url}\n${text}`;
}

/** The document's file name in the folder. */
export function documentFile(kind = "map", format = "yaml") {
  return `${kind === "scrollytelling" ? "story" : "map"}.${format === "json" || format === "toml" ? format : "yaml"}`;
}

/**
 * The files of the download, as text, keyed by their path in the zip.
 *
 * @param {string} text the document as written
 * @param {"map" | "scrollytelling"} kind
 * @param {Format} [format]
 * @returns {Record<string, string>}
 */
export function downloadFiles(text, kind = "map", format = "yaml") {
  const file = documentFile(kind, format);
  let doc = withSchemaHint(rewriteSiteUrls(text, SITE, format), kind, format);
  if (!doc.endsWith("\n")) doc += "\n";
  return {
    "my-map/index.html": kind === "scrollytelling" ? storyPage(file) : mapPage(file),
    [`my-map/${file}`]: doc,
    "my-map/README.txt": readme(file),
  };
}

/**
 * The download as zip bytes. Imported on click, so fflate (only the zip
 * writer, a few KB) loads when someone downloads, not with the page.
 *
 * @param {string} text
 * @param {"map" | "scrollytelling"} kind
 * @param {Format} [format]
 * @returns {Uint8Array}
 */
export function downloadZip(text, kind = "map", format = "yaml") {
  const files = downloadFiles(text, kind, format);
  return zipSync(Object.fromEntries(Object.entries(files).map(([name, body]) => [name, strToU8(body)])), { level: 6 });
}
