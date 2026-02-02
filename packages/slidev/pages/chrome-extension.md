---
transition: slide-up
layout: two-cols-header
layoutClass: gap-4
---

# Chrome Extension

> Content ↔ Background ↔ Popup Communication

::left::

### Traditional Messaging

```ts
// content.ts - Send message
chrome.runtime.sendMessage({ type: "GET_VERSION" }, (response) => {
	console.log(response.version)
	// No type safety!
})

// background.ts - Handle message
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
	if (message.type === "GET_VERSION") {
		sendResponse({
			version: chrome.runtime.getManifest().version
		})
	}
	// Must manually check types
	return true // Keep channel open
})
```

::right::

### With kkRPC (Port-Based)

```ts
// content.ts - Direct function call
import { ChromePortIO, RPCChannel } from "kkrpc/chrome-extension"
import type { BackgroundAPI } from "./types"

const port = chrome.runtime.connect({ name: "content" })
const io = new ChromePortIO(port)
const rpc = new RPCChannel<{}, BackgroundAPI>(io)

const bg = rpc.getAPI()
const version = await bg.getExtensionVersion()
// Full type safety! ✨
```

```ts
// background.ts - Expose API
chrome.runtime.onConnect.addListener((port) => {
	const io = new ChromePortIO(port)
	new RPCChannel(io, {
		expose: {
			getExtensionVersion: () => chrome.runtime.getManifest().version
		}
	})
})
```

<v-click>
<div class="mt-4 p-4 bg-purple-900/30 rounded-lg">
  <strong>Long-lived connections:</strong> Bidirectional, type-safe communication between all extension contexts
</div>
</v-click>

<!--
Traditional Chrome extension messaging is painful - string-based message types, manual response handling, no type safety, complex state management.

Traditional approach: sendMessage with type strings, manual listeners, callbacks for responses, no TypeScript autocomplete. Very error-prone.

With kkRPC: Uses Chrome ports for long-lived connections. Both sides can expose APIs. Full TypeScript type safety with autocomplete. Clean function calls instead of message type strings.

Perfect for complex extensions with multiple contexts - content scripts, background, popup, sidepanel all talking to each other type-safely.
-->
