/**
 * The playground's editor: CodeMirror 6 with YAML, JSON or TOML
 * highlighting (a language compartment the format toggle switches), schema
 * completion and hover for YAML (schema-assist.mjs), and the parser's
 * diagnostics with quick fixes (diagnostics.mjs) in every format. There is
 * no CodeMirror linter: diagnostics come from core only. Loaded with a dynamic import from the
 * playground page only, so no other page carries it (design D1, D10;
 * docs/test/playground-bundle.test.mjs holds that line).
 */
import {
  EditorView,
  keymap,
  lineNumbers,
  highlightActiveLine,
  highlightActiveLineGutter,
  drawSelection,
  hoverTooltip,
} from "@codemirror/view";
import { EditorState, type Extension } from "@codemirror/state";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { yaml } from "@codemirror/lang-yaml";
import { json } from "@codemirror/lang-json";
import { toml } from "@codemirror/legacy-modes/mode/toml";
import {
  syntaxHighlighting,
  HighlightStyle,
  indentOnInput,
  bracketMatching,
  indentUnit,
  StreamLanguage,
} from "@codemirror/language";
import { lintGutter, setDiagnostics, lintKeymap, openLintPanel, type Diagnostic as CMDiagnostic } from "@codemirror/lint";
import {
  autocompletion,
  completionKeymap,
  closeBrackets,
  closeBracketsKeymap,
  type CompletionContext,
  type CompletionResult,
} from "@codemirror/autocomplete";
import { tags as t } from "@lezer/highlight";
import { createSchemaAssist } from "./schema-assist.mjs";
import type { Diagnostic } from "./diagnostics.mjs";

/** Token colours from the page's theme, so light and dark both read. */
const highlight = HighlightStyle.define([
  { tag: [t.propertyName, t.definition(t.propertyName)], color: "var(--pg-tok-key)" },
  { tag: [t.string, t.special(t.string), t.content, t.attributeValue], color: "var(--pg-tok-string)" },
  { tag: [t.number, t.bool, t.null, t.atom], color: "var(--pg-tok-number)" },
  { tag: [t.comment, t.lineComment, t.blockComment], color: "var(--pg-tok-comment)", fontStyle: "italic" },
  { tag: [t.meta, t.typeName, t.labelName, t.keyword, t.modifier], color: "var(--pg-tok-meta)" },
  { tag: [t.punctuation, t.separator, t.squareBracket, t.brace, t.bracket], color: "var(--pg-tok-punct)" },
]);

export type Format = "yaml" | "json" | "toml";

/** The words the editor's accessible name uses for each format. */
const FORMAT_NAME: Record<Format, string> = { yaml: "YAML", json: "JSON", toml: "TOML" };

const tomlLanguage = StreamLanguage.define(toml);
const languageFor = (format: Format): Extension =>
  format === "json" ? json() : format === "toml" ? tomlLanguage : yaml();

const theme = EditorView.theme({
  "&": { height: "100%", backgroundColor: "var(--pg-bg)", color: "var(--pg-fg)" },
  ".cm-scroller": { fontFamily: "var(--__sl-font-mono, ui-monospace, SFMono-Regular, Menlo, monospace)" },
  ".cm-content": { caretColor: "var(--pg-fg)" },
  ".cm-gutters": { backgroundColor: "var(--pg-panel)", color: "var(--pg-muted)", borderRight: "1px solid var(--pg-line)" },
  ".cm-activeLine": { backgroundColor: "var(--pg-active-line)" },
  ".cm-activeLineGutter": { backgroundColor: "var(--pg-active-line)" },
  "&.cm-focused .cm-cursor": { borderLeftColor: "var(--pg-fg)" },
  "&.cm-focused .cm-selectionBackground, .cm-selectionBackground": { backgroundColor: "var(--pg-selection)" },
  ".cm-tooltip": {
    backgroundColor: "var(--pg-panel)",
    color: "var(--pg-fg)",
    border: "1px solid var(--pg-line)",
    borderRadius: "6px",
  },
  ".cm-tooltip-autocomplete > ul > li[aria-selected]": { backgroundColor: "var(--pg-accent)", color: "var(--pg-on-accent)" },
  ".cm-completionDetail": { color: "inherit", opacity: "0.75", fontStyle: "normal", marginLeft: "0.75em" },
  ".cm-panels": { backgroundColor: "var(--pg-panel)", color: "var(--pg-fg)" },
  ".cm-panel.cm-panel-lint ul [aria-selected]": { backgroundColor: "var(--pg-active-line)", color: "inherit" },
  ".cm-panel.cm-panel-lint ul:focus [aria-selected]": { backgroundColor: "var(--pg-selection)", color: "inherit" },
  ".cm-diagnosticAction": { backgroundColor: "var(--pg-accent)", color: "var(--pg-on-accent)", borderRadius: "4px", padding: "4px 8px" },
});

