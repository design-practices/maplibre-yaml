# Contributing to maplibre-yaml

Thank you for your interest in contributing!

## Development Setup

1. Fork and clone the repository
2. Install dependencies: `pnpm install`
3. Build: `pnpm build`
4. Run tests: `pnpm test`

## Project Structure

```
packages/
├── core/           # @maplibre-yaml/core: schemas, parser, renderer, web components
├── astro/          # @maplibre-yaml/astro: Astro components and loaders
├── cli/            # @maplibre-yaml/cli: init, validate, preview, emit, schema
├── maplibre-yaml/  # maplibre-yaml: runs the CLI as `npx maplibre-yaml@latest`
└── effects/        # @maplibre-yaml/effects: shader effects (experimental)
docs/               # documentation site (Astro + Starlight); design plans in docs/plans/
examples/           # runnable examples
e2e/                # Playwright browser checks (`pnpm verify:browser`)
```

## Making Changes

1. Create a branch: `git checkout -b feature/your-feature`
2. Make your changes
3. Add tests for new functionality
4. Run the full check: `pnpm presubmit` (build, typecheck, lint, test, docs
   snippet check)
5. If a published package changes in a way users can see, add a changeset:
   `pnpm changeset`
6. Commit with conventional commits: `feat: add new feature`
7. Push and open a Pull Request

## Commit Convention

We use [Conventional Commits](https://www.conventionalcommits.org/):

- `feat:` New feature
- `fix:` Bug fix
- `docs:` Documentation
- `chore:` Maintenance
- `test:` Tests
- `refactor:` Refactoring

## Code Style

- TypeScript for all code
- Use Zod for runtime validation
- Export types alongside schemas
- Write tests for new features

## Questions?

Open an issue or discussion on GitHub.