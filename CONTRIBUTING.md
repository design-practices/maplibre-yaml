# Contributing to maplibre-yaml

Thank you for your interest in contributing!

## Development Setup

1. Fork and clone the repository
2. Install dependencies: `pnpm install`
3. Build: `pnpm build`
4. Run tests: `pnpm test`

## Project Structure
packages/
├── core/      # Core library (schemas, parser, renderer)
├── astro/     # Astro integration
└── cli/       # Command-line tools

## Making Changes

1. Create a branch: `git checkout -b feature/your-feature`
2. Make your changes
3. Add tests for new functionality
4. Run tests: `pnpm test`
5. Commit with conventional commits: `feat: add new feature`
6. Push and open a Pull Request

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