# kkrpc - EXAMPLES

**Generated:** 2026-02-03
**Location:** examples/

## OVERVIEW

10 production-ready examples demonstrating kkrpc across different runtimes, frameworks, and use cases. Each example is a complete working application.

## EXAMPLES

| Example                  | Runtime   | Transport       | Description                                 | Docs                                        |
| ------------------------ | --------- | --------------- | ------------------------------------------- | ------------------------------------------- |
| **chrome-extension**     | Browser   | Chrome Ports    | Extension content↔background communication | [AGENTS.md](./chrome-extension/AGENTS.md)   |
| **deno-backend**         | Deno      | HTTP            | Deno server with HTTP adapter               | -                                           |
| **deno-webworker-demo**  | Deno      | Web Workers     | Deno native worker support                  | -                                           |
| **electron-demo**        | Electron  | IPC + stdio     | Renderer↔Main↔Utility Process             | [AGENTS.md](./electron-demo/AGENTS.md)      |
| **http-demo**            | Bun       | HTTP            | Simple HTTP client/server                   | -                                           |
| **iframe-worker-demo**   | Browser   | iframe + Worker | Cross-frame + Worker communication          | [AGENTS.md](./iframe-worker-demo/AGENTS.md) |
| **nats-demo**            | Node/Deno | NATS            | Message queue integration                   | -                                           |
| **tauri-demo**           | Tauri     | Shell stdio     | Tauri app calling external JS/TS            | [AGENTS.md](./tauri-demo/AGENTS.md)         |
| **transferable-browser** | Browser   | Worker          | Zero-copy ArrayBuffer transfers             | -                                           |

## EXAMPLE STRUCTURE

Each example follows this pattern:

```
example-name/
├── src/              # Source code
├── package.json      # Dependencies
├── README.md         # Example-specific docs
└── [framework files] # vite.config.ts, svelte.config.js, etc.
```

## RUNNING EXAMPLES

```bash
# HTTP demo
cd examples/http-demo && bun run dev

# Tauri demo
cd examples/tauri-demo && pnpm tauri dev

# Electron demo
cd examples/electron-demo && pnpm dev

# Chrome extension
cd examples/chrome-extension && pnpm build
# Load unpacked in chrome://extensions
```

## CONVENTIONS

- **Self-contained**: Each example has its own package.json
- **README**: Every example has setup/running instructions
- **Type-safe**: All examples use full TypeScript
- **Production patterns**: Examples demonstrate real-world usage

## ENTRY POINTS

| Example              | Server Entry                     | Client Entry            |
| -------------------- | -------------------------------- | ----------------------- |
| http-demo            | src/server.ts                    | src/client.ts           |
| electron-demo        | src/main.ts                      | src/renderer.ts         |
| tauri-demo           | src-tauri/src/main.rs + backend/ | src/routes/+page.svelte |
| transferable-browser | src/routes/worker.ts             | src/routes/+page.svelte |

## NOTES

- Tauri demo uses Rust main process calling JS/TS workers
- Electron demo shows secure IPC with contextIsolation
- Transferable-browser shows 40-100x speedup with zero-copy
- Chrome extension demonstrates port-based messaging

## HIERARCHY

```
examples/AGENTS.md
├── chrome-extension/AGENTS.md
├── electron-demo/AGENTS.md
├── iframe-worker-demo/AGENTS.md
└── tauri-demo/AGENTS.md
```
