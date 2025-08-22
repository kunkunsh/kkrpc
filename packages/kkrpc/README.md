# kkrpc

> This project is created for building extension system for a Tauri app (https://github.com/kunkunsh/kunkun).
>
> It can potentially be used in other types of apps, so I open sourced it as a standalone package.

[![NPM Version](https://img.shields.io/npm/v/kkrpc)](https://www.npmjs.com/package/kkrpc)
[![JSR Version](https://jsr.io/badges/@kunkun/kkrpc)](https://jsr.io/@kunkun/kkrpc)
![GitHub last commit](https://img.shields.io/github/last-commit/kunkunsh/kkrpc)

> A TypeScript-first RPC library that enables seamless bi-directional communication between processes.
> Call remote functions as if they were local, with full TypeScript type safety and autocompletion support.

- [JSR Package](https://jsr.io/@kunkun/kkrpc)
- [NPM Package](https://www.npmjs.com/package/kkrpc)
- [Documentation by JSR](https://jsr.io/@kunkun/kkrpc/doc)
- [Typedoc Documentation](https://kunkunsh.github.io/kkrpc/)

[Excalidraw Diagrams](https://excalidraw.com/#json=xp6GbAJVAx3nU-h3PhaxW,oYBNvYmCRsQ2XR3MQo73Ug)

<img src="https://imgur.com/vR3Lmv0.png" style="max-height: 200px;"/>
<img src="https://i.imgur.com/zmOHNfu.png" style="max-height: 250px;"/>
<img src="https://imgur.com/u728aVv.png" style="max-height: 400px;"/>
<img src="https://i.imgur.com/Gu7jH1v.png" style="max-height: 300px;"/>

## Supported Environments

- stdio: RPC over stdio between any combinations of Node.js, Deno, Bun processes
- web: RPC over `postMessage` API and message channel between browser main thread and web workers, or main thread and iframe
  - Web Worker API (web standard) is also supported in Deno and Bun, the main thread can call functions in worker and vice versa.
- http: RPC over HTTP like tRPC
  - supports any HTTP server (e.g. hono, bun, nodejs http, express, fastify, deno, etc.)
- WebSocket: RPC over WebSocket

The core of **kkrpc** design is in `RPCChannel` and `IoInterface`.

- `RPCChannel` is the bidirectional RPC channel
- `LocalAPI` is the APIs to be exposed to the other side of the channel
- `RemoteAPI` is the APIs exposed by the other side of the channel, and callable on the local side
- `rpc.getAPI()` returns an object that is `RemoteAPI` typed, and is callable on the local side like a normal local function call.
- `IoInterface` is the interface for implementing the IO for different environments. The implementations are called adapters.
  - For example, for a Node process to communicate with a Deno process, we need `NodeIo` and `DenoIo` adapters which implements `IoInterface`. They share the same stdio pipe (`stdin/stdout`).
  - In web, we have `WorkerChildIO` and `WorkerParentIO` adapters for web worker, `IframeParentIO` and `IframeChildIO` adapters for iframe.

> In browser, import from `kkrpc/browser` instead of `kkrpc`, Deno adapter uses node:buffer which doesn't work in browser.

```ts
interface IoInterface {
	name: string
	read(): Promise<Buffer | Uint8Array | string | null> // Reads input
	write(data: string): Promise<void> // Writes output
}

class RPCChannel<
	LocalAPI extends Record<string, any>,
	RemoteAPI extends Record<string, any>,
	Io extends IoInterface = IoInterface
> {}
```

## Serialization

kkrpc supports two serialization formats for message transmission:

- `json`: Standard JSON serialization
- `superjson`: Enhanced JSON serialization with support for more data types like Date, Map, Set, BigInt, and Uint8Array (default since v0.2.0)

You can specify the serialization format when creating a new RPCChannel:

```ts
// Using default serialization (superjson)
const rpc = new RPCChannel(io, { expose: apiImplementation })

// Explicitly using superjson serialization (recommended for clarity)
const rpc = new RPCChannel(io, {
	expose: apiImplementation,
	serialization: { version: "superjson" }
})

// Using standard JSON serialization (for backward compatibility)
const rpc = new RPCChannel(io, {
	expose: apiImplementation,
	serialization: { version: "json" }
})
```

For backward compatibility, the receiving side will automatically detect the serialization format so older clients can communicate with newer servers and vice versa.

## Examples

Below are simple examples.

### Stdio Example

```ts
import { NodeIo, RPCChannel } from "kkrpc"
import { apiMethods } from "./api.ts"

const stdio = new NodeIo(process.stdin, process.stdout)
const child = new RPCChannel(stdio, { expose: apiMethods })
```

```ts
import { spawn } from "child_process"

const worker = spawn("bun", ["scripts/node-api.ts"])
const io = new NodeIo(worker.stdout, worker.stdin)
const parent = new RPCChannel<{}, API>(io)
const api = parent.getAPI()

expect(await api.add(1, 2)).toBe(3)
```

### Web Worker Example

```ts
import { RPCChannel, WorkerChildIO, type DestroyableIoInterface } from "kkrpc"

const worker = new Worker(new URL("./scripts/worker.ts", import.meta.url).href, { type: "module" })
const io = new WorkerChildIO(worker)
const rpc = new RPCChannel<API, API, DestroyableIoInterface>(io, { expose: apiMethods })
const api = rpc.getAPI()

expect(await api.add(1, 2)).toBe(3)
```

```ts
import { RPCChannel, WorkerParentIO, type DestroyableIoInterface } from "kkrpc"

const io: DestroyableIoInterface = new WorkerChildIO()
const rpc = new RPCChannel<API, API, DestroyableIoInterface>(io, { expose: apiMethods })
const api = rpc.getAPI()

const sum = await api.add(1, 2)
expect(sum).toBe(3)
```

### HTTP Example

Codesandbox: https://codesandbox.io/p/live/4a349334-0b04-4352-89f9-cf1955553ae7

#### `api.ts`

Define API type and implementation.

```ts
export type API = {
	echo: (message: string) => Promise<string>
	add: (a: number, b: number) => Promise<number>
}

export const api: API = {
	echo: (message) => {
		return Promise.resolve(message)
	},
	add: (a, b) => {
		return Promise.resolve(a + b)
	}
}
```

#### `server.ts`

Server only requires a one-time setup, then it won't need to be touched again.
All the API implementation is in `api.ts`.

```ts
import { HTTPServerIO, RPCChannel } from "kkrpc"
import { api, type API } from "./api"

const serverIO = new HTTPServerIO()
const serverRPC = new RPCChannel<API, API>(serverIO, { expose: api })

const server = Bun.serve({
	port: 3000,
	async fetch(req) {
		const url = new URL(req.url)
		if (url.pathname === "/rpc") {
			const res = await serverIO.handleRequest(await req.text())
			return new Response(res, {
				headers: { "Content-Type": "application/json" }
			})
		}
		return new Response("Not found", { status: 404 })
	}
})
console.log(`Start server on port: ${server.port}`)
```

#### `client.ts`

```ts
import { HTTPClientIO, RPCChannel } from "kkrpc"
import { api, type API } from "./api"

const clientIO = new HTTPClientIO({
	url: "http://localhost:3000/rpc"
})
const clientRPC = new RPCChannel<{}, API>(clientIO, { expose: api })
const clientAPI = clientRPC.getAPI()

const echoResponse = await clientAPI.echo("hello")
console.log("echoResponse", echoResponse)

const sum = await clientAPI.add(2, 3)
console.log("Sum: ", sum)
```

### Chrome Extension Example

For Chrome extensions, use the dedicated `ChromePortIO` adapter for reliable, port-based communication.

#### `background.ts`

```ts
import { ChromePortIO, RPCChannel } from "kkrpc/chrome-extension";
import type { BackgroundAPI, ContentAPI } from "./types";

const backgroundAPI: BackgroundAPI = {
  async getExtensionVersion() {
    return chrome.runtime.getManifest().version;
  },
};

chrome.runtime.onConnect.addListener((port) => {
  if (port.name === "content-to-background") {
    const io = new ChromePortIO(port);
    const rpc = new RPCChannel(io, { expose: backgroundAPI });
    // Handle disconnect
    port.onDisconnect.addListener(() => io.destroy());
  }
});
```

#### `content.ts`

```ts
import { ChromePortIO, RPCChannel } from "kkrpc/chrome-extension";
import type { BackgroundAPI, ContentAPI } from "./types";

const contentAPI: ContentAPI = {
  async getPageTitle() {
    return document.title;
  },
};

const port = chrome.runtime.connect({ name: "content-to-background" });
const io = new ChromePortIO(port);
const rpc = new RPCChannel<ContentAPI, BackgroundAPI>(io, { expose: contentAPI });

const backgroundAPI = rpc.getAPI();

// Example call
backgroundAPI.getExtensionVersion().then(version => {
  console.log("Extension version:", version);
});
```

**Chrome Extension Features:**
- **Port-based**: Uses `chrome.runtime.Port` for stable, long-lived connections.
- **Bidirectional**: Both sides can expose and call APIs.
- **Type-safe**: Full TypeScript support for your APIs.
- **Reliable**: Handles connection lifecycle and cleanup.

### Tauri Example

Call functions in bun/node/deno processes from Tauri app with JS/TS.

It allows you to call any JS/TS code in Deno/Bun/Node processes from Tauri app, just like using Electron.

Seamless integration with Tauri's official shell plugin and [unlocked shellx plugin](https://github.com/HuakunShen/tauri-plugin-shellx).

```ts
import { RPCChannel, TauriShellStdio } from "kkrpc/browser"
import { Child, Command } from "@tauri-apps/plugin-shell"

const localAPIImplementation = {
	add: (a: number, b: number) => Promise.resolve(a + b)
}

async function spawnCmd(runtime: "deno" | "bun" | "node") {
	let cmd: Command<string>
	let process = Child | null = null

	if (runtime === "deno") {
		cmd = Command.create("deno", ["run", "-A", scriptPath])
		process = await cmd.spawn()
	} else if (runtime === "bun") {
		cmd = Command.create("bun", [scriptPath])
		process = await cmd.spawn()
	} else if (runtime === "node") {
		cmd = Command.create("node", [scriptPath])
		process = await cmd.spawn()
	} else {
		throw new Error(`Invalid runtime: ${runtime}, pick either deno or bun`)
	}

	// monitor stdout/stderr/close/error for debugging and error handling
	cmd.stdout.on("data", (data) => {
		console.log("stdout", data)
	})
	cmd.stderr.on("data", (data) => {
		console.warn("stderr", data)
	})
	cmd.on("close", (code) => {
		console.log("close", code)
	})
	cmd.on("error", (err) => {
		console.error("error", err)
	})

	const stdio = new TauriShellStdio(cmd.stdout, process)
	const stdioRPC = new RPCChannel<typeof localAPIImplementation, RemoteAPI>(stdio, {
		expose: localAPIImplementation
	})

	const api = stdioRPC.getAPI();
	await api
		.add(1, 2)
		.then((result) => {
			console.log("result", result)
		})
		.catch((err) => {
			console.error(err)
		})

	process?.kill()
}
```

I provided a sample tauri app in `examples/tauri-demo`.

![Sample Tauri App](https://i.imgur.com/nkDwRHk.png)
