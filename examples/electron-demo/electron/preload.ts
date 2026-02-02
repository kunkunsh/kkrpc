import { contextBridge, ipcRenderer } from "electron"

contextBridge.exposeInMainWorld("electron", {
	ipcRenderer: {
		send(...args: Parameters<typeof ipcRenderer.send>) {
			const [channel, ...omit] = args
			return ipcRenderer.send(channel, ...omit)
		},
		on(...args: Parameters<typeof ipcRenderer.on>) {
			const [channel, listener] = args
			return ipcRenderer.on(channel, (event, ...args) => listener(event, ...args))
		},
		off(...args: Parameters<typeof ipcRenderer.off>) {
			const [channel, ...omit] = args
			return ipcRenderer.off(channel, ...omit)
		}
	}
})
