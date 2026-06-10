# Example Manual Testing README Design

## Goal

Add clear manual testing instructions to every example README so a maintainer can run each demo without remembering the original setup.

## Scope

Update all 10 example READMEs:

- `examples/chrome-extension/README.md`
- `examples/deno-backend/README.md`
- `examples/deno-webworker-demo/README.md`
- `examples/electron-demo/README.md`
- `examples/http-demo/README.md`
- `examples/iframe-worker-demo/README.md`
- `examples/inspector-demo/README.md`
- `examples/streaming-middleware-demo/README.md`
- `examples/tauri-demo/README.md`
- `examples/transferable-browser/README.md`

## Design

Each README should include a concise `Manual Testing` section with:

- setup or prerequisite notes only when needed
- exact commands to run from the example directory
- what visible output or UI behavior confirms the demo is working
- short troubleshooting notes for likely runtime-specific issues

The docs should preserve existing README content and avoid changing code or package scripts.

## Verification

Run `pnpm --filter "./examples/*" check-types` after the docs edit to ensure no package state regressed. No code behavior is changed, so runtime verification remains manual by design.
