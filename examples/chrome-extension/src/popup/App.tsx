import { RPCChannel } from "kkrpc/browser"
import { chromePortTransport } from "kkrpc/chrome-extension"
import { useEffect, useState } from "react"
import type { BackgroundAPI, ContentAPI } from "../rpc"
import "./App.css"

export default function App() {
	const [message, setMessage] = useState("Connecting with kkrpc...")

	useEffect(() => {
		const port = chrome.runtime.connect({ name: "popup" })
		const rpc = new RPCChannel<ContentAPI, BackgroundAPI>(chromePortTransport(port))
		rpc
			.getAPI()
			.ping("popup")
			.then(setMessage)
			.catch((error: unknown) => setMessage(error instanceof Error ? error.message : String(error)))

		return () => rpc.destroy()
	}, [])

	return (
		<div className="card">
			<h1>kkrpc Chrome Port Demo</h1>
			<p>{message}</p>
		</div>
	)
}
