import { NodeIo, RPCChannel } from "../../mod.ts"
import { apiMethods } from "./api.ts"

const stdio = new NodeIo(process.stdin, process.stdout)

// Using superjson serialization (the default option)
// const child = new RPCChannel(stdio, { expose: apiMethods })

// Or explicitly specify serialization version (recommended for forward compatibility)
const child = new RPCChannel(stdio, {
	expose: apiMethods,
	serialization: { version: "superjson" }
})

// For backward compatibility with older clients, use standard JSON serialization
// const child = new RPCChannel(stdio, {
//   expose: apiMethods,
//   serialization: { version: "json" }
// })
