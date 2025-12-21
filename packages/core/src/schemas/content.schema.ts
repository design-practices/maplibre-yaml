/**
 * @file Content schemas for maplibre-yaml
 * @module @maplibre-yaml/core/schemas/content
 *
 * @description
 * Zod schemas for non-map content blocks including text, images, iframes,
 * and other HTML elements with dynamic property interpolation.
 *
 * @example
 * ```typescript
 * import { ContentBlockSchema } from '@maplibre-yaml/core/schemas';
 * ```
 */

import { z } from "zod";

/**
 * Valid HTML tag names for content elements.
 *
 * @remarks
 * Supports common HTML elements for rich content rendering.
 * Use semantic tags for better accessibility and SEO.
 *
 * **Heading Tags:** h1, h2, h3, h4, h5, h6
 * **Text Tags:** p, span, div, strong, em, code, pre
 * **Link Tag:** a
 * **Media Tags:** img, iframe
 * **List Tags:** ul, ol, li
 * **Other Tags:** blockquote, hr, br
 */
export const ValidTagNames = [
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "p",
  "span",
  "div",
  "a",
  "strong",
  "em",
  "code",
  "pre",
  "img",
  "iframe",
  "ul",
  "ol",
  "li",
  "blockquote",
  "hr",
  "br",
] as const;

/**
 * Content element with styling and dynamic properties.
 *
 * @remarks
 * Defines a single element within content. Supports both static and
 * dynamic values via property interpolation.
 *
 * **Core Properties:**
 * - `str` - Static text string
 * - `property` - Feature/context property name
 * - `else` - Fallback value if property is missing
 *
 * **Styling:**
 * - `classList` - CSS class names (space-separated or array)
 * - `id` - Element ID
 * - `style` - Inline CSS styles
 *
 * **Links (a tag):**
 * - `href` - URL
 * - `target` - Link target (_blank, _self, etc.)
 *
 * **Media (img, iframe):**
 * - `src` - Source URL
 * - `alt` - Alternative text (img)
 * - `width` - Width (pixels or %)
 * - `height` - Height (pixels or %)
 *
 * @example Static Text
 * ```yaml
 * - str: "Welcome to our site"
 * ```
 *
 * @example Dynamic Property
 * ```yaml
 * - property: "userName"
 *   else: "Guest"
 * ```
 *
 * @example Styled Element
 * ```yaml
 * - str: "Important"
 *   classList: "text-bold text-red"
 *   style: "font-size: 18px;"
 * ```
 *
 * @example Link
 * ```yaml
 * - str: "Learn more"
 *   href: "https://example.com"
 *   target: "_blank"
 * ```
 *
 * @example Image
 * ```yaml
 * - src: "https://example.com/photo.jpg"
 *   alt: "Photo description"
 *   width: "100%"
 * ```
 */
export const ContentElementSchema = z
  .object({
    // Content
    str: z.string().optional().describe("Static text string"),
    property: z.string().optional().describe("Dynamic property from context"),
    else: z.string().optional().describe("Fallback value if property missing"),

    // Styling
    classList: z
      .union([z.string(), z.array(z.string())])
      .optional()
      .describe("CSS class names (space-separated string or array)"),
    id: z.string().optional().describe("Element ID attribute"),
    style: z.string().optional().describe("Inline CSS styles"),

    // Links
    href: z.string().url().optional().describe("Link URL"),
    target: z
      .string()
      .optional()
      .describe("Link target (_blank, _self, _parent, _top)"),

    // Media
    src: z.string().url().optional().describe("Source URL for img or iframe"),
    alt: z.string().optional().describe("Alternative text for images"),
    width: z
      .union([z.string(), z.number()])
      .optional()
      .describe("Width (pixels or %)"),
    height: z
      .union([z.string(), z.number()])
      .optional()
      .describe("Height (pixels or %)"),
  })
  .passthrough()
  .describe("Content element with styling and properties");

