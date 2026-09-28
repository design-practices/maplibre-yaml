/**
 * @file Generate the YAML reference pages from the core Zod schemas.
 *
 * Runs on every docs dev start and build (the `maplibre-yaml-reference` hook in
 * docs/astro.config.mjs spawns it through tsx), writing markdown into
 * `src/content/docs/reference/yaml/` — git-ignored, so the reference cannot
 * drift from the schemas: there is no checked-in copy to go stale.
 *
 * Source of truth: `buildReferenceSchema()` in
 * packages/core/scripts/emit-json-schema.ts — the SAME emit pipeline
 * (zod-to-json-schema + strictness + `deprecated` annotations) that produces
 * the published `schemas/*.schema.json`, run over all four document shapes
 * (v1 map, v2 map, scrollytelling, `pages:` root) in one document. Every
 * description on these pages is a `.describe()` string in
 * packages/core/src/schemas/ — fix wording there, never here.
 *
 * How the tree becomes pages:
 *  - Each page renders one subtree ("page root", a JSON pointer).
 *  - Every rendered key gets a heading with a stable anchor (its dotted path).
 *  - The combined schema uses the `"root"` $ref strategy, so a Zod schema used
 *    in two places appears once in full and as a `$ref` everywhere else. A
 *    `$ref` to a structure that is already documented renders as a link to it
 *    ("Same shape as ..."); a `$ref` to a scalar is simply inlined.
 *  - Discriminated unions (layers by `type`, sources by `type`) render their
 *    shared fields once, then one section per variant with only what differs.
 *  - MapLibre `paint`/`layout` keys render as compact tables linking to the
 *    MapLibre style spec, which is their real reference.
 *
 * Standalone: `pnpm --filter @maplibre-yaml/docs reference:yaml`.
 */

import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { buildReferenceSchema } from "../../packages/core/scripts/emit-json-schema";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dirname, "..", "src", "content", "docs", "reference", "yaml");
const BASE_URL = "/reference/yaml";
const SPEC_URL = "https://maplibre.org/maplibre-style-spec/layers/";
const SCHEMA_URL = "https://docs.maplibre-yaml.org/schema/latest";

// Indices of `$defs.reference.anyOf` — fixed by buildReferenceSchema().
const REF = "#/$defs/reference/anyOf";
const PTR = {
  mapV1: `${REF}/0`,
  sources: `${REF}/0/properties/sources/additionalProperties`,
  layers: `${REF}/0/properties/layers/items`,
  mapV2: `${REF}/1`,
  scrollytelling: `${REF}/2`,
  root: `${REF}/3`,
};

type Schema = Record<string, any>;

interface PageDef {
  slug: string;
  title: string;
  description: string;
  root: string;
  /** Display path prefix for keys on this page (e.g. `layers[]`). */
  prefix: string;
  /** What one instance of the page root is called ("source"), for variant labels. */
  noun?: string;
  order: number;
  intro: string;
}

const PAGES: PageDef[] = [
  {
    slug: "map",
    title: "Map block (v1)",
    description: "Every key of a `type: map` block in format v1, generated from the schemas.",
    root: PTR.mapV1,
    prefix: "",
    order: 1,
    intro:
      "A `type: map` block — the unit `<ml-map src>` and `mlym validate` consume. " +
      "This is the default format (`version: 1`, or no `version:` key). " +
      "For narrative and examples see [Map Configuration](/schema/map-config/).",
  },
  {
    slug: "sources",
    title: "Sources",
    description: "Every data-source type and key, generated from the schemas.",
    root: PTR.sources,
    prefix: "sources.<source-id>",
    noun: "source",
    order: 2,
    intro:
      "A data source, declared under a block's `sources:` map (then referenced from a " +
      "layer by bare name) or inline as a layer's `source:`. The `type` key selects " +
      "the variant. For narrative and examples see [Data Sources](/schema/sources/).",
  },
  {
    slug: "layers",
    title: "Layers",
    description: "Every layer type and key, including interactivity, generated from the schemas.",
    root: PTR.layers,
    prefix: "layers[]",
    noun: "layer",
    order: 3,
    intro:
      "An entry of a block's `layers:` list: either a full layer (the `type` key " +
      "selects the variant) or a `$ref` to a named layer in a root document. " +
      "For narrative and examples see [Layer Types](/schema/layers/) and " +
      "[Interactivity](/schema/interactivity/).",
  },
  {
    slug: "map-v2",
    title: "Map block (v2)",
    description: "Every key of a format-v2 (`style:`/`runtime:`) map block, generated from the schemas.",
    root: PTR.mapV2,
    prefix: "",
    order: 4,
    intro:
      "A format-v2 map block (`version: 2`): the same capabilities as v1, split into " +
      "a `style:` half (everything that erases to a MapLibre `style.json`) and a " +
      "`runtime:` half (everything that degrades). Source and layer spec bodies are " +
      "the v1 ones; their live-data and experience keys move under a nested " +
      "`runtime:`. For the why, see [Format v2](/guides/format-v2/).",
  },
  {
    slug: "scrollytelling",
    title: "Scrollytelling block",
    description: "Every key of a `type: scrollytelling` block, generated from the schemas.",
    root: PTR.scrollytelling,
    prefix: "",
    order: 5,
    intro:
      "A `type: scrollytelling` block: one map plus an ordered list of chapters that " +
      "drive the camera and layer visibility as the reader scrolls. For narrative " +
      "and examples see [Scrollytelling](/schema/scrollytelling/).",
  },
  {
    slug: "root",
    title: "Root document (pages)",
    description: "Every key of a multi-page `pages:` root document, generated from the schemas.",
    root: PTR.root,
    prefix: "",
    order: 6,
    intro:
      "A root document: global `config`, shared named `layers` and `sources`, and a " +
      "`pages:` list whose blocks are content, map, scrollytelling, or mixed blocks. " +
      "Framework integrations render it; it is never the `src` of `<ml-map>`. For " +
      "narrative see [Root Configuration](/schema/root/) and [Pages & Blocks](/schema/pages/).",
  },
];

