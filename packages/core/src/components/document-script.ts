/**
 * @file The inline document script both elements read
 * @module @maplibre-yaml/core/components/document-script
 *
 * @description
 * `<ml-map>` and `<ml-scrollytelling>` take their document from a child
 * `<script>` whose `type` names a YAML, JSON or TOML media type (ml-4cn.2).
 * One list, one lookup, so the two elements cannot drift apart again. The
 * script's type is the format signal the front door reads.
 */

/**
 * The inline script `type`s that hold a map or story document. Compared
 * case-insensitively and without media-type parameters (`; charset=…`).
 */
export const DOCUMENT_SCRIPT_TYPES: readonly string[] = [
  "text/yaml",
  "application/yaml",
  "text/x-yaml",
  "application/x-yaml",
  "application/json",
  "text/json",
  "application/toml",
  "text/toml",
  "application/x-toml",
  "text/x-toml",
];

/** The essence of a `type` attribute: lower case, parameters dropped. */
function essence(type: string | null): string {
  return (type ?? "").split(";")[0]!.trim().toLowerCase();
}

/** Whether a script's `type` is one of {@link DOCUMENT_SCRIPT_TYPES}. */
export function isDocumentScript(el: Element): el is HTMLScriptElement {
  return el.localName === "script" && DOCUMENT_SCRIPT_TYPES.includes(essence(el.getAttribute("type")));
}

/**
 * The first document script that belongs to `host`, in document order.
 *
 * @remarks
 * `directChildrenOnly` matches `<ml-scrollytelling>` (`:scope > script`).
 * Otherwise any descendant counts, as `<ml-map>` always read it, except a
 * script inside slot content or inside a nested `<ml-map>` /
 * `<ml-scrollytelling>`: that is someone else's data (a JSON data island in
 * a corner widget, an inset map's own document), never this element's.
 */
export function findDocumentScript(
  host: Element,
  directChildrenOnly = false
): HTMLScriptElement | null {
  return (ownScripts(host, directChildrenOnly).find(isDocumentScript) as HTMLScriptElement | undefined) ?? null;
}

/**
 * The "nothing to show" message for an element with no document. A
 * supported script that is there but empty says so (with a word on its
 * `src`, which a document script never loads). Else, when a script of an
 * unsupported type that looks like a document is there (`text/x-yaml5`,
 * `application/json5`), it names that type (R5, ml-4cn.9). `module`,
 * `importmap` and `application/ld+json` never count.
 */
export function noDocumentMessage(host: Element, directChildrenOnly: boolean, none: string): string {
  const scripts = ownScripts(host, directChildrenOnly);
  const empty = scripts.find(isDocumentScript);
  if (empty) {
    const src = empty.getAttribute("src");
    return (
      `The <script type="${empty.getAttribute("type")}"> is empty, so there is no document to show. ` +
      "Put the document inside the script." +
      (src !== null
        ? ` A document script's src attribute is not loaded: to load the file, write <${host.localName} src="${src}">.`
        : "")
    );
  }
  const type = scripts
    .filter((el) => !isDocumentScript(el))
    .map((el) => el.getAttribute("type") ?? "")
    .find((type) => /yaml|yml|toml|json5|jsonc/i.test(type));
  return type
    ? `<script type="${type}"> isn't a type maplibre-yaml reads, so there is no document to show. ` +
        'Use type="text/yaml", type="application/json" or type="application/toml".'
    : none;
}

/** The scripts that belong to `host` (see {@link findDocumentScript}). */
function ownScripts(host: Element, directChildrenOnly: boolean): Element[] {
  return directChildrenOnly
    ? Array.from(host.children).filter((el) => el.localName === "script")
    : Array.from(host.getElementsByTagName("script")).filter((el) => belongsTo(el, host));
}

function belongsTo(script: Element, host: Element): boolean {
  for (let el = script.parentElement; el && el !== host; el = el.parentElement) {
    if (el.hasAttribute("slot")) return false;
    if (el.localName === "ml-map" || el.localName === "ml-scrollytelling") return false;
  }
  return true;
}

// One wording for JSON syntax errors, shared with `parseDocumentText`.
export { wordForJson } from "../parser/document-text.js";
