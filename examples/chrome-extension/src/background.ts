import { RPCChannel } from "kkrpc/browser"
import { chromePortTransport } from "kkrpc/chrome-extension"
import type { BackgroundAPI, ContentAPI } from "./rpc"

const backgroundAPI: BackgroundAPI = {
	async ping(source) {
		return `background pong for ${source}`
	}
}

chrome.runtime.onConnect.addListener((port) => {
	new RPCChannel<BackgroundAPI, ContentAPI>(chromePortTransport(port), {
		expose: backgroundAPI
	})
})
