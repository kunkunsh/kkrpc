---
transition: slide-left
layout: two-cols-header
layoutClass: gap-4
---

# Tauri Sidecar

::left::

### Traditional: Spawn + HTTP/JSON-RPC

```ts
// 1. Spawn process
const cmd = Command.create("deno", ["server.ts"])
const process = await cmd.spawn()

// 2. Start HTTP server in sidecar
// 3. Connect via HTTP/WebSocket
// 4. Manual protocol handling

// OR use stdio with manual JSON-RPC
process.write(
	JSON.stringify({
		jsonrpc: "2.0",
		method: "greet",
		params: ["World"],
		id: 1
	})
)
// Parse response manually...
```

::right::

### With kkRPC (Direct Function Calls)

```ts
// sidecar.ts - Runs in Deno/Bun/Node
import { DenoIo, RPCChannel } from "kkrpc"
import { api } from "./api.ts"

const io = new DenoIo(Deno.stdin.readable)
const rpc = new RPCChannel(io, { expose: api })
```

```ts
// Frontend - TypeScript with full autocomplete
import { Command } from "@tauri-apps/plugin-shell"
import { RPCChannel, TauriShellStdio } from "kkrpc/browser"
import type { api as SidecarAPI } from "./api.ts"

const cmd = Command.create("deno", ["sidecar.ts"])
const process = await cmd.spawn()

const io = new TauriShellStdio(cmd.stdout, process)
const rpc = new RPCChannel<{}, typeof SidecarAPI>(io)
const api = rpc.getAPI()

await api.greet("World") // Direct function call!
```

<!--
Traditionally, if you want to call functions defined in another process in Tauri, you need to spawn the process first, then communicate via STDIO using protocols like JSON RPC or simply run an HTTP server or web socket server in the process.

But spawning an HTTP server comes with real costs: extra memory and CPU usage just for the server, the headache of finding and managing an available port to avoid conflicts, and security concerns if you're not using HTTPS encryption for local communication.

With kkRPC: Just spawn the process and call functions directly. No server setup, no port management, no manual protocol handling, no security concerns about unencrypted local HTTP traffic.

The sidecar exposes its API via stdio using kkRPC, and the frontend gets a fully typed proxy. It's that simple.
-->
