/**
 * The playground page's controller: which document to open, the preview
 * pipeline, the status line, share, download and the phone layout. The
 * editor itself (CodeMirror) is a dynamic import, so the map can start
 * drawing while the editor's code downloads.
 *
 * Design: docs/plans/2026-10-22-docs-playground-design.md (ml-vjs.17).
 */
import { YAMLParser, YAML_PARSE_OPTIONS } from "@maplibre-yaml/core";
import { parse as parseYaml } from "yaml";
import { toDiagnostics, trustNotes, holdWhileTyping, summarize, type Diagnostic } from "./diagnostics.mjs";
import { decodeShare, shareLink, hostsOf, safeSrc } from "./share.mjs";
import { schemaNameFor } from "./schema-assist.mjs";
import type { EditorHandle } from "./editor";

/** Re-render this long after typing stops (design D4). */
const DEBOUNCE_MS = 400;
/** A syntax error on the line being typed shows after this much idle (§3.1). */
const HOLD_MS = 1200;
const DRAFT_KEY = "mlym-playground-draft";
const PHONE = "(max-width: 50rem)";

type Kind = "map" | "scrollytelling";
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
    try {
      localStorage.setItem(DRAFT_KEY, text());
    } catch {
      // private mode: the draft just isn't kept
    }
  }

  function run(): void {
    window.clearTimeout(runTimer);
    const source = text();
    const t0 = performance.now();
    const parsed = YAMLParser.safeParseAny(source);
    const diagnostics = [...toDiagnostics(source, parsed), ...trustNotes(source)];
    root.dataset.parseMs = (performance.now() - t0).toFixed(1);
    allDiagnostics = diagnostics;
    const firstError = diagnostics.find((d) => d.severity === "error") ?? diagnostics.find((d) => d.severity === "warning");
    firstProblem = firstError ? firstError.from : null;
    loadSchemaFor(source);

    // Any error, held or not, keeps the document from the map.
    const errors = diagnostics.some((d) => d.severity === "error");
    const valid = !errors && parsed.result.success;
    blockedByPages = valid && parsed.blockType !== "map" && parsed.blockType !== "scrollytelling";
    if (valid && !blockedByPages) {
      lastKind = parsed.blockType as Kind;
      if (source !== lastRendered || previewKind !== parsed.blockType) render(source, lastKind);
    }
    showDiagnostics();
    if (blockedByPages) {
      setStatus(
        "warning",
        "This document has pages: — the playground previews one map or one story map at a time.",
      );
    }
  }

  function render(source: string, kind: Kind): void {
    // Hand the element the document as written (YAML to plain values, with
    // core's options so `!html` stays a tag), so it validates it exactly as
    // it would a src= file. Never a trusted policy: one code path for all.
    let doc: any;
    try {
      doc = parseYaml(source, YAML_PARSE_OPTIONS);
    } catch {
      return;
    }
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
  function loadSchemaFor(source: string): void {
    const name = schemaNameFor(source);
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

  function setText(next: string): void {
    pane.scrollTop = 0; // a story opens on its first chapter
    if (editor) editor.setValue(next);
    else pendingText = next;
    typingLine = null;
    run();
  }

  async function fetchConfig(src: string): Promise<string | null> {
    try {
      const r = await fetch(src);
      return r.ok ? await r.text() : null;
    } catch {
      return null;
    }
  }

  function showShared(source: string | null): void {
    if (source === null) {
      sharedBanner.hidden = true;
      return;
    }
    let hosts: string[] = [];
    try {
      hosts = hostsOf(parseYaml(source, YAML_PARSE_OPTIONS));
    } catch {
      // a broken shared document fetches nothing
    }
    sharedHosts.textContent = hosts.length ? hosts.join(", ") : "no other sites";
    sharedBanner.hidden = false;
  }

  async function initialText(): Promise<string> {
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
        return fetched;
      }
      message.textContent = `Couldn't open ${src}. Showing the default map instead.`;
    } else {
      try {
        const draft = localStorage.getItem(DRAFT_KEY);
        if (draft) return draft;
      } catch {
        // no storage: start fresh
      }
    }
    starter.value = defaultSrc;
    return (await fetchConfig(defaultSrc)) ?? "type: map\nid: my-map\nconfig:\n  center: [0, 20]\n  zoom: 1.5\n  mapStyle: \"https://tiles.openfreemap.org/styles/liberty\"\nlayers: []\n";
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
    setText(fetched);
  });

  window.addEventListener("hashchange", () => {
    const shared = decodeShare(location.hash);
    if (shared !== null && shared !== text()) {
      starter.value = "";
      showShared(shared);
      setText(shared);
    }
  });

  el("pg-shared-close").addEventListener("click", () => {
    sharedBanner.hidden = true;
  });

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
    const link = shareLink(location.origin + location.pathname, text());
    message.replaceChildren();
    if (link.url === null) {
      message.append(
        `This map is too long for a link (${link.length.toLocaleString("en")} characters). Use Download, or `,
        copyYamlButton(),
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

  function copyYamlButton(): HTMLButtonElement {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "pg-link-button";
    b.textContent = "copy the YAML";
    b.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(text());
        message.textContent = "YAML copied.";
      } catch {
        message.textContent = "Couldn't copy: select the text in the editor and copy it.";
      }
    });
    return b;
  }

  // ---- download ---------------------------------------------------------

  el("pg-download-btn").addEventListener("click", async () => {
    const { downloadZip } = await import("./download.mjs");
    const zip = downloadZip(text(), lastKind);
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
    pendingText = initial;
    // The map starts from the text right away; the editor arrives after.
    run();
    const { mount } = await editorReady;
    editorHost.replaceChildren();
    editor = mount(editorHost, pendingText, {
      label: "Map document (YAML)",
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
    // Diagnostics and schema help for the text as loaded.
    schemaName = "";
    run();
  });
}
