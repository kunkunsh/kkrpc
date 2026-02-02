import { defineConfig } from "tsdown"

export default defineConfig({
	entry: [
		"./mod.ts",
		"./browser-mod.ts",
		"./http.ts",
		"./deno-mod.ts",
		"./chrome-extension.ts",
		"./socketio.ts",
		"./rabbitmq.ts",
		"./kafka.ts",
		"./redis-streams.ts",
		"./nats.ts",
		"./electron.ts",
		"./electron-ipc.ts"
	],
	dts: true,
	format: ["cjs", "esm"],
	clean: true,
	minify: true
})
