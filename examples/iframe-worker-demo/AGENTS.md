# iframe + Web Worker Demo

**Generated:** 2026-02-03
**Location:** examples/iframe-worker-demo

## OVERVIEW

SvelteKit app demonstrating kkrpc across iframe boundaries and Web Workers. Shows bidirectional communication with sandboxed contexts.

## ARCHITECTURE

```
┌─────────────────────────────────────────────────────────────┐
│  Parent Page (SvelteKit)                                     │
│  ┌─────────────────┐  postMessage  ┌─────────────────────┐ │
│  │  Parent RPC     │◄─────────────►│  iframe (child)     │ │
│  │  iframe parent  │               │  iframe child       │ │
│  └─────────────────┘               └─────────────────────┘ │
│                                                              │
│  ┌─────────────────┐  Worker API  ┌─────────────────────┐  │
│  │  Worker Parent  │◄────────────►│  Web Worker         │  │
│  │  worker parent  │               │  worker self        │  │
│  └─────────────────┘               └─────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

## STRUCTURE

```
iframe-worker-demo/
├── src/
│   └── routes/
│       ├── +page.svelte         # Parent page with iframe + worker
│       ├── iframe/
│       │   └── +page.svelte     # iframe child content
│       └── web-worker/
│           └── +page.svelte     # Web worker demo
├── e2e/
│   └── demo.test.ts            # Playwright E2E tests
└── playwright.config.ts        # Test configuration
```

## KEY FILES

| File                                 | Purpose                      |
| ------------------------------------ | ---------------------------- |
| `src/routes/+page.svelte`            | Parent page embedding iframe |
| `src/routes/iframe/+page.svelte`     | Child page inside iframe     |
| `src/routes/web-worker/+page.svelte` | Web worker demo              |
| `e2e/demo.test.ts`                   | Playwright E2E tests         |

## IFRAME PATTERN

```typescript
// Parent
import { RPCChannel } from "kkrpc/browser"
import { iframeParentTransportReady } from "kkrpc/iframe"
const transport = await iframeParentTransportReady(iframe.contentWindow!)
const rpc = new RPCChannel(transport, { expose: parentAPI })
const childAPI = rpc.getAPI()

// Child (iframe content)
import { RPCChannel } from "kkrpc/browser"
import { iframeChildTransport } from "kkrpc/iframe"
const rpc = new RPCChannel(iframeChildTransport(), { expose: childAPI })
```

## RUNNING

```bash
cd examples/iframe-worker-demo
pnpm install
pnpm dev

# Run E2E tests
pnpm test
```

## NOTES

- `iframeParentTransport()` / `iframeChildTransport()` for cross-frame RPC
- `workerTransport()` / `workerSelfTransport()` for Web Worker RPC
- Playwright tests verify bidirectional calls
- Both support transferable objects (ArrayBuffer)
