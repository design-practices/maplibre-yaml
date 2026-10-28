/**
 * The pages a playground download puts next to the document: the quick
 * start's page (`/getting-started/quick-start/`) and the story-map page
 * (`/integrations/scrollytelling-html/`), unchanged but for the file they
 * load: `map.yaml`, `map.json` or `map.toml` (`story.*` for a story), after
 * the playground's format.
 *
 * Kept under docs/src so `scripts/sync-cdn-pins.mjs` keeps the
 * `@maplibre-yaml/core@<minor>` pin on the current release with every other
 * pin in the docs (its `--check` run guards it). The maplibre-gl pin matches
 * the quick start's.
 */

/** The map page, loading `file` (`map.yaml`, `map.json`, `map.toml`). */
export const mapPage = (file) => `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <!-- Without this line, phones lay the page out at desktop width and the map looks tiny -->
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>My map</title>
    <link
      href="https://unpkg.com/maplibre-gl@6/dist/maplibre-gl.css"
      rel="stylesheet"
    />
    <!-- Tell the browser where to find maplibre-gl -->
    <script type="importmap">
      { "imports": { "maplibre-gl": "https://unpkg.com/maplibre-gl@6/dist/maplibre-gl.mjs" } }
    </script>
    <!-- Register the <ml-map> element -->
    <script
      type="module"
      src="https://unpkg.com/@maplibre-yaml/core@0.9/register.js"
    ></script>
    <style>
      body {
        margin: 0;
      }
      /* <ml-map> has no size of its own: without a height the map is invisible */
      ml-map {
        display: block;
        width: 100%;
        height: 100vh;
      }
    </style>
  </head>
  <body>
    <ml-map src="./${file}"></ml-map>
  </body>
</html>
`;

/** The story page, loading `file` (`story.yaml`, `story.json`, `story.toml`). */
export const storyPage = (file) => `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>My story map</title>
    <link
      rel="stylesheet"
      href="https://unpkg.com/maplibre-gl@6/dist/maplibre-gl.css"
    />
    <!-- Tell the browser where to find maplibre-gl -->
    <script type="importmap">
      { "imports": { "maplibre-gl": "https://unpkg.com/maplibre-gl@6/dist/maplibre-gl.mjs" } }
    </script>
    <!-- Registers <ml-scrollytelling> (and <ml-map>) -->
    <script
      type="module"
      src="https://unpkg.com/@maplibre-yaml/core@0.9/register.js"
    ></script>
    <style>
      body {
        margin: 0;
        font-family: system-ui, sans-serif;
      }
    </style>
  </head>
  <body>
    <ml-scrollytelling src="${file}"></ml-scrollytelling>
  </body>
</html>
`;

/** How to open the folder. A double-clicked page (file://) can't load the map. */
export function readme(file) {
  return `Your map from the maplibre-yaml playground
==========================================

This folder is a web page: index.html shows the map described in ${file}.
Edit ${file} in any text editor and reload the page to see the change.

To open it, serve the folder with a local web server, from inside it:

    npx serve .              (needs Node.js)
    python3 -m http.server   (needs Python)

then open the address it prints (for example http://localhost:3000).

Double-clicking index.html doesn't work: a page opened from a file:// address
isn't allowed to load ${file}, and the map shows a card that says so.

To publish it, upload the folder to any static host (GitHub Pages, Netlify,
Cloudflare Pages).

Docs: https://docs.maplibre-yaml.org/getting-started/quick-start/
`;
}
