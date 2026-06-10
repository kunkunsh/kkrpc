# iframe + Web Worker kkrpc Demo

This SvelteKit example demonstrates `kkrpc` communication across iframe boundaries and browser Web Workers.

## Manual Testing

### Start The App

```bash
pnpm install
pnpm dev -- --open
```

### What To Verify

- The browser opens the SvelteKit app.
- The iframe demo can call methods exposed by the parent page and the parent can call methods exposed by the iframe.
- The Web Worker demo can call worker methods and receive responses.
- Browser DevTools should not show unhandled `postMessage` or worker errors.

### Automated Smoke Tests

```bash
pnpm test
pnpm test:e2e
```

`pnpm test` runs unit tests. `pnpm test:e2e` runs Playwright tests against the browser flow.

### Build Check

```bash
pnpm check-types
pnpm build
```

### Troubleshooting

- If Playwright browsers are missing, install them with `pnpm exec playwright install` from this example directory.
- If iframe calls fail, check that the app is served from the Vite dev server rather than opened as a local file.
