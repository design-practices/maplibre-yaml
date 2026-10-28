/**
 * Schema help for the playground editor: key and value completion, and
 * hover descriptions, read from the published JSON Schema
 * (`/schema/latest/map.schema.json`, `scrollytelling.schema.json`).
 *
 * Framework-free on purpose (design D2, Q6): it works on plain text and a
 * cursor offset, so any editor (or map-party) can bind it. It finds the YAML
 * path from indentation rather than from a parse, so it keeps working while
 * the document is half-typed and doesn't parse. Layer unions are narrowed by
 * the sibling `type:` value, so `paint:` under a `type: circle` layer offers
 * `circle-*` keys only.
 *
 * It never reports problems. Diagnostics have one source, core's
 * `parseDocumentText` (see diagnostics.mjs), so nothing is reported twice.
 *
 * YAML only: the completions and hovers walk YAML indentation, so the editor
 * turns them off while the document is JSON or TOML.
 */

/** @typedef {{ label: string, detail?: string, info?: string, type: "property" | "enum" }} Option */
/** @typedef {{ from: number, to: number, options: Option[] }} Completion */
/** @typedef {{ from: number, to: number, title: string, detail: string, text: string }} Hover */

/** A top-level `type` that names a story, as each format writes it. */
const STORY_TYPE = {
  yaml: /^type:\s*["']?scrollytelling\b/m,
  json: /"type"\s*:\s*"scrollytelling"/,
  toml: /^type\s*=\s*["']scrollytelling["']/m,
};

/**
 * Which schema a document needs: stories have their own. Read from the text,
 * so it holds while the document is half-typed and doesn't parse; the
 * playground prefers the parser's answer when there is one.
 *
 * @param {string} text
 * @param {"yaml" | "json" | "toml"} [format]
 */
export function schemaNameFor(text, format = "yaml") {
  return (STORY_TYPE[format] ?? STORY_TYPE.yaml).test(text) ? "scrollytelling" : "map";
}

const KEY = "[A-Za-z0-9_$-]+";

/**
 * @param {any} schema a JSON Schema document (draft 7 / 2019-09 style, with
 *   `$ref`s into `$defs` or `definitions`)
 */
export function createSchemaAssist(schema) {
  const root = schema;

  /** Follow `$ref`s (internal pointers only) to the node they name. */
  function deref(node) {
    for (let hops = 0; node && typeof node === "object" && node.$ref && hops < 20; hops++) {
      const ptr = String(node.$ref)
        .replace(/^#\/?/, "")
        .split("/")
        .filter(Boolean)
        .map((s) => s.replace(/~1/g, "/").replace(/~0/g, "~"));
      let cur = root;
      for (const p of ptr) cur = cur?.[p];
      node = cur;
    }
    return node;
  }

  /** Flatten `anyOf` / `oneOf` / `allOf` into concrete branches. */
  function branches(node, out = []) {
    node = deref(node);
    if (!node || typeof node !== "object") return out;
    const alts = node.anyOf || node.oneOf;
    if (alts) {
      for (const a of alts) branches(a, out);
    } else if (node.allOf) {
      for (const a of node.allOf) branches(a, out);
    } else {
      out.push(node);
    }
    return out;
  }

  /** Does a branch fit the sibling `type:` the author has written? */
  function matches(branch, siblings) {
    const t = branch.properties?.type;
    if (!t || siblings?.type === undefined) return true;
    const tt = deref(t);
    if (tt?.const !== undefined) return String(tt.const) === siblings.type;
    if (tt?.enum) return tt.enum.map(String).includes(siblings.type);
    return true;
  }

  /** The schema nodes at a path of keys and "[]" (array item). */
  function nodesAt(path, siblingsAt = []) {
    let cur = [deref(root)];
    path.forEach((seg, i) => {
      const next = [];
      for (const n of cur) {
        for (const b of branches(n)) {
          if (seg === "[]") {
            if (b.items) next.push(b.items);
            continue;
          }
          if (!matches(b, siblingsAt[i])) continue;
          if (b.properties?.[seg]) next.push(b.properties[seg]);
          else if (b.additionalProperties && typeof b.additionalProperties === "object") {
            next.push(b.additionalProperties);
          }
        }
      }
      cur = next;
    });
    return cur;
  }

  /** A short type summary for the completion list: `number`, `"circle" | "line"`. */
  function summarize(n) {
    const types = new Set();
    for (const b of branches(n)) {
      if (b.const !== undefined) types.add(JSON.stringify(b.const));
      else if (b.enum) types.add(b.enum.map((e) => JSON.stringify(e)).join(" | "));
      else if (b.type) types.add(Array.isArray(b.type) ? b.type.join(" | ") : b.type);
    }
    return [...types].slice(0, 4).join(" or ");
  }

  function describe(n) {
    const d = deref(n);
    if (d?.description) return d.description;
    for (const b of branches(n)) if (b.description) return b.description;
    return "";
  }

  /**
   * The keys already written at one indentation block, as `{ key: value }`,
   * so a key isn't offered twice and `type:` can narrow a union.
   */
  function siblingsOf(lines, startLine, ind) {
    const s = {};
    const re = new RegExp(`^(\\s*)(- +)?(${KEY}):\\s*["']?([^"'#\\n]*?)["']?\\s*(#.*)?$`);
    // A line that opens a list item ("- key:") is the item's first line:
    // nothing above it belongs to the same object.
    const opensItem = /^\s*- /.test(lines[startLine] ?? "");
    for (const dir of opensItem ? [1] : [-1, 1]) {
      for (let i = startLine + (dir === 1 ? 0 : -1); i >= 0 && i < lines.length; i += dir) {
        const l = lines[i];
        if (!l.trim() || /^\s*#/.test(l)) continue;
        const mm = re.exec(l);
        const lead = l.length - l.trimStart().length;
        const keyInd = mm ? mm[1].length + (mm[2] ? mm[2].length : 0) : lead;
        if (keyInd < ind) break;
        if (mm && keyInd === ind) {
          if (i !== startLine) s[mm[3]] = mm[4] || undefined;
          if (mm[2] && dir === -1) break; // the item's first key
          if (mm[2] && dir === 1 && i !== startLine) break; // the next item
        }
      }
    }
    return s;
  }

  /**
   * Where the cursor is: completing a key or a value, under which path.
   * Returns null when the cursor is somewhere neither applies (a comment, a
   * flow collection, a block scalar's text).
   */
  function context(text, offset) {
    const before = text.slice(0, offset);
    const lineStart = before.lastIndexOf("\n") + 1;
    const line = text.slice(lineStart, offset);
    const lines = text.split("\n");
    const lineNo = before.split("\n").length - 1;

    let mode, indent, prefix, key, m;
    if ((m = new RegExp(`^(\\s*)(- +)?(${KEY.replace("+", "*")})$`).exec(line))) {
      mode = "key";
      indent = m[1].length + (m[2] ? m[2].length : 0);
      prefix = m[3];
    } else if ((m = new RegExp(`^(\\s*)(- +)?(${KEY}):\\s*["']?([^"'#\\[\\]{},]*)$`).exec(line))) {
      mode = "value";
      indent = m[1].length + (m[2] ? m[2].length : 0);
      key = m[3];
      prefix = m[4];
    } else {
      return null;
    }
    const from = offset - prefix.length;

    const path = [];
    const sibs = [siblingsOf(lines, lineNo, indent)];
    let want = indent;
    // The column of the "-" of the list item the cursor is inside, or -1.
    let dashCol = m[2] !== undefined ? m[1].length : -1;
    for (let i = lineNo - 1; i >= 0; i--) {
      const l = lines[i];
      if (!l.trim() || /^\s*#/.test(l)) continue;
      const mm = new RegExp(`^(\\s*)(- +)?(${KEY})?:?`).exec(l);
      const sp = mm[1].length;
      const dash = mm[2] ? mm[2].length : 0;
      if (dashCol >= 0) {
        // Looking for the key that holds the list we are in.
        if (dash && sp === dashCol) continue; // a sibling item
        if (sp > dashCol) continue;
        if (mm[3]) {
          path.unshift(mm[3], "[]");
          sibs.unshift({});
          want = sp + dash;
          sibs.unshift(siblingsOf(lines, i, want));
          dashCol = dash ? sp : -1;
          if (want === 0) break;
        }
        continue;
      }
      if (dash && sp + dash === want) {
        // The first line of the item whose keys sit at `want`.
        dashCol = sp;
        continue;
      }
      if (sp < want && mm[3]) {
        path.unshift(mm[3]);
        want = sp + dash;
        sibs.unshift(siblingsOf(lines, i, want));
        if (dash) dashCol = sp;
        if (want === 0 && !dash) break;
      }
    }
    if (dashCol >= 0) {
      path.unshift("[]");
      sibs.unshift({});
    }
    // sibs[i] holds the keys of the object that owns path[i]; the last entry
    // is the object the cursor is in.
    return { mode, path, sibs, prefix, key, from, to: offset };
  }

  /**
   * Completion options at `offset`.
   * @returns {Completion | null}
   */
  function complete(text, offset) {
    const ctx = context(text, offset);
    if (!ctx) return null;
    const own = ctx.sibs[ctx.sibs.length - 1] || {};
    if (ctx.mode === "key") {
      const seen = new Map();
      for (const n of nodesAt(ctx.path, ctx.sibs)) {
        for (const b of branches(n)) {
          if (!matches(b, own)) continue;
          for (const [k, v] of Object.entries(b.properties || {})) {
            if (k in own || seen.has(k)) continue;
            seen.set(k, { label: k, detail: summarize(v), info: describe(v), type: "property" });
          }
        }
      }
      return { from: ctx.from, to: ctx.to, options: [...seen.values()] };
    }
    const vals = new Map();
    for (const n of nodesAt([...ctx.path, ctx.key], [...ctx.sibs, own])) {
      for (const b of branches(n)) {
        const add = (v) =>
          vals.set(String(v), { label: String(v), detail: b.description || describe(n), type: "enum" });
        if (b.const !== undefined) add(b.const);
        if (b.enum) b.enum.forEach(add);
        if (b.type === "boolean") {
          add(true);
          add(false);
        }
      }
    }
    return { from: ctx.from, to: ctx.to, options: [...vals.values()] };
  }

  /**
   * The description of the key under `offset`.
   * @returns {Hover | null}
   */
  function hover(text, offset) {
    const lineStart = text.lastIndexOf("\n", offset - 1) + 1;
    const nl = text.indexOf("\n", offset);
    const line = text.slice(lineStart, nl === -1 ? text.length : nl);
    const m = new RegExp(`^(\\s*)(- +)?(${KEY}):`).exec(line);
    if (!m) return null;
    const kStart = lineStart + m[1].length + (m[2] ? m[2].length : 0);
    const kEnd = kStart + m[3].length;
    if (offset < kStart || offset > kEnd) return null;
    const ctx = context(text, kEnd);
    if (!ctx) return null;
    const own = ctx.sibs[ctx.sibs.length - 1] || {};
    const nodes = nodesAt([...ctx.path, m[3]], [...ctx.sibs, own]);
    if (!nodes.length) return null;
    const textOf = nodes.map(describe).find(Boolean) ?? "";
    return { from: kStart, to: kEnd, title: m[3], detail: summarize(nodes[0]), text: textOf };
  }

  return { complete, hover, context };
}
