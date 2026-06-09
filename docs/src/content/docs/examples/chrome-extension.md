---
title: Chrome Extension
description: Guide to Chrome extension communication using kkrpc
---

Chrome extension support uses native transports backed by `chrome.runtime.Port` for persistent two-way communication.

## API Definition

```ts title="types.ts"
export interface BackgroundAPI {
	getExtensionVersion(): Promise<string>
}

export interface ContentAPI {
	getPageTitle(): Promise<string>
}
```

## Background Script

```ts title="background.ts"
import { RPCChannel } from "kkrpc"
import { chromePortTransport } from "kkrpc/chrome-extension"
import type { BackgroundAPI, ContentAPI } from "./types"

const backgroundAPI: BackgroundAPI = {
	async getExtensionVersion() {
		return chrome.runtime.getManifest().version
	}
}

const contentChannels = new Map<number, RPCChannel<BackgroundAPI, ContentAPI>>()

chrome.runtime.onConnect.addListener((port) => {
	if (port.name !== "content-to-background") return
	const tabId = port.sender?.tab?.id
	if (!tabId) return

	const transport = chromePortTransport(port)
	const channel = new RPCChannel<BackgroundAPI, ContentAPI>(transport, { expose: backgroundAPI })
	contentChannels.set(tabId, channel)

	port.onDisconnect.addListener(() => {
		channel.destroy()
		transport.close?.()
		contentChannels.delete(tabId)
	})
})
```

## Content Script

```ts title="content.ts"
import { RPCChannel } from "kkrpc"
import { chromePortTransport } from "kkrpc/chrome-extension"
import type { BackgroundAPI, ContentAPI } from "./types"

const contentAPI: ContentAPI = {
	async getPageTitle() {
		return document.title
	}
}

const port = chrome.runtime.connect({ name: "content-to-background" })
const transport = chromePortTransport(port)
const channel = new RPCChannel<ContentAPI, BackgroundAPI>(transport, { expose: contentAPI })
const backgroundAPI = channel.getAPI()

console.log(await backgroundAPI.getExtensionVersion())
```

Use one port-backed transport per long-lived connection. Call `channel.destroy()` and `transport.close?.()` when the connection should be cleaned up manually.
