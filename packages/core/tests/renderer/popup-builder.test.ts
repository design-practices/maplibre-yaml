import { describe, it, expect } from "vitest";
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
});
