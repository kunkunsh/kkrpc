# Tauri Demo

**Generated:** 2026-02-03
**Location:** examples/tauri-demo

## OVERVIEW

Tauri desktop app demonstrating kkrpc for calling Bun/Deno/Node.js sidecar processes from a Svelte frontend. Shows how kkrpc replaces Electron's contentBridge pattern in Tauri apps.

## ARCHITECTURE

```
┌─────────────────┐     Tauri Shell API     ┌─────────────────┐
│  Svelte UI      │◄───────────────────────►│  Sidecar Proc   │
│  (WebView)      │   stdin/stdout (stdio)  │  (Bun/Node/Deno)│
└─────────────────┘                         └─────────────────┘
       │
       │ Commands (spawn/kill)
       ▼
┌─────────────────┐
│  Rust Main      │
│  (Tauri Core)   │
└─────────────────┘
```

## STRUCTURE

```
tauri-demo/
├── src/
│   ├── backend/          # Sidecar implementations
│   │   ├── api.ts       # Shared API definition
│   │   ├── bun.ts       # Bun runtime entry
│   │   └── node.ts      # Node.js runtime entry
│   ├── lib/
│   │   └── components/  # Svelte components
│   └── routes/          # SvelteKit routes (+page.svelte)
├── src-tauri/           # Rust Tauri app
│   ├── src/
│   │   ├── main.rs     # Entry point
│   │   └── lib.rs      # Tauri commands
│   ├── Cargo.toml      # Rust deps
│   └── tauri.conf.json # Tauri config
└── sample-script/       # Example scripts to run
```

## KEY FILES

| File                      | Purpose                                  |
| ------------------------- | ---------------------------------------- |
| `src/backend/api.ts`      | API exposed to frontend (DB, math, etc.) |
| `src/backend/bun.ts`      | Bun process entry with stdio RPC         |
| `src/routes/+page.svelte` | Main UI with code examples               |
| `src-tauri/src/lib.rs`    | Rust commands to spawn processes         |
| `sample-script/run.ts`    | Script runner for testing                |

## RUNNING

```bash
# Build monorepo first (from root)
pnpm install
pnpm build

# Run Tauri app
cd examples/tauri-demo
pnpm tauri dev
```

## PATTERNS

### Spawn + RPC Channel

```typescript
import { Command } from "@tauri-apps/plugin-shell"
import { RPCChannel, TauriShellStdio } from "kkrpc/browser"

const cmd = Command.create("deno", ["run", "backend/deno.ts"])
const process = await cmd.spawn()
const stdio = new TauriShellStdio(cmd.stdout, process)
const channel = new RPCChannel(stdio, { expose: { sendNotification } })
const api = channel.getAPI()

await api.initSqlite() // Call sidecar function
```

### Sidecar API Definition

```typescript
// backend/api.ts
export const api = {
	initSqlite: () => {
		/* ... */
	},
	db: {
		query: (sql: string) => {
			/* ... */
		}
	}
}
```

## NOTES

- Uses `TauriShellStdio` adapter for stdin/stdout communication
- Supports Bun, Deno, and Node.js runtimes
- Sidecars can be bundled (binaries/) or system-installed
- ~60MB bundle size when including runtime binary
