import { $ } from "bun"

// copy packages/kkrpc/README.md to root README.md
await $`cp ./packages/kkrpc/README.md ./README.md`
