# Deno Backend for Tauri App Example

`deno-backend` is in a separate repository because of `deno compile`'s limitation.

If `deno compile` is in a directory with `package.json` and `node_modules`, it will bundle the entire `node_modules` into the binary.

Bun doesn't have this problem, so it can be placed together with nodejs in [`backend/`](./backend/).

## Manual Testing

Run the Deno backend directly:

```bash
deno task dev
```

Build the standalone Deno sidecar binary used by the Tauri example:

```bash
deno task build
```

### What To Verify

- `deno task dev` should start `main.ts` without import or permission errors.
- `deno task build` should produce the `deno` binary in this directory.
- The built binary is consumed by `examples/tauri-demo` when its sidecars are rebuilt.

### Troubleshooting

- Run commands from `examples/deno-backend` so `deno.json` imports resolve correctly.
- The build task uses `--unstable-kv -A` because this backend demonstrates Deno KV and is intended to run as a sidecar.
