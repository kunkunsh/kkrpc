import { apiImplementationNested, type APINested } from "@kksh/demo-api"
import Fastify from "fastify"
import { HTTPServerIO, RPCChannel } from "kkrpc"

const app = Fastify({
	logger: true
})

const serverIO = new HTTPServerIO()
const serverRPC = new RPCChannel<APINested, APINested>(serverIO, {
	expose: apiImplementationNested
})

// Add content type parser for raw body
app.addContentTypeParser("application/json", { parseAs: "string" }, function (_, body, done) {
	done(null, body)
})

app.post("/rpc", async (request, reply) => {
	try {
		const message = request.body as string
		const response = await serverIO.handleRequest(message)

		reply.type("application/json").send(response)
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
