# Contributing to cocarr-core-api

Thanks for contributing to the Cocarr platform.

## Branch Strategy
- `main` — protected, always deployable. No direct commits.
- `develop` — integration branch. Feature branches merge here.
- `release` — release-candidate branch, protected.

Create feature branches from `develop` using `feature/<short-description>`.
Bug fixes use `fix/<short-description>`.

## Workflow
1. Fork or branch from `develop`.
2. Make your change with tests and documentation.
3. Ensure lint and tests pass locally.
4. Open a pull request into `develop` using the PR template.
5. At least one approval from a CODEOWNER is required to merge.

## Commit Messages
Follow Conventional Commits: `feat:`, `fix:`, `docs:`, `chore:`, `refactor:`,
`test:`, `ci:`.

## Code Style
Prettier and ESLint configuration ship with the repo. Run them before pushing.

## Reporting Issues
Use the issue templates for bug reports and feature requests.
