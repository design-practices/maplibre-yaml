/**
 * @file Attribution sanitizer: the one markup sink we do not own
 * @module @maplibre-yaml/core/utils
 *
 * @description
 * MapLibre renders attribution with `innerHTML = DOM.sanitize(html)`, and that
 * sanitizer is a denylist that can be bypassed in every maplibre-gl release in
 * our peer range (3.x to 5.x; upstream advisory GHSA-jrc7-96c5-q579). Attribution
 * strings come from the document (a source's `attribution:`, a control's
 * `customAttribution`) or from resources the document points at (a remote
 * basemap style, a TileJSON `url:`). An untrusted document therefore reaches an
 * HTML sink whose only guard is broken.
 *
 * So attribution goes through *our* sanitizer before MapLibre's sees it. It is
 * an allowlist, not a denylist: plain text, character references, and `<a>`
 * elements whose `href` uses `http:`, `https:` or `mailto:`, with only `href`,
 * `target` and `rel` kept. Everything else is escaped and renders as visible
 * text, so a stripped attribution stays legible instead of disappearing (an
 * attribution is a licensing obligation, and silently deleting it is its own
 * bug).
 *
 * **This is not gated on trust.** `!html` popups render raw markup for a
 * trusted document because our own sink is sound. Here the sink is MapLibre's,
 * and it is unsound: a trusted author gains nothing from bypassing our
 * allowlist except exposure to the upstream bug. The only cost to a trusted
 * document is that non-link markup (`<b>`, `<span>`) in attribution renders as
 * text.
 *
 * Works without a DOM, so the emitter can apply the same rule in Node when it
 * writes attribution into an exported `style.json`.
 */

import { LINK_TARGETS } from "./html";

/** Result of sanitizing one attribution string. */
export interface SanitizedAttribution {
  /** Markup safe to hand to MapLibre's attribution control. */
  html: string;
  /**
   * True when something in the input was not allowed and was escaped or
   * dropped: a non-anchor tag, an unsafe or missing `href`, a disallowed
   * attribute. Escaping a stray `&` or quote is normalization, not removal, and
   * does not set this.
   */
  changed: boolean;
}

/** Schemes an attribution link may navigate to. Narrower than `safeUrl`. */
const ATTRIBUTION_SCHEMES = new Set(["http", "https", "mailto"]);

