/**
 * The playground's framework-free modules (ml-vjs.17): schema help, the
 * diagnostics adapter, share links, camera keeping, the download, and the
 * starter list. The browser half (editor, live map, quick fix, share
 * round-trip, zip) is e2e/playground.spec.ts.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { YAMLParser } from "@maplibre-yaml/core";
import { createSchemaAssist, schemaNameFor } from "../src/playground/schema-assist.mjs";
import { toDiagnostics, trustNotes, holdWhileTyping, lineColToOffset, cleanMessage, summarize } from "../src/playground/diagnostics.mjs";
import { encodeShare, decodeShare, shareLink, hostsOf, safeSrc, SHARE_MAX_LENGTH } from "../src/playground/share.mjs";
import { cameraKey, withCamera } from "../src/playground/camera.mjs";
import { rewriteSiteUrls, downloadFiles, downloadZip } from "../src/playground/download.mjs";
import { unzipSync, strFromU8 } from "fflate";
import { CURATED, DEFAULT_SRC, galleryStarters, playgroundHref } from "../src/playground/starters.mjs";
import { allEntries } from "../src/data/gallery.mjs";

const DOCS = join(dirname(fileURLToPath(import.meta.url)), "..");
const PUBLIC = join(DOCS, "public");
const CORE_SCHEMAS = join(DOCS, "..", "packages", "core", "schemas");
const schema = (name) => JSON.parse(readFileSync(join(CORE_SCHEMAS, `${name}.schema.json`), "utf8"));
const config = (src) => readFileSync(join(PUBLIC, src), "utf8");

/** Text with a `|` cursor marker -> [text, offset]. */
const at = (marked) => [marked.replace("|", ""), marked.indexOf("|")];
const labels = (r) => (r ? r.options.map((o) => o.label) : []);

// ---- schema help ----------------------------------------------------------

const map = createSchemaAssist(schema("map"));
const story = createSchemaAssist(schema("scrollytelling"));

test("schema help: keys under config:, filtered by what is already written", () => {
  const r = map.complete(...at("type: map\nid: x\nconfig:\n  center: [0, 0]\n  pi|\n"));
  assert.ok(labels(r).includes("pitch"));
  assert.ok(labels(r).includes("zoom"));
  assert.ok(!labels(r).includes("center"), "a key already written isn't offered again");
  const [text, pos] = at("type: map\nid: x\nconfig:\n  center: [0, 0]\n  pi|\n");
  assert.equal(r.from, pos - 2, "replaces the typed prefix");
  assert.equal(text.slice(r.from, pos), "pi");
});

test("schema help: top-level keys of a map document", () => {
  const r = map.complete(...at("type: map\nid: x\n|"));
  for (const k of ["config", "layers", "sources", "controls", "legend"]) assert.ok(labels(r).includes(k), k);
});

test("schema help: paint keys narrow to the layer's type", () => {
  const circle = labels(map.complete(...at("type: map\nid: x\nlayers:\n  - id: a\n    type: circle\n    paint:\n      |\n")));
  assert.ok(circle.includes("circle-radius"));
  assert.ok(!circle.some((k) => k.startsWith("line-")));
  const line = labels(map.complete(...at("type: map\nid: x\nlayers:\n  - id: a\n    type: line\n    paint:\n      |\n")));
  assert.ok(line.includes("line-width"));
  assert.ok(!line.some((k) => k.startsWith("circle-")));
});

test("schema help: values from enums and booleans", () => {
  const types = labels(map.complete(...at("type: map\nid: x\nlayers:\n  - id: a\n    type: |\n")));
  for (const t of ["circle", "line", "fill", "symbol"]) assert.ok(types.includes(t), t);
  assert.deepEqual(labels(map.complete(...at("type: map\nid: x\ncontrols:\n  navigation: |\n"))), ["true", "false"]);
});

test("schema help: a new list item doesn't inherit the previous item's keys", () => {
  const r = labels(map.complete(...at("type: map\nid: x\nlayers:\n  - id: a\n    type: circle\n  - |\n")));
  assert.ok(r.includes("id") && r.includes("type"));
});

