# Chrome Extension Demo

**Generated:** 2026-02-03
**Location:** examples/chrome-extension

## OVERVIEW

Chrome extension demonstrating kkrpc for port-based communication between content scripts, popup, and side panel. Uses CRXJS for Vite integration.

## ARCHITECTURE

```
┌─────────────────┐  chrome.runtime.Port  ┌─────────────────┐
│  Content Script │◄─────────────────────►│  Popup/Panel    │
│  (injected)     │                       │  (UI)           │
└─────────────────┘                       └─────────────────┘
       │
       │ chrome.runtime.connect()
       ▼
┌─────────────────┐
│  Background     │
│  (Service Worker│
└─────────────────┘
```

## STRUCTURE

```
chrome-extension/
├── src/
│   ├── content/        # Content scripts (injected into pages)
│   │   ├── main.tsx
│   │   └── views/
│   │       └── App.tsx
│   ├── popup/          # Popup UI (click extension icon)
│   │   ├── main.tsx
│   │   └── App.tsx
│   ├── sidepanel/      # Side panel (Chrome 114+)
│   │   ├── main.tsx
│   │   └── App.tsx
│   └── components/     # Shared React components
├── manifest.config.ts  # Extension manifest (CRXJS)
└── vite.config.ts      # Vite + CRXJS config
```

## KEY FILES

| File                    | Purpose                                |
| ----------------------- | -------------------------------------- |
| `manifest.config.ts`    | Extension permissions, content scripts |
| `src/content/main.tsx`  | Content script entry (injected)        |
| `src/popup/App.tsx`     | Popup UI with port connection          |
| `src/sidepanel/App.tsx` | Side panel UI                          |

## RPC PATTERN

```typescript
// Content script
import { ChromePortIO, RPCChannel } from "kkrpc/chrome-extension"

const port = chrome.runtime.connect({ name: "content-to-popup" })
const io = new ChromePortIO(port)
const rpc = new RPCChannel(io, { expose: contentAPI })
const popupAPI = rpc.getAPI()

// Popup
chrome.runtime.onConnect.addListener((port) => {
	const io = new ChromePortIO(port)
	const rpc = new RPCChannel(io, { expose: popupAPI })
})
```

## RUNNING

```bash
cd examples/chrome-extension
pnpm install
pnpm dev

# Load in Chrome:
# 1. Open chrome://extensions
# 2. Enable "Developer mode"
# 3. Click "Load unpacked"
# 4. Select the `dist` folder
```

## NOTES

- Uses `ChromePortIO` adapter for `chrome.runtime.Port`
- CRXJS plugin auto-generates manifest from config
- Content scripts injected into matched pages
- Ports provide long-lived bidirectional channels
