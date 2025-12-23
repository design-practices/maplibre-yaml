// docs/astro.config.mjs
import { defineConfig } from "astro/config";
import starlight from "@astrojs/starlight";

export default defineConfig({
  site: "https://design-practices.github.io",
  base: "/maplibre-yaml",
  integrations: [
    starlight({
      title: "maplibre-yaml",
      description: "Declarative web maps with YAML configuration",

      logo: {
        src: "./src/assets/logo.svg",
        replacesTitle: false,
      },

      social: {
        github: "https://github.com/design-practices/maplibre-yaml",
      },

      editLink: {
        baseUrl:
          "https://github.com/design-practices/maplibre-yaml/edit/main/docs/",
      },

      tableOfContents: {
        minHeadingLevel: 2,
        maxHeadingLevel: 4,
      },

      sidebar: [
        {
          label: "Getting Started",
          items: [
            { label: "Introduction", link: "/getting-started/introduction/" },
            { label: "Installation", link: "/getting-started/installation/" },
            { label: "Quick Start", link: "/getting-started/quick-start/" },
            { label: "Your First Map", link: "/getting-started/first-map/" },
          ],
        },
        {
          label: "Guides",
          items: [
            { label: "Working with Layers", link: "/guides/layers/" },
            { label: "Data Sources", link: "/guides/data-sources/" },
            { label: "Interactivity", link: "/guides/interactivity/" },
            { label: "Live Data & Streaming", link: "/guides/live-data/" },
            { label: "Scrollytelling", link: "/guides/scrollytelling/" },
            { label: "Styling & Theming", link: "/guides/styling/" },
          ],
        },
        {
          label: "YAML Schema",
          items: [
            { label: "Overview", link: "/schema/overview/" },
            { label: "Root Configuration", link: "/schema/root/" },
            { label: "Pages & Blocks", link: "/schema/pages/" },
            { label: "Map Configuration", link: "/schema/map-config/" },
            { label: "Data Sources", link: "/schema/sources/" },
            { label: "Layer Types", link: "/schema/layers/" },
            { label: "Interactivity", link: "/schema/interactivity/" },
            { label: "Scrollytelling", link: "/schema/scrollytelling/" },
          ],
        },
        {
          label: "Integrations",
          items: [
            { label: "Vanilla JavaScript", link: "/integrations/vanilla/" },
            { label: "Astro", link: "/integrations/astro/" },
            { label: "Web Components", link: "/integrations/web-components/" },
          ],
        },
        {
          label: "API Reference",
          autogenerate: { directory: "api" },
        },
        {
          label: "Examples",
          items: [
            { label: "Basic Map", link: "/examples/basic-map/" },
            { label: "Choropleth", link: "/examples/choropleth/" },
            { label: "Live Dashboard", link: "/examples/live-dashboard/" },
            { label: "Story Map", link: "/examples/story-map/" },
          ],
        },
      ],

      head: [
        // MapLibre GL CSS
        {
          tag: "link",
          attrs: {
            rel: "stylesheet",
            href: "https://unpkg.com/maplibre-gl@4.1.0/dist/maplibre-gl.css",
          },
        },
      ],

      customCss: ["./src/styles/custom.css"],

      components: {
        // Override components if needed
      },

      lastUpdated: true,

      pagination: true,

      favicon: "/favicon.svg",
    }),
  ],
});
