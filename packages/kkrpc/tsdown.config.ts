import { defineConfig } from "tsdown"

export default defineConfig({
	entry: [
		"./mod.ts",
		"./browser-mod.ts",
		"./browser-lite-mod.ts",
		"./browser-mini-mod.ts",
		"./next.ts",
		"./next-worker.ts",
		"./next-stdio.ts",
		"./next-transport.ts",
		"./next-codecs.ts",
		"./next-plugins.ts",
		"./next-validation.ts",
		"./next-middleware.ts",
		"./next-superjson.ts",
		"./next-classic-compat.ts",
		"./http.ts",
		"./deno-mod.ts",
		"./chrome-extension.ts",
		"./socketio.ts",
		"./rabbitmq.ts",
		"./kafka.ts",
		"./redis-streams.ts",
		"./nats.ts",
		"./electron.ts",
		"./electron-ipc.ts",
		"./inspector.ts"
	],
	dts: true,
	format: ["cjs", "esm"],
	clean: true,
	minify: true,
	external: [
		"amqplib",
		"kafkajs",
		"ioredis",
		"@nats-io/transport-node",
		"socket.io",
		"socket.io-client",
		"ws",
		"elysia",
		"hono",
		"@tauri-apps/plugin-shell"
	]
})
