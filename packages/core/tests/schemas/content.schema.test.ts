/**
 * @file Tests for content schemas
 * @module @maplibre-yaml/core/tests/schemas/content
 */

import { describe, it, expect } from "vitest";
import {
  ContentElementSchema,
  ContentItemSchema,
} from "../../src/schemas/content.schema";

describe("ContentElementSchema", () => {
  describe("static content", () => {
    it("accepts static string", () => {
      const element = { str: "Hello World" };
      expect(ContentElementSchema.parse(element)).toMatchObject(element);
    });
  });

  describe("dynamic content", () => {
    it("accepts property reference", () => {
      const element = { property: "userName" };
      expect(ContentElementSchema.parse(element)).toMatchObject(element);
    });

    it("accepts property with fallback", () => {
      const element = { property: "userName", else: "Guest" };
      expect(ContentElementSchema.parse(element)).toMatchObject(element);
    });
  });

  describe("styling", () => {
    it("accepts classList as string", () => {
      const element = { str: "Text", classList: "text-bold text-red" };
      expect(ContentElementSchema.parse(element)).toMatchObject(element);
    });

    it("accepts classList as array", () => {
      const element = { str: "Text", classList: ["text-bold", "text-red"] };
      expect(ContentElementSchema.parse(element)).toMatchObject(element);
    });

    it("accepts id", () => {
      const element = { str: "Text", id: "main-heading" };
      expect(ContentElementSchema.parse(element)).toMatchObject(element);
    });

    it("accepts inline style", () => {
      const element = { str: "Text", style: "color: red; font-size: 18px;" };
      expect(ContentElementSchema.parse(element)).toMatchObject(element);
    });

    it("accepts all styling properties together", () => {
      const element = {
        str: "Styled text",
        classList: "text-bold",
        id: "special",
        style: "color: blue;",
      };
      expect(ContentElementSchema.parse(element)).toMatchObject(element);
    });
  });

  describe("links", () => {
    it("accepts link with href", () => {
      const element = { str: "Click here", href: "https://example.com" };
      expect(ContentElementSchema.parse(element)).toMatchObject(element);
    });

    it("accepts link with target", () => {
      const element = {
        str: "External link",
        href: "https://example.com",
        target: "_blank",
      };
      expect(ContentElementSchema.parse(element)).toMatchObject(element);
    });

    it("rejects invalid URL", () => {
      expect(() =>
        ContentElementSchema.parse({ href: "not-a-valid-url" })
      ).toThrow();
    });
  });

  describe("media", () => {
    it("accepts image with src and alt", () => {
      const element = {
        src: "https://example.com/image.jpg",
        alt: "Description",
      };
      expect(ContentElementSchema.parse(element)).toMatchObject(element);
    });

    it("accepts image with dimensions as numbers", () => {
      const element = {
        src: "https://example.com/image.jpg",
        width: 800,
        height: 600,
      };
      expect(ContentElementSchema.parse(element)).toMatchObject(element);
    });

    it("accepts image with dimensions as strings", () => {
      const element = {
        src: "https://example.com/image.jpg",
        width: "100%",
        height: "400px",
      };
      expect(ContentElementSchema.parse(element)).toMatchObject(element);
    });

    it("accepts iframe with src", () => {
      const element = {
        src: "https://www.youtube.com/embed/VIDEO_ID",
        width: "560",
        height: "315",
      };
      expect(ContentElementSchema.parse(element)).toMatchObject(element);
    });

    it("rejects invalid media URL", () => {
      expect(() => ContentElementSchema.parse({ src: "not-a-url" })).toThrow();
    });
  });

  describe("passthrough", () => {
    it("accepts additional properties", () => {
      const element = {
        str: "Text",
        "data-custom": "value",
        role: "button",
      };
      expect(ContentElementSchema.parse(element)).toMatchObject(element);
    });
  });
});

describe("ContentItemSchema", () => {
  it("accepts single tag with elements", () => {
    const item = {
      h1: [{ str: "Title" }],
    };
    expect(ContentItemSchema.parse(item)).toEqual(item);
  });

  it("accepts multiple elements in single tag", () => {
    const item = {
      p: [{ str: "Welcome, " }, { property: "userName", else: "Guest" }],
    };
    expect(ContentItemSchema.parse(item)).toEqual(item);
  });

  it("accepts all heading tags", () => {
    const headings = ["h1", "h2", "h3", "h4", "h5", "h6"];
    headings.forEach((tag) => {
      const item = { [tag]: [{ str: "Heading" }] };
      expect(ContentItemSchema.parse(item)).toEqual(item);
    });
  });

  it("accepts text formatting tags", () => {
    const tags = ["p", "span", "div", "strong", "em", "code", "pre"];
    tags.forEach((tag) => {
      const item = { [tag]: [{ str: "Text" }] };
      expect(ContentItemSchema.parse(item)).toEqual(item);
    });
  });

  it("accepts link tag", () => {
    const item = {
      a: [{ str: "Link", href: "https://example.com" }],
    };
    expect(ContentItemSchema.parse(item)).toEqual(item);
  });

  it("accepts media tags", () => {
    const imgItem = {
      img: [{ src: "https://example.com/image.jpg", alt: "Image" }],
    };
    expect(ContentItemSchema.parse(imgItem)).toEqual(imgItem);

    const iframeItem = {
      iframe: [{ src: "https://example.com/embed" }],
    };
    expect(ContentItemSchema.parse(iframeItem)).toEqual(iframeItem);
  });

  it("accepts list tags", () => {
    const ulItem = { ul: [{ str: "List" }] };
    expect(ContentItemSchema.parse(ulItem)).toEqual(ulItem);

    const olItem = { ol: [{ str: "List" }] };
    expect(ContentItemSchema.parse(olItem)).toEqual(olItem);

    const liItem = { li: [{ str: "Item" }] };
    expect(ContentItemSchema.parse(liItem)).toEqual(liItem);
  });

  it("accepts other tags", () => {
    const blockquoteItem = { blockquote: [{ str: "Quote" }] };
    expect(ContentItemSchema.parse(blockquoteItem)).toEqual(blockquoteItem);

    const hrItem = { hr: [{}] };
    expect(ContentItemSchema.parse(hrItem)).toEqual(hrItem);

    const brItem = { br: [{}] };
    expect(ContentItemSchema.parse(brItem)).toEqual(brItem);
  });

  it("rejects invalid tag names", () => {
    expect(() =>
      ContentItemSchema.parse({
        script: [{ str: "Not allowed" }],
      })
    ).toThrow();

    expect(() =>
      ContentItemSchema.parse({
        style: [{ str: "Not allowed" }],
      })
    ).toThrow();
  });
});
