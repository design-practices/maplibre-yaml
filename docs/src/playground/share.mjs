/**
 * Share links (design D6, §5): the document travels in the URL fragment,
 * `/playground/#code/<lz-string payload>`. A fragment is never sent to the
 * server, so a shared map leaves nothing in any log and there is nothing to
 * store or expire. The prefix is the format: `#code/` is YAML (every link
 * made before the JSON and TOML toggle is one, and still opens as YAML),
 * `#json/` is JSON and `#toml/` is TOML.
 *
 * A shared document runs exactly like any other: `<ml-map>` treats every
 * document as untrusted (raw HTML shown as text, `click.emit` dropped). What
 * it can still do is make the reader's browser fetch URLs, so the playground
 * shows the hosts a shared document names (see `hostsOf`).
 */
import LZString from "lz-string";

/** @typedef {"yaml" | "json" | "toml"} Format */

/** The fragment prefix for each format. `#code/` stays YAML, so old links open. */
export const SHARE_PREFIXES = { yaml: "#code/", json: "#json/", toml: "#toml/" };
/** Above this, some chat apps, mail clients and QR codes cut the link. */
export const SHARE_WARN_LENGTH = 2000;
/** Above this, no link: offer Download or Copy YAML instead. */
export const SHARE_MAX_LENGTH = 32000;

/**
 * The fragment for a document, with its leading `#`.
 *
 * @param {string} text
 * @param {Format} [format]
 */
export function encodeShare(text, format = "yaml") {
  return (SHARE_PREFIXES[format] ?? SHARE_PREFIXES.yaml) + LZString.compressToEncodedURIComponent(text);
}

/**
 * The document in a fragment (`#code/…`, `#json/…`, `#toml/…`) and its
 * format, or null when the fragment isn't a share link or doesn't decode.
 *
 * @returns {{ text: string, format: Format } | null}
 */
export function decodeShare(hash) {
  if (typeof hash !== "string") return null;
  const format = /** @type {Format | undefined} */ (
    Object.keys(SHARE_PREFIXES).find((f) => hash.startsWith(SHARE_PREFIXES[f]))
  );
  if (!format) return null;
  const payload = hash.slice(SHARE_PREFIXES[format].length);
  if (!payload) return null;
  try {
    const text = LZString.decompressFromEncodedURIComponent(payload);
    return typeof text === "string" && text.length > 0 ? { text, format } : null;
  } catch {
    return null;
  }
}

/**
 * The share link for a document and what to tell the author about it.
 *
 * @param {string} pageUrl the playground's URL without a fragment
 * @param {string} text the document
 * @param {Format} [format] the document's format
 * @returns {{ url: string | null, length: number, level: "ok" | "long" | "too-long" }}
 */
export function shareLink(pageUrl, text, format = "yaml") {
  const url = pageUrl.replace(/#.*$/, "") + encodeShare(text, format);
  const length = url.length;
  if (length > SHARE_MAX_LENGTH) return { url: null, length, level: "too-long" };
  return { url, length, level: length > SHARE_WARN_LENGTH ? "long" : "ok" };
}

/**
 * Every host a document will make the browser contact: the hostnames of
 * the absolute `http(s)://` URLs among its values (data, basemap, tiles,
 * images). Sorted, without repeats.
 *
 * @param {unknown} doc the document parsed to plain values (any format)
 * @returns {string[]}
 */
export function hostsOf(doc) {
  const hosts = new Set();
  const visit = (v) => {
    if (typeof v === "string") {
      for (const m of v.matchAll(/\bhttps?:\/\/[^\s"'<>]+/g)) {
        try {
          hosts.add(new URL(m[0]).hostname);
        } catch {
          // not a URL after all
        }
      }
    } else if (Array.isArray(v)) {
      v.forEach(visit);
    } else if (v && typeof v === "object") {
      Object.values(v).forEach(visit);
    }
  };
  visit(doc);
  return [...hosts].sort();
}

/**
 * A `?src=` value the playground will load: only same-origin docs configs,
 * so a link can't make the page fetch from anywhere else on load.
 */
export function safeSrc(src) {
  if (typeof src !== "string") return null;
  if (!/^\/configs\/[\w./-]+\.ya?ml$/.test(src) || src.includes("..")) return null;
  return src;
}
