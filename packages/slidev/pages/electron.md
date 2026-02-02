---
transition: slide-up
layout: two-cols-header
layoutClass: gap-4
---

# Electron IPC

::left::

### Traditional IPC

```ts
// preload.ts
import { contextBridge, ipcRenderer } from "electron"

contextBridge.exposeInMainWorld("api", {
	getVersion: () => ipcRenderer.invoke("get-version"),
	showDialog: (msg) => ipcRenderer.invoke("show-dialog", msg)
})

// main.ts
ipcMain.handle("get-version", () => app.getVersion())
ipcMain.handle("show-dialog", (e, msg) => dialog.show(msg))

// renderer.ts - No types!
const version = await window.api.getVersion()
// string? number? any? Who knows!
```

::right::

### With kkRPC

```ts
// types.ts - Define once, use everywhere
type MainAPI = {
	getVersion(): Promise<string>
	showDialog(msg: string): Promise<void>
}

// main.ts - Expose API
const rpc = new RPCChannel(io, {
	expose: { getVersion: () => app.getVersion() }
})

// renderer.ts - Full autocomplete!
const rpc = new RPCChannel<{}, MainAPI>(io)
const api = rpc.getAPI()
const version = await api.getVersion() // string!
```

<!--
Here's a concrete example with Electron.

On the left - the traditional way. You expose methods one by one in the preload, create handlers for each in main, and in the renderer... you have no type safety. You just hope the method exists and returns what you expect. And if you're using TypeScript and you need the types to work, you have to manually cast the types.

On the right - with kkRPC. Define your API types once. Set up the channel in one line. Get full autocomplete and type checking. Beautiful.
Also, in reality you don't even need to manually define the types, you can just infer it from an API object with the typeof keyword.
-->
