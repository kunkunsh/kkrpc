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
│  │  (IframeParent) │               │  (IframeChildIO)    │ │
│  └─────────────────┘               └─────────────────────┘ │
│                                                              │
│  ┌─────────────────┐  Worker API  ┌─────────────────────┐  │
│  │  Worker Parent  │◄────────────►│  Web Worker         │  │
│  │  (WorkerParent) │               │  (WorkerChildIO)    │  │
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
import { IframeParentIO, RPCChannel } from "kkrpc/browser"
const io = new IframeParentIO(iframe.contentWindow!)
const rpc = new RPCChannel(io, { expose: parentAPI })
const childAPI = rpc.getAPI()

// Child (iframe content)
import { IframeChildIO, RPCChannel } from "kkrpc/browser"
const io = new IframeChildIO()
const rpc = new RPCChannel(io, { expose: childAPI })
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

- `IframeParentIO` / `IframeChildIO` for cross-frame RPC
- `WorkerParentIO` / `WorkerChildIO` for Web Worker RPC
- Playwright tests verify bidirectional calls
- Both support transferable objects (ArrayBuffer)
