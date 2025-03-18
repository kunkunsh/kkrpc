---
title: Chrome Extension
---

#### `background.ts`

```ts
import { ChromeBackgroundIO, RPCChannel } from "kkrpc"
import type { API } from "./api"

// Store RPC channels for each tab
const rpcChannels = new Map<number, RPCChannel<API, {}>>()

// Listen for tab connections
chrome.runtime.onConnect.addListener((port) => {
	if (port.sender?.tab?.id) {
		const tabId = port.sender.tab.id
		const io = new ChromeBackgroundIO(tabId)
		const rpc = new RPCChannel(io, { expose: backgroundAPI })
		rpcChannels.set(tabId, rpc)

		port.onDisconnect.addListener(() => {
			rpcChannels.delete(tabId)
		})
	}
})
```

#### `content.ts`

```ts
import { ChromeContentIO, RPCChannel } from "kkrpc"
import type { API } from "./api"

const io = new ChromeContentIO()
const rpc = new RPCChannel<API, API>(io, {
	expose: {
		updateUI: async (data) => {
			document.body.innerHTML = data.message
			return true
		}
	}
})

// Get API from background script
const api = rpc.getAPI()
const data = await api.getData()
console.log(data) // { message: "Hello from background!" }
```
