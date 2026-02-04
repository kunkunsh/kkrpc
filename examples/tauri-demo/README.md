# Tauri Demo with kkrpc

A Tauri desktop application demonstrating bidirectional RPC between a Svelte frontend and Bun/Deno/Node.js sidecar processes using kkrpc. This demo shows how kkrpc replaces Electron's contentBridge pattern in Tauri apps.

## Overview

This demo features a code editor that can execute JavaScript/TypeScript code in three different runtimes (Bun, Deno, Node.js) through sidecar processes. The frontend communicates with these processes via stdio (stdin/stdout) using kkrpc's type-safe RPC channel.

### Key Features

- **Multi-runtime support**: Execute code in Bun, Deno, or Node.js
- **Live code editor**: Monaco-based editor with syntax highlighting
- **Real-time output**: stdout/stderr display for each execution
- **Type-safe RPC**: Full TypeScript inference across process boundaries
- **ES Module support**: Import and use runtime-specific APIs (e.g., `bun:sqlite`, Deno KV)

## Prerequisites

- **Bun** (latest version)
- **Deno** (latest version)
- **Node.js** (v18+)
- **Rust** toolchain (for Tauri)
- **pnpm** package manager

## Project Structure

```
tauri-demo/
├── src/
│   ├── backend/              # Sidecar implementations
│   │   ├── api.ts           # Shared API definition (eval, etc.)
│   │   ├── bun.ts           # Bun runtime entry point
│   │   └── node.ts          # Node.js runtime entry point
│   ├── lib/
│   │   └── components/      # Svelte UI components
│   ├── routes/              # SvelteKit routes
│   │   ├── +page.svelte     # Main demo page
│   │   └── examples/        # Additional examples (editor, math)
│   └── sample-script/       # Test scripts for each runtime
├── src-tauri/               # Rust Tauri application
│   ├── src/
│   │   ├── main.rs         # Tauri entry point
│   │   └── lib.rs          # Tauri commands
│   └── binaries/           # Compiled sidecar binaries (auto-generated)
└── build.ts                # Build script for sidecar binaries
```

## Quick Start

### 1. Build the Monorepo

First, build the entire kkrpc monorepo from the root directory:

```bash
# From repository root
cd /path/to/kkrpc
pnpm install
pnpm build
```

### 2. Build Sidecar Binaries

The demo requires compiled binaries for each runtime. Build them with:

```bash
cd examples/tauri-demo
bun run build
```

This will:

- Compile the Deno backend (from `../deno-backend/`)
- Bundle and package the Node.js backend using `pkg`
- Compile the Bun backend using `bun build --compile`
- Generate binaries in `src-tauri/binaries/`

**Note**: The first build may take several minutes as `pkg` downloads Node.js binaries.

### 3. Run the Tauri App

```bash
pnpm tauri dev
```

This starts the Tauri development server with hot reload.

## Usage

### Code Editor

1. **Select Runtime**: Choose between Bun, Deno, or Node.js from the dropdown
2. **Write Code**: Enter JavaScript/TypeScript in the editor
3. **Run**: Click the "Run" button to execute in the selected runtime
4. **View Output**: Check stdout/stderr panels for results

### Sample Scripts

Each runtime has a default sample script demonstrating unique features:

- **Deno**: Uses Deno KV for key-value storage
- **Bun**: Demonstrates `bun:sqlite` for in-memory databases
- **Node.js**: Shows Node.js built-in modules (os, crypto, perf_hooks)

### Custom Code Examples

**Basic console.log:**

```javascript
console.log("Hello from the sidecar!")
```

**Bun with SQLite:**

```javascript
import { Database } from "bun:sqlite"

const db = new Database(":memory:")
db.run("CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT)")
db.run("INSERT INTO users (name) VALUES ('Alice')")
const result = db.query("SELECT * FROM users").all()
console.log(result)
```

**Deno with KV:**

```javascript
const kv = await Deno.openKv()
await kv.set(["user", "1"], { name: "Alice", age: 30 })
const entry = await kv.get(["user", "1"])
console.log(entry.value)
```

**Node.js with Crypto:**

```javascript
const { createHash } = require("crypto")
const hash = createHash("sha256")
hash.update("Hello World")
console.log(hash.digest("hex"))
```

## Architecture

### How It Works

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

1. **Frontend** spawns a sidecar process via Tauri's shell API
2. **kkrpc** establishes bidirectional communication over stdio
3. **Frontend** calls `api.eval(code)` to execute code remotely
4. **Sidecar** executes the code and returns results via RPC
5. **stdout/stderr** are streamed back to the frontend for display

### Key Components

**TauriShellStdio Adapter** (`src/routes/+page.svelte`):

```typescript
import { Command } from "@tauri-apps/plugin-shell"
import { RPCChannel, TauriShellStdio } from "kkrpc/browser"

const cmd = Command.sidecar(`binaries/${runtime}`)
const process = await cmd.spawn()
const stdio = new TauriShellStdio(cmd.stdout, process)
const rpc = new RPCChannel(stdio, {})
const api = rpc.getAPI()

// Execute code remotely
await api.eval(code)
```

**API Definition** (`src/backend/api.ts`):

```typescript
export class Api {
	async eval(code: string) {
		// Dynamic import with base64 encoding for ES module support
		const base64 = Buffer.from(code).toString("base64")
		const dataUrl = `data:text/javascript;base64,${base64}`
		return await import(dataUrl)
	}
}
```

## Known Issues & Limitations

### Bun on macOS

Bun has a known issue with stdin on macOS that prevents kkrpc from working properly. The demo will show a warning when Bun is selected on macOS.

**Workaround**: Use Node.js or Deno on macOS.

**Reference**: https://github.com/kunkunsh/kkrpc/issues/11

### Binary Sizes

Compiled binaries are approximately:

- **Bun**: ~57MB
- **Deno**: ~70MB
- **Node.js**: ~67MB

These are bundled into the Tauri app and contribute to the overall app size.

## Development

### Rebuilding Sidecars

If you modify the backend code (`src/backend/*.ts`), rebuild the binaries:

```bash
bun run build
```

### Adding New Runtimes

To add support for another runtime:

1. Create a new backend entry file in `src/backend/`
2. Implement the `Api` class with your methods
3. Add the runtime to the build script (`build.ts`)
4. Update the frontend runtime selector

### Debugging

Enable verbose logging:

```bash
# In the browser console (frontend)
localStorage.debug = 'kkrpc:*'

# For sidecar processes, check stderr output in the UI
```

## Troubleshooting

### "Error: UNEXPECTED-20" (Node.js binary)

This error occurs when the Node.js binary wasn't built correctly with `pkg`. Ensure:

- You're using `@yao-pkg/pkg` version 6.3.2 (pinned in package.json)
- The build completed without errors
- The binary in `src-tauri/binaries/` is executable

### "Unexpected token '{'. import call expects..." (Bun)

This happens when Bun's `eval()` receives ES module syntax. The backend now uses dynamic `import()` with base64 encoding to support imports. If you see this, the backend may not be updated - rebuild with `bun run build`.

### kkrpc JSON appears in stdout

This is expected behavior - both user `console.log` output and kkrpc messages go to stdout. The frontend RPC channel intercepts kkrpc messages automatically.

## License

MIT © kkrpc contributors
