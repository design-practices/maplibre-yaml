# maplibre-yaml

Runs [`@maplibre-yaml/cli`](https://www.npmjs.com/package/@maplibre-yaml/cli),
the maplibre-yaml command line, under a short name, so one-off commands need
no install:

```bash
npx maplibre-yaml init my-map
npx maplibre-yaml validate my-map/map.yaml
```

Every command and flag is the CLI's own: `init`, `validate`, `preview`,
`emit`, `schema` and `bake`. See the
[command reference](https://docs.maplibre-yaml.org/cli/reference/).

For a project, install the CLI itself. That also gives you the short
`mlym` command (`npx mlym …`, or `mlym …` after a global install):

```bash
npm install --save-dev @maplibre-yaml/cli
```

To put maps on a page, see [`@maplibre-yaml/core`](https://www.npmjs.com/package/@maplibre-yaml/core)
and the docs at [docs.maplibre-yaml.org](https://docs.maplibre-yaml.org).
