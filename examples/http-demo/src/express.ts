import { apiImplementationNested, type APINested } from "@kksh/demo-api"
import express from "express"
import { HTTPServerIO, RPCChannel } from "kkrpc"

const app = express()
const serverIO = new HTTPServerIO()
const serverRPC = new RPCChannel<APINested, APINested>(serverIO, apiImplementationNested)

// Parse raw body
app.use(express.text({ type: "application/json" }))

app.post("/rpc", async (req, res) => {
	try {
		const message = req.body
		const response = await serverIO.handleRequest(message)

		res.type("application/json").send(response)
	} catch (error) {
		console.error("RPC error:", error)
		res.status(500).send("Internal Server Error")
	}
})

// Handle 404
app.use((req, res) => {
	res.status(404).send("Not found")
})

const port = 3000
app.listen(port, () => {
	console.log(`Express server running at http://localhost:${port}`)
})

export default app
