import { describe, it, expect, vi } from "vitest";
import { PopupBuilder } from "../../src/renderer/popup-builder";

describe("PopupBuilder", () => {
  let builder: PopupBuilder;

  beforeEach(() => {
    builder = new PopupBuilder();
  });

  describe("build", () => {
    it("builds simple static content", () => {
      const content = [
        {
          h3: [{ str: "Hello World" }],
        },
        {
          p: [{ str: "This is a test" }],
        },
      ];

      const html = builder.build(content, {});

      expect(html).toBe("<h3>Hello World</h3><p>This is a test</p>");
    });

    it("interpolates property values", () => {
      const content = [
        {
          h3: [{ property: "name" }],
        },
        {
          p: [{ str: "Population: " }, { property: "population" }],
        },
      ];

      const properties = {
        name: "New York",
        population: 8336817,
      };

      const html = builder.build(content, properties);

      expect(html).toBe("<h3>New York</h3><p>Population: 8336817</p>");
    });

    it("uses fallback values for missing properties", () => {
      const content = [
        {
          h3: [{ property: "name", else: "Unknown" }],
        },
      ];

      const html = builder.build(content, {});

      expect(html).toBe("<h3>Unknown</h3>");
    });

    it("formats numbers with thousands separator", () => {
      const content = [
        {
          p: [{ property: "value", format: ",.0f" }],
        },
      ];

      const properties = { value: 1234567 };
      const html = builder.build(content, properties);

      expect(html).toBe("<p>1,234,567</p>");
    });

    it("formats numbers with decimal places", () => {
      const content = [
        {
          p: [{ property: "value", format: ".2f" }],
        },
      ];

      const properties = { value: 123.456 };
      const html = builder.build(content, properties);

      expect(html).toBe("<p>123.46</p>");
    });

    it("formats numbers with both thousands and decimals", () => {
      const content = [
        {
          p: [{ property: "value", format: ",.2f" }],
        },
      ];

      const properties = { value: 1234567.89 };
      const html = builder.build(content, properties);

      expect(html).toBe("<p>1,234,567.89</p>");
    });

    it("builds links", () => {
      const content = [
        {
          p: [{ href: "https://example.com" }],
        },
      ];

      const html = builder.build(content, {});

      expect(html).toContain('<a href="https://example.com"');
      expect(html).toContain('target="_blank"');
    });

    it("builds images", () => {
      const content = [
        {
          p: [{ src: "https://example.com/image.jpg" }],
        },
      ];

      const html = builder.build(content, {});

      expect(html).toContain('<img src="https://example.com/image.jpg"');
      expect(html).toContain('alt=""');
    });

    it("escapes HTML in string values", () => {
      const content = [
        {
          p: [{ str: '<script>alert("xss")</script>' }],
        },
      ];

      const html = builder.build(content, {});

      expect(html).toBe(
        "<p>&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;</p>"
      );
      expect(html).not.toContain("<script>");
    });

    it("escapes HTML in property values", () => {
      const content = [
        {
          p: [{ property: "dangerous" }],
        },
      ];

      const properties = {
        dangerous: "<img src=x onerror=alert(1)>",
      };

      const html = builder.build(content, properties);

      expect(html).toBe("<p>&lt;img src=x onerror=alert(1)&gt;</p>");
      expect(html).not.toContain("<img");
    });

    it("handles mixed content", () => {
      const content = [
        {
          h3: [{ property: "title" }],
        },
        {
          p: [
            { str: "Location: " },
            { property: "city" },
            { str: ", " },
            { property: "country" },
          ],
        },
        {
          p: [
            { str: "Population: " },
            { property: "population", format: ",.0f" },
          ],
        },
      ];

      const properties = {
        title: "New York City",
        city: "New York",
        country: "USA",
        population: 8336817,
      };

      const html = builder.build(content, properties);

      expect(html).toContain("<h3>New York City</h3>");
      expect(html).toContain("<p>Location: New York, USA</p>");
      expect(html).toContain("<p>Population: 8,336,817</p>");
    });

    it("handles empty content array", () => {
      const html = builder.build([], {});
      expect(html).toBe("");
    });

    it("returns empty string for missing properties without fallback", () => {
      const content = [
        {
          p: [{ property: "missing" }],
        },
      ];

      const html = builder.build(content, {});
      expect(html).toBe("<p></p>");
    });
  });
  // Popups render feature properties from fetched data, in documents that may
  // have been authored by someone other than the person whose browser renders
  // them. These are the vectors that were live before the hardening.
  describe("injection hardening", () => {
    it("drops a tag that is not on the allowlist", () => {
      // The tag is a YAML key, so `script:` emitted a real <script> block.
      const html = builder.build(
        [{ script: [{ str: "alert(1)" }] }] as never,
        {}
      );
      expect(html).toBe("");
      expect(html).not.toContain("<script");
    });

    it("drops a tag carrying smuggled attributes", () => {
      const html = builder.build(
        [{ 'img src=x onerror=alert(1)': [{ str: "x" }] }] as never,
        {}
      );
      expect(html).not.toContain("onerror");
      expect(html).toBe("");
    });

    it("escapes a script payload arriving in a feature property", () => {
      const html = builder.build([{ p: [{ property: "name" }] }] as never, {
        name: '<img src=x onerror="alert(1)">',
      });
      expect(html).not.toContain("<img");
      expect(html).toContain("&lt;img");
    });

    it("drops a javascript: link but keeps its text", () => {
      // zod's .url() accepts `javascript:` as well-formed, so validation never
      // caught this -- escaping does not touch it either.
      const html = builder.build(
        [{ a: [{ href: "javascript:alert(1)", text: "Click me" }] }] as never,
        {}
      );
      expect(html).not.toContain("javascript:");
      expect(html).not.toContain("<a ");
      expect(html).toContain("Click me");
    });

    it("drops a data: image", () => {
      const html = builder.build(
        [
          {
            img: [{ src: "data:text/html,<script>alert(1)</script>" }],
          },
        ] as never,
        {}
      );
      expect(html).not.toContain("data:text/html");
    });

    it("keeps a same-origin link and image", () => {
      const html = builder.build(
        [
          { a: [{ href: "/about", text: "About" }] },
          { p: [{ src: "/img/pin.png", alt: "Pin" }] },
        ] as never,
        {}
      );
      expect(html).toContain('href="/about"');
      expect(html).toContain('src="/img/pin.png"');
    });

    it("cannot break out of the target attribute", () => {
      const html = builder.build(
        [
          {
            a: [
              {
                href: "https://example.com",
                text: "x",
                target: '_blank" onmouseover="alert(1)',
              },
            ],
          },
        ] as never,
        {}
      );
      expect(html).not.toMatch(/onmouseover=(?!&)/);
      expect(html).toContain('target="_blank"');
    });

    it("adds rel=noopener to a _blank link", () => {
      const html = builder.build(
        [{ a: [{ href: "https://example.com", text: "x" }] }] as never,
        {}
      );
      expect(html).toContain('rel="noopener noreferrer"');
    });

    it("omits rel for a same-tab link", () => {
      const html = builder.build(
        [
          {
            a: [{ href: "https://example.com", text: "x", target: "_self" }],
          },
        ] as never,
        {}
      );
      expect(html).toContain('target="_self"');
      expect(html).not.toContain("rel=");
    });
  });

  // ml-aot.29: `str` + `href` is the shape the content-block docs show, so
  // authors write it in popups too -- it used to render the text and drop the
  // URL with no warning, because the `str` branch returned first.
  describe("link items", () => {
    it("renders str + href as a link with str as its text", () => {
      const html = builder.build(
        [{ p: [{ str: "Wikipedia", href: "https://en.wikipedia.org/wiki/Chicago" }] }],
        {}
      );
      expect(html).toBe(
        '<p><a href="https://en.wikipedia.org/wiki/Chicago" target="_blank" rel="noopener noreferrer">Wikipedia</a></p>'
      );
    });

    it("prefers text over str for the link text", () => {
      const html = builder.build(
        [{ p: [{ str: "ignored", text: "Read more", href: "https://example.com" }] }],
        {}
      );
      expect(html).toContain(">Read more</a>");
      expect(html).not.toContain("ignored");
    });

    it("escapes str link text", () => {
      const html = builder.build(
        [{ p: [{ str: "<b>x</b>", href: "https://example.com" }] }],
        {}
      );
      expect(html).toContain(">&lt;b&gt;x&lt;/b&gt;</a>");
    });

    it("keeps an !html str link text escaped under the untrusted policy", () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const html = builder.build(
        [{ p: [{ str: { $html: "<em>styled</em>" }, href: "https://example.com" }] }],
        {}
      );
      expect(html).toContain('<a href="https://example.com"');
      expect(html).toContain(">&lt;em&gt;styled&lt;/em&gt;</a>");
      warn.mockRestore();
    });

    it("honours target on a str + href link", () => {
      const html = builder.build(
        [{ p: [{ str: "Home", href: "/", target: "_self" }] }],
        {}
      );
      expect(html).toBe('<p><a href="/" target="_self">Home</a></p>');
    });

    it("drops an unsafe str + href URL but keeps the text", () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const html = builder.build(
        [{ p: [{ str: "Click me", href: "javascript:alert(1)" }] }],
        {}
      );
      expect(html).toBe("<p>Click me</p>");
      expect(warn).toHaveBeenCalledWith(expect.stringContaining("unsafe URL scheme"));
      warn.mockRestore();
    });

    it("emits a single anchor when a link item is wrapped in a:", () => {
      const html = builder.build(
        [{ a: [{ href: "https://example.com", text: "x" }] }],
        {}
      );
      expect(html).toBe(
        '<a href="https://example.com" target="_blank" rel="noopener noreferrer">x</a>'
      );
    });

    it("emits a single image when an image item is wrapped in img:", () => {
      const html = builder.build(
        [{ img: [{ src: "https://example.com/a.png", alt: "A" }] }],
        {}
      );
      expect(html).toBe('<img src="https://example.com/a.png" alt="A" />');
    });

    it("still wraps text items in a: (no href, so no link)", () => {
      const html = builder.build([{ a: [{ str: "plain" }] }], {});
      expect(html).toBe("<a>plain</a>");
    });
  });

  // 0.9: numbers through Intl with MapLibre's number-format options, in the
  // page's language unless the format names one.
  describe("number formats (Intl, MapLibre number-format options)", () => {
    const norm = (s: string) => s.replace(/[  ]/g, " ");
    const popup = (format: unknown) => [{ p: [{ property: "v", format }] }] as any;

    it("de-DE decimal comma, currency, fraction digits", () => {
      expect(builder.build(popup({ locale: "de-DE", "max-fraction-digits": 1 }), { v: 1234567.891 })).toBe(
        "<p>1.234.567,9</p>"
      );
      expect(norm(builder.build(popup({ locale: "de-DE", currency: "EUR" }), { v: 12.5 }))).toBe("<p>12,50 €</p>");
      expect(builder.build(popup({ locale: "en-US", "min-fraction-digits": 2 }), { v: 3 })).toBe("<p>3.00</p>");
    });

    it("the page's language is the default locale", () => {
      const german = new PopupBuilder(undefined, { language: () => "de-DE" });
      expect(german.build(popup({ "max-fraction-digits": 2 }), { v: 1234.567 })).toBe("<p>1.234,57</p>");
      // The older string form follows it too.
      expect(german.build(popup(",.0f"), { v: 1234567.891 })).toBe("<p>1.234.568</p>");
      // A format's own locale wins.
      expect(german.build(popup({ locale: "en-US" }), { v: 1234.5 })).toBe("<p>1,234.5</p>");
    });

    it("strings and missing values are not formatted", () => {
      expect(builder.build(popup({ locale: "de-DE" }), { v: "1234.5" })).toBe("<p>1234.5</p>");
      expect(builder.build([{ p: [{ property: "v", format: { locale: "de-DE" }, else: "n/a" }] }] as any, {})).toBe(
        "<p>n/a</p>"
      );
    });
  });
});
