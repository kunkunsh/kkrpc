import { connect } from "node:net"
import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { kafkaTransport, type KafkaTransport } from "../kafka.ts"
import { RPCChannel } from "../mod.ts"
import { apiMethods, type API } from "./scripts/api.ts"

const TEST_TOPIC = "kkrpc-test-topic-" + Math.random().toString(36).substring(2, 8)
const KAFKA_BROKERS = (process.env.KAFKA_BROKERS || "localhost:9092")
	.split(",")
	.map((broker) => broker.trim())
	.filter(Boolean)
const RUN_KAFKA_TESTS =
	process.env.KKRPC_RUN_KAFKA_TESTS === "1" ||
	process.env.KAFKA_BROKERS !== undefined ||
	process.env.CI === "true" ||
	process.env.GITHUB_ACTIONS === "true"
const describeKafka = RUN_KAFKA_TESTS ? describe : describe.skip
const KAFKA_TEST_RETRY = { initialRetryTime: 50, retries: 1 }

function canOpenTcpConnection(broker: string, timeoutMs = 500): Promise<boolean> {
	const [host, portText] = broker.split(":")
	const port = Number(portText)
	if (!host || !Number.isInteger(port)) return Promise.resolve(false)

	return new Promise((resolve) => {
		const socket = connect({ host, port })
		const finish = (result: boolean) => {
			socket.destroy()
			resolve(result)
		}

		socket.setTimeout(timeoutMs)
		socket.once("connect", () => finish(true))
		socket.once("error", () => finish(false))
		socket.once("timeout", () => finish(false))
	})
}

async function assertKafkaBrokerAvailable(): Promise<void> {
	if (!RUN_KAFKA_TESTS) return
	for (const broker of KAFKA_BROKERS) {
		if (await canOpenTcpConnection(broker)) return
	}

	throw new Error(
		`Kafka broker unavailable at ${KAFKA_BROKERS.join(", ")}. Start docker compose or unset KAFKA_BROKERS to skip local Kafka integration tests.`
	)
}

describeKafka("kafkaTransport", () => {
	beforeAll(assertKafkaBrokerAvailable)

	test("creates an object-mode transport with broadcast capabilities by default", () => {
		const transport = kafkaTransport({
			brokers: KAFKA_BROKERS,
			topic: TEST_TOPIC + "-construction",
			localPeerId: "client",
			retry: KAFKA_TEST_RETRY
		})

		expect(transport.capabilities).toEqual({ objectMode: true, transfer: false, broadcast: true })
		transport.close?.()
	})

	describe("RPC communication", () => {
		let serverTransport: KafkaTransport
		let clientTransport: KafkaTransport
		let serverRPC: RPCChannel<API, API>
		let clientRPC: RPCChannel<API, API>

		beforeAll(async () => {
			const topic = TEST_TOPIC + "-rpc"
			serverTransport = kafkaTransport({
				brokers: KAFKA_BROKERS,
				topic,
				localPeerId: "server",
				remotePeerId: "client",
				retry: KAFKA_TEST_RETRY
			})
			clientTransport = kafkaTransport({
				brokers: KAFKA_BROKERS,
				topic,
				localPeerId: "client",
				remotePeerId: "server",
				retry: KAFKA_TEST_RETRY
			})

			serverRPC = new RPCChannel<API, API>(serverTransport, { expose: apiMethods })
			clientRPC = new RPCChannel<API, API>(clientTransport, { expose: apiMethods })
			await new Promise((resolve) => setTimeout(resolve, 2000))
		})

		afterAll(() => {
			clientRPC.destroy()
			serverRPC.destroy()
		})

		test("performs RPC round trips over Kafka", async () => {
			const serverAPI = clientRPC.getAPI()

			expect(await serverAPI.echo("Hello Kafka!")).toBe("Hello Kafka!")
			expect(await serverAPI.add(3, 7)).toBe(10)
		}, 20_000)

		test("supports nested API calls", async () => {
			const serverAPI = clientRPC.getAPI()

			expect(await serverAPI.math.grade2.multiply(4, 5)).toBe(20)
		}, 20_000)
	})
})
