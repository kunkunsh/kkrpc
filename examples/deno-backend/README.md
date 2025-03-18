# Deno Backend for Tauri App Example

`deno-backend` is in a separate repository because of `deno compile`'s limitation.

If `deno compile` is in a directory with `package.json` and `node_modules`, it will bundle the entire `node_modules` into the binary.

Bun doesn't have this problem, so it can be placed together with nodejs in [`backend/`](./backend/).
