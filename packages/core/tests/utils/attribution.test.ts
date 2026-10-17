/**
 * The attribution sanitizer: an allowlist in front of MapLibre's attribution
 * sink, whose own sanitizer is bypassable on every supported maplibre-gl
 * (GHSA-jrc7-96c5-q579). Inputs here are of the vulnerability *class* —
 * markup that is not a plain link — not reproductions of any specific bypass.
 */
import { describe, it, expect } from "vitest";
import {
  sanitizeAttribution,
  safeAttributionHref,
  sanitizeCustomAttribution,
  sanitizeSourcesAttribution,
} from "../../src/utils/attribution";

const clean = (input: unknown) => sanitizeAttribution(input).html;

describe("sanitizeAttribution: what survives", () => {
  it.each([
    "© OpenStreetMap contributors",
    '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    '<a href="https://maplibre.org/" target="_blank">MapLibre</a>',
    '<a href="https://example.com/" target="_blank" rel="noopener noreferrer">Example</a>',
    '<a href="mailto:data@example.com">Contact</a>',
    "Data &amp; tiles &#169; &#xA9; Example",
  ])("leaves already-safe attribution untouched: %s", (input) => {
    const result = sanitizeAttribution(input);
    expect(result.html).toBe(input);
    expect(result.changed).toBe(false);
  });

  it("normalizes attribute quoting and case without flagging a change", () => {
    const result = sanitizeAttribution("<A HREF='https://example.com/'>x</A>");
    expect(result.html).toBe('<a href="https://example.com/">x</a>');
    expect(result.changed).toBe(false);
  });

  it("escapes a bare ampersand and quotes in text without flagging a change", () => {
    const result = sanitizeAttribution(`Tom & Jerry's "maps"`);
    expect(result.html).toBe("Tom &amp; Jerry&#39;s &quot;maps&quot;");
    expect(result.changed).toBe(false);
  });

  it("keeps a query-string href, escaping its ampersand", () => {
    expect(clean('<a href="https://x.test/?a=1&b=2">x</a>')).toBe(
      '<a href="https://x.test/?a=1&amp;b=2">x</a>'
    );
  });
});

describe("sanitizeAttribution: what is escaped or dropped", () => {
  it("escapes every tag other than <a> so it renders as text", () => {
    const result = sanitizeAttribution("<b>bold</b> <img src=x> <svg><g/></svg>");
    expect(result.html).not.toMatch(/<(?!\/?a[\s>])/);
    expect(result.html).toBe(
      "&lt;b&gt;bold&lt;/b&gt; &lt;img src=x&gt; &lt;svg&gt;&lt;g/&gt;&lt;/svg&gt;"
    );
    expect(result.changed).toBe(true);
  });

  it("escapes comments and processing-instruction-like input", () => {
    const result = sanitizeAttribution("a<!-- b -->c<?x?>");
    expect(result.html).toBe("a&lt;!-- b --&gt;c&lt;?x?&gt;");
    expect(result.changed).toBe(true);
  });

  it("drops every anchor attribute outside href/target/rel", () => {
    const result = sanitizeAttribution(
      '<a href="https://x.test/" onclick="f()" style="color:red" id="y">x</a>'
    );
    expect(result.html).toBe('<a href="https://x.test/">x</a>');
    expect(result.changed).toBe(true);
  });

  it.each([
    "javascript:f()",
    "JaVaScRiPt:f()",
    " javascript:f()",
    "java\tscript:f()",
    "java\nscript:f()",
    "&#106;avascript:f()",
    "&#x6A;avascript:f()",
    "&#106avascript:f()",
    "javascript&colon;f()",
    "data:text/html,x",
    "vbscript:x",
    "tel:123",
    "/relative/path",
    "//host.test/path",
    "#fragment",
    "",
  ])("unwraps a link whose href is not http(s)/mailto: %j", (href) => {
    const result = sanitizeAttribution(`<a href="${href}">text</a>`);
    expect(result.html).toBe("text");
    expect(result.changed).toBe(true);
  });

  it("unwraps a link with no href at all", () => {
    expect(sanitizeAttribution("<a name=x>text</a>")).toEqual({ html: "text", changed: true });
  });

  it("drops an invalid target value and keeps the link", () => {
    expect(clean('<a href="https://x.test/" target="evil frame">x</a>')).toBe(
      '<a href="https://x.test/">x</a>'
    );
  });

  it("keeps only word tokens in rel", () => {
    expect(clean('<a href="https://x.test/" rel="noopener x=y">x</a>')).toBe(
      '<a href="https://x.test/" rel="noopener">x</a>'
    );
  });

  it("closes an unclosed anchor and drops a stray close tag", () => {
    expect(clean('<a href="https://x.test/">open')).toBe('<a href="https://x.test/">open</a>');
    expect(sanitizeAttribution("text</a>")).toEqual({ html: "text", changed: true });
  });

  it("treats a nested <a> as closing the previous one, as HTML does", () => {
    expect(clean('<a href="https://a.test/">a<a href="https://b.test/">b</a>')).toBe(
      '<a href="https://a.test/">a</a><a href="https://b.test/">b</a>'
    );
  });

  it("escapes markup nested inside a link's text", () => {
    expect(clean('<a href="https://x.test/"><b>x</b></a>')).toBe(
      '<a href="https://x.test/">&lt;b&gt;x&lt;/b&gt;</a>'
    );
  });

  it("escapes a malformed or unterminated tag rather than guessing", () => {
    expect(clean('<a href="https://x.test/"')).toBe("&lt;a href=&quot;https://x.test/&quot;");
    expect(clean("<a/href=x>y")).toBe("&lt;a/href=x&gt;y");
  });

  it("escapes quote characters that would break out of an attribute", () => {
    expect(clean(`<a href='https://x.test/"onmouseover="f()'>x</a>`)).toBe(
      '<a href="https://x.test/&quot;onmouseover=&quot;f()">x</a>'
    );
  });

  it("stringifies non-strings and maps nullish to empty", () => {
    expect(clean(42)).toBe("42");
    expect(clean(null)).toBe("");
    expect(clean(undefined)).toBe("");
  });
});

