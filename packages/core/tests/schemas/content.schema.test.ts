/**
 * @file Tests for content schemas
 * @module @maplibre-yaml/core/tests/schemas/content
 */

import { describe, it, expect } from "vitest";
import {
  ContentElementSchema,
  ContentItemSchema,
  ContentBlockSchema,
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

describe("ContentBlockSchema", () => {
  describe("basic content blocks", () => {
    it("accepts minimal content block", () => {
      const block = {
        type: "content" as const,
        content: [{ h1: [{ str: "Title" }] }],
      };
      expect(ContentBlockSchema.parse(block)).toMatchObject(block);
    });

    it("accepts content block with id", () => {
      const block = {
        type: "content" as const,
        id: "intro",
        content: [{ p: [{ str: "Text" }] }],
      };
      expect(ContentBlockSchema.parse(block)).toMatchObject(block);
    });

    it("accepts content block with className", () => {
      const block = {
        type: "content" as const,
        className: "card shadow",
        content: [{ p: [{ str: "Text" }] }],
      };
      expect(ContentBlockSchema.parse(block)).toMatchObject(block);
    });

    it("accepts content block with style", () => {
      const block = {
        type: "content" as const,
        style: "padding: 20px; background: #f5f5f5;",
        content: [{ p: [{ str: "Text" }] }],
      };
      expect(ContentBlockSchema.parse(block)).toMatchObject(block);
    });
  });

  describe("complex content blocks", () => {
    it("accepts multiple content items", () => {
      const block = {
        type: "content" as const,
        id: "article",
        content: [
          { h1: [{ str: "Article Title" }] },
          { p: [{ str: "First paragraph" }] },
          { p: [{ str: "Second paragraph" }] },
          { blockquote: [{ str: "A quote" }] },
        ],
      };
      expect(ContentBlockSchema.parse(block)).toMatchObject(block);
    });

    it("accepts mixed content with dynamic properties", () => {
      const block = {
        type: "content" as const,
        id: "user-profile",
        content: [
          { h2: [{ str: "User Profile" }] },
          {
            p: [{ str: "Name: " }, { property: "userName", else: "Unknown" }],
          },
          {
            p: [
              { str: "Email: " },
              { property: "userEmail", else: "Not provided" },
            ],
          },
        ],
      };
      expect(ContentBlockSchema.parse(block)).toMatchObject(block);
    });

    it("accepts content with media", () => {
      const block = {
        type: "content" as const,
        content: [
          { h1: [{ str: "Gallery" }] },
          {
            img: [
              {
                src: "https://example.com/photo1.jpg",
                alt: "Photo 1",
                width: "100%",
              },
            ],
          },
          {
            img: [
              {
                src: "https://example.com/photo2.jpg",
                alt: "Photo 2",
                width: "100%",
              },
            ],
          },
        ],
      };
      expect(ContentBlockSchema.parse(block)).toMatchObject(block);
    });

    it("accepts content with lists", () => {
      const block = {
        type: "content" as const,
        content: [
          { h2: [{ str: "Features" }] },
          {
            ul: [
              { li: [{ str: "Feature 1" }] },
              { li: [{ str: "Feature 2" }] },
              { li: [{ str: "Feature 3" }] },
            ],
          },
        ],
      };
      expect(ContentBlockSchema.parse(block)).toMatchObject(block);
    });

    it("accepts content with links", () => {
      const block = {
        type: "content" as const,
        content: [
          { p: [{ str: "Visit our " }] },
          {
            a: [
              {
                str: "website",
                href: "https://example.com",
                target: "_blank",
              },
            ],
          },
          { p: [{ str: " for more information." }] },
        ],
      };
      expect(ContentBlockSchema.parse(block)).toMatchObject(block);
    });

    it("accepts content with embedded iframe", () => {
      const block = {
        type: "content" as const,
        content: [
          { h2: [{ str: "Tutorial Video" }] },
          {
            iframe: [
              {
                src: "https://www.youtube.com/embed/VIDEO_ID",
                width: "560",
                height: "315",
              },
            ],
          },
        ],
      };
      expect(ContentBlockSchema.parse(block)).toMatchObject(block);
    });
  });

  describe("validation", () => {
    it('requires type to be "content"', () => {
      expect(() =>
        ContentBlockSchema.parse({
          type: "invalid",
          content: [],
        })
      ).toThrow();
    });

    it("requires content array", () => {
      expect(() =>
        ContentBlockSchema.parse({
          type: "content",
        })
      ).toThrow();
    });

    it("accepts empty content array", () => {
      const block = {
        type: "content" as const,
        content: [],
      };
      expect(ContentBlockSchema.parse(block)).toMatchObject(block);
    });
  });

  describe("real-world examples", () => {
    it("parses intro section", () => {
      const block = {
        type: "content" as const,
        id: "intro",
        className: "intro-section",
        content: [
          { h1: [{ str: "Welcome" }] },
          {
            p: [{ str: "This is " }, { property: "siteName", else: "my site" }],
          },
          {
            img: [
              {
                src: "https://example.com/image.jpg",
                alt: "Example image",
              },
            ],
          },
        ],
      };
      expect(ContentBlockSchema.parse(block)).toMatchObject(block);
    });

    it("parses styled card", () => {
      const block = {
        type: "content" as const,
        id: "card",
        className: "card shadow-lg",
        style: "padding: 2rem; border-radius: 8px;",
        content: [
          {
            h3: [
              {
                str: "Card Title",
                classList: "text-primary font-bold",
              },
            ],
          },
          {
            p: [
              {
                str: "Card description goes here.",
                style: "color: #666;",
              },
            ],
          },
          {
            a: [
              {
                str: "Learn More →",
                href: "https://example.com/details",
                target: "_blank",
                classList: "btn btn-primary",
              },
            ],
          },
        ],
      };
      expect(ContentBlockSchema.parse(block)).toMatchObject(block);
    });
  });
});
