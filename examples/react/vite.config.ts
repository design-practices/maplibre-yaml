import { defineConfig, type Alias } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

/**
 * One app, two React majors, production and development builds.
 *
 * | command                               | React | build       | outDir              |
 * |---------------------------------------|-------|-------------|---------------------|
 * | `vite build`                          | 19    | production  | dist/               |
 * | `vite build --mode react18`           | 18    | production  | dist-react18/       |
 * | `vite build --mode react19-dev`       | 19    | development | dist-dev/           |
 * | `vite build --mode react18-dev`       | 18    | development | dist-react18-dev/   |
 *
 * React 18 comes from the npm aliases `react-18` / `react-dom-18` (see
 * package.json): the alias below replaces every `react` / `react-dom` import,
 * the app's and react-dom's own alike. Both majors come from one lockfile, so
 * CI and a laptop test exactly the same trees; the page prints
 * `React.version` and the browser suite asserts it.
 *
 * The `-dev` modes load `.env.<mode>`, which sets NODE_ENV=development: React's
 * development build, where StrictMode really double-invokes effects (it is
 * inert in production). The suite runs against all four.
 *
 * React-19-only code (typed `onml-map:*` props, an object `config`) lives
 * behind `#react19-only`, which the React 18 builds swap for a stub, the
 * same swap tsconfig.react18.json makes for the type-check.
 *
 * `base: "./"` keeps asset URLs relative, so the built app also runs from a
 * subdirectory: the repo's hermetic e2e server serves it at
 * /examples/react/dist*\/.
 */
export default defineConfig(({ mode }) => {
  const react18 = mode.startsWith("react18");
  const dev = mode.endsWith("-dev");
  const alias: Alias[] = react18
    ? [
        { find: /^react$/, replacement: "react-18" },
        { find: /^react\/(.*)$/, replacement: "react-18/$1" },
        { find: /^react-dom$/, replacement: "react-dom-18" },
        { find: /^react-dom\/(.*)$/, replacement: "react-dom-18/$1" },
        {
          find: /^#react19-only$/,
          replacement: fileURLToPath(new URL("./src/react19/stub.tsx", import.meta.url)),
        },
      ]
    : [];

  return {
    base: "./",
    plugins: [react()],
    resolve: { alias },
    build: {
      outDir: `dist${react18 ? "-react18" : ""}${dev ? "-dev" : ""}`,
      emptyOutDir: true,
      minify: !dev,
      // maplibre-gl alone is ~1 MB minified; that is expected, not a regression.
      chunkSizeWarningLimit: 4000,
    },
  };
});
