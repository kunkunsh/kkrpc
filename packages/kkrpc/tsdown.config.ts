import { defineConfig } from "tsdown"

export default defineConfig({
	entry: [
		"./mod.ts",
		"./browser-mod.ts",
		"./deno-mod.ts",
		"./transport.ts",
		"./codecs.ts",
		"./plugins.ts",
		"./validation.ts",
		"./middleware.ts",
		"./superjson.ts",
		"./worker.ts",
		"./stdio.ts",
		"./http.ts",
		"./ws.ts",
		"./ws-hono.ts",
		"./ws-elysia.ts",
		"./iframe.ts",
		"./chrome-extension.ts",
		"./electron.ts",
		"./tauri.ts",
		"./socketio.ts",
		"./rabbitmq.ts",
		"./kafka.ts",
		"./redis-streams.ts",
		"./nats.ts",
		"./relay.ts",
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
