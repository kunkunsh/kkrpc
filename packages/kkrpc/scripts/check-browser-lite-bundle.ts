/**
 * Verifies that the tsdown-built browser-lite artifacts do not statically import
 * SuperJSON, its known dependencies, or the full serializer runtime. This uses
 * the canonical dist output instead of adding another bundler to the project.
 */
import { access, readFile } from "node:fs/promises"
import { basename, dirname, join, normalize } from "node:path"

const entryFiles = [
	"dist/browser-lite-mod.js",
	"dist/browser-lite-mod.cjs",
	"dist/browser-lite-mod.d.ts",
	"dist/browser-lite-mod.d.cts"
]

const packageRoot = join(import.meta.dir, "..")
const forbiddenPackages = ["superjson", "copy-anything", "is-what"]
const staticSpecifierPattern =
	/\b(?:import|export)(?:[^"'`]*?\bfrom)?\s*["'`]([^"'`]+)["'`]|\bimport\(\s*["'`]([^"'`]+)["'`]\s*\)|\brequire\(\s*["'`]([^"'`]+)["'`]\s*\)/g
const pending = [...entryFiles]
const visited = new Set<string>()
const failures: string[] = []

function normalizePath(file: string): string {
	return normalize(file).replaceAll("\\", "/")
}

function getForbiddenSpecifierReason(specifier: string): string | null {
	for (const packageName of forbiddenPackages) {
		if (specifier === packageName || specifier.startsWith(`${packageName}/`)) {
			return `package import ${packageName}`
		}
	}

	if (!specifier.startsWith(".")) {
		return null
	}

	const fileName = basename(specifier)
	if (fileName.startsWith("serialization-full")) {
		return "serialization-full runtime chunk"
	}
	if (
		fileName === "serialization.js" ||
		fileName === "serialization.cjs" ||
		/^serialization-(?!json-|types-)/.test(fileName)
	) {
		return "serialization.ts compatibility chunk"
	}

	return null
}

async function fileExists(file: string): Promise<boolean> {
	try {
		await access(join(packageRoot, file))
		return true
	} catch {
		return false
	}
}

async function resolveLocalImport(currentFile: string, specifier: string): Promise<string | null> {
	if (!specifier.startsWith(".")) {
		return null
	}

	const resolved = normalizePath(join(dirname(currentFile), specifier))
	const candidates = [resolved]
	if (currentFile.endsWith(".d.ts") && resolved.endsWith(".js")) {
		candidates.push(`${resolved.slice(0, -3)}.d.ts`)
	}
	if (currentFile.endsWith(".d.cts") && resolved.endsWith(".cjs")) {
		candidates.push(`${resolved.slice(0, -4)}.d.cts`)
	}

	for (const candidate of candidates) {
		if (await fileExists(candidate)) {
			return candidate
		}
	}

	return null
}

while (pending.length > 0) {
	const file = pending.shift()
	if (!file || visited.has(file)) {
		continue
	}
	visited.add(file)

	const filePath = join(packageRoot, file)
	const contents = await readFile(filePath, "utf8")
	for (const match of contents.matchAll(staticSpecifierPattern)) {
		const specifier = match[1] ?? match[2] ?? match[3]
		if (!specifier) {
			continue
		}

		const reason = getForbiddenSpecifierReason(specifier)
		if (reason) {
			failures.push(`[browser-lite-bundle] ${file} imports ${specifier} (${reason})`)
		}

		const resolved = await resolveLocalImport(file, specifier)
		if (resolved) {
			pending.push(resolved)
		}
	}
}

if (failures.length > 0) {
	for (const failure of failures) {
		console.error(failure)
	}
	process.exit(1)
}

console.log("[browser-lite-bundle] No forbidden SuperJSON dependency imports found")