test("schema help: works on a half-typed document that doesn't parse", () => {
  const text = "type: map\nid: x\nconfig:\n  center: [0, 0\n  zo|\n";
  assert.equal(YAMLParser.safeParseAny(text.replace("|", "")).result.success, false);
  assert.ok(labels(map.complete(...at(text))).includes("zoom"));
});

test("schema help: hover describes the key under the cursor", () => {
  const h = map.hover(...at("type: map\nid: x\nconfig:\n  pit|ch: 30\n"));
  assert.equal(h.title, "pitch");
  assert.equal(h.detail, "number");
  assert.match(h.text, /pitch/i);
  assert.equal(map.hover(...at("type: map\nid: x\nconfig:\n  pitch: 3|0\n")), null, "not on a value");
});

test("schema help: story documents use the scrollytelling schema", () => {
  assert.equal(schemaNameFor("type: scrollytelling\nid: s\n"), "scrollytelling");
  assert.equal(schemaNameFor("type: map\nid: s\n"), "map");
  const chapter = labels(story.complete(...at("type: scrollytelling\nid: s\nchapters:\n  - id: a\n    |\n")));
  for (const k of ["title", "center", "zoom", "description"]) assert.ok(chapter.includes(k), k);
});

// ---- diagnostics ----------------------------------------------------------

const diagnose = (text) => toDiagnostics(text, YAMLParser.safeParseAny(text));

test("diagnostics: line and column become offsets, clamped to the line", () => {
  const text = "ab\ncdef\ng";
  assert.equal(lineColToOffset(text, 2, 3), 5);
  assert.equal(lineColToOffset(text, 2, 99), 7);
  assert.equal(lineColToOffset(text, 9, 1), text.length);
});

test("diagnostics: the mistakes starter reports each mistake on its token, with a quick fix", () => {
  const text = config("configs/playground/find-the-mistakes.yaml");
  const list = diagnose(text);
  const zom = list.find((d) => text.slice(d.from, d.to) === "zom");
  assert.ok(zom, JSON.stringify(list));
  assert.equal(zom.severity, "error");
  assert.deepEqual(zom.fix, { label: "Change to zoom", insert: "zoom" });
  // Positioned on the layer's "- id:" line by the parser, moved onto the value.
  const circel = list.find((d) => text.slice(d.from, d.to) === "circel");
  assert.ok(circel, JSON.stringify(list));
  assert.equal(circel.fix.insert, "circle");
  assert.equal(circel.line, text.split("\n").findIndex((l) => l.includes("circel")) + 1);
});

test("diagnostics: applying the quick fixes in turn leaves a valid document", () => {
  let text = config("configs/playground/find-the-mistakes.yaml");
  for (let i = 0; i < 5; i++) {
    const fix = diagnose(text).find((d) => d.fix);
    if (!fix) break;
    text = text.slice(0, fix.from) + fix.fix.insert + text.slice(fix.to);
  }
  assert.deepEqual(diagnose(text), []);
  assert.equal(YAMLParser.safeParseAny(text).result.success, true);
});

test("diagnostics: a warning is a warning, and a YAML syntax error loses its code frame", () => {
  const warn = diagnose("type: map\nid: x\nconfig:\n  center: [0, 0]\n  zoom: 1\n  mapStyle: x\nlayers:\n  - id: a\n    type: circle\n    source: { type: geojson, data: { type: FeatureCollection, features: [] } }\n    paint:\n      circle-colour: red\n");
  assert.equal(warn.length, 1);
  assert.equal(warn[0].severity, "warning");
  assert.equal(warn[0].fix.insert, "circle-color");
  const syntax = diagnose("type: map\nid: x\nconfig:\n  center: [0,0\n  zoom: 1\n");
  assert.equal(syntax[0].code, "yaml-syntax");
  assert.doesNotMatch(syntax[0].message, /\n|at line \d/);
  assert.equal(cleanMessage('YAML syntax error: Bad thing at line 5, column 3:\n\n  x\n  ^\n'), "YAML syntax error: Bad thing");
});

