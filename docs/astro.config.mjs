// docs/astro.config.mjs
import { defineConfig } from "astro/config";
import starlight from "@astrojs/starlight";
import { generateAgentAssets } from "./scripts/generate-agent-assets.mjs";

/**
 * Regenerate agent-facing assets (hosted JSON Schemas, llms.txt, llms-full.txt)
 * on every dev start and production build, from the core schemas + example
 * configs — so they can never go stale relative to the docs they ship with.
 */
const agentAssets = {
  name: "maplibre-yaml-agent-assets",
  hooks: {
    "astro:config:setup": () => {
      generateAgentAssets();
    },
  },
};

export default defineConfig({
  site: "https://docs.maplibre-yaml.org",
  base: "/",
  integrations: [
    agentAssets,
    starlight({
      title: "maplibre-yaml",
      description: "Declarative web maps with YAML configuration",
      customCss: ["./src/styles/custom.css"],
      logo: {
        src: "./src/assets/houston.webp",
        replacesTitle: false,
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
            { label: "Live Data & Streaming", link: "/guides/live-data/" },
            { label: "Editor Setup", link: "/guides/editor-setup/" },
            { label: "Using AI Agents", link: "/guides/ai-agents/" },
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
            { label: "Vanilla JavaScript", link: "/integrations/vanilla-js/" },
            { label: "Astro", link: "/integrations/astro/" },
            { label: "Web Components", link: "/integrations/web-components/" },
          ],
        },
        {
          label: "CLI Tools",
          items: [
            { label: "Getting Started", link: "/cli/getting-started/" },
            { label: "VSCode Integration", link: "/cli/vscode/" },
            { label: "Command Reference", link: "/cli/reference/" },
          ],
        },
        {
          label: "Examples",
          items: [
            { label: "Overview", link: "/examples/" },
            { label: "Basic Map", link: "/examples/basic-map/" },
            {
              label: "Earthquake Tracker",
              link: "/examples/earthquake-tracker/",
            },
            { label: "Clustered Data", link: "/examples/clustering/" },
            {
              label: "Interactive Points",
              link: "/examples/interactive-points/",
            },
            {
              label: "Live Vehicle Tracking",
              link: "/examples/live-vehicles/",
            },
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
