import { spawn } from "node:child_process"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { app, BrowserWindow, ipcMain, Menu, screen, utilityProcess } from "electron"
import { RPCChannel } from "kkrpc"
import type { RPCMessage } from "kkrpc"
import { electronIpcTransport, electronUtilityProcessTransport } from "kkrpc/electron"
import { nodeStdioTransport } from "kkrpc/stdio"
import type { StdioWorkerAPI } from "../stdio-worker"
import type { WorkerAPI } from "../worker"

const rendererMethods = {
	showAlert: async (message: string) => {
		console.log(`[Main] Alert from renderer: ${message}`)
	},
	getRendererInfo: async () => ({
		userAgent: "mock-user-agent",
		language: "en-US",
		platform: "web"
	})
}
export type RendererAPI = typeof rendererMethods

export type MainAPI = {
	showNotification(message: string): Promise<void>
	getAppVersion(): Promise<string>
	pingRenderer(message: string): Promise<string>
	worker: WorkerAPI
	stdio: StdioWorkerAPI
	test: {
		pingRenderer(message: string): Promise<{
			success: boolean
			message: string
			rendererInfo: { userAgent: string; language: string; platform: string }
		}>
	}
}

const __dirname = path.dirname(fileURLToPath(import.meta.url))

process.env.APP_ROOT = path.join(__dirname, "..")

export const VITE_DEV_SERVER_URL = process.env["VITE_DEV_SERVER_URL"]
export const MAIN_DIST = path.join(process.env.APP_ROOT, "dist-electron")
export const RENDERER_DIST = path.join(process.env.APP_ROOT, "dist")

process.env.VITE_PUBLIC = VITE_DEV_SERVER_URL
	? path.join(process.env.APP_ROOT, "public")
	: RENDERER_DIST

let win: BrowserWindow | null
let workerProcess: ReturnType<typeof utilityProcess.fork> | null = null
let rpcChannel: RPCChannel<MainAPI, WorkerAPI> | null = null
let workerAPI!: WorkerAPI
let ipcRPC: RPCChannel<MainAPI, RendererAPI> | null = null
let rendererAPI!: RendererAPI
let stdioProcess: ReturnType<typeof spawn> | null = null
let stdioRPC: RPCChannel<
	{ showNotification(message: string): Promise<void> },
	StdioWorkerAPI
> | null = null
let stdioAPI!: StdioWorkerAPI

const mainAPI: MainAPI = {
	showNotification: async (message: string) => {
		console.log(`[Main] Notification: ${message}`)
		win?.webContents.send("notification", message)
	},
	getAppVersion: async () => app.getVersion(),
	pingRenderer: async (message: string) => {
		console.log(`[Main] Pinging renderer with: ${message}`)
		await rendererAPI.showAlert(`Message from Main: ${message}`)
		const info = await rendererAPI.getRendererInfo()
		console.log("[Main] Renderer info:", info)
		return `Renderer responded! Platform: ${info.platform}, Language: ${info.language}`
	},
	worker: {
		add: (a: number, b: number) => workerAPI.add(a, b),
		multiply: (a: number, b: number) => workerAPI.multiply(a, b),
		getProcessInfo: () => workerAPI.getProcessInfo(),
		pingMain: (message: string) => workerAPI.pingMain(message)
	},
	stdio: {
		calculateFactorial: (n: number) => stdioAPI.calculateFactorial(n),
		calculateFibonacci: (n: number) => stdioAPI.calculateFibonacci(n),
		getSystemInfo: () => stdioAPI.getSystemInfo(),
		executeCode: (code: string) => stdioAPI.executeCode(code)
	},
	test: {
		pingRenderer: async (message: string) => {
			console.log("[Main] Testing pingRenderer...")
			if (!win || win.isDestroyed()) {
				throw new Error("Window not available")
			}
			try {
				await rendererAPI.showAlert(`Bidirectional test: ${message}`)
				const info = await rendererAPI.getRendererInfo()
				return {
					success: true,
					message: `Main successfully called renderer!`,
					rendererInfo: info
				}
			} catch (error) {
				console.error("[Main] Error calling renderer:", error)
				throw error
			}
		}
	}
}