describe("sanitizeAttribution: output invariants", () => {
  const corpus = [
    "<b>x</b>",
    '<a href="javascript:x">y</a>',
    "<a href=https://x.test/ onfocus=y autofocus>z</a>",
    "<svg><a href=https://x.test/>q</a></svg>",
    "<template><a href=https://x.test/>q</a></template>",
    "<<a href=https://x.test/>>",
    "&lt;a href=x&gt;",
    "<style>a{}</style><script>x</script>",
    '"><a href="https://x.test/">',
  ];

  it.each(corpus)("is idempotent: %j", (input) => {
    const once = clean(input);
    expect(clean(once)).toBe(once);
  });

  it.each(corpus)("emits only text and safe <a> elements when parsed: %j", (input) => {
    const container = document.createElement("div");
    container.innerHTML = clean(input);
    for (const element of Array.from(container.querySelectorAll("*"))) {
      expect(element.tagName).toBe("A");
      for (const attr of Array.from(element.attributes)) {
        expect(["href", "target", "rel"]).toContain(attr.name);
      }
      expect(element.getAttribute("href")).toMatch(/^(https?|mailto):/);
    }
  });
});

describe("safeAttributionHref", () => {
  it("returns the decoded navigable form", () => {
    expect(safeAttributionHref("https://x.test/?a=1&amp;b=2")).toBe("https://x.test/?a=1&b=2");
    expect(safeAttributionHref("&#104;ttps://x.test/")).toBe("https://x.test/");
  });

  it("rejects an href carrying a named reference it cannot decode exactly", () => {
    expect(safeAttributionHref("https://x.test/&copy;")).toBeNull();
  });
});

describe("sanitizeCustomAttribution", () => {
  it("preserves string and array shapes", () => {
    expect(sanitizeCustomAttribution("<b>x</b>")).toEqual({
      value: "&lt;b&gt;x&lt;/b&gt;",
      changed: true,
    });
    expect(sanitizeCustomAttribution(["a", "<i>b</i>"])).toEqual({
      value: ["a", "&lt;i&gt;b&lt;/i&gt;"],
      changed: true,
    });
    expect(sanitizeCustomAttribution(undefined)).toEqual({ value: undefined, changed: false });
  });
});

describe("sanitizeSourcesAttribution", () => {
  it("returns the same object when nothing needs to change", () => {
    const sources = { a: { type: "vector", attribution: "© A" }, b: { type: "raster" } };
    expect(sanitizeSourcesAttribution(sources)).toBe(sources);
  });

  it("copies on write and reports stripped sources", () => {
    const sources = { a: { type: "vector", attribution: "<b>A</b>" } };
    const changed: string[] = [];
    const out = sanitizeSourcesAttribution(sources, (id) => changed.push(id)) as any;
    expect(out).not.toBe(sources);
    expect(out.a.attribution).toBe("&lt;b&gt;A&lt;/b&gt;");
    expect(sources.a.attribution).toBe("<b>A</b>");
    expect(changed).toEqual(["a"]);
  });
});
