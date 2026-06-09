import { RPCChannel } from "kkrpc/browser"
import { chromePortTransport } from "kkrpc/chrome-extension"
import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import type { BackgroundAPI, ContentAPI } from "../rpc"
import App from "./views/App.tsx"

console.log("[CRXJS] Hello world from content script!")

const contentAPI: ContentAPI = {
	async getPageTitle() {
		return document.title
	}
}

const port = chrome.runtime.connect({ name: "content" })
const rpc = new RPCChannel<ContentAPI, BackgroundAPI>(chromePortTransport(port), {
	expose: contentAPI
})
rpc
	.getAPI()
	.ping("content script")
	.then((message) => console.log(`[kkrpc] ${message}`))

const container = document.createElement("div")
container.id = "crxjs-app"
document.body.appendChild(container)
createRoot(container).render(
	<StrictMode>
		<App />
	</StrictMode>
)
