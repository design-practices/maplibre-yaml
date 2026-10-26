/**
 * @file The inline document script both elements read
 * @module @maplibre-yaml/core/components/document-script
 *
 * @description
 * `<ml-map>` and `<ml-scrollytelling>` take their document from a child
 * `<script>` whose `type` names a YAML or JSON media type (ml-4cn.2). One
 * list, one lookup, so the two elements cannot drift apart again.
 *
 * Both formats go through the same YAML parser: JSON is valid YAML 1.2, so
 * line/column positions and did-you-mean hints work for either. The only
 * JSON-specific step is the wording of a syntax error.
 */

import type { ParseError } from "../parser/yaml-parser.js";

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
];

const JSON_TYPES: ReadonlySet<string> = new Set(["application/json", "text/json"]);

/** The essence of a `type` attribute: lower case, parameters dropped. */
function essence(type: string | null): string {
  return (type ?? "").split(";")[0]!.trim().toLowerCase();
}

/** Whether a script's `type` is one of {@link DOCUMENT_SCRIPT_TYPES}. */
export function isDocumentScript(el: Element): el is HTMLScriptElement {
  return el.localName === "script" && DOCUMENT_SCRIPT_TYPES.includes(essence(el.getAttribute("type")));
}

/** Whether a document script holds JSON (decides the syntax-error wording). */
export function isJsonScript(script: Element): boolean {
  return JSON_TYPES.has(essence(script.getAttribute("type")));
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
  const candidates = directChildrenOnly
    ? Array.from(host.children)
    : Array.from(host.getElementsByTagName("script"));
  for (const el of candidates) {
    if (!isDocumentScript(el)) continue;
    if (directChildrenOnly || belongsTo(el, host)) return el;
  }
  return null;
}

function belongsTo(script: Element, host: Element): boolean {
  for (let el = script.parentElement; el && el !== host; el = el.parentElement) {
    if (el.hasAttribute("slot")) return false;
    if (el.localName === "ml-map" || el.localName === "ml-scrollytelling") return false;
  }
  return true;
}

/**
 * Word a syntax error from a JSON script as JSON: the parser (YAML, which
 * reads JSON) says "YAML syntax error", which would send a JSON author
 * looking for YAML. Positions are untouched.
 */
export function wordForJson(errors: ParseError[]): ParseError[] {
  return errors.map((err) =>
    err.code === "yaml-syntax"
      ? { ...err, message: err.message.replace(/^YAML (syntax|quoting|indentation) error:/, "JSON syntax error:") }
      : err
  );
}