/** Inferred type for content element. */
export type ContentElement = z.infer<typeof ContentElementSchema>;

/**
 * Content item mapping tag name to element array.
 *
 * @remarks
 * Each content item is a record where the key is an HTML tag name
 * and the value is an array of content elements to render inside that tag.
 *
 * @example
 * ```yaml
 * - h1:
 *     - str: "Page Title"
 * - p:
 *     - str: "Welcome, "
 *     - property: "userName"
 *       else: "Guest"
 * ```
 */
export const ContentItemSchema = z
  .record(z.enum(ValidTagNames), z.array(ContentElementSchema))
  .describe("Content item mapping tag to elements");

/** Inferred type for content item. */
export type ContentItem = z.infer<typeof ContentItemSchema>;

/**
 * Content block for rich text and media.
 *
 * @remarks
 * Content blocks allow you to add non-map content to your pages.
 * They render as HTML with support for dynamic property interpolation.
 *
 * **Use Cases:**
 * - Introductory text
 * - Explanatory sections
 * - Embedded images and videos
 * - Interactive elements
 * - Mixed content layouts
 *
 * **Properties are resolved from:**
 * 1. Page-level context (passed to renderer)
 * 2. Global configuration
 * 3. URL query parameters (if configured)
 *
 * @example Basic Text Content
 * ```yaml
 * type: content
 * id: intro
 * content:
 *   - h1:
 *       - str: "Welcome"
 *   - p:
 *       - str: "This is a simple text block."
 * ```
 *
 * @example Dynamic Content
 * ```yaml
 * type: content
 * id: user-info
 * className: user-section
 * content:
 *   - h2:
 *       - str: "User Profile"
 *   - p:
 *       - str: "Name: "
 *       - property: "userName"
 *         else: "Unknown"
 *   - p:
 *       - str: "Location: "
 *       - property: "userCity"
 *         else: "Not specified"
 * ```
 *
 * @example Rich Content with Media
 * ```yaml
 * type: content
 * id: article
 * content:
 *   - h1:
 *       - str: "Article Title"
 *   - img:
 *       - src: "https://example.com/header.jpg"
 *         alt: "Header image"
 *         width: "100%"
 *   - p:
 *       - str: "Article text goes here..."
 *   - blockquote:
 *       - str: "An inspiring quote."
 *   - a:
 *       - str: "Read more"
 *         href: "https://example.com/full-article"
 *         target: "_blank"
 * ```
 *
 * @example Styled Content
 * ```yaml
 * type: content
 * id: styled
 * className: "card shadow"
 * style: "padding: 20px; background: #f5f5f5;"
 * content:
 *   - h3:
 *       - str: "Card Title"
 *         classList: "text-primary"
 *   - p:
 *       - str: "Card content"
 * ```
 *
 * @example List Content
 * ```yaml
 * type: content
 * id: features
 * content:
 *   - h2:
 *       - str: "Features"
 *   - ul:
 *       - li:
 *           - str: "Fast rendering"
 *       - li:
 *           - str: "Easy configuration"
 *       - li:
 *           - str: "Fully customizable"
 * ```
 *
 * @example Embedded Content
 * ```yaml
 * type: content
 * id: video
 * content:
 *   - h2:
 *       - str: "Tutorial Video"
 *   - iframe:
 *       - src: "https://www.youtube.com/embed/VIDEO_ID"
 *         width: "560"
 *         height: "315"
 * ```
 */
export const ContentBlockSchema = z
  .object({
    type: z.literal("content").describe("Block type"),
    id: z.string().optional().describe("Unique block identifier"),
    className: z
      .string()
      .optional()
      .describe("CSS class name for the block container"),
    style: z
      .string()
      .optional()
      .describe("Inline CSS styles for the block container"),
    content: z
      .array(ContentItemSchema)
      .describe("Array of content items to render"),
  })
  .describe("Content block for rich text and media");

/** Inferred type for content block. */
export type ContentBlock = z.infer<typeof ContentBlockSchema>;
