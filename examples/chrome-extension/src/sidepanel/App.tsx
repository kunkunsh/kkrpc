import { RPCChannel } from "kkrpc/browser"
import { chromePortTransport } from "kkrpc/chrome-extension"
import { useEffect, useState } from "react"
import type { BackgroundAPI, ContentAPI } from "../rpc"
import "./App.css"

export default function App() {
	const [message, setMessage] = useState("Connecting with kkrpc...")

	useEffect(() => {
		const port = chrome.runtime.connect({ name: "sidepanel" })
		const rpc = new RPCChannel<ContentAPI, BackgroundAPI>(chromePortTransport(port))
		rpc
			.getAPI()
			.ping("side panel")
			.then(setMessage)
			.catch((error: unknown) => setMessage(error instanceof Error ? error.message : String(error)))

		return () => rpc.destroy()
	}, [])

	return (
		<div className="card">
			<h1>kkrpc Side Panel</h1>
			<p>{message}</p>
		</div>
	)
}