test("diagnostics: an error with no position attaches to the start", () => {
  const list = diagnose("type: map\nconfig:\n  center: [0, 0]\n  zoom: 1\n  mapStyle: x\nlayers: []\n");
  assert.equal(list[0].line, 1);
  assert.match(list[0].message, /id:/);
});

test("diagnostics: !html and click.emit get an info note, and only those", () => {
  const text = "popup:\n  - p:\n      - str: !html \"<b>x</b>\"\ninteractive:\n  click:\n    emit:\n      event: select\n# emit: in a comment\n";
  const notes = trustNotes(text);
  assert.equal(notes.length, 2);
  assert.ok(notes.every((n) => n.severity === "info" && n.href));
  assert.equal(text.slice(notes[0].from, notes[0].to), "!html");
  assert.equal(text.slice(notes[1].from, notes[1].to), "emit");
});

test("diagnostics: a syntax error on the line being typed is held, others show", () => {
  const list = [
    { line: 4, code: "yaml-syntax", severity: "error" },
    { line: 2, severity: "warning" },
  ];
  assert.deepEqual(holdWhileTyping(list, 4).shown, [list[1]]);
  assert.deepEqual(holdWhileTyping(list, 3).shown, list);
  assert.deepEqual(holdWhileTyping(list, null).shown, list);
  assert.equal(summarize([{ severity: "error" }, { severity: "warning" }, { severity: "warning" }, { severity: "info" }]), "1 error, 2 warnings");
});

// ---- share links ----------------------------------------------------------

