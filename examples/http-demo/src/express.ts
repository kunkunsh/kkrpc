import { apiImplementationNested } from "@kksh/demo-api"
import express from "express"
import { createHttpHandler } from "kkrpc/http"

const app = express()
const handler = createHttpHandler(apiImplementationNested)

// Parse raw body
app.use(express.text({ type: "application/json" }))

app.post("/rpc", async (req, res) => {
	try {
		const response = await handler(
			new Request("http://127.0.0.1/rpc", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: req.body
			})
		)

		res
			.status(response.status)
			.type("application/json")
			.send(await response.text())
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
