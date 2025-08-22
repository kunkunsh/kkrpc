---
title: Chrome Extension
description: Guide to Chrome extension communication using kkrpc
---

This guide demonstrates how to implement robust bidirectional communication between different parts of a Chrome extension (like background scripts, content scripts, popups, etc.) using `kkrpc`.

`kkrpc` provides a `ChromePortIO` adapter that uses `chrome.runtime.Port` for persistent, two-way connections.

## Features

- **Port-based communication**: More reliable for long-lived connections compared to one-off messages.
- **Bidirectional**: Any component can expose an API and call remote APIs.
- **Type-safe**: Full TypeScript support for your APIs.
- **Automatic cleanup**: Manages listeners and resources when a connection is closed.

## Installation

```bash
npm install kkrpc
```

## API Definition

First, define the types for the APIs you want to expose from different parts of your extension.

```typescript
// types.ts
export interface BackgroundAPI {
	getExtensionVersion: () => Promise<string>
}

export interface ContentAPI {
	getPageTitle: () => Promise<string>
}
```

## Implementation

### Background Script

The background script listens for incoming connections from other parts of the extension.

```typescript
// background.ts
import { ChromePortIO, RPCChannel } from "kkrpc/chrome-extension"
import type { BackgroundAPI, ContentAPI } from "./types"

const backgroundAPI: BackgroundAPI = {
	async getExtensionVersion() {
		return chrome.runtime.getManifest().version
	}
}

// A map to hold RPC channels, e.g., for each content script tab
const contentChannels = new Map<number, RPCChannel<BackgroundAPI, ContentAPI>>()

chrome.runtime.onConnect.addListener((port) => {
	console.log(`[Background] Connection from: ${port.name}`)

	// Example: Differentiating connections
	if (port.name === "content-to-background") {
		const tabId = port.sender?.tab?.id
		if (tabId) {
			const io = new ChromePortIO(port)
			const rpc = new RPCChannel(io, { expose: backgroundAPI })
			contentChannels.set(tabId, rpc)

			port.onDisconnect.addListener(() => {
				io.destroy()
				contentChannels.delete(tabId)
				console.log(`[Background] Disconnected from tab ${tabId}`)
			})
		}
	}
	// Add handlers for other components like popup, sidepanel...
})
```

### Content Script

The content script initiates a connection to the background script.

```typescript
// content.ts
import { ChromePortIO, RPCChannel } from "kkrpc/chrome-extension"
import type { BackgroundAPI, ContentAPI } from "./types"

const contentAPI: ContentAPI = {
	async getPageTitle() {
		return document.title
	}
}

const port = chrome.runtime.connect({ name: "content-to-background" })
const io = new ChromePortIO(port)
const rpc = new RPCChannel<ContentAPI, BackgroundAPI>(io, {
	expose: contentAPI
})

const backgroundAPI = rpc.getAPI()

// Example Usage
async function logVersion() {
	try {
		const version = await backgroundAPI.getExtensionVersion()
		console.log(`[Content] Extension version: ${version}`)
	} catch (error) {
		console.error("[Content] RPC call failed:", error)
	}
}

logVersion()
```

### Popup / Side Panel / Options Page

Other UI components like the popup connect in the same way as the content script.

```typescript
// popup.ts
import { ChromePortIO, RPCChannel } from "kkrpc/chrome-extension"
import type { BackgroundAPI } from "./types"

// Popups don't usually expose APIs to the background script
const port = chrome.runtime.connect({ name: "popup-to-background" })
const io = new ChromePortIO(port)
const rpc = new RPCChannel<{}, BackgroundAPI>(io)

const backgroundAPI = rpc.getAPI()

// Example: Get version when popup button is clicked
document.getElementById("get-version-btn")?.addEventListener("click", async () => {
	const version = await backgroundAPI.getExtensionVersion()
	document.getElementById("version-display")!.textContent = version
})
```

## Manifest V3 Configuration

Ensure your `manifest.json` is set up correctly.

```json
{
	"manifest_version": 3,
	"name": "My kkrpc Extension",
	"version": "1.0",
	"background": {
		"service_worker": "background.js"
	},
	"content_scripts": [
		{
			"matches": ["<all_urls>"],
			"js": ["content.js"]
		}
	],
	"action": {
		"default_popup": "popup.html"
	}
}
```

## Best Practices

1.  **Centralize RPC Setup**: Consider creating a helper file (like the `lib/kkrpc.ts` in the example project) to manage RPC creation for different components. This avoids code duplication.
2.  **Named Ports**: Use distinct names for ports (`chrome.runtime.connect({ name: '...' })`) to identify the connecting component in the background script.
3.  **Cleanup**: The `ChromePortIO` handles listener cleanup, but ensure you also clean up your `RPCChannel` instances and any other related state in the `onDisconnect` listener.
4.  **Error Handling**: Wrap your RPC calls in `try...catch` blocks to gracefully handle cases where the connection might be lost (e.g., the background service worker becomes inactive).
