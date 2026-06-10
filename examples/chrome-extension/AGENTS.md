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
│  Service Worker │
└─────────────────┘
```

## STRUCTURE

```
chrome-extension/
├── src/
│   ├── background.ts   # Service worker exposing the background API
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
| `src/background.ts`     | Background service worker RPC endpoint |
| `src/content/main.tsx`  | Content script entry (injected)        |
| `src/popup/App.tsx`     | Popup UI with port connection          |
| `src/sidepanel/App.tsx` | Side panel UI                          |

## RPC PATTERN

```typescript
// Content script
import { RPCChannel } from "kkrpc/browser"
import { chromePortTransport } from "kkrpc/chrome-extension"

const port = chrome.runtime.connect({ name: "content" })
const rpc = new RPCChannel(chromePortTransport(port), { expose: contentAPI })
const backgroundAPI = rpc.getAPI()

// Background service worker
chrome.runtime.onConnect.addListener((port) => {
	new RPCChannel(chromePortTransport(port), { expose: backgroundAPI })
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

- Uses `chromePortTransport()` for `chrome.runtime.Port`
- CRXJS plugin auto-generates manifest from config
- Content scripts injected into matched pages
- Ports provide long-lived bidirectional channels
