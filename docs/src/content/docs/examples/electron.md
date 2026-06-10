---
title: Electron
description: Type-safe bidirectional RPC for Electron renderer, main, and utility processes
---

`kkRPC` provides stable transport factories for Electron IPC and utility-process messaging. All helpers are exported from `kkrpc/electron`.

## Communication Patterns

1. Renderer to main process over IPC
2. Main process to utility process over `postMessage`
3. Renderer to external process through a main-process relay

## Imports

```ts
import { RPCChannel } from "kkrpc"
import {
	createSecureIpcBridge,
	electronIpcTransport,
	electronUtilityProcessChildTransport,
	electronUtilityProcessTransport
} from "kkrpc/electron"
```

## Architecture Overview

```text
Renderer <-> Main <-> Utility Process
    IPC      postMessage
```

Each edge is a stable `Transport<RPCMessage>`. Pass the transport to `RPCChannel`, `wrap()`, or `expose()` just like any other kkrpc transport.

## Preload Script Setup

Expose a restricted IPC bridge from preload when `contextIsolation` is enabled.

```ts title="preload.ts"
import { contextBridge, ipcRenderer } from "electron"
import { createSecureIpcBridge } from "kkrpc/electron"

const securedIpcRenderer = createSecureIpcBridge({
	ipcRenderer,
	channelPrefix: "kkrpc:"
})

contextBridge.exposeInMainWorld("electron", {
	ipcRenderer: securedIpcRenderer
})
```

You can also whitelist specific channels.

```ts title="preload.ts"
const securedIpcRenderer = createSecureIpcBridge({
	ipcRenderer,
	allowedChannels: ["kkrpc:main", "kkrpc:external"]
})
```

## API Definition

```ts title="api.ts"
export interface MainAPI {
	showNotification(message: string): Promise<void>
	getAppVersion(): Promise<string>
	pingRenderer(message: string): Promise<string>
}

export interface RendererAPI {
	getRendererInfo(): Promise<{
		userAgent: string
		language: string
		platform: string
	}>
}

export interface WorkerAPI {
	add(a: number, b: number): Promise<number>
	getProcessInfo(): Promise<{
		pid: number
		version: string
		platform: string
	}>
}
```

## Pattern 1: Renderer To Main IPC

### Main Process

```ts title="main.ts"
import { app, BrowserWindow, ipcMain } from "electron"
import { RPCChannel } from "kkrpc"
import { electronIpcTransport } from "kkrpc/electron"
import type { MainAPI, RendererAPI } from "./api"

let rendererAPI: RendererAPI

const mainAPI: MainAPI = {
	async showNotification(message) {
		console.log(`[Main] Notification: ${message}`)
	},
	async getAppVersion() {
		return app.getVersion()
	},
	async pingRenderer(message) {
		const info = await rendererAPI.getRendererInfo()
		return `${message}; renderer platform: ${info.platform}`
	}
}

const win = new BrowserWindow({
	webPreferences: {
		preload: path.join(__dirname, "preload.js"),
		contextIsolation: true,
		nodeIntegration: false
	}
})

const transport = electronIpcTransport({
	endpoint: {
		send: (_channel, message) => win.webContents.send("kkrpc:main", message),
		on: (channel, listener) => ipcMain.on(channel, listener),
		off: (channel, listener) => ipcMain.off(channel, listener)
	},
	channel: "kkrpc:main"
})

const channel = new RPCChannel<MainAPI, RendererAPI>(transport, { expose: mainAPI })
rendererAPI = channel.getAPI()
```

### Renderer Process

```ts title="renderer.ts"
import { RPCChannel } from "kkrpc"
import { electronIpcTransport } from "kkrpc/electron"
import type { MainAPI, RendererAPI } from "./api"

declare global {
	interface Window {
		electron: {
			ipcRenderer: {
				send(channel: string, message: unknown): void
				on(channel: string, listener: (event: unknown, message: unknown) => void): void
				off(channel: string, listener: (event: unknown, message: unknown) => void): void
			}
		}
	}
}

const rendererAPI: RendererAPI = {
	async getRendererInfo() {
		return {
			userAgent: navigator.userAgent,
			language: navigator.language,
			platform: navigator.platform
		}
	}
}

const transport = electronIpcTransport({
	endpoint: window.electron.ipcRenderer,
	channel: "kkrpc:main"
})

const channel = new RPCChannel<RendererAPI, MainAPI>(transport, { expose: rendererAPI })
const mainAPI = channel.getAPI()

await mainAPI.showNotification("Hello from renderer")
const version = await mainAPI.getAppVersion()
```

