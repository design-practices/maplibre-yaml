# maplibre-yaml docs

The source of [docs.maplibre-yaml.org](https://docs.maplibre-yaml.org), built
with Astro and Starlight and deployed to Cloudflare Pages (see the root
`wrangler.toml`).

| Path | What it holds |
| --- | --- |
| `src/content/docs/` | The pages. `reference/yaml/` and `reference/api/` are generated on every build; don't edit them |
| `public/` | Static files, including the YAML configs the live maps load |
| `scripts/` | Build-time generators and checks (`check-stable-urls.mjs`) |
| `test/` | `pnpm --filter @maplibre-yaml/docs test` |
| `redirects.mjs` | Pages that moved, so old links keep working |
| `STYLE.md` | How to write a page here |
| `plans/`, `brainstorms/` | Design plans and requirements docs for the library (not published) |
| `archive/` | Retired material kept for provenance (not published) |
| `examples/vscode/` | VS Code settings and tasks that the editor-setup page links to |
| `patterns/` | A long-form pattern note; its YAML is checked by `pnpm docs:validate-snippets` |

## Commands

Run from the repository root after `pnpm install && pnpm build`:

```bash
pnpm --filter @maplibre-yaml/docs dev       # http://localhost:4321
pnpm --filter @maplibre-yaml/docs build     # fails on a broken internal link
pnpm --filter @maplibre-yaml/docs preview
node docs/scripts/check-stable-urls.mjs --base http://localhost:4321
```
