/**
 * @file The on-page error card `<ml-map>` shows when a document can't render
 * @module @maplibre-yaml/core/components/error-card
 */

import type { ParseError } from "../parser/yaml-parser.js";
import { escapeHtml } from "../utils/html.js";

/** Class on the card element; `<ml-map>` removes elements carrying it. */
export const ERROR_CARD_CLASS = "ml-map-error";

/** Everything the card can show. */
export interface ErrorCardOptions {
  /** Heading, e.g. "Configuration Error". */
  title: string;
  /** One entry per problem; `path` (when set) is shown in bold before it. */
  errors: ParseError[];
  /** What to do next — a short paragraph under the errors. */
  hint?: string;
  /** Append the "How to configure" box (shown when no config was given). */
  showHelp?: boolean;
}

const HELP_SECTION = `
  <div style="margin-top: 16px; padding: 16px; background: #fef3c7; border-radius: 6px; color: #92400e;">
    <strong style="display: block; margin-bottom: 8px;">How to configure:</strong>
    <div style="font-family: monospace; font-size: 12px; line-height: 1.6;">
      <div style="margin-bottom: 8px;">
        <strong>1. External file (recommended):</strong><br>
        &lt;ml-map src="/path/to/config.yaml"&gt;&lt;/ml-map&gt;
      </div>
      <div style="margin-bottom: 8px;">
        <strong>2. Inline YAML:</strong><br>
        &lt;ml-map&gt;<br>
        &nbsp;&nbsp;&lt;script type="text/yaml"&gt;<br>
        &nbsp;&nbsp;type: map<br>
        &nbsp;&nbsp;id: my-map<br>
        &nbsp;&nbsp;...<br>
        &nbsp;&nbsp;&lt;/script&gt;<br>
        &lt;/ml-map&gt;
      </div>
      <div>
        <strong>3. JSON attribute:</strong><br>
        &lt;ml-map config='{"type":"map",...}'&gt;&lt;/ml-map&gt;
      </div>
    </div>
  </div>
`;

/**
 * Build the error card: a title, one row per error (with its YAML line when
 * known), and an optional hint saying how to fix it.
 *
 * @remarks
 * The single place the card's markup lives — every failure path (parse
 * errors, a `src` that would not load, a basemap style that never loaded, a
 * page opened from disk) goes through it with different content. Every
 * author- or network-supplied string is escaped. `role="alert"` so a screen
 * reader announces the failure.
 */
export function createErrorCard(doc: Document, options: ErrorCardOptions): HTMLElement {
  const rows = options.errors
    .map((err) => {
      const where =
        err.line !== undefined
          ? ` <span style="color: #7f1d1d; white-space: nowrap;">(line ${err.line})</span>`
          : "";
      // A YAML syntax error carries a code excerpt with a caret after its
      // first line; keep that part's line breaks and alignment. A trailing
      // "Hint: …" line is prose, not code.
      const [head = "", ...rest] = err.message.split("\n");
      const hintIndex = rest.findIndex((line) => line.startsWith("Hint: "));
      const note = hintIndex >= 0 ? rest.splice(hintIndex).join(" ") : "";
      const excerpt = rest.join("\n").replace(/^\n+|\s+$/g, "");
      const saysLine = err.line !== undefined && head.includes(`line ${err.line}`);
      return `
        <div style="margin-bottom: 8px; padding: 8px; background: #fee2e2; border-radius: 4px; overflow-wrap: anywhere;">${
          err.path
            ? `<strong style="color: #991b1b;">${escapeHtml(err.path)}</strong>: `
            : ""
        }${escapeHtml(head)}${saysLine ? "" : where}${
          excerpt
            ? `<pre style="margin: 6px 0 0; font: 12px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace; white-space: pre-wrap;">${escapeHtml(excerpt)}</pre>`
            : ""
        }${note ? `<div style="margin-top: 6px;">${escapeHtml(note)}</div>` : ""}</div>`;
    })
    .join("");

  const hint = options.hint
    ? `<div class="ml-map-error-hint" style="margin-top: 12px; padding: 12px; background: #fff7ed; border-radius: 6px; color: #7c2d12; font-size: 14px; line-height: 1.5;"><strong>How to fix it:</strong> ${escapeHtml(options.hint)}</div>`
    : "";

  const template = doc.createElement("template");
  template.innerHTML = `
    <div class="${ERROR_CARD_CLASS}" role="alert" style="
      padding: 20px;
      background: #fef2f2;
      border: 1px solid #fecaca;
      border-radius: 8px;
      color: #dc2626;
      font-family: system-ui, -apple-system, sans-serif;
      height: 100%;
      box-sizing: border-box;
      overflow: auto;
    ">
      <div style="font-weight: 600; margin-bottom: 12px; display: flex; align-items: center; gap: 8px;">
        <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
          <path fill-rule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clip-rule="evenodd"/>
        </svg>
        ${escapeHtml(options.title)}
      </div>
      <div style="font-size: 14px;">${rows}</div>
      ${hint}
      ${options.showHelp ? HELP_SECTION : ""}
    </div>
  `;
  return template.content.firstElementChild as HTMLElement;
}
