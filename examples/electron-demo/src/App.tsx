import { ElectronIpcRendererIO, RPCChannel } from "kkrpc/electron-ipc"
import { useState } from "react"
import "./App.css"
import type { MainAPI } from "../electron/main"
import type { StdioWorkerAPI } from "../stdio-worker"

const rendererAPI = {
	showAlert: async (message: string) => {
		alert(message)
		console.log("[Renderer] Alert shown:", message)
	},
	getRendererInfo: async () => ({
		userAgent: navigator.userAgent,
		language: navigator.language,
		platform: navigator.platform
	})
}
export type RendererAPI = typeof rendererAPI

interface LogEntry {
	timestamp: string
	message: string
	type: "success" | "error" | "info"
}

const ipcIO = new ElectronIpcRendererIO()
const ipcRPC = new RPCChannel<RendererAPI, MainAPI>(ipcIO, { expose: rendererAPI })
const mainAPI = ipcRPC.getAPI()

const stdioIO = new ElectronIpcRendererIO("kkrpc-stdio-relay")
const stdioRPC = new RPCChannel<object, StdioWorkerAPI>(stdioIO)
const stdioAPI = stdioRPC.getAPI()

function App() {
	const [logs, setLogs] = useState<LogEntry[]>([])
	const [isLoading, setIsLoading] = useState(false)
	const [fibNumber, setFibNumber] = useState(10)
	const [codeInput, setCodeInput] = useState("2 + 2")

	const addLog = (message: string, type: "success" | "error" | "info" = "info") => {
		setLogs((prev) => [
			...prev,
			{
				timestamp: new Date().toLocaleTimeString(),
				message,
				type
			}
		])
	}

	const clearLogs = () => setLogs([])

	const handleShowNotification = async () => {
		setIsLoading(true)
		try {
			await mainAPI.showNotification("Hello from renderer!")
			addLog("Renderer → Main: showNotification() called", "success")
		} catch (error) {
			addLog(`Error: ${error}`, "error")
		}
		setIsLoading(false)
	}

	const handleGetAppVersion = async () => {
		setIsLoading(true)
		try {
			const version = await mainAPI.getAppVersion()
			addLog(`Renderer → Main: App version = ${version}`, "success")
		} catch (error) {
			addLog(`Error: ${error}`, "error")
		}
		setIsLoading(false)
	}

	const handleWorkerAdd = async () => {
		setIsLoading(true)
		try {
			const result = await mainAPI.worker.add(2, 3)
			addLog(`Main → Worker: add(2, 3) = ${result}`, "success")
		} catch (error) {
			addLog(`Error: ${error}`, "error")
		}
		setIsLoading(false)
	}

	const handleWorkerMultiply = async () => {
		setIsLoading(true)
		try {
			const result = await mainAPI.worker.multiply(4, 5)
			addLog(`Main → Worker: multiply(4, 5) = ${result}`, "success")
		} catch (error) {
			addLog(`Error: ${error}`, "error")
		}
		setIsLoading(false)
	}

	const handleWorkerGetProcessInfo = async () => {
		setIsLoading(true)
		try {
			const info = await mainAPI.worker.getProcessInfo()
			addLog(
				`Main → Worker: Process pid=${info.pid}, version=${info.version}, platform=${info.platform}`,
				"success"
			)
		} catch (error) {
			addLog(`Error: ${error}`, "error")
		}
		setIsLoading(false)
	}

	const handleWorkerPingMain = async () => {
		setIsLoading(true)
		try {
			const result = await mainAPI.worker.pingMain("Hello!")
			addLog(`Worker → Main: ${result}`, "success")
		} catch (error) {
			addLog(`Error: ${error}`, "error")
		}
		setIsLoading(false)
	}

	const handleStdioFactorial = async () => {
		setIsLoading(true)
		try {
			const result = await stdioAPI.calculateFactorial(5)
			addLog(`Stdio Worker (via relay): factorial(5) = ${result}`, "success")
		} catch (error) {
			addLog(`Error: ${error}`, "error")
		}
		setIsLoading(false)
	}

	const handleStdioFibonacci = async () => {
		setIsLoading(true)
		try {
			const result = await stdioAPI.calculateFibonacci(fibNumber)
			addLog(`Stdio Worker (via relay): fibonacci(${fibNumber}) = ${result}`, "success")
		} catch (error) {
			addLog(`Error: ${error}`, "error")
		}
		setIsLoading(false)
	}

	const handleStdioGetSystemInfo = async () => {
		setIsLoading(true)
		try {
			const info = await stdioAPI.getSystemInfo()
			addLog(
				`Stdio Worker (via relay): pid=${info.pid}, platform=${info.platform}, arch=${info.arch}, node=${info.nodeVersion}`,
				"success"
			)
		} catch (error) {
			addLog(`Error: ${error}`, "error")
		}
		setIsLoading(false)
	}

	const handleStdioExecuteCode = async () => {
		setIsLoading(true)
		try {
			const result = await stdioAPI.executeCode(codeInput)
			addLog(
				`Stdio Worker (via relay): executeCode("${codeInput}") = ${JSON.stringify(result)}`,
				"success"
			)
		} catch (error) {
			addLog(`Error: ${error}`, "error")
		}
		setIsLoading(false)
	}

	const handleTestBidirectional = async () => {
		setIsLoading(true)
		try {
			const result = await mainAPI.test.pingRenderer("Hello from UI!")
			addLog(`Bidirectional: ${result.message}`, "success")
			addLog(
				`Renderer Info: ${result.rendererInfo.platform} | ${result.rendererInfo.language}`,
				"info"
			)
		} catch (error) {
			addLog(`Bidirectional Error: ${error}`, "error")
		}
		setIsLoading(false)
	}

	return (
		<div className="container">
			<div className="header">
				<h1>Electron kkrpc Demo</h1>
				<p>Multiple RPC Patterns: Renderer ↔ Main ↔ Utility Process ↔ Stdio Worker</p>
			</div>

			<div className="main-content">
				<div className="sidebar">
					<div className="section">
						<h3 className="section-title">1. Renderer → Main (kkrpc IPC)</h3>
						<div className="button-grid">
							<button
								className="btn btn-full"
								onClick={handleShowNotification}
								disabled={isLoading}
							>
								showNotification("Hello!")
							</button>
							<button className="btn btn-full" onClick={handleGetAppVersion} disabled={isLoading}>
								getAppVersion()
							</button>
							<button
								className="btn btn-secondary btn-full"
								onClick={handleTestBidirectional}
								disabled={isLoading}
							>
								Test Main → Renderer
							</button>
						</div>
					</div>

					<div className="section">
						<h3 className="section-title">2. Main → Worker (Utility Process)</h3>
						<div className="button-grid">
							<button className="btn" onClick={handleWorkerAdd} disabled={isLoading}>
								add(2, 3)
							</button>
							<button className="btn" onClick={handleWorkerMultiply} disabled={isLoading}>
								multiply(4, 5)
							</button>
							<button
								className="btn btn-full"
								onClick={handleWorkerGetProcessInfo}
								disabled={isLoading}
							>
								getProcessInfo()
							</button>
						</div>
					</div>

					<div className="section">
						<h3 className="section-title">3. Worker → Main (Bidirectional)</h3>
						<div className="button-grid">
							<button
								className="btn btn-secondary btn-full"
								onClick={handleWorkerPingMain}
								disabled={isLoading}
							>
								pingMain("Hello!")
							</button>
						</div>
					</div>

					<div className="section">
						<h3 className="section-title">4. Renderer → Stdio Worker (Direct Relay)</h3>
						<p className="section-desc">External Node.js process via transparent relay</p>
						<div className="button-grid">
							<button className="btn btn-full" onClick={handleStdioFactorial} disabled={isLoading}>
								factorial(5)
							</button>
							<div className="input-row">
								<input
									type="number"
									value={fibNumber}
									onChange={(e) => setFibNumber(Number(e.target.value))}
									min={1}
									max={40}
									className="input"
								/>
								<button className="btn" onClick={handleStdioFibonacci} disabled={isLoading}>
									fibonacci()
								</button>
							</div>
							<button
								className="btn btn-full"
								onClick={handleStdioGetSystemInfo}
								disabled={isLoading}
							>
								Get System Info
							</button>
							<div className="input-row">
								<input
									type="text"
									value={codeInput}
									onChange={(e) => setCodeInput(e.target.value)}
									placeholder="2 + 2"
									className="input"
								/>
								<button
									className="btn btn-warning"
									onClick={handleStdioExecuteCode}
									disabled={isLoading}
								>
									Execute
								</button>
							</div>
							<p className="warning-text">⚠️ executeCode is for demo only</p>
						</div>
					</div>
				</div>

				<div className="log-section">
					<div className="log-header">
						<h3 className="log-title">Results</h3>
						<div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
							<span className="log-count">{logs.length} entries</span>
							{logs.length > 0 && (
								<button className="clear-btn" onClick={clearLogs}>
									Clear
								</button>
							)}
						</div>
					</div>
					<div className="log-box">
						{logs.length === 0 ? (
							<p className="placeholder">Click a button to see results...</p>
						) : (
							logs.map((log, index) => (
								<div key={index} className={`log-line log-${log.type}`}>
									<span className="log-timestamp">{log.timestamp}</span> {log.message}
								</div>
							))
						)}
					</div>
				</div>
			</div>
		</div>
	)
}

export default App
