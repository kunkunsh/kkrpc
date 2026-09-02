// @ts-check

const { expose } = require("../dist/mod.cjs")
const { godotStdioTransport } = require("../dist/stdio.cjs")
const { SceneTree } = require("godot")

class KkrpcStdioWorker extends SceneTree {
	_initialize() {
		const transport = godotStdioTransport()
		this.controller = expose(
			{
				async add(left, right) {
					await Promise.resolve()
					return left + right
				},
				async callCallback(value, callback) {
					callback(`godot:${value}`)
				}
			},
			transport
		)
		transport.onClose(() => this.quit(0))
	}

	_finalize() {
		this.controller?.dispose()
	}
}

exports.default = KkrpcStdioWorker
