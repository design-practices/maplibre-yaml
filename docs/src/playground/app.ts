/**
 * The playground page's controller: which document to open, the preview
 * pipeline, the status line, the YAML / JSON / TOML toggle, share, download
 * and the phone layout. The editor itself (CodeMirror) is a dynamic import,
 * so the map can start drawing while the editor's code downloads.
 *
 * Every read of the document goes through core's front door,
 * `parseDocumentText`, in the format the toggle names: the diagnostics, the
 * story detection, the value the preview renders, the trust notes and the
 * share banner all come from that one result.
 *
 * Design: docs/plans/2026-10-22-docs-playground-design.md (ml-vjs.17).
 */
import { parseDocumentText, convertDocument, type DocumentTextResult, type ConvertLoss } from "@maplibre-yaml/core";
import { toDiagnostics, trustNotes, holdWhileTyping, summarize, type Diagnostic } from "./diagnostics.mjs";
import { decodeShare, shareLink, hostsOf, safeSrc } from "./share.mjs";
import { schemaNameFor } from "./schema-assist.mjs";
import type { EditorHandle, Format } from "./editor";

/** Re-render this long after typing stops (design D4). */
const DEBOUNCE_MS = 400;
/** A syntax error on the line being typed shows after this much idle (§3.1). */
const HOLD_MS = 1200;
const DRAFT_KEY = "mlym-playground-draft";
/** The draft's format; a draft saved before the toggle has none and is YAML. */
const DRAFT_FORMAT_KEY = "mlym-playground-draft-format";
const FORMATS: Format[] = ["yaml", "json", "toml"];
const FORMAT_NAME: Record<Format, string> = { yaml: "YAML", json: "JSON", toml: "TOML" };
const isFormat = (f: unknown): f is Format => FORMATS.includes(f as Format);
/** Errors that mean the text isn't a document at all, whatever it says. */
const UNREADABLE = new Set(["yaml-syntax", "toml-syntax", "yaml-expansion", "yaml-merge"]);
const PHONE = "(max-width: 50rem)";

type Kind = "map" | "scrollytelling";
type Opened = { text: string; format: Format };
type MapLike = HTMLElement & {
  config: unknown;
  getMap?: () => any;
};