/** A complete character reference, kept verbatim in text position. */
const CHAR_REF = /&(?:#[0-9]{1,7}|#[xX][0-9a-fA-F]{1,6}|[A-Za-z][A-Za-z0-9]{1,31});/y;

/**
 * An `<a ...>` start tag. Attribute syntax follows the HTML tokenizer closely
 * enough that anything it would read as one tag, this reads as one tag; any
 * input this does not match is escaped rather than guessed at.
 */
const ANCHOR_OPEN =
  /<a(?=[\s/>])((?:\s+[^\s"'>/=]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>`]+))?)*)\s*\/?>/iy;
const ANCHOR_CLOSE = /<\/a\s*>/iy;
const ATTRIBUTE = /([^\s"'>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;

/** Something a browser would start parsing as markup: a tag, comment, or PI. */
const TAG_LIKE = /<[A-Za-z!/?]/y;

const TEXT_ESCAPES: Record<string, string> = {
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

/** The named references an `href` may carry; any other one rejects the link. */
const ATTR_NAMED: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
};

function escapeAttr(value: string): string {
  return value.replace(/[&<>"']/g, (c) => (c === "&" ? "&amp;" : TEXT_ESCAPES[c] as string));
}

/**
 * Decode the character references a browser decodes in an attribute value.
 *
 * @remarks
 * Numeric references are decoded (with or without the trailing `;`, as a
 * browser does). Of the named ones only the five XML basics are, and any other
 * `&name;` returns null: the full HTML table includes references like the one
 * for `:`, and a value we cannot decode exactly is a value we cannot vouch for.
 * A bare `&` (a query string `?a=1&b=2`) is literal, as it is to a browser.
 */
function decodeAttr(raw: string): string | null {
  let failed = false;
  const decoded = raw.replace(
    /&(?:#[xX]([0-9a-fA-F]+);?|#([0-9]+);?|([A-Za-z][A-Za-z0-9]*);)/g,
    (_m, hex: string | undefined, dec: string | undefined, name: string | undefined) => {
      if (name !== undefined) {
        const value = ATTR_NAMED[name];
        if (value === undefined) failed = true;
        return value ?? "";
      }
      const code = Number.parseInt((hex ?? dec) as string, hex ? 16 : 10);
      return code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff)
        ? String.fromCodePoint(code)
        : "�";
    }
  );
  return failed ? null : decoded;
}

/** Characters a browser strips from a URL before it reads the scheme. */
const URL_STRIPPED = new RegExp("[\u0000-\u001F\u007F-\u009F]", "g");

/**
 * The navigable form of an attribution `href`, or null if it is not allowed.
 *
 * @remarks
 * Validated *after* decoding, against what the browser will navigate to, and
 * the decoded value is what gets written back out (re-escaped). There is no
 * gap between the string checked and the string followed.
 */
export function safeAttributionHref(raw: string): string | null {
  const decoded = decodeAttr(raw);
  if (decoded === null) return null;
  const cleaned = decoded.replace(URL_STRIPPED, "").trim();
  const scheme = /^([A-Za-z][A-Za-z0-9+.-]*):/.exec(cleaned);
  if (!scheme || !ATTRIBUTION_SCHEMES.has((scheme[1] as string).toLowerCase())) return null;
  try {
    new URL(cleaned);
  } catch {
    return null;
  }
  return cleaned;
}

interface AnchorAttributes {
  href: string | null;
  target: string | null;
  rel: string | null;
  dropped: boolean;
}

function readAnchorAttributes(source: string): AnchorAttributes {
  const out: AnchorAttributes = { href: null, target: null, rel: null, dropped: false };
  const seen = new Set<string>();
  ATTRIBUTE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = ATTRIBUTE.exec(source)) !== null) {
    const name = (match[1] as string).toLowerCase();
    const value = match[2] ?? match[3] ?? match[4] ?? "";
    // A browser keeps the first of a duplicated attribute; so do we.
    if (seen.has(name)) continue;
    seen.add(name);
    if (name === "href") {
      out.href = safeAttributionHref(value);
      if (out.href === null) out.dropped = true;
    } else if (name === "target") {
      const target = decodeAttr(value)?.trim().toLowerCase() ?? "";
      if (LINK_TARGETS.has(target)) out.target = target;
      else out.dropped = true;
    } else if (name === "rel") {
      const tokens = (decodeAttr(value) ?? "")
        .split(/\s+/)
        .filter((t) => /^[A-Za-z][A-Za-z-]*$/.test(t));
      if (tokens.length > 0) out.rel = tokens.join(" ").toLowerCase();
      else out.dropped = true;
    } else {
      out.dropped = true;
    }
  }
  return out;
}

/**
 * Sanitize one attribution string for MapLibre's attribution control.
 *
 * @remarks
 * Output grammar: escaped text and character references, plus balanced
 * `<a href="…" target="…" rel="…">text</a>` with an http(s)/mailto `href`.
 * Nothing in it changes meaning when MapLibre re-parses and re-serializes it,
 * which is what makes it safe to concatenate and hand to a broken sanitizer.
 * The function is idempotent: sanitizing its own output returns it unchanged.
 *
 * An `<a>` without an allowed `href` is unwrapped (its text survives, the tag
 * does not). Non-strings are stringified; `null`/`undefined` become `""`.
 */
export function sanitizeAttribution(input: unknown): SanitizedAttribution {
  const source = input == null ? "" : String(input);
  let out = "";
  let changed = false;
  /** Whether we are inside an `<a>` and whether we emitted its start tag. */
  let anchor: "none" | "emitted" | "unwrapped" = "none";
  let i = 0;

  const closeAnchor = () => {
    if (anchor === "emitted") out += "</a>";
    anchor = "none";
  };

  while (i < source.length) {
    const char = source[i] as string;

    if (char === "<") {
      ANCHOR_OPEN.lastIndex = i;
      const open = ANCHOR_OPEN.exec(source);
      if (open) {
        // An <a> inside an <a> implicitly closes the first, as in HTML.
        closeAnchor();
        const attrs = readAnchorAttributes(open[1] ?? "");
        if (attrs.dropped) changed = true;
        if (attrs.href !== null) {
          out += `<a href="${escapeAttr(attrs.href)}"`;
          if (attrs.target !== null) out += ` target="${escapeAttr(attrs.target)}"`;
          if (attrs.rel !== null) out += ` rel="${escapeAttr(attrs.rel)}"`;
          out += ">";
          anchor = "emitted";
        } else {
          changed = true;
          anchor = "unwrapped";
        }
        i += open[0].length;
        continue;
      }

      ANCHOR_CLOSE.lastIndex = i;
      const close = ANCHOR_CLOSE.exec(source);
      if (close) {
        if (anchor === "none") changed = true;
        closeAnchor();
        i += close[0].length;
        continue;
      }

      TAG_LIKE.lastIndex = i;
      if (TAG_LIKE.test(source)) changed = true;
      out += "&lt;";
      i += 1;
      continue;
    }

    if (char === "&") {
      CHAR_REF.lastIndex = i;
      const ref = CHAR_REF.exec(source);
      if (ref) {
        out += ref[0];
        i += ref[0].length;
      } else {
        out += "&amp;";
        i += 1;
      }
      continue;
    }

    out += TEXT_ESCAPES[char] ?? char;
    i += 1;
  }

  if (anchor === "emitted") out += "</a>";
  return { html: out, changed };
}

/**
 * Sanitize a `customAttribution` value (`string | string[]`), preserving its
 * shape. Returns `undefined` for `undefined`.
 */
export function sanitizeCustomAttribution(
  value: unknown
): { value: string | string[] | undefined; changed: boolean } {
  if (value === undefined) return { value: undefined, changed: false };
  if (Array.isArray(value)) {
    let changed = false;
    const items = value.map((item) => {
      const result = sanitizeAttribution(item);
      changed ||= result.changed;
      return result.html;
    });
    return { value: items, changed };
  }
  const result = sanitizeAttribution(value);
  return { value: result.html, changed: result.changed };
}

/**
 * Copy of a style's `sources` map with every `attribution` sanitized.
 *
 * @remarks
 * Returns the input object itself when nothing needed to change, so callers
 * can compare by identity. `onChanged` is called with the source id of every
 * attribution whose content was stripped (not merely normalized).
 */
export function sanitizeSourcesAttribution(
  sources: unknown,
  onChanged?: (sourceId: string) => void
): unknown {
  if (typeof sources !== "object" || sources === null || Array.isArray(sources)) return sources;
  let copy: Record<string, unknown> | null = null;
  for (const [id, source] of Object.entries(sources as Record<string, unknown>)) {
    if (typeof source !== "object" || source === null || !("attribution" in source)) continue;
    const raw = (source as Record<string, unknown>)["attribution"];
    if (raw === undefined) continue;
    const result = sanitizeAttribution(raw);
    if (result.changed) onChanged?.(id);
    if (result.html === raw) continue;
    copy ??= { ...(sources as Record<string, unknown>) };
    copy[id] = { ...(source as Record<string, unknown>), attribution: result.html };
  }
  return copy ?? sources;
}
