/**
 * @file HTML escaping and URL guards for every markup sink in the library
 * @module @maplibre-yaml/core/utils
 *
 * @description
 * One escaper, one URL guard, one tag allowlist — used by the popup builder,
 * the legend builder, and every error card. Before this module each sink
 * carried its own copy, and they did not agree: the `<ml-map>` error card
 * escaped via `div.textContent`, which leaves `"` and `'` intact and therefore
 * cannot be used in an attribute, while the popup builder's regex version
 * could. A shared helper is the only way that stays true as sinks are added.
 *
 * The threat model these guard against is stated in the function-handling
 * proposal: a document may be authored by someone other than the person whose
 * browser renders it (a collaborative editor, a static export handed to an
 * audience). Feature properties come from fetched data, which is never
 * trusted. So escaping is not a courtesy for stray angle brackets — it is the
 * boundary that makes the format safe to render at all.
 */

const HTML_ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

/**
 * Escape a value for interpolation into HTML, in **text or attribute**
 * position.
 *
 * @remarks
 * Quotes are escaped, so the result is safe inside `attr="..."` and
 * `attr='...'` as well as between tags. A single regex pass avoids the
 * double-escaping bug that chained `.replace()` calls hit when `&` is not
 * handled first.
 *
 * Works without a DOM, so it is usable during SSR and in Node — the
 * `document.createElement` trick it replaces was not.
 */
export function escapeHtml(value: unknown): string {
  return String(value).replace(
    /[&<>"']/g,
    (char) => HTML_ESCAPES[char] as string
  );
}

/** URL schemes that cannot execute script when navigated to or loaded. */
const SAFE_SCHEMES = new Set(["http:", "https:", "mailto:", "tel:"]);

/**
 * Control characters a browser drops when resolving a URL.
 *
 * @remarks
 * Browsers remove tabs and newlines from URLs *before* determining the scheme,
 * so `java
script:alert(1)` navigates as `javascript:`. The guard has to parse
 * what the browser will act on, not what the string literally contains.
 *
 * Space is deliberately outside the range: a browser percent-encodes an
 * internal space rather than dropping it, so stripping would rewrite a
 * legitimate `/my file.png` into a different path. Leading and trailing
 * whitespace — which does affect scheme sniffing — is handled by `trim()`.
 */
const URL_CONTROL_CHARS = new RegExp("[\u0000-\u001F\u007F-\u009F]", "g");

/**
 * Return `url` if a browser can safely navigate to or load it, else `null`.
 *
 * @remarks
 * `escapeHtml` alone does not make a URL safe: `javascript:alert(1)` contains
 * no character that escaping touches, so it survives into `href` intact and
 * executes on click. Schema validation does not catch it either — zod's
 * `.url()` is `new URL()`, which accepts `javascript:` as a perfectly
 * well-formed URL.
 *
 * Relative, root-relative, fragment, and query references carry no scheme and
 * cannot execute, so they pass through.
 */
export function safeUrl(url: string): string | null {
  const cleaned = url.replace(URL_CONTROL_CHARS, "").trim();
  if (cleaned === "") return null;

  // No scheme possible: these are unambiguously relative references.
  if (/^(\/|\.\.?\/|#|\?)/.test(cleaned)) return cleaned;

  try {
    const parsed = new URL(cleaned);
    return SAFE_SCHEMES.has(parsed.protocol) ? cleaned : null;
  } catch {
    // Not an absolute URL. Safe only if nothing before the first `/`, `?` or
    // `#` looks like a scheme — `foo/bar.png` is fine, `javascript:x` is not.
    return /^[^/?#]*:/.test(cleaned) ? null : cleaned;
  }
}

/**
 * Element names the popup DSL may emit.
 *
 * @remarks
 * The popup content schema is `z.record(...)` — the tag is a YAML *key*, so
 * before this allowlist any key at all became an element: `script:` emitted a
 * `<script>` block, and a key carrying spaces (`img src=x onerror=...`)
 * injected attributes wholesale.
 *
 * `iframe` appears in the docs' supported-tag list but is deliberately absent
 * here. The builder has never emitted an iframe with a `src` — it would render
 * an empty frame — so nothing that worked stops working, and an embedded
 * browsing context is not something a document from an untrusted author should
 * be able to conjure.
 */
export const POPUP_TAGS: ReadonlySet<string> = new Set([
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "p",
  "span",
  "div",
  "strong",
  "em",
  "code",
  "pre",
  "a",
  "img",
  "ul",
  "ol",
  "li",
  "blockquote",
  "hr",
  "br",
]);

/** Values legal in a link `target`; anything else has the attribute dropped. */
export const LINK_TARGETS: ReadonlySet<string> = new Set([
  "_blank",
  "_self",
  "_parent",
  "_top",
]);
