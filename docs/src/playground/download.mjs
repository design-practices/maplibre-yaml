/**
 * "Download" (design D7): the document as a folder that works on its own,
 * `my-map/index.html` + `map.yaml` (or `story.yaml`) + `README.txt`. The
 * page zips these in the browser with fflate, loaded on click.
 */
import { zipSync, strToU8 } from "fflate";
import { MAP_PAGE, STORY_PAGE, readme } from "./download-template.mjs";

export const SITE = "https://docs.maplibre-yaml.org";

/** Keys whose value names a file the map fetches. */
const FILE_KEYS = new Set(["url", "data", "mapStyle", "style", "image", "src", "icon", "sprite", "glyphs", "basemap"]);
/** A site-root path: /data/…, /configs/…, /gallery-assets/… (a tile template too). */
const ROOT_PATH = /^\/[\w-][\w./{}%-]*$/;
/** A relative path to a data or image file, as the docs configs write them. */
const RELATIVE_FILE = /^(?:\.\/)?[\w-][\w./-]*\.(geojson|json|csv|tsv|fgb|pmtiles|parquet|geoparquet|tif|tiff|png|jpe?g|gif|svg|webp|mvt|pbf)$/i;
/** `key: value` or `- value`, optionally quoted, optionally with a comment. */
const LINE = /^(\s*(?:- +)?)(?:([\w$-]+)(:[ \t]+))?(["']?)([^\s"'#][^\s"'#]*)\4([ \t]*(?:#.*)?)$/;

/**
 * Point the docs site's own paths at the docs site, so the map still finds
 * its data when it runs from the reader's folder. The preview resolves
 * `/data/…` and `data/…` against the docs site; a downloaded page would
 * look in its own folder instead. Full URLs are left alone, and so are
 * comments and the rest of the text: only the path changes.
 */
export function rewriteSiteUrls(text, site = SITE) {
  return text
    .split("\n")
    .map((line) => {
      const m = LINE.exec(line);
      if (!m) return line;
      const [, lead, key, colon = "", quote, value, tail] = m;
      const listItem = !key && /-\s+$/.test(lead);
      const fileKey = key !== undefined && FILE_KEYS.has(key);
      let next = null;
      if ((fileKey || listItem) && ROOT_PATH.test(value)) next = site + value;
      else if (fileKey && RELATIVE_FILE.test(value)) next = `${site}/${value.replace(/^\.\//, "")}`;
      return next === null ? line : `${lead}${key ?? ""}${colon}${quote}${next}${quote}${tail}`;
    })
    .join("\n");
}

/** The editor modeline the docs configs start with, kept in the download. */
const MODELINE = (kind) =>
  `# yaml-language-server: $schema=${SITE}/schema/latest/${kind === "scrollytelling" ? "scrollytelling" : "map"}.schema.json\n`;

/**
 * The files of the download, as text, keyed by their path in the zip.
 *
 * @param {string} text the document as written
 * @param {"map" | "scrollytelling"} kind
 * @returns {Record<string, string>}
 */
export function downloadFiles(text, kind = "map") {
  const story = kind === "scrollytelling";
  const file = story ? "story.yaml" : "map.yaml";
  let yaml = rewriteSiteUrls(text);
  if (!/^#\s*yaml-language-server:/m.test(yaml)) yaml = MODELINE(kind) + yaml;
  if (!yaml.endsWith("\n")) yaml += "\n";
  return {
    "my-map/index.html": story ? STORY_PAGE : MAP_PAGE,
    [`my-map/${file}`]: yaml,
    "my-map/README.txt": readme(file),
  };
}

/**
 * The download as zip bytes. Imported on click, so fflate (only the zip
 * writer, a few KB) loads when someone downloads, not with the page.
 *
 * @param {string} text
 * @param {"map" | "scrollytelling"} kind
 * @returns {Uint8Array}
 */
export function downloadZip(text, kind = "map") {
  const files = downloadFiles(text, kind);
  return zipSync(Object.fromEntries(Object.entries(files).map(([name, body]) => [name, strToU8(body)])), { level: 6 });
}
