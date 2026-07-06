import { apiImplementationNested } from "@kksh/demo-api"
import Fastify from "fastify"
import { createHttpHandler } from "kkrpc/http"

const app = Fastify({
	logger: true
})

const handler = createHttpHandler(apiImplementationNested)

// Add content type parser for raw body
app.addContentTypeParser("application/json", { parseAs: "string" }, function (_, body, done) {
	done(null, body)
})

app.post("/rpc", async (request, reply) => {
	try {
		const response = await handler(
			new Request("http://127.0.0.1/rpc", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: request.body as string
			})
		)

		reply
			.status(response.status)
			.type("application/json")
			.send(await response.text())
	} catch (error) {
		request.log.error(error)
		reply.status(500).send("Internal Server Error")
	}
})

// Handle 404
app.setNotFoundHandler((request, reply) => {
	reply.status(404).send("Not found")
})

const port = 3000
const start = async () => {
	try {
		await app.listen({ port })
		console.log(`Fastify server running at http://localhost:${port}`)
	} catch (err) {
		app.log.error(err)
		process.exit(1)
	}
}

start()

export default app
