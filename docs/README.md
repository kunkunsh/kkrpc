# kkrpc Documentation Site

This workspace contains the Astro Starlight documentation site for `kkrpc`.

Published site: <https://docs.kkrpc.kunkun.sh/>

## Structure

```text
docs/
├── astro.config.mjs          # Starlight config and sidebar
├── public/                   # Static assets
├── src/content/docs/         # Markdown and MDX documentation pages
│   ├── guides/               # Concepts and usage guides
│   ├── examples/             # Transport-specific examples
│   ├── reference/            # Protocol and design reference
│   └── index.mdx             # Landing page
└── package.json              # Docs scripts and dependencies
```

## Commands

Run from the repository root with pnpm filters:

```bash
pnpm --filter docs dev
pnpm --filter docs build
pnpm --filter docs preview
```

Or run inside `docs/`:

```bash
pnpm dev
pnpm build
pnpm preview
```

`pnpm build` runs `astro check` before generating the static site.

## Content Guidelines

- Document the stable native `Transport<RPCMessage>` API, not removed classic `IoInterface` adapters.
- Keep import examples aligned with package subpaths such as `kkrpc/ws`, `kkrpc/worker`, `kkrpc/validation`, and `kkrpc/relay`.
- Mention optional peer dependencies on pages that require them.
- HTTP examples should be clear that HTTP is unary request/response and does not support callback arguments.
- Use `kkrpc/browser` for browser-specific examples when that makes the runtime boundary explicit.
- Generated output in `dist/` should not be edited manually.

## Related Docs

- Package README: `packages/kkrpc/README.md`
- API reference output: `packages/kkrpc/docs/`
- Migration guide: `src/content/docs/guides/migration-1-0.md`
- Examples: `examples/`
