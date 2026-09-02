const { expose } = require("../dist/mod.cjs")
const { nodeStdioTransport } = require("../dist/stdio.cjs")

expose(
	{
		async add(left, right) {
			return left + right
		},
		async callCallback(value, callback) {
			callback(`node:${value}`)
		}
	},
	nodeStdioTransport()
)
