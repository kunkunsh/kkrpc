import { $ } from "bun"

await $`rm -rf dist`
await $`tsup`
await $`pnpm run docs`