/** Placeholder names for record (map-of) keys, by the parent key's name. */
const RECORD_KEY_NAMES: Record<string, string> = {
  sources: "<source-id>",
  layers: "<layer-id>",
  images: "<image-id>",
  state: "<state-key>",
  parameters: "<state-key>",
  locale: "<phrase-id>",
  "[]": "<tag>",
};

// ---------------------------------------------------------------------------
// JSON pointer helpers
// ---------------------------------------------------------------------------

let SCHEMA: Schema;

function resolvePointer(ptr: string): Schema | undefined {
  const parts = ptr
    .replace(/^#\//, "")
    .split("/")
    .map((p) => p.replace(/~1/g, "/").replace(/~0/g, "~"));
  let node: any = SCHEMA;
  for (const part of parts) node = node?.[part];
  return node;
}

const esc = (key: string) => key.replace(/~/g, "~0").replace(/\//g, "~1");

/**
 * Follow `$ref`s. Returns the merged node (sibling keywords on the ref node —
 * usually a local `.describe()` or `default` — win over the target's) plus the
 * pointer of the node that actually carries the structure.
 */
function deref(node: Schema, ptr: string): { node: Schema; ptr: string; ref?: string } {
  let current = node;
  let at = ptr;
  let firstRef: string | undefined;
  const overrides: Schema = {};
  for (let guard = 0; current && typeof current.$ref === "string" && guard < 20; guard++) {
    const { $ref, ...rest } = current;
    for (const [k, v] of Object.entries(rest)) if (!(k in overrides)) overrides[k] = v;
    firstRef ??= $ref;
    at = $ref;
    current = resolvePointer($ref) ?? {};
  }
  return { node: { ...current, ...overrides }, ptr: at, ref: firstRef };
}

// ---------------------------------------------------------------------------
// Classification
// ---------------------------------------------------------------------------

const GEOJSON_TYPES = new Set([
  "Point",
  "MultiPoint",
  "LineString",
  "MultiLineString",
  "Polygon",
  "MultiPolygon",
  "GeometryCollection",
  "Feature",
  "FeatureCollection",
]);

function branches(node: Schema): Schema[] | undefined {
  return node.anyOf ?? node.oneOf;
}

function branchKey(node: Schema): "anyOf" | "oneOf" {
  return node.anyOf ? "anyOf" : "oneOf";
}

/** A union of GeoJSON objects: documented as one `GeoJSON` leaf. */
function isGeoJSON(node: Schema, ptr: string): boolean {
  const list = branches(node);
  if (!list) return false;
  return list.some((b, i) => {
    const r = deref(b, `${ptr}/${branchKey(node)}/${i}`).node;
    const t = r.properties?.type;
    const values = t?.enum ?? (t?.const !== undefined ? [t.const] : []);
    return values.some((v: unknown) => GEOJSON_TYPES.has(String(v)));
  });
}

function hasObjectShape(node: Schema): boolean {
  return Boolean(node.properties && Object.keys(node.properties).length > 0);
}

function recordValue(node: Schema): Schema | undefined {
  if (hasObjectShape(node)) return undefined;
  const ap = node.additionalProperties;
  return ap && typeof ap === "object" ? ap : undefined;
}

/** Does this node carry documentable structure (worth a link, not an inline copy)? */
function isStructural(node: Schema, ptr: string, depth = 0): boolean {
  if (depth > 6) return false;
  const { node: n, ptr: p } = deref(node, ptr);
  if (isGeoJSON(n, p)) return false;
  if (hasObjectShape(n)) return true;
  const rv = recordValue(n);
  if (rv) return isStructural(rv, `${p}/additionalProperties`, depth + 1);
  if (n.items && !Array.isArray(n.items)) return isStructural(n.items, `${p}/items`, depth + 1);
  const list = branches(n);
  if (list) return list.some((b, i) => isStructural(b, `${p}/${branchKey(n)}/${i}`, depth + 1));
  return false;
}

/** The `type` literal of a union branch, when the union is discriminated on it. */
function discriminator(node: Schema): string | undefined {
  const raw = node.properties?.type;
  if (!raw) return undefined;
  const t = deref(raw, "").node;
  if (t.const !== undefined) return String(t.const);
  if (Array.isArray(t.enum) && t.enum.length === 1) return String(t.enum[0]);
  return undefined;
}

// ---------------------------------------------------------------------------
// Type strings
// ---------------------------------------------------------------------------

function literal(value: unknown): string {
  return typeof value === "string" ? value : JSON.stringify(value);
}

function typeString(node: Schema, ptr: string, depth = 0): string {
  if (depth > 4) return "…";
  const { node: n, ptr: p } = deref(node, ptr);
  if (n.const !== undefined) return JSON.stringify(n.const);
  if (Array.isArray(n.enum)) {
    return n.enum.length <= 6 ? n.enum.map((v: unknown) => JSON.stringify(v)).join(" | ") : n.type ?? "enum";
  }
  if (isGeoJSON(n, p)) return "GeoJSON";
  const list = branches(n);
  if (list) {
    const parts = list.map((b, i) => typeString(b, `${p}/${branchKey(n)}/${i}`, depth + 1));
    return [...new Set(parts)].join(" | ");
  }
  const type = Array.isArray(n.type) ? n.type.join(" | ") : n.type;
  if (type === "array") {
    if (Array.isArray(n.items)) {
      return `[${n.items.map((it: Schema, i: number) => typeString(it, `${p}/items/${i}`, depth + 1)).join(", ")}]`;
    }
    if (n.items) {
      const inner = typeString(n.items, `${p}/items`, depth + 1);
      return inner.includes(" ") ? `(${inner})[]` : `${inner}[]`;
    }
    return "array";
  }
  if (type === "object") {
    const rv = recordValue(n);
    if (rv) return `map of ${typeString(rv, `${p}/additionalProperties`, depth + 1)}`;
    return "object";
  }
  if (type === "string" && n.format === "uri") return "string (URL)";
  if (type) return type;
  return "any";
}

// ---------------------------------------------------------------------------
// Markdown helpers
// ---------------------------------------------------------------------------

/** Escape `<`/`>` outside code spans (descriptions mention `<ml-map>` etc). */
function prose(text: string | undefined): string {
  if (!text) return "";
  return text
    .split(/(`[^`]*`)/g)
    .map((part) => (part.startsWith("`") ? part : part.replace(/</g, "&lt;").replace(/>/g, "&gt;")))
    .join("");
}

function code(text: string): string {
  return text.includes("`") ? `\`\` ${text} \`\`` : `\`${text}\``;
}

function tableCell(text: string): string {
  return text.replace(/\|/g, "\\|").replace(/\n+/g, " ");
}

function anchorFor(path: string): string {
  const slug = path
    .replace(/\[\]/g, "")
    .replace(/[<>]/g, "")
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
  return slug || "top";
}

function joinPath(parent: string, key: string): string {
  if (!parent) return key;
  if (key === "[]") return `${parent}[]`;
  return `${parent}.${key}`;
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

interface Target {
  page: string;
  anchor: string;
  path: string;
}

interface Ctx {
  page: PageDef;
  out: string[];
  /** Anchors used on this page (dedupe). */
  anchors: Set<string>;
  /** Registration disabled inside a subtree reached through a $ref. */
  viaRef: boolean;
  /** Canonical pointers being expanded right now -> their path (cycle guard). */
  stack: Map<string, string>;
  /** Discriminated-union variant(s) being rendered: namespaces anchors. */
  variant?: string;
}

/** The anchor for a key path, namespaced by the enclosing variant(s). */
function anchorOf(ctx: Ctx, path: string): string {
  return anchorFor(ctx.variant ? `${ctx.variant}.${path}` : path);
}

/** pointer -> where it is documented. Built across passes; first page wins. */
let registry = new Map<string, Target>();
let nextRegistry = new Map<string, Target>();

/** Keys lacking a description, for the build log. */
const missing = new Set<string>();

function link(target: Target, from: PageDef): string {
  const href =
    target.page === from.slug ? `#${target.anchor}` : `${BASE_URL}/${target.page}/#${target.anchor}`;
  const label = target.path || PAGES.find((p) => p.slug === target.page)?.title || target.page;
  return `[${code(label)}](${href})`;
}

function pageRootFor(ptr: string): PageDef | undefined {
  return PAGES.find((p) => p.root === ptr);
}

function register(ctx: Ctx, ptr: string, path: string, anchor: string): void {
  if (ctx.viaRef) return;
  if (!nextRegistry.has(ptr)) {
    nextRegistry.set(ptr, { page: ctx.page.slug, anchor, path: ctx.variant ? `${displayPath(ctx, path)} (type: ${ctx.variant})` : displayPath(ctx, path) });
  }
}

function uniqueAnchor(ctx: Ctx, base: string): string {
  let anchor = base;
  for (let i = 2; ctx.anchors.has(anchor); i++) anchor = `${base}-${i}`;
  ctx.anchors.add(anchor);
  return anchor;
}

/**
 * A markdown heading with an explicit anchor. The trailing `{#id}` marker is
 * turned into the heading's id by docs/scripts/rehype-heading-anchors.mjs, so
 * anchors are path-shaped and stable AND Starlight's table of contents still
 * sees the heading (it ignores raw-HTML headings).
 */
function heading(ctx: Ctx, level: number, anchor: string, markdown: string): void {
  const h = Math.min(Math.max(level, 2), 6);
  ctx.out.push(`${"#".repeat(h)} ${markdown} {#${anchor}}`, "");
}

function constraints(n: Schema): string[] {
  const items: string[] = [];
  if (n.minimum !== undefined && n.maximum !== undefined) items.push(`**Range:** ${n.minimum} to ${n.maximum}`);
  else if (n.minimum !== undefined) items.push(`**Minimum:** ${n.minimum}`);
  else if (n.maximum !== undefined) items.push(`**Maximum:** ${n.maximum}`);
  if (n.exclusiveMinimum !== undefined) items.push(`**Greater than:** ${n.exclusiveMinimum}`);
  if (n.minLength !== undefined) items.push(`**Min length:** ${n.minLength}`);
  if (n.pattern) items.push(`**Pattern:** ${code(n.pattern)}`);
  if (n.type === "array" && !Array.isArray(n.items)) {
    if (n.minItems !== undefined && n.minItems === n.maxItems) items.push(`**Length:** ${n.minItems}`);
    else {
      if (n.minItems !== undefined) items.push(`**Min items:** ${n.minItems}`);
      if (n.maxItems !== undefined) items.push(`**Max items:** ${n.maxItems}`);
    }
  }
  return items;
}

/** Allowed values of an enum-ish node (enum, or a union of consts). */
function allowedValues(n: Schema, ptr: string): unknown[] | undefined {
  if (Array.isArray(n.enum)) return n.enum;
  const list = branches(n);
  if (!list) return undefined;
  const values: unknown[] = [];
  list.forEach((b, i) => {
    const r = deref(b, `${ptr}/${branchKey(n)}/${i}`).node;
    if (r.const !== undefined) values.push(r.const);
    else if (Array.isArray(r.enum)) values.push(...r.enum);
  });
  return values.length > 0 ? values : undefined;
}

/**
 * Render one key: heading, metadata line, description, then its children.
 */
function renderField(
  ctx: Ctx,
  key: string,
  node: Schema,
  ptr: string,
  path: string,
  level: number,
  required: boolean,
): void {
  const { node: n, ptr: at, ref } = deref(node, ptr);
  const anchor = uniqueAnchor(ctx, anchorOf(ctx, path));
  register(ctx, ptr, path, anchor);

  heading(ctx, level, anchor, code(key));

  const meta: string[] = [];
  if (path.includes(".") || path.includes("[]") || ctx.page.prefix) {
    meta.push(`**Path:** ${code(displayPath(ctx, path))}`);
  }
  meta.push(`**Type:** ${code(typeString(node, ptr))}`);
  if (required) meta.push("**Required**");
  if (n.default !== undefined) meta.push(`**Default:** ${code(JSON.stringify(n.default))}`);
  meta.push(...constraints(n));
  // `deprecated` is per-position (the emitter annotates the property node),
  // so never inherit it through a $ref from the shared first occurrence.
  if (ref ? node.deprecated : n.deprecated) meta.push("**Deprecated**");
  ctx.out.push(meta.join(" · "), "");

  // A $ref without its own `.describe()` inherits the target's description —
  // right when the target is the same key reused, wrong when a shared Zod
  // schema was first described for a different key (e.g. a zoom schema first
  // used as `minZoom`). Only inherit across the same key name.
  const description =
    ref && node.description === undefined && ref.split("/").pop() !== esc(key)
      ? undefined
      : n.description;
  if (description) ctx.out.push(prose(description), "");
  else if (!key.startsWith("<") && !key.startsWith("$")) {
    missing.add(`${ctx.page.slug}: ${displayPath(ctx, path)}`);
  }

  const allowed = allowedValues(n, at);
  if (allowed && allowed.length > 1 && !(Array.isArray(n.enum) && n.enum.length <= 6)) {
    ctx.out.push(`**Allowed values:** ${allowed.map((v) => code(literal(v))).join(", ")}`, "");
  }

  // Another page documents this subtree.
  const page = pageRootFor(at);
  if (page && page.slug !== ctx.page.slug) {
    ctx.out.push(`See the [${page.title} reference](${BASE_URL}/${page.slug}/).`, "");
    return;
  }
  // A `$ref` to a structure documented elsewhere: link instead of copying.
  if (ref && isStructural(n, at)) {
    const target = registry.get(at);
    if (target && !(target.page === ctx.page.slug && target.anchor === anchor)) {
      ctx.out.push(`Same shape as ${link(target, ctx.page)}.`, "");
      return;
    }
  }

  const inner: Ctx = ref ? { ...ctx, viaRef: true } : ctx;
  renderChildren(inner, key, n, at, path, level + 1);
}

/** The user-facing dotted path of a key, including the page's prefix. */
function displayPath(ctx: Ctx, path: string): string {
  const clean = path;
  const prefix = ctx.page.prefix;
  if (!prefix) return clean;
  if (!clean) return prefix;
  return clean.startsWith("[]") ? `${prefix}${clean}` : `${prefix}.${clean}`;
}

/** Render whatever structure sits beneath a (dereferenced) node. */
function renderChildren(ctx: Ctx, key: string, n: Schema, ptr: string, path: string, level: number): void {
  if (isGeoJSON(n, ptr)) return;
  const enclosing = ctx.stack.get(ptr);
  if (enclosing !== undefined) {
    ctx.out.push(`Recursive: same shape as the enclosing ${code(displayPath(ctx, enclosing) || "document")}.`, "");
    return;
  }
  ctx.stack.set(ptr, path);
  try {
    renderChildrenInner(ctx, key, n, ptr, path, level);
  } finally {
    ctx.stack.delete(ptr);
  }
}

function renderChildrenInner(ctx: Ctx, key: string, n: Schema, ptr: string, path: string, level: number): void {

  if (key === "paint" || key === "layout") {
    renderSpecTable(ctx, key, n, ptr);
    return;
  }

  if (hasObjectShape(n)) {
    renderProperties(ctx, n, ptr, path, level);
    return;
  }

  const rv = recordValue(n);
  if (rv) {
    const placeholder = RECORD_KEY_NAMES[key] ?? "<key>";
    if (isStructural(rv, `${ptr}/additionalProperties`) || deref(rv, `${ptr}/additionalProperties`).node.description) {
      renderField(ctx, placeholder, rv, `${ptr}/additionalProperties`, joinPath(path, placeholder), level, false);
    }
    return;
  }

  if (n.items && !Array.isArray(n.items)) {
    const itemsPtr = `${ptr}/items`;
    const { node: item, ptr: itemAt, ref } = deref(n.items, itemsPtr);
    const page = pageRootFor(itemAt);
    if (page && page.slug !== ctx.page.slug) {
      ctx.out.push(`Each entry: see the [${page.title} reference](${BASE_URL}/${page.slug}/).`, "");
      return;
    }
    if (ref && isStructural(item, itemAt)) {
      const target = registry.get(itemAt);
      if (target) {
        ctx.out.push(`Each entry has the same shape as ${link(target, ctx.page)}.`, "");
        return;
      }
    }
    register(ctx, itemsPtr, joinPath(path, "[]"), anchorOf(ctx, path));
    renderChildren(ref ? { ...ctx, viaRef: true } : ctx, "[]", item, itemAt, joinPath(path, "[]"), level);
    return;
  }

  if (branches(n)) renderUnion(ctx, key, n, ptr, path, level);
}

function renderProperties(ctx: Ctx, n: Schema, ptr: string, path: string, level: number): void {
  const required = new Set<string>(n.required ?? []);
  for (const [key, child] of Object.entries<Schema>(n.properties)) {
    renderField(ctx, key, child, `${ptr}/properties/${esc(key)}`, joinPath(path, key), level, required.has(key));
  }
}

/** Canonical identity of a property node: where its structure really lives. */
/**
 * Identity of a property for "common field" detection: where its structure
 * lives AND what it says — two variants reusing one Zod schema under
 * different `.describe()` text (a geojson `url` vs a vector `url`) are not
 * the same field to a reader.
 */
function canonical(node: Schema, ptr: string): string {
  const { node: n, ptr: at } = deref(node, ptr);
  return `${at}|${node.description ?? n.description ?? ""}`;
}

function renderUnion(ctx: Ctx, key: string, n: Schema, ptr: string, path: string, level: number): void {
  const kind = branchKey(n);
  const list = (branches(n) ?? []).map((b, i) => {
    const bp = `${ptr}/${kind}/${i}`;
    return { raw: b, rawPtr: bp, ...deref(b, bp) };
  });
  const objects = list.filter((b) => isStructural(b.node, b.ptr));
  if (objects.length === 0) return;

  // A nested union (layers: [layer-union, $ref-object]) — flatten one level.
  if (objects.length === 1) {
    const only = objects[0]!;
    const page = pageRootFor(only.ptr);
    if (page && page.slug !== ctx.page.slug) {
      ctx.out.push(`See the [${page.title} reference](${BASE_URL}/${page.slug}/).`, "");
      return;
    }
    if (only.ref) {
      const target = registry.get(only.ptr);
      if (target) {
        ctx.out.push(`Object form: same shape as ${link(target, ctx.page)}.`, "");
        return;
      }
    }
    renderChildren(only.ref ? { ...ctx, viaRef: true } : ctx, key, only.node, only.ptr, path, level);
    return;
  }

  const discriminated = objects.every((b) => hasObjectShape(b.node) && discriminator(b.node) !== undefined);
  if (!discriminated) {
    objects.forEach((b, i) => {
      const label = describeVariant(b.node, b.ptr, i);
      const anchor = uniqueAnchor(ctx, anchorOf(ctx, `${path}-${label}`));
      register(ctx, b.rawPtr, path, anchor);
      heading(ctx, level, anchor, label);
      if (b.node.description) ctx.out.push(prose(b.node.description), "");
      const page = pageRootFor(b.ptr);
      if (page && page.slug !== ctx.page.slug) {
        ctx.out.push(`See the [${page.title} reference](${BASE_URL}/${page.slug}/).`, "");
        return;
      }
      if (b.ref) {
        const target = registry.get(b.ptr);
        if (target) {
          ctx.out.push(`Same shape as ${link(target, ctx.page)}.`, "");
          return;
        }
      }
      if (branches(b.node) && !hasObjectShape(b.node)) {
        renderUnion(b.ref ? { ...ctx, viaRef: true } : ctx, key, b.node, b.ptr, path, level + 1);
      } else {
        renderChildren(b.ref ? { ...ctx, viaRef: true } : ctx, key, b.node, b.ptr, path, level + 1);
      }
    });
    return;
  }

  // Discriminated on `type`: shared fields once, then one section per variant.
  const first = objects[0]!;
  const shared = new Map<string, string>(); // key -> canonical pointer
  for (const [k, child] of Object.entries<Schema>(first.node.properties)) {
    if (k === "type") continue;
    const canon = canonical(child, `${first.ptr}/properties/${esc(k)}`);
    const count = objects.filter((b) => {
      const c = b.node.properties?.[k];
      return c && canonical(c, `${b.ptr}/properties/${esc(k)}`) === canon;
    }).length;
    if (count >= 2) shared.set(k, canon);
  }

  const typeNames = objects.map((b) => discriminator(b.node)!);
  ctx.out.push(
    `One of ${objects.length} variants, selected by ${code("type")}: ${typeNames.map((t) => code(t)).join(", ")}.`,
    "",
  );

  if (shared.size > 0) {
    const anchor = uniqueAnchor(ctx, anchorOf(ctx, `${path}-common-fields`));
    heading(ctx, level, anchor, "Common fields");
    ctx.out.push("Accepted by every variant that lists them below.", "");
    const required = new Set<string>(first.node.required ?? []);
    for (const k of shared.keys()) {
      const child = first.node.properties[k];
      renderField(ctx, k, child, `${first.ptr}/properties/${esc(k)}`, joinPath(path, k), level + 1, required.has(k));
    }
  }

  for (const b of objects) {
    const name = discriminator(b.node)!;
    const anchor = uniqueAnchor(ctx, anchorOf(ctx, `${path}-${name}`));
    register(ctx, b.rawPtr, `${path} (type: ${name})`, anchor);
    heading(ctx, level, anchor, code(`type: ${name}`));
    if (b.node.description) ctx.out.push(prose(b.node.description), "");
    const variantPage = pageRootFor(b.ptr);
    if (variantPage && variantPage.slug !== ctx.page.slug) {
      ctx.out.push(`See the [${variantPage.title} reference](${BASE_URL}/${variantPage.slug}/).`, "");
      continue;
    }
    if (b.ref) {
      const target = registry.get(b.ptr);
      if (target) {
        ctx.out.push(`Same shape as ${link(target, ctx.page)}.`, "");
        continue;
      }
    }

    const props = b.node.properties as Record<string, Schema>;
    const required = new Set<string>(b.node.required ?? []);
    const common = Object.keys(props).filter(
      (k) => shared.has(k) && canonical(props[k]!, `${b.ptr}/properties/${esc(k)}`) === shared.get(k),
    );
    if (common.length > 0) {
      ctx.out.push(
        `Common fields: ${common.map((k) => `[${code(k)}](#${anchorOf(ctx, joinPath(path, k))})`).join(", ")}.`,
        "",
      );
    }
    const variant = ctx.variant ? `${ctx.variant}.${name}` : name;
    const inner: Ctx = { ...ctx, viaRef: ctx.viaRef || Boolean(b.ref), variant };
    for (const [k, child] of Object.entries(props)) {
      if (common.includes(k)) continue;
      renderField(inner, k, child, `${b.ptr}/properties/${esc(k)}`, joinPath(path, k), level + 1, required.has(k));
    }
  }
}

function describeVariant(n: Schema, ptr: string, i: number): string {
  const page = pageRootFor(ptr);
  if (page?.noun) return `Inline ${page.noun}`;
  const list = branches(n);
  if (list && !hasObjectShape(n)) {
    const objects = list.map((b, j) => deref(b, `${ptr}/${branchKey(n)}/${j}`).node);
    if (objects.every((o) => discriminator(o) !== undefined)) return "Definition (by `type`)";
  }
  const keys = Object.keys(n.properties ?? {});
  if (keys.length === 1 && keys[0] === "$ref") return "Reference (`$ref`)";
  if (keys.length === 1) return `Object with \`${keys[0]}\``;
  return `Object form${i > 0 ? ` ${i + 1}` : ""}`;
}

function renderSpecTable(ctx: Ctx, key: string, n: Schema, ptr: string): void {
  const props = Object.entries<Schema>(n.properties ?? {});
  if (props.length > 0) {
    ctx.out.push(`| Property | Type | Notes |`, `| --- | --- | --- |`);
    for (const [prop, child] of props) {
      const r = deref(child, `${ptr}/properties/${esc(prop)}`).node;
      const allowed = allowedValues(r, `${ptr}/properties/${esc(prop)}`);
      const notes = [
        prose(r.description),
        allowed && allowed.length > 1 ? `One of ${allowed.map((v) => code(literal(v))).join(", ")}.` : "",
        r.default !== undefined ? `Default ${code(JSON.stringify(r.default))}.` : "",
      ]
        .filter(Boolean)
        .join(" ");
      ctx.out.push(
        `| [${code(prop)}](${SPEC_URL}#${prop}) | ${tableCell(code(typeString(child, `${ptr}/properties/${esc(prop)}`)))} | ${tableCell(notes)} |`,
      );
    }
    ctx.out.push("");
  }
  if (n.additionalProperties === true) {
    ctx.out.push(
      `Any other MapLibre ${key} property valid for this layer type is accepted as well; the ` +
        `[MapLibre style spec](${SPEC_URL}) is the reference for each property's semantics.`,
      "",
    );
  }
}

// ---------------------------------------------------------------------------
// Pages
// ---------------------------------------------------------------------------

const GENERATED_NOTE =
  ":::note[Generated reference]\n" +
  "This page is generated from the Zod schemas in `packages/core/src/schemas/` on every docs build — " +
  "descriptions are the schemas' own `.describe()` text, so it always matches the installed validator. " +
  "Edit the schema, not this page.\n" +
  ":::";

function frontmatter(page: { title: string; description: string; order: number }): string {
  return [
    "---",
    `title: ${JSON.stringify(page.title)}`,
    `description: ${JSON.stringify(page.description)}`,
    "editUrl: false",
    "sidebar:",
    `  order: ${page.order}`,
    "---",
    "",
  ].join("\n");
}

function renderPage(page: PageDef): string {
  const ctx: Ctx = { page, out: [], anchors: new Set(), viaRef: false, stack: new Map() };
  const { node, ptr } = deref(resolvePointer(page.root) ?? {}, page.root);
  ctx.out.push(prose(page.intro), "", GENERATED_NOTE, "");
  nextRegistry.set(page.root, { page: page.slug, anchor: "top", path: "" });
  ctx.stack.set(ptr, "");
  if (hasObjectShape(node)) {
    renderProperties(ctx, node, ptr, "", 2);
  } else {
    renderChildrenInner(ctx, page.slug, node, ptr, "", 2);
  }
  return frontmatter(page) + ctx.out.join("\n") + "\n";
}

function renderIndex(): string {
  const rows = PAGES.map(
    (p) => `| [${p.title}](${BASE_URL}/${p.slug}/) | ${prose(p.description)} |`,
  ).join("\n");
  return (
    frontmatter({
      title: "YAML reference",
      description: "Generated reference for every key of the maplibre-yaml document format.",
      order: 0,
    }) +
    [
      "Every key the maplibre-yaml validator accepts, with its type, default, allowed values, and " +
        "description. The guides under **YAML Schema** explain *how* to use these keys; this " +
        "reference lists *all* of them.",
      "",
      GENERATED_NOTE,
      "",
      "## Document shapes",
      "",
      "| Page | Covers |",
      "| --- | --- |",
      rows,
      "",
      "## Reading this reference",
      "",
      "- **Type** uses TypeScript-like notation: `string[]` is a list of strings, `map of X` is a " +
        "YAML mapping whose keys you choose, and `a | b` means either.",
      "- **Required** keys must be present; everything else is optional.",
      "- A key whose structure is shared (the popup DSL, controls, legend items, ...) is documented " +
        "once; other places link to it.",
      "- `paint` and `layout` properties are MapLibre's own; each links to the MapLibre style spec.",
      "- Keys starting with `x-` are accepted anywhere as extensions and never validated.",
      "",
      "## Machine-readable schemas",
      "",
      "The same schemas are published as JSON Schema for editors and agents (format v1):",
      "",
      ...["map", "scrollytelling", "root", "any"].map(
        (b) => `- [\`${b}.schema.json\`](${SCHEMA_URL}/${b}.schema.json)`,
      ),
      "",
      "See [Editor Setup](/guides/editor-setup/) to wire them into VS Code.",
      "",
    ].join("\n")
  );
}

export function generateYamlReference({ quiet = false } = {}): { pages: number; missing: string[] } {
  SCHEMA = buildReferenceSchema();

  // Links depend on where things are documented, and where things are
  // documented depends on which subtrees get linked instead of expanded:
  // iterate until the registry stops changing (converges in 2-3 passes).
  let rendered: string[] = [];
  for (let pass = 0; pass < 5; pass++) {
    nextRegistry = new Map();
    missing.clear();
    rendered = PAGES.map(renderPage);
    const stable =
      nextRegistry.size === registry.size &&
      [...nextRegistry].every(([k, v]) => {
        const prev = registry.get(k);
        return prev && prev.page === v.page && prev.anchor === v.anchor;
      });
    registry = nextRegistry;
    if (stable) break;
  }

  rmSync(OUT_DIR, { recursive: true, force: true });
  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(join(OUT_DIR, "index.md"), renderIndex(), "utf-8");
  PAGES.forEach((page, i) => writeFileSync(join(OUT_DIR, `${page.slug}.md`), rendered[i]!, "utf-8"));

  const list = [...missing].sort();
  if (!quiet) {
    console.log(`[yaml-reference] wrote ${PAGES.length + 1} pages to src/content/docs/reference/yaml/`);
    if (list.length > 0) {
      console.log(`[yaml-reference] ${list.length} keys have no .describe() text:`);
      for (const m of list) console.log(`  - ${m}`);
    }
  }
  return { pages: PAGES.length + 1, missing: list };
}

const invoked = process.argv[1];
if (invoked && import.meta.url === pathToFileURL(invoked).href) {
  generateYamlReference();
}