export function start(): void {
  const root = document.querySelector<HTMLElement>(".pg-root");
  if (!root) return;
  const el = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

  const editorHost = el("pg-editor");
  const status = el("pg-status");
  const statusText = el("pg-status-text");
  const statusBtn = el<HTMLButtonElement>("pg-status-btn");
  const pane = el("pg-preview");
  const stale = el("pg-stale");
  const empty = el("pg-empty");
  const message = el("pg-message");
  const sharedBanner = el("pg-shared");
  const sharedHosts = el("pg-shared-hosts");
  const starter = el<HTMLSelectElement>("pg-starter");
  const storyGate = el("pg-story-gate");
  const backBtn = el<HTMLButtonElement>("pg-back");
  const defaultSrc = root.dataset.defaultSrc ?? "/configs/earthquakes.yaml";
  const phone = window.matchMedia(PHONE);

  let editor: EditorHandle | null = null;
  /** The text before the editor exists, and the editor's text after. */
  let pendingText = "";
  let preview: MapLike | null = null;
  let previewKind: Kind | null = null;
  let lastRendered: string | null = null;
  let lastKind: Kind = "map";
  let renders = 0;
  let runtimeProblems = 0;
  let parseSummary = "";
  let firstProblem: number | null = null;
  let typingLine: number | null = null;
  let allDiagnostics: Diagnostic[] = [];
  let shownDiagnostics: Diagnostic[] = [];
  let blockedByPages = false;
  let runTimer = 0;
  let holdTimer = 0;
  let schemaName = "";
  /** The format the editor holds; the toggle, a share link or a draft sets it. */
  let format: Format = "yaml";
  /** Bumped by every run(): a slow read (TOML's first) never lands over a newer one. */
  let generation = 0;
  /**
   * The text before the last format switch, kept so switching straight back
   * with no edit restores it as written (comments and all), not reconverted.
   */
  let beforeSwitch: { format: Format; text: string; switchedTo: Format; converted: string } | null = null;

  const text = () => (editor ? editor.getValue() : pendingText);
  // Read-only, for the browser suite (e2e/playground.spec.ts): CodeMirror
  // only renders the lines in view, so the DOM can't give the whole text.
  (window as any).__playground = { getText: text };

  // ---- status line ------------------------------------------------------

  function setStatus(state: "ok" | "warning" | "error" | "loading", words: string): void {
    status.dataset.state = state;
    if (statusText.textContent !== words) statusText.textContent = words;
    statusBtn.setAttribute("aria-disabled", String(firstProblem === null));
  }

  function refreshStatus(): void {
    const errors = shownDiagnostics.filter((d) => d.severity === "error").length;
    const warnings = shownDiagnostics.filter((d) => d.severity === "warning").length;
    const onMap = runtimeProblems
      ? ` · ${runtimeProblems} problem${runtimeProblems === 1 ? "" : "s"} on the map`
      : "";
    if (errors) {
      setStatus(
        "error",
        `${parseSummary}${lastRendered !== null ? " · the map shows your last working version" : ""}`,
      );
    } else if (warnings) {
      setStatus("warning", `Map updated · ${parseSummary}${onMap}`);
    } else {
      setStatus(runtimeProblems ? "warning" : "ok", `Map updated · no problems${onMap}`);
    }
  }

  // ---- diagnostics ------------------------------------------------------

  /**
   * Show what isn't held back (quiet while typing): the editor's marks, the
   * status line and the "last working map" pill all count the same set.
   */
  function showDiagnostics(): void {
    const { shown } = holdWhileTyping(allDiagnostics, typingLine);
    editor?.setDiagnostics(shown);
    shownDiagnostics = shown;
    parseSummary = summarize(shown);
    const errors = shown.some((d) => d.severity === "error");
    stale.hidden = !(errors && lastRendered !== null);
    empty.hidden = !(errors && lastRendered === null);
    root.dataset.errors = String(shown.filter((d) => d.severity === "error").length);
    if (!blockedByPages) refreshStatus();
  }

  // ---- the pipeline: parse, diagnose, render -----------------------------

  function schedule(): void {
    window.clearTimeout(runTimer);
    runTimer = window.setTimeout(run, DEBOUNCE_MS);
    window.clearTimeout(holdTimer);
    holdTimer = window.setTimeout(() => {
      typingLine = null;
      showDiagnostics();
    }, HOLD_MS);
    saveDraft();
  }

  function saveDraft(): void {
    try {
      localStorage.setItem(DRAFT_KEY, text());
      localStorage.setItem(DRAFT_FORMAT_KEY, format);
    } catch {
      // private mode: the draft just isn't kept
    }
  }

  /**
   * Read the document: one `parseDocumentText` call per text and format,
   * shared by the preview and the share banner, so both see the same
   * result. It never rejects; a TOML reader that couldn't be downloaded is
   * an error result, and the next edit tries again.
   */
  let lastRead: { source: string; format: Format; result: Promise<DocumentTextResult> } | null = null;
  function read(source: string, fmt: Format): Promise<DocumentTextResult> {
    if (lastRead && lastRead.source === source && lastRead.format === fmt) return lastRead.result;
    const entry = {
      source,
      format: fmt,
      result: parseDocumentText(source, { kind: "any", format: fmt }).catch((): DocumentTextResult => {
        if (lastRead === entry) lastRead = null;
        return {
          blockType: "unknown",
          format: fmt,
          result: {
            success: false,
            errors: [
              {
                path: "",
                message: `The ${FORMAT_NAME[fmt]} reader couldn't be downloaded. Check the connection, then edit the document to try again.`,
              },
            ],
            warnings: [],
          },
        } as DocumentTextResult;
      }),
    };
    lastRead = entry;
    return entry.result;
  }

  async function run(): Promise<void> {
    window.clearTimeout(runTimer);
    const gen = ++generation;
    const source = text();
    const fmt = format;
    const t0 = performance.now();
    const parsed = await read(source, fmt);
    // A newer edit, document or format is being read: this result is old.
    if (gen !== generation) return;
    const value = parsed.result.success ? parsed.result.data : undefined;
    const diagnostics = [...toDiagnostics(source, parsed, fmt), ...trustNotes(source, value, fmt)];
    root.dataset.parseMs = (performance.now() - t0).toFixed(1);
    allDiagnostics = diagnostics;
    const firstError = diagnostics.find((d) => d.severity === "error") ?? diagnostics.find((d) => d.severity === "warning");
    firstProblem = firstError ? firstError.from : null;
    // The parser knows a story when the document reads; while it doesn't,
    // the text decides (the schema help works on half-typed YAML).
    loadSchemaFor(
      parsed.blockType === "map" || parsed.blockType === "scrollytelling" ? parsed.blockType : schemaNameFor(source, fmt),
    );

    // Any error, held or not, keeps the document from the map.
    const errors = diagnostics.some((d) => d.severity === "error");
    const valid = !errors && parsed.result.success;
    blockedByPages = valid && parsed.blockType !== "map" && parsed.blockType !== "scrollytelling";
    if (valid && !blockedByPages) {
      lastKind = parsed.blockType as Kind;
      if (source !== lastRendered || previewKind !== parsed.blockType) render(source, value, lastKind);
    }
    showDiagnostics();
    if (blockedByPages) {
      setStatus(
        "warning",
        "This document has pages: — the playground previews one map or one story map at a time.",
      );
    }
  }

  function render(source: string, doc: unknown, kind: Kind): void {
    // Hand the element the document as the front door read it (plain
    // values, whatever the format), and the element validates it again on
    // its own value path, as it would any document. Never a trusted policy:
    // one code path for all.
    if (previewKind !== kind) {
      preview?.remove();
      preview = document.createElement(kind === "map" ? "ml-map" : "ml-scrollytelling") as MapLike;
      preview.className = "pg-preview-el";
      preview.setAttribute("base", "/");
      pane.append(preview);
      previewKind = kind;
    }
    // The camera is the element's business (live documents, 0.10): a
    // changed document applies to the running map in place and leaves the
    // camera where the reader put it unless the document's own view
    // changed. The playground no longer copies the live camera into the
    // document before handing it over.
    runtimeProblems = 0;
    preview!.config = doc;
    lastRendered = source;
    renders += 1;
    root.dataset.renders = String(renders);
    root.dataset.kind = kind;
    updateStoryGate();
  }

  pane.addEventListener("ml-map:layer-data-error", () => {
    runtimeProblems += 1;
    refreshStatus();
  });
  pane.addEventListener("ml-map:error", () => {
    runtimeProblems += 1;
    refreshStatus();
  });

  // ---- schema help ------------------------------------------------------

  const schemas = new Map<string, Promise<unknown>>();
  function loadSchemaFor(name: string): void {
    if (name === schemaName || !editor) return;
    schemaName = name;
    if (!schemas.has(name)) {
      schemas.set(
        name,
        fetch(`/schema/latest/${name}.schema.json`)
          .then((r) => (r.ok ? r.json() : null))
          .catch(() => null),
      );
    }
    schemas.get(name)!.then((schema) => {
      if (schemaName === name) editor?.setSchema(schema);
    });
  }

  // ---- opening a document -----------------------------------------------

  /** Open a document (a starter, a share link, a format switch) with a fresh undo history. */
  function setText(next: string, fmt: Format = format): void {
    pane.scrollTop = 0; // a story opens on its first chapter
    beforeSwitch = null;
    setFormat(fmt);
    if (editor) editor.setValue(next, fmt);
    else pendingText = next;
    typingLine = null;
    void run();
  }

  function setFormat(fmt: Format): void {
    format = fmt;
    formatSelect.value = fmt;
    root.dataset.format = fmt;
  }

  async function fetchConfig(src: string): Promise<string | null> {
    try {
      const r = await fetch(src);
      return r.ok ? await r.text() : null;
    } catch {
      return null;
    }
  }

  /**
   * The banner for a document opened from a share link: the hosts it will
   * make the browser contact, read from the same parse the preview renders,
   * once it resolves. A document that doesn't read names no hosts, and the
   * banner says so rather than "no other sites".
   */
  let sharedToken = 0;
  function showShared(shared: Opened | null): void {
    const token = ++sharedToken;
    if (shared === null) {
      sharedBanner.hidden = true;
      return;
    }
    sharedHosts.textContent = "checking…";
    sharedBanner.hidden = false;
    void read(shared.text, shared.format).then((parsed) => {
      if (token !== sharedToken) return;
      if (!parsed.result.success) {
        sharedHosts.textContent = "not known, because the document could not be read";
        return;
      }
      const hosts = hostsOf(parsed.result.data);
      sharedHosts.textContent = hosts.length ? hosts.join(", ") : "no other sites";
    });
  }

  async function initialText(): Promise<Opened> {
    const shared = decodeShare(location.hash);
    if (shared !== null) {
      showShared(shared);
      return shared;
    }
    const src = safeSrc(new URLSearchParams(location.search).get("src"));
    if (src) {
      const fetched = await fetchConfig(src);
      if (fetched !== null) {
        starter.value = src;
        return { text: fetched, format: "yaml" };
      }
      message.textContent = `Couldn't open ${src}. Showing the default map instead.`;
    } else {
      try {
        const draft = localStorage.getItem(DRAFT_KEY);
        const draftFormat = localStorage.getItem(DRAFT_FORMAT_KEY);
        if (draft) return { text: draft, format: isFormat(draftFormat) ? draftFormat : "yaml" };
      } catch {
        // no storage: start fresh
      }
    }
    starter.value = defaultSrc;
    const text =
      (await fetchConfig(defaultSrc)) ??
      "type: map\nid: my-map\nconfig:\n  center: [0, 20]\n  zoom: 1.5\n  mapStyle: \"https://tiles.openfreemap.org/styles/liberty\"\nlayers: []\n";
    return { text, format: "yaml" };
  }

  starter.addEventListener("change", async () => {
    const src = safeSrc(starter.value);
    if (!src) return;
    const fetched = await fetchConfig(src);
    if (fetched === null) {
      message.textContent = `Couldn't open ${src}.`;
      return;
    }
    history.replaceState(null, "", `${location.pathname}?src=${src}`);
    showShared(null);
    message.textContent = "";
    setText(fetched, "yaml");
  });

  window.addEventListener("hashchange", () => {
    const shared = decodeShare(location.hash);
    if (shared !== null && (shared.text !== text() || shared.format !== format)) {
      starter.value = "";
      showShared(shared);
      setText(shared.text, shared.format);
    }
  });

  el("pg-shared-close").addEventListener("click", () => {
    sharedBanner.hidden = true;
  });

  // ---- the format toggle: YAML, JSON, TOML ------------------------------

  // A labelled native select in the editor's status bar: keyboard and
  // screen-reader ready, and narrow enough for a phone.
  const formatLabel = document.createElement("label");
  formatLabel.className = "sr-only";
  formatLabel.htmlFor = "pg-format";
  formatLabel.textContent = "Document format";
  const formatSelect = document.createElement("select");
  formatSelect.id = "pg-format";
  formatSelect.className = "pg-control pg-small";
  formatSelect.title = "Write the document in YAML, JSON or TOML";
  for (const f of FORMATS) formatSelect.append(new Option(FORMAT_NAME[f], f));
  el("pg-swap").before(formatLabel, formatSelect);

  formatSelect.addEventListener("change", () => {
    const to = formatSelect.value;
    if (isFormat(to)) void switchFormat(to);
  });

  /**
   * Convert the document to another format (core's `convertDocument`) and
   * say what the new format doesn't keep. Refused, with the editor as it
   * was, when the text has a syntax error; a document with schema errors
   * converts anyway, so they can be fixed in the new format. Switching
   * straight back, with no edit in between, restores the text as written.
   */
  async function switchFormat(to: Format): Promise<void> {
    const from = format;
    const source = text();
    if (to === from) return;
    message.replaceChildren();
    if (beforeSwitch && beforeSwitch.format === to && beforeSwitch.switchedTo === from && beforeSwitch.converted === source) {
      const restored = beforeSwitch.text;
      setText(restored, to);
      message.textContent = `Back to your ${FORMAT_NAME[to]}, as you wrote it.`;
      saveDraft();
      return;
    }
    formatSelect.disabled = true;
    let result: Awaited<ReturnType<typeof convertDocument>>;
    try {
      result = await convertDocument(source, { from, to });
    } catch {
      message.textContent = `Couldn't switch to ${FORMAT_NAME[to]}: part of the converter didn't download. Check the connection and try again.`;
      formatSelect.value = from;
      return;
    } finally {
      formatSelect.disabled = false;
    }
    if (text() !== source || format !== from) {
      message.textContent = `The document changed while it was being converted. Choose ${FORMAT_NAME[to]} again to switch.`;
      formatSelect.value = format;
      return;
    }
    if (!result.success) {
      formatSelect.value = from;
      const first = result.errors[0];
      const unreadable = result.errors.find((e) => e.code !== undefined && UNREADABLE.has(e.code));
      // The converter's own errors name the path of the value it can't write.
      message.textContent = unreadable
        ? `Can't switch to ${FORMAT_NAME[to]}: the ${FORMAT_NAME[from]} has a syntax error${unreadable.line ? ` on line ${unreadable.line}` : ""}. Fix it, then switch.`
        : `Can't switch to ${FORMAT_NAME[to]}: ${first ? firstLine(first.message) : "the document can't be written in it"}.`;
      return;
    }
    setText(result.text, to);
    beforeSwitch = { format: from, text: source, switchedTo: to, converted: result.text };
    saveDraft();
    message.textContent = switchedMessage(from, to, result.losses);
  }

  const firstLine = (m: string) => m.split("\n")[0]!.replace(/[.:]\s*$/, "");

  /** "Switched to TOML. Not kept: 3 comments (lines 2, 3, 9); …. Switch back before editing to get your YAML as written." */
  function switchedMessage(from: Format, to: Format, losses: ConvertLoss[]): string {
    const comments = losses.filter((l) => l.kind === "comment");
    const others = losses.filter((l) => l.kind !== "comment");
    const lost: string[] = [];
    if (comments.length) {
      const lines = comments.map((c) => c.line).filter((n): n is number => typeof n === "number");
      const shown = lines.slice(0, 5).join(", ") + (lines.length > 5 ? ", …" : "");
      lost.push(`${comments.length} comment${comments.length === 1 ? "" : "s"}${lines.length ? ` (line${lines.length === 1 ? "" : "s"} ${shown})` : ""}`);
    }
    for (const l of others.slice(0, 3)) lost.push(firstLine(l.message));
    if (others.length > 3) lost.push(`${others.length - 3} more`);
    const kept = lost.length ? ` Not kept: ${lost.join("; ")}.` : "";
    return `Switched to ${FORMAT_NAME[to]}.${kept} Switch back before editing to get your ${FORMAT_NAME[from]} as you wrote it.`;
  }

  // ---- status button: jump to the first problem ---------------------------

  statusBtn.addEventListener("click", () => {
    if (!editor || firstProblem === null) return;
    typingLine = null;
    showDiagnostics();
    editor.reveal(firstProblem);
    editor.openProblems();
  });

  // ---- share ----------------------------------------------------------------

  el("pg-share-btn").addEventListener("click", async () => {
    const link = shareLink(location.origin + location.pathname, text(), format);
    message.replaceChildren();
    if (link.url === null) {
      message.append(
        `This map is too long for a link (${link.length.toLocaleString("en")} characters). Use Download, or `,
        copyTextButton(),
        ".",
      );
      return;
    }
    history.replaceState(null, "", `${location.pathname}${link.url.slice(link.url.indexOf("#"))}`);
    let copied = false;
    try {
      await navigator.clipboard.writeText(link.url);
      copied = true;
    } catch {
      // no clipboard permission: the link is in the address bar
    }
    const where = copied ? "Link copied." : "The link is in the address bar.";
    message.textContent =
      link.level === "long"
        ? `${where} It is ${link.length.toLocaleString("en")} characters long: some chat apps, mail programs and QR codes cut links this long.`
        : where;
  });

  function copyTextButton(): HTMLButtonElement {
    const name = FORMAT_NAME[format];
    const b = document.createElement("button");
    b.type = "button";
    b.className = "pg-link-button";
    b.textContent = `copy the ${name}`;
    b.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(text());
        message.textContent = `${name} copied.`;
      } catch {
        message.textContent = "Couldn't copy: select the text in the editor and copy it.";
      }
    });
    return b;
  }

  // ---- download ---------------------------------------------------------

  el("pg-download-btn").addEventListener("click", async () => {
    const { downloadZip } = await import("./download.mjs");
    const zip = downloadZip(text(), lastKind, format);
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([zip], { type: "application/zip" }));
    a.download = "my-map.zip";
    document.body.append(a);
    a.click();
    a.remove();
    window.setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
    message.textContent = "Downloaded my-map.zip: unzip it and read README.txt to open the map.";
  });

  // ---- phone layout: map size, full-screen story ---------------------------

  const resizeSoon = () => window.setTimeout(() => preview?.getMap?.()?.resize?.(), 260);

  el("pg-swap").addEventListener("click", (e) => {
    const big = root.classList.toggle("pg-map-big");
    (e.currentTarget as HTMLElement).setAttribute("aria-pressed", String(big));
    resizeSoon();
  });

  function updateStoryGate(): void {
    const gated = previewKind === "scrollytelling" && phone.matches && !root.classList.contains("pg-story-full");
    storyGate.hidden = !gated;
  }
  phone.addEventListener("change", () => {
    if (!phone.matches) closeStory();
    updateStoryGate();
    resizeSoon();
  });

  el("pg-story-open").addEventListener("click", () => {
    root.classList.add("pg-story-full");
    backBtn.hidden = false;
    updateStoryGate();
    pane.scrollTop = 0;
    backBtn.focus();
    resizeSoon();
  });
  function closeStory(): void {
    if (!root.classList.contains("pg-story-full")) return;
    root.classList.remove("pg-story-full");
    backBtn.hidden = true;
    updateStoryGate();
    resizeSoon();
  }
  backBtn.addEventListener("click", () => {
    closeStory();
    el("pg-story-open").focus();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && root.classList.contains("pg-story-full")) {
      closeStory();
      el("pg-story-open").focus();
    }
  });

  // ---- boot -------------------------------------------------------------

  setStatus("loading", "Loading…");
  const editorReady = import("./editor");
  initialText().then(async (initial) => {
    pendingText = initial.text;
    setFormat(initial.format);
    // The map starts from the text right away; the editor arrives after.
    void run();
    const { mount } = await editorReady;
    editorHost.replaceChildren();
    editor = mount(editorHost, pendingText, {
      format,
      onChange: () => {
        typingLine = editor!.cursorLine();
        schedule();
      },
      onCursorLine: () => {
        if (typingLine !== null) {
          typingLine = null;
          showDiagnostics();
        }
      },
    });
    root.dataset.editor = "ready";
    // Diagnostics and schema help for the text as loaded (and the format
    // switched to meanwhile, if any).
    schemaName = "";
    void run();
  });
}
