import { contextBridge, ipcRenderer } from "electron"
import { createSecureIpcBridge } from "kkrpc/electron"

// Create secure IPC bridge with channel prefix whitelisting
// Only channels starting with "kkrpc-" will be allowed
const securedIpcRenderer = createSecureIpcBridge({
	ipcRenderer,
	channelPrefix: "kkrpc-"
})

contextBridge.exposeInMainWorld("electron", {
	ipcRenderer: securedIpcRenderer
})
