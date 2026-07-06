---
"kkrpc": patch
---

Mark the package as side-effect free (`"sideEffects": false`). kkrpc's source has no import-time side effects, so this lets downstream bundlers drop unused re-export modules. The browser entry's module count drops with no change to the core bundle size.
