import { defineConfig } from "tsdown"

const externalDependencies = [
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

export default defineConfig({
	entry: {
		mod: "./src/entries/mod.ts",
		"browser-mod": "./src/entries/browser-mod.ts",
		"deno-mod": "./src/entries/deno-mod.ts",
		transport: "./src/entries/transport.ts",
		codecs: "./src/entries/codecs.ts",
		plugins: "./src/entries/plugins.ts",
		validation: "./src/entries/validation.ts",
		middleware: "./src/entries/middleware.ts",
		superjson: "./src/entries/superjson.ts",
		worker: "./src/entries/worker.ts",
		stdio: "./src/entries/stdio.ts",
		http: "./src/entries/http.ts",
		ws: "./src/entries/ws.ts",
		"ws-hono": "./src/entries/ws-hono.ts",
		"ws-elysia": "./src/entries/ws-elysia.ts",
		iframe: "./src/entries/iframe.ts",
		"chrome-extension": "./src/entries/chrome-extension.ts",
		electron: "./src/entries/electron.ts",
		tauri: "./src/entries/tauri.ts",
		socketio: "./src/entries/socketio.ts",
		rabbitmq: "./src/entries/rabbitmq.ts",
		kafka: "./src/entries/kafka.ts",
		"redis-streams": "./src/entries/redis-streams.ts",
		nats: "./src/entries/nats.ts",
		relay: "./src/entries/relay.ts",
		inspector: "./src/entries/inspector.ts"
	},
	dts: true,
	format: ["cjs", "esm"],
	clean: true,
	minify: true,
	outExtensions: ({ format }) => ({
		js: format === "cjs" ? ".cjs" : ".js"
	}),
	deps: {
		neverBundle: externalDependencies
	}
})
