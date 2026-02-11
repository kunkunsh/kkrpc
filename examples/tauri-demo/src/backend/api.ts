export class Api {
	async eval(code: string) {
		if (process.versions.bun) {
			// Use dynamic import with base64 data URL to support ES modules in Bun
			// Bun's eval() doesn't support ES module syntax (import/export)
			const base64 = Buffer.from(code).toString("base64")
			const dataUrl = `data:text/javascript;base64,${base64}`
			return await import(dataUrl)
		}
		return eval(code) // This only works with deno and node, not bun
	}
}

export const api = new Api()
