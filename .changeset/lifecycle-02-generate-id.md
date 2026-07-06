---
"kkrpc": patch
---

Consolidate the three duplicated `generateId` helpers into `core/utils.ts` and harden the no-`crypto.randomUUID` fallback with a process-monotonic counter, so a channel never reuses an id for two live requests even on runtimes without `crypto` and when the clock and `Math.random()` collide.