/**
 * On a narrow screen the completion description goes under the list, not
 * beside it, where it would cover the list (design §2.3).
 */
function positionInfo(
  _view: EditorView,
  list: DOMRect,
  _option: DOMRect,
  _info: DOMRect,
  space: DOMRect,
) {
  if (space.right - space.left >= 640) return {};
  const width = Math.max(200, Math.min(400, space.right - list.left - 8));
  // Below the list when it fits there, else above it.
  const below = space.bottom - list.bottom >= 96 || list.top - space.top < 96;
  return {
    style: below
      ? `top: ${list.bottom - list.top}px; left: 0; max-width: ${width}px`
      : `bottom: ${list.bottom - list.top}px; top: auto; left: 0; max-width: ${width}px`,
    class: "cm-completionInfo-below",
  };
}

export interface EditorHandle {
  view: EditorView;
  getValue(): string;
  /**
   * Replace the whole document, with a fresh undo history (a new starter, a
   * format switch); with `format`, switch the language too.
   */
  setValue(text: string, format?: Format): void;
  setSchema(schema: unknown): void;
  setDiagnostics(list: Diagnostic[]): void;
  /** Move the cursor to an offset and focus the editor. */
  reveal(offset: number): void;
  openProblems(): void;
  cursorLine(): number;
}

export interface EditorOptions {
  onChange?: (text: string) => void;
  /** The cursor moved to another line (quiet-while-typing releases held errors). */
  onCursorLine?: (line: number) => void;
  /** The document's format; YAML when left out. */
  format?: Format;
}