## Pattern 2: Main To Utility Process

### Main Process

```ts title="main.ts"
import { utilityProcess } from "electron"
import { RPCChannel } from "kkrpc"
import { electronUtilityProcessTransport } from "kkrpc/electron"
import type { MainAPI, WorkerAPI } from "./api"

const workerProcess = utilityProcess.fork(path.join(__dirname, "worker.js"))
const transport = electronUtilityProcessTransport(workerProcess)
const channel = new RPCChannel<MainAPI, WorkerAPI>(transport, { expose: mainAPI })
const workerAPI = channel.getAPI()

console.log(await workerAPI.add(2, 3))
```

### Utility Process

```ts title="worker.ts"
import { RPCChannel } from "kkrpc"
import { electronUtilityProcessChildTransport } from "kkrpc/electron"
import type { MainAPI, WorkerAPI } from "./api"

const workerAPI: WorkerAPI = {
	async add(a, b) {
		return a + b
	},
	async getProcessInfo() {
		return {
			pid: process.pid,
			version: process.version,
			platform: process.platform
		}
	}
}

const transport = electronUtilityProcessChildTransport()
const channel = new RPCChannel<WorkerAPI, MainAPI>(transport, { expose: workerAPI })
const mainAPI = channel.getAPI()

await mainAPI.showNotification("Hello from utility process")
```

## Pattern 3: Renderer To External Process Through Relay

```ts title="main.ts"
import { spawn } from "child_process"
import { ipcMain } from "electron"
import { electronIpcTransport } from "kkrpc/electron"
import { relayTransport } from "kkrpc/relay"
import { stdioJsonTransport } from "kkrpc/stdio"

const workerProcess = spawn("node", [path.join(__dirname, "external-worker.js")])

const rendererSide = electronIpcTransport({
	endpoint: {
		send: (_channel, message) => win.webContents.send("kkrpc:external", message),
		on: (channel, listener) => ipcMain.on(channel, listener),
		off: (channel, listener) => ipcMain.off(channel, listener)
	},
	channel: "kkrpc:external"
})

const processSide = stdioJsonTransport({
	readable: workerProcess.stdout!,
	writable: workerProcess.stdin!
})

const relay = relayTransport(rendererSide, processSide)
```

```ts title="renderer.ts"
import { RPCChannel } from "kkrpc"
import { electronIpcTransport } from "kkrpc/electron"
import type { ExternalAPI } from "./api"

const transport = electronIpcTransport({
	endpoint: window.electron.ipcRenderer,
	channel: "kkrpc:external"
})

const channel = new RPCChannel<object, ExternalAPI>(transport)
const externalAPI = channel.getAPI()

const result = await externalAPI.heavyCalculation(1000)
```

```ts title="external-worker.ts"
import { RPCChannel } from "kkrpc"
import { nodeStdioTransport } from "kkrpc/stdio"
import type { ExternalAPI } from "./api"

const externalAPI: ExternalAPI = {
	async heavyCalculation(n) {
		return n * n
	}
}

new RPCChannel<ExternalAPI, object>(nodeStdioTransport(), { expose: externalAPI })
```

## Transport Reference

| Helper                                 | Import Path      | Runs In          | Communication               |
| -------------------------------------- | ---------------- | ---------------- | --------------------------- |
| `electronIpcTransport`                 | `kkrpc/electron` | Main or renderer | IPC endpoint pair           |
| `electronUtilityProcessTransport`      | `kkrpc/electron` | Main             | Utility process postMessage |
| `electronUtilityProcessChildTransport` | `kkrpc/electron` | Utility process  | Parent postMessage          |
| `createSecureIpcBridge`                | `kkrpc/electron` | Preload          | Restricted renderer bridge  |

## Cleanup

```ts title="main.ts"
app.on("window-all-closed", () => {
	channel.destroy()
	transport.close?.()
	relay.dispose()
	workerProcess.kill()
	if (process.platform !== "darwin") app.quit()
})
```

## Security Notes

- Use `contextIsolation: true` and `nodeIntegration: false`.
- Expose only the IPC methods needed by kkrpc from preload.
- Use `createSecureIpcBridge()` with a channel prefix or explicit allow-list.
- Keep separate channels for unrelated RPC connections.
