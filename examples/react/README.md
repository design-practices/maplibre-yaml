# `<ml-map>` in React

A Vite + React + TypeScript app that uses `<ml-map>` the documented way, and
the source of the React snippets in the docs
(`docs/src/content/docs/integrations/web-components.mdx`; `pnpm test` here
fails if they differ).

It shows a map from a YAML file with its params panel, one from a config
object, `ml-map:*` events reaching React state, a ref + `mapReady()` reaching
the MapLibre map, React-rendered controls in a map corner (a slot), mount and
unmount under StrictMode with a config assigned from an effect, and the React
19 object `config` + typed `onml-map:*` props. Types come from one line in
`src/vite-env.d.ts`: `/// <reference types="@maplibre-yaml/core/react" />`.

The basemap is local (Natural Earth 1:110m land, public domain, in
`public/data/`), so the app needs no network.

## Run it

From the repo root, after `pnpm install` and `pnpm --filter @maplibre-yaml/core build`:

```bash
pnpm --filter @maplibre-yaml/example-react dev          # React 19, http://localhost:5190
pnpm --filter @maplibre-yaml/example-react dev:react18  # React 18, http://localhost:5191
```

## React 18 and 19 from one source

Both majors are installed side by side under npm aliases (`react-18`,
`react-dom-18`, `react-types-18`, `react-dom-types-18`). `--mode react18`
aliases them into the bundle (see `vite.config.ts`), and
`tsconfig.react18.json` points the type-check at the React 18 types. Code
that only React 19 can run lives behind `#react19-only`, which both swap for
`src/react19/stub.tsx`.

| script | what |
|---|---|
| `build` | all four bundles: `dist/` (19), `dist-dev/` (19, development), `dist-react18/`, `dist-react18-dev/` |
| `typecheck` | `tsc` against `@types/react` 19, then 18 |
| `test` | the docs snippets equal the files here |

The browser suite is `e2e/react-example.spec.ts` at the repo root
(`pnpm verify:browser`, or `REACT_MAJORS=18 pnpm exec playwright test
e2e/react-example.spec.ts`); CI runs it per React major in the
`react-example` job.
