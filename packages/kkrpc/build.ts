import { $ } from "bun"

await $`rm -rf dist`
await $`tsdown`
await $`pnpm run docs`
