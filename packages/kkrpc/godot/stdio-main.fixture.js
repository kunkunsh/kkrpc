// @ts-check

const { dispose, wrap } = require("../dist/mod.cjs")
const { godotChildProcessTransport } = require("../dist/godot.cjs")
const { OS, SceneTree } = require("godot")

class KkrpcStdioMainTest extends SceneTree {
	_initialize() {
		this.run()
	}

	async run() {
		let api
		try {
			const transport = godotChildProcessTransport({
				path: OS.get_environment("KKRPC_TEST_BUN"),
				args: [OS.get_environment("KKRPC_TEST_CHILD")]
			})
			api = wrap(transport)
			if ((await api.add(4, 5)) !== 9) throw new Error("first child call failed")
			if ((await api.add(10, 8)) !== 18) throw new Error("second child call failed")
			let callbackValue = ""
			await api.callCallback("ready", (value) => (callbackValue = value))
			if (callbackValue !== "node:ready") throw new Error("child callback failed")
			this.quit(0)
		} catch (error) {
			console.error(error)
			this.quit(1)
		} finally {
			if (api) dispose(api)
		}
	}
}

exports.default = KkrpcStdioMainTest