test("share: encode/decode round-trips any document", () => {
  for (const name of ["earthquakes.yaml", "basic-map.yaml", "classify/graduated.yaml", "gallery/fly-to-a-location-based-on-scroll-position.yaml"]) {
    const text = config(`configs/${name}`);
    const hash = encodeShare(text);
    assert.match(hash, /^#code\/[A-Za-z0-9+\-$]+$/, "URL-safe payload");
    assert.equal(decodeShare(hash), text);
  }
  const odd = "id: ünïcödé — 🗺️\n\ttabs & \"quotes\" #?&=\n";
  assert.equal(decodeShare(encodeShare(odd)), odd);
});

test("share: decode refuses anything that isn't a share link", () => {
  for (const h of ["", "#", "#code/", "#other/abc", "#code/%%%", null, undefined]) assert.equal(decodeShare(h), null, String(h));
});

test("share: link length levels", () => {
  const page = "https://docs.maplibre-yaml.org/playground/";
  const small = shareLink(page + "#code/old", config("configs/earthquakes.yaml"));
  assert.equal(small.level, "ok");
  assert.ok(small.url.startsWith(page + "#code/"), "an old fragment is replaced");
  assert.ok(small.length < 2000);
  const long = shareLink(page, config("configs/gallery/fly-to-a-location-based-on-scroll-position.yaml"));
  assert.equal(long.level, "long");
  // Random text doesn't compress: past the limit there is no link.
  let noise = "";
  for (let i = 0; noise.length < SHARE_MAX_LENGTH * 2; i++) noise += ((i * 2654435761) % 4294967296).toString(36);
  const huge = shareLink(page, noise);
  assert.equal(huge.level, "too-long");
  assert.equal(huge.url, null);
});

test("share: the hosts a document will contact", () => {
  const doc = {
    config: { mapStyle: "https://tiles.openfreemap.org/styles/liberty" },
    layers: [
      { source: { url: "https://earthquake.usgs.gov/feed.geojson" } },
      { source: { tiles: ["https://a.tile.example.org/{z}/{x}/{y}.png", "https://a.tile.example.org/x"] } },
      { source: { url: "/data/local.geojson" } },
    ],
  };
  assert.deepEqual(hostsOf(doc), ["a.tile.example.org", "earthquake.usgs.gov", "tiles.openfreemap.org"]);
  assert.deepEqual(hostsOf({ a: "no urls here" }), []);
});

test("share: ?src= only loads docs configs", () => {
  assert.equal(safeSrc("/configs/earthquakes.yaml"), "/configs/earthquakes.yaml");
  assert.equal(safeSrc("/configs/gallery/display-a-map.yaml"), "/configs/gallery/display-a-map.yaml");
  for (const bad of ["https://evil.example/x.yaml", "//evil.example/configs/x.yaml", "/configs/../secret.yaml", "/data/x.yaml", "/configs/x.json", null]) {
    assert.equal(safeSrc(bad), null, String(bad));
  }
});

// ---- camera keeping -------------------------------------------------------

test("camera: the key changes only with the view, and the live camera replaces it", () => {
  const a = { config: { center: [0, 0], zoom: 2, mapStyle: "x" }, layers: [] };
  const b = { config: { center: [0, 0], zoom: 2, mapStyle: "y" }, layers: [{ id: "n" }] };
  assert.equal(cameraKey(a), cameraKey(b));
  assert.notEqual(cameraKey(a), cameraKey({ config: { ...a.config, zoom: 3 } }));
  const kept = withCamera({ config: { center: [0, 0], zoom: 2, bounds: [0, 0, 1, 1], fitTo: "s" } }, { center: [139.7000001, 35.7], zoom: 4.12345, bearing: 10, pitch: 20 });
  assert.deepEqual(kept.config, { center: [139.7, 35.7], zoom: 4.123, bearing: 10, pitch: 20 });
});

// ---- download -------------------------------------------------------------

test("download: site paths point at the docs site; URLs, links and comments stay", () => {
  const text = [
    "sources:",
    "  cities:",
    "    url: /data/classify/world-cities.geojson   # natural earth",
    "    data: \"data/cities.geojson\"",
    "  tiles:",
    "    tiles:",
    "      - /tiles/{z}/{x}/{y}.pbf",
    "  remote:",
    "    url: https://earthquake.usgs.gov/feed.geojson",
    "popup:",
    "  - a: { href: /about }",
    "id: /not-a-file-key",
    "",
  ].join("\n");
  assert.equal(
    rewriteSiteUrls(text),
    [
      "sources:",
      "  cities:",
      "    url: https://docs.maplibre-yaml.org/data/classify/world-cities.geojson   # natural earth",
      "    data: \"https://docs.maplibre-yaml.org/data/cities.geojson\"",
      "  tiles:",
      "    tiles:",
      "      - https://docs.maplibre-yaml.org/tiles/{z}/{x}/{y}.pbf",
      "  remote:",
      "    url: https://earthquake.usgs.gov/feed.geojson",
      "popup:",
      "  - a: { href: /about }",
      "id: /not-a-file-key",
      "",
    ].join("\n"),
  );
});

test("download: the folder holds the page, the document and a README, pinned to this minor", () => {
  const core = JSON.parse(readFileSync(join(DOCS, "..", "packages", "core", "package.json"), "utf8")).version;
  const minor = core.split(".").slice(0, 2).join(".");
  const files = downloadFiles(config("configs/classify/graduated.yaml"), "map");
  assert.deepEqual(Object.keys(files).sort(), ["my-map/README.txt", "my-map/index.html", "my-map/map.yaml"]);
  assert.ok(files["my-map/index.html"].includes(`https://unpkg.com/@maplibre-yaml/core@${minor}/register.js`));
  assert.ok(files["my-map/index.html"].includes('<ml-map src="./map.yaml">'));
  assert.ok(files["my-map/map.yaml"].includes("url: https://docs.maplibre-yaml.org/data/classify/world-cities.geojson"));
  assert.equal(YAMLParser.safeParseAny(files["my-map/map.yaml"]).result.success, true);
  assert.match(files["my-map/README.txt"], /npx serve \./);
  assert.match(files["my-map/README.txt"], /file:\/\//);

  const s = downloadFiles("type: scrollytelling\nid: s", "scrollytelling");
  assert.ok(s["my-map/story.yaml"].startsWith("# yaml-language-server: $schema=https://docs.maplibre-yaml.org/schema/latest/scrollytelling.schema.json\n"));
  assert.ok(s["my-map/index.html"].includes('<ml-scrollytelling src="story.yaml">'));
  assert.match(s["my-map/README.txt"], /story\.yaml/);

  const zipped = unzipSync(downloadZip("type: map\nid: z\n", "map"));
  assert.deepEqual(Object.keys(zipped).sort(), ["my-map/README.txt", "my-map/index.html", "my-map/map.yaml"]);
  assert.match(strFromU8(zipped["my-map/map.yaml"]), /^# yaml-language-server: .*\ntype: map\nid: z\n$/);
});

// ---- starters -------------------------------------------------------------

test("starters: the gallery list is every pure-YAML gallery page, and only those", () => {
  const listed = galleryStarters().flatMap((g) => g.starters.map((s) => s.slug));
  const yaml = allEntries().filter((e) => e.slug && e.kind === "yaml").map((e) => e.slug);
  assert.deepEqual(listed, yaml);
  assert.ok(listed.length >= 80);
});

test("starters: every starter file exists and validates (except the one with mistakes)", () => {
  const all = [...CURATED, ...galleryStarters().flatMap((g) => g.starters)];
  assert.ok(CURATED.length >= 4 && CURATED.length <= 6, "about five hand-picked");
  assert.ok(CURATED.some((s) => s.src === DEFAULT_SRC));
  for (const s of all) {
    assert.equal(safeSrc(s.src), s.src, `${s.src} is loadable with ?src=`);
    const file = join(PUBLIC, s.src);
    assert.ok(existsSync(file), `${s.src} exists`);
    const result = YAMLParser.safeParseAny(readFileSync(file, "utf8"));
    if (s.broken) assert.equal(result.result.success, false, `${s.src} still has its mistakes`);
    else assert.equal(result.result.success, true, `${s.src}: ${JSON.stringify(result.result.errors)}`);
  }
  assert.ok(CURATED.some((s) => YAMLParser.safeParseAny(config(s.src.slice(1))).blockType === "scrollytelling"), "a story starter");
});

test("starters: the story starter is near the top, short, and the docs' complete example verbatim", () => {
  const i = CURATED.findIndex((s) => YAMLParser.safeParseAny(config(s.src.slice(1))).blockType === "scrollytelling");
  assert.ok(i >= 0 && i <= 1, "the story map is the first or second starter");
  const text = config(CURATED[i].src.slice(1));
  const doc = YAMLParser.safeParseAny(text).result.data;
  assert.ok(doc.chapters.length >= 3 && doc.chapters.length <= 4, "three or four chapters");
  assert.ok(doc.legend, "a legend, so the starter shows one");
  assert.equal(doc.showMarkers, true, "the chapter rail");
  // Character for character: the file is the fence plus the schema modeline.
  const page = readFileSync(join(DOCS, "src/content/docs/schema/scrollytelling.mdx"), "utf8");
  const fence = /## A complete example[\s\S]*?```yaml title="story\.yaml"\n([\s\S]*?)```/.exec(page)?.[1];
  assert.ok(fence, "Writing a story file still has its complete example");
  assert.equal(text, "# yaml-language-server: $schema=https://docs.maplibre-yaml.org/schema/latest/scrollytelling.schema.json\n" + fence);
  // The download of it is a story page.
  const files = downloadFiles(text, "scrollytelling");
  assert.ok(files["my-map/index.html"].includes('<ml-scrollytelling src="story.yaml"></ml-scrollytelling>'));
  assert.equal(files["my-map/story.yaml"], text);
});

test("starters: playground links", () => {
  assert.equal(playgroundHref("/configs/gallery/display-a-map.yaml"), "/playground/?src=/configs/gallery/display-a-map.yaml");
});
