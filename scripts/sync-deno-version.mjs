#!/usr/bin/env node
/**
 * Sync `packages/kkrpc/deno.json` version to match `packages/kkrpc/package.json`.
 *
 * Changesets only bumps npm `package.json` files. The JSR publish workflow reads
 * the version from `deno.json`, so without this sync a release would publish the
 * previous version number to JSR. Run this after `changeset version` (the root
 * `version` script does so automatically).
 */
import { readFileSync, writeFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"

const root = join(dirname(fileURLToPath(import.meta.url)), "..")
const pkgPath = join(root, "packages/kkrpc/package.json")
const denoPath = join(root, "packages/kkrpc/deno.json")

const version = JSON.parse(readFileSync(pkgPath, "utf8")).version
const denoRaw = readFileSync(denoPath, "utf8")
const deno = JSON.parse(denoRaw)

if (deno.version === version) {
	console.log(`deno.json already at ${version}`)
	process.exit(0)
}

// Preserve formatting/trailing newline by replacing just the version string.
const updated = denoRaw.replace(
	/("version"\s*:\s*")[^"]*(")/,
	`$1${version}$2`
)
if (JSON.parse(updated).version !== version) {
	throw new Error("Failed to update deno.json version; check the file format")
}
writeFileSync(denoPath, updated)
console.log(`Synced deno.json ${deno.version} -> ${version}`)