export function mount(parent: HTMLElement, doc: string, options: EditorOptions = {}): EditorHandle {
  let assist: ReturnType<typeof createSchemaAssist> | null = null;
  let lastLine = 1;
  let format: Format = options.format ?? "yaml";
  const labelFor = (f: Format) =>
    EditorView.contentAttributes.of({ "aria-label": `Map document (${FORMAT_NAME[f]})` });

  // Schema completion and hover read YAML indentation: YAML only.
  const assisting = () => (format === "yaml" ? assist : null);

  const schemaSource = (ctx: CompletionContext): CompletionResult | null => {
    const assist = assisting();
    if (!assist) return null;
    const r = assist.complete(ctx.state.doc.toString(), ctx.pos);
    if (!r || !r.options.length) return null;
    const line = ctx.state.doc.lineAt(ctx.pos);
    const before = line.text.slice(0, ctx.pos - line.from);
    // Open by itself only where a key or value can start; Ctrl-Space
    // (explicit) opens it anywhere it has something to offer.
    if (r.from === r.to && !ctx.explicit && !/:\s*$|^\s*(- +)?$/.test(before)) return null;
    return {
      from: r.from,
      options: r.options.map((o) => ({
        label: o.label,
        detail: o.detail || undefined,
        info: o.info || undefined,
        type: o.type,
        apply: o.type === "property" ? `${o.label}: ` : o.label,
      })),
      validFor: /^[\w$-]*$/,
    };
  };

  const hover = hoverTooltip((view, pos) => {
    const assist = assisting();
    if (!assist) return null;
    const h = assist.hover(view.state.doc.toString(), pos);
    if (!h || !h.text) return null;
    return {
      pos: h.from,
      end: h.to,
      above: true,
      create() {
        const dom = document.createElement("div");
        dom.className = "pg-hover";
        const title = document.createElement("strong");
        title.textContent = h.title;
        dom.append(title);
        if (h.detail) {
          const type = document.createElement("code");
          type.textContent = ` ${h.detail}`;
          dom.append(type);
        }
        const text = document.createElement("p");
        text.textContent = h.text;
        dom.append(text);
        return { dom };
      },
    };
  });

  const extensions: Extension[] = [
    lineNumbers(),
    highlightActiveLineGutter(),
    history(),
    drawSelection(),
    indentOnInput(),
    indentUnit.of("  "),
    EditorState.tabSize.of(2),
    bracketMatching(),
    closeBrackets(),
    highlightActiveLine(),
    syntaxHighlighting(highlight),
    autocompletion({ override: [schemaSource], icons: false, positionInfo }),
    hover,
    lintGutter(),
    theme,
    keymap.of([
      ...closeBracketsKeymap,
      ...completionKeymap,
      ...lintKeymap,
      ...defaultKeymap,
      ...historyKeymap,
      indentWithTab,
    ]),
    EditorView.lineWrapping,
    EditorView.contentAttributes.of({
      // A phone keyboard must not "fix" keys.
      autocapitalize: "off",
      autocorrect: "off",
      spellcheck: "false",
    }),
    EditorView.updateListener.of((u) => {
      if (u.docChanged) options.onChange?.(u.state.doc.toString());
      if (u.selectionSet || u.docChanged) {
        const line = u.state.doc.lineAt(u.state.selection.main.head).number;
        if (line !== lastLine) {
          lastLine = line;
          options.onCursorLine?.(line);
        }
      }
    }),
  ];

  // The language and the accessible name follow the format. A format switch
  // is a new state, like a starter: the undo history can't cross it, since
  // undoing into YAML text with the TOML language would show neither right.
  const stateFor = (text: string) =>
    EditorState.create({ doc: text, extensions: [...extensions, languageFor(format), labelFor(format)] });
  const view = new EditorView({ parent, state: stateFor(doc) });

  return {
    view,
    getValue: () => view.state.doc.toString(),
    setValue(text, next) {
      if (next) format = next;
      view.setState(stateFor(text));
      lastLine = 1;
    },
    setSchema(schema) {
      assist = schema ? createSchemaAssist(schema) : null;
    },
    setDiagnostics(list) {
      const len = view.state.doc.length;
      const out: CMDiagnostic[] = list.map((d) => ({
        from: Math.min(d.from, len),
        to: Math.min(d.to, len),
        severity: d.severity,
        message: d.message,
        renderMessage: d.href
          ? () => {
              const span = document.createElement("span");
              span.textContent = `${d.message} `;
              const a = document.createElement("a");
              a.href = d.href!;
              a.textContent = "Why?";
              a.target = "_blank";
              span.append(a);
              return span;
            }
          : undefined,
        actions: d.fix
          ? [
              {
                name: d.fix.label,
                apply: (v: EditorView, from: number, to: number) =>
                  v.dispatch({ changes: { from, to, insert: d.fix!.insert } }),
              },
            ]
          : undefined,
      }));
      view.dispatch(setDiagnostics(view.state, out));
    },
    reveal(offset) {
      view.dispatch({ selection: { anchor: Math.min(offset, view.state.doc.length) }, scrollIntoView: true });
      view.focus();
    },
    openProblems() {
      openLintPanel(view);
    },
    cursorLine: () => view.state.doc.lineAt(view.state.selection.main.head).number,
  };
}