async function spawnWorker() {
	const workerPath = path.join(__dirname, "./worker.js")
	workerProcess = utilityProcess.fork(workerPath)
	rpcChannel = new RPCChannel<MainAPI, WorkerAPI>(electronUtilityProcessTransport(workerProcess), {
		expose: mainAPI
	})
	workerAPI = rpcChannel.getAPI()
}

async function spawnStdioWorker() {
	const stdioWorkerPath = path.join(__dirname, "./stdio-worker.js")
	stdioProcess = spawn("node", [stdioWorkerPath])

	stdioRPC = new RPCChannel<{ showNotification(message: string): Promise<void> }, StdioWorkerAPI>(
		nodeStdioTransport({ readable: stdioProcess.stdout!, writable: stdioProcess.stdin! }),
		{ expose: { showNotification: mainAPI.showNotification } }
	)
	stdioAPI = stdioRPC.getAPI()
	console.log("[Main] Stdio RPC established")
}

function createIpcMainEndpoint(webContents: Electron.WebContents) {
	const wrappers = new Map<
		(_event: unknown, message: RPCMessage) => void,
		(event: Electron.IpcMainEvent, message: RPCMessage) => void
	>()

	return {
		send(channel: string, message: RPCMessage): void {
			if (!webContents.isDestroyed()) webContents.send(channel, message)
		},
		on(channel: string, listener: (_event: unknown, message: RPCMessage) => void): void {
			const wrapped = (event: Electron.IpcMainEvent, message: RPCMessage) => {
				if (event.sender === webContents) listener(event, message)
			}
			wrappers.set(listener, wrapped)
			ipcMain.on(channel, wrapped)
		},
		off(channel: string, listener: (_event: unknown, message: RPCMessage) => void): void {
			const wrapped = wrappers.get(listener)
			if (!wrapped) return
			wrappers.delete(listener)
			ipcMain.off(channel, wrapped)
		}
	}
}

function createWindow() {
	const { width, height } = screen.getPrimaryDisplay().workAreaSize

	win = new BrowserWindow({
		width: Math.min(1400, width * 0.9),
		height: Math.min(900, height * 0.9),
		icon: path.join(process.env.VITE_PUBLIC, "electron-vite.svg"),
		webPreferences: {
			preload: path.join(__dirname, "preload.mjs"),
			contextIsolation: true,
			nodeIntegration: false
		}
	})

	if (ipcRPC) {
		ipcRPC.destroy()
	}
	ipcRPC = new RPCChannel<MainAPI, RendererAPI>(
		electronIpcTransport({
			endpoint: createIpcMainEndpoint(win.webContents),
			channel: "kkrpc-ipc"
		}),
		{ expose: mainAPI }
	)
	rendererAPI = ipcRPC.getAPI()

	win.webContents.on("context-menu", (_event, params) => {
		Menu.buildFromTemplate([
			{
				label: "Inspect Element",
				click: () => {
					win?.webContents.inspectElement(params.x, params.y)
				}
			},
			{
				label: "Reload",
				click: () => {
					win?.webContents.reload()
				}
			},
			{
				label: "Toggle DevTools",
				click: () => {
					win?.webContents.toggleDevTools()
				}
			}
		]).popup()
	})

	win.webContents.on("did-finish-load", () => {
		win?.webContents.send("main-process-message", new Date().toLocaleString())
	})

	if (VITE_DEV_SERVER_URL) {
		win.loadURL(VITE_DEV_SERVER_URL)
	} else {
		win.loadFile(path.join(RENDERER_DIST, "index.html"))
	}
}

app.on("window-all-closed", () => {
	stdioRPC?.destroy()
	stdioRPC = null
	ipcRPC?.destroy()
	rpcChannel?.destroy()
	workerProcess?.kill()
	stdioProcess?.kill()
	if (process.platform !== "darwin") {
		app.quit()
		win = null
	}
})

app.on("activate", () => {
	if (BrowserWindow.getAllWindows().length === 0) {
		createWindow()
	}
})

app.whenReady().then(async () => {
	createWindow()
	await spawnWorker()
	await spawnStdioWorker()
})
