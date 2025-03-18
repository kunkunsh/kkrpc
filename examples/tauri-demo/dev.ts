import { $ } from "bun"

await Promise.all([$`vite dev`, $`bun run src/backend/node.ts`, $`bun run src/backend/bun.ts`])
