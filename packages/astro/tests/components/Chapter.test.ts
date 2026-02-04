/**
 * @file Tests for Chapter component types and integration
 * @module @maplibre-yaml/astro/tests/components/Chapter
 *
 * @description
 * Tests for the Chapter component focusing on:
 * - Type validation for component props
 * - Alignment options
 * - Theme support
 * - Content and media handling
 *
 * Note: Cannot directly import .astro components in vitest, so tests focus
 * on type validation and prop combinations.
 */

import { describe, it, expect } from "vitest";
import type { ChapterProps } from "../../src/types";

describe("Chapter Component Types", () => {
  describe("ChapterProps interface", () => {
    it("should accept required props only", () => {
      const props: ChapterProps = {
        id: "chapter-1",
        title: "Introduction",
      };
      expect(props.id).toBe("chapter-1");
      expect(props.title).toBe("Introduction");
    });

    it("should accept optional description", () => {
      const props: ChapterProps = {
        id: "chapter-2",
        title: "Details",
        description: "<p>This is a detailed chapter.</p>",
      };
      expect(props.description).toBe("<p>This is a detailed chapter.</p>");
    });

    it("should accept image URL", () => {
      const props: ChapterProps = {
        id: "chapter-3",
        title: "Visual Story",
        image: "/images/hero.jpg",
      };
      expect(props.image).toBe("/images/hero.jpg");
    });

    it("should accept video URL", () => {
      const props: ChapterProps = {
        id: "chapter-4",
        title: "Video Chapter",
        video: "/videos/intro.mp4",
      };
      expect(props.video).toBe("/videos/intro.mp4");
    });

    it("should accept both image and video", () => {
      const props: ChapterProps = {
        id: "chapter-5",
        title: "Media Rich",
        image: "/images/poster.jpg",
        video: "/videos/clip.mp4",
      };
      expect(props.image).toBe("/images/poster.jpg");
      expect(props.video).toBe("/videos/clip.mp4");
    });
  });

  describe("Alignment options", () => {
    it("should accept left alignment", () => {
      const props: ChapterProps = {
        id: "left-chapter",
        title: "Left Aligned",
        alignment: "left",
      };
      expect(props.alignment).toBe("left");
    });

    it("should accept right alignment", () => {
      const props: ChapterProps = {
        id: "right-chapter",
        title: "Right Aligned",
        alignment: "right",
      };
      expect(props.alignment).toBe("right");
    });

    it("should accept center alignment", () => {
      const props: ChapterProps = {
        id: "center-chapter",
        title: "Centered",
        alignment: "center",
      };
      expect(props.alignment).toBe("center");
    });

    it("should accept full alignment", () => {
      const props: ChapterProps = {
        id: "full-chapter",
        title: "Full Width",
        alignment: "full",
      };
      expect(props.alignment).toBe("full");
    });

    it("should allow omitting alignment (defaults to center)", () => {
      const props: ChapterProps = {
        id: "default-chapter",
        title: "Default Alignment",
      };
      expect(props.alignment).toBeUndefined();
    });
  });

  describe("Theme options", () => {
    it("should accept light theme", () => {
      const props: ChapterProps = {
        id: "light-chapter",
        title: "Light Theme",
        theme: "light",
      };
      expect(props.theme).toBe("light");
    });

    it("should accept dark theme", () => {
      const props: ChapterProps = {
        id: "dark-chapter",
        title: "Dark Theme",
        theme: "dark",
      };
      expect(props.theme).toBe("dark");
    });

    it("should allow omitting theme (defaults to light)", () => {
      const props: ChapterProps = {
        id: "default-theme",
        title: "Default Theme",
      };
      expect(props.theme).toBeUndefined();
    });
  });

  describe("Hidden and active states", () => {
    it("should accept hidden prop", () => {
      const props: ChapterProps = {
        id: "hidden-chapter",
        title: "Hidden Chapter",
        hidden: true,
      };
      expect(props.hidden).toBe(true);
    });

    it("should accept isActive prop", () => {
      const props: ChapterProps = {
        id: "active-chapter",
        title: "Active Chapter",
        isActive: true,
      };
      expect(props.isActive).toBe(true);
    });

    it("should accept both hidden and isActive", () => {
      const props: ChapterProps = {
        id: "state-chapter",
        title: "State Chapter",
        hidden: false,
        isActive: true,
      };
      expect(props.hidden).toBe(false);
      expect(props.isActive).toBe(true);
    });
  });

  describe("Complete configurations", () => {
    it("should accept minimal configuration", () => {
      const props: ChapterProps = {
        id: "minimal",
        title: "Minimal Chapter",
      };
      expect(props.id).toBe("minimal");
      expect(props.title).toBe("Minimal Chapter");
    });

    it("should accept full configuration with all props", () => {
      const props: ChapterProps = {
        id: "complete-chapter",
        title: "Complete Chapter",
        description: "<p>A complete chapter with all features.</p>",
        image: "/images/chapter.jpg",
        video: "/videos/chapter.mp4",
        alignment: "left",
        hidden: false,
        isActive: true,
        theme: "dark",
      };

      expect(props.id).toBe("complete-chapter");
      expect(props.title).toBe("Complete Chapter");
      expect(props.description).toBeDefined();
      expect(props.image).toBeDefined();
      expect(props.video).toBeDefined();
      expect(props.alignment).toBe("left");
      expect(props.hidden).toBe(false);
      expect(props.isActive).toBe(true);
      expect(props.theme).toBe("dark");
    });

    it("should accept HTML description with various elements", () => {
      const props: ChapterProps = {
        id: "html-chapter",
        title: "Rich HTML",
        description: `
          <p>First paragraph with <strong>bold</strong> and <em>italic</em>.</p>
          <p>Second paragraph with a <a href="#">link</a>.</p>
          <ul>
            <li>List item 1</li>
            <li>List item 2</li>
          </ul>
        `,
      };
      expect(props.description).toContain("<strong>");
      expect(props.description).toContain("<a href");
      expect(props.description).toContain("<ul>");
    });

    it("should accept chapters for scrollytelling narrative", () => {
      const chapters: ChapterProps[] = [
        {
          id: "intro",
          title: "Introduction",
          description: "<p>Welcome to the story.</p>",
          alignment: "center",
          theme: "light",
        },
        {
          id: "detail-1",
          title: "First Detail",
          description: "<p>Exploring the data.</p>",
          image: "/images/detail-1.jpg",
          alignment: "left",
          theme: "light",
        },
        {
          id: "transition",
          title: "Transition",
          hidden: true,
        },
        {
          id: "conclusion",
          title: "Conclusion",
          description: "<p>Summary of findings.</p>",
          alignment: "center",
          theme: "dark",
        },
      ];

      expect(chapters).toHaveLength(4);
      expect(chapters[0].alignment).toBe("center");
      expect(chapters[1].image).toBeDefined();
      expect(chapters[2].hidden).toBe(true);
      expect(chapters[3].theme).toBe("dark");
    });
  });

  describe("Media URL formats", () => {
    it("should accept absolute image URLs", () => {
      const props: ChapterProps = {
        id: "abs-img",
        title: "Absolute Image",
        image: "https://example.com/image.jpg",
      };
      expect(props.image).toMatch(/^https?:\/\//);
    });

    it("should accept relative image URLs", () => {
      const props: ChapterProps = {
        id: "rel-img",
        title: "Relative Image",
        image: "/images/local.jpg",
      };
      expect(props.image).toMatch(/^\//);
    });

    it("should accept absolute video URLs", () => {
      const props: ChapterProps = {
        id: "abs-vid",
        title: "Absolute Video",
        video: "https://example.com/video.mp4",
      };
      expect(props.video).toMatch(/^https?:\/\//);
    });

    it("should accept relative video URLs", () => {
      const props: ChapterProps = {
        id: "rel-vid",
        title: "Relative Video",
        video: "/videos/local.mp4",
      };
      expect(props.video).toMatch(/^\//);
    });
  });

  describe("ID validation", () => {
    it("should accept kebab-case IDs", () => {
      const props: ChapterProps = {
        id: "chapter-one",
        title: "Chapter One",
      };
      expect(props.id).toBe("chapter-one");
    });

    it("should accept snake_case IDs", () => {
      const props: ChapterProps = {
        id: "chapter_one",
        title: "Chapter One",
      };
      expect(props.id).toBe("chapter_one");
    });

    it("should accept numeric IDs", () => {
      const props: ChapterProps = {
        id: "chapter-1",
        title: "Chapter 1",
      };
      expect(props.id).toBe("chapter-1");
    });

    it("should accept simple IDs", () => {
      const props: ChapterProps = {
        id: "intro",
        title: "Introduction",
      };
      expect(props.id).toBe("intro");
    });
  });
});
