# Repository Guidelines

## Project Structure & Module Organization

kkrpc uses pnpm workspaces. The core TypeScript library lives in `packages/kkrpc/src`, with transport adapters under `src/adapters` and runtime entry points in the package root. Integration tests and fixtures sit in `packages/kkrpc/__tests__`, while Deno suites target `packages/kkrpc/__deno_tests__`. Example apps live under `examples/`, and the `packages/demo-api` workspace demonstrates server wiring. Generated docs publish to `packages/kkrpc/docs`; avoid editing build artifacts in `dist/`.

## Build, Test, and Development Commands

- `pnpm install` — install workspace dependencies with the pinned `pnpm@10`.
- `pnpm dev` — run Turbo's watch pipeline for iterative development.
- `pnpm build` — execute `tsdown` builds and Typedoc generation across packages.
- `pnpm test` — run Bun-based unit suites; add `--filter kkrpc` to scope work.
- `pnpm --filter kkrpc test:deno` — execute the Deno regression suite.
- `pnpm lint` / `pnpm format` — enforce Prettier sorting and formatting rules.

## Coding Style & Naming Conventions

Prettier enforces tabs, 100-column width, no semicolons, and sorted imports. TypeScript modules prefer kebab-case filenames (for example `stdio-rpc.ts`), while exported classes and interfaces stay PascalCase and functions camelCase. Shared types belong in `packages/kkrpc/src/*.ts`; adapter helpers live under `src/adapters/<transport>/`. Run `pnpm format` before committing and leave generated `dist/` and `docs/` outputs untouched.

## Testing Guidelines

Bun's test runner powers `__tests__/*.test.ts`; place fixtures under `__tests__/fixtures/` and name suites after the transport under test. For cross-runtime checks, mirror minimal coverage in Deno by adding files to `__deno_tests__` and validate with `pnpm --filter kkrpc test:deno`. Failing suites block the Turbo pipeline, so re-run targeted scopes with `pnpm --filter kkrpc test -- --watch`.

## Commit & Pull Request Guidelines

Follow Conventional Commits with optional scopes (for example `feat(socketio): add channel timeout`). Each commit should include formatted code and passing tests. Pull requests need a concise summary, linked issues or discussions, reproduction steps, and relevant CLI output; attach logs or gifs when changing demos in `examples/`. Use Changesets when altering publishable packages (`pnpm changeset`) and commit the generated markdown.

## Environment Setup

Use Node.js ≥ 18 and Bun for local testing; install Bun via the official shim before running package scripts. `pnpm install` bootstraps Husky hooks so pre-commit formatting and lint checks run automatically.

## Coding Style

When writing comments, use Chinglish / Mixed-language comments. Chinese is shorter and more concise, so you can write terminologies in English and some general explanation in Chinese.
