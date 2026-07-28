import { spawn, type ChildProcess } from "node:child_process"
import { randomUUID } from "node:crypto"
import { mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises"
import { createServer } from "node:net"
import path from "node:path"
import { pathToFileURL } from "node:url"
import type { Browser, BrowserContext, Page } from "playwright"
import { z } from "zod"
import type { CompiledTimeline, CompiledTimelineEntry } from "../../components/narration/types"
import {
	generatedStatesDirectory,
	generatedTimelinePath,
	projectRoot,
	publicGeneratedStatesDirectory
} from "./paths"

const HOST = "127.0.0.1"
const CAPTURE_WIDTH = 1920
const CAPTURE_HEIGHT = 1080
const SERVER_READY_TIMEOUT_MS = 30_000
const PAGE_READY_TIMEOUT_MS = 30_000
const SERVER_STOP_TIMEOUT_MS = 5_000
const PROCESS_LOG_LIMIT = 12_000

const compiledTimelineEntrySchema = z.object({
	id: z.string(),
	index: z.number().int().nonnegative(),
	page: z.number().int().positive(),
	click: z.number().int().nonnegative(),
	text: z.string(),
	audioPublicPath: z.string().nullable(),
	audioDurationMs: z.number().int().nonnegative(),
	silentMs: z.number().int().nonnegative(),
	transitionMs: z.number().int().nonnegative(),
	leadInMs: z.number().int().nonnegative(),
	tailMs: z.number().int().nonnegative(),
	transitionFrames: z.number().int().nonnegative(),
	leadInFrames: z.number().int().nonnegative(),
	audioFrames: z.number().int().nonnegative(),
	tailFrames: z.number().int().nonnegative(),
	startFrame: z.number().int().nonnegative(),
	durationInFrames: z.number().int().nonnegative(),
	stateImagePublicPath: z.string()
})

const compiledTimelineSchema: z.ZodType<CompiledTimeline> = z.object({
	version: z.literal(1),
	fps: z.literal(30),
	width: z.literal(CAPTURE_WIDTH),
	height: z.literal(CAPTURE_HEIGHT),
	durationInFrames: z.number().int().nonnegative(),
	entries: z.array(compiledTimelineEntrySchema)
})

export interface SlideState {
	page: number
	click: number
}

export function stateFileName(page: number, click: number): string {
	return `s${String(page).padStart(3, "0")}-c${String(click).padStart(3, "0")}.png`
}

export function uniqueStates(entries: CompiledTimelineEntry[]): SlideState[] {
	const seen = new Set<string>()
	const states: SlideState[] = []

	for (const entry of entries) {
		const key = `${entry.page}:${entry.click}`
		if (seen.has(key)) continue
		seen.add(key)
		states.push({ page: entry.page, click: entry.click })
	}

	return states
}

async function writeFileAtomically(destinationPath: string, data: Uint8Array): Promise<void> {
	const temporaryPath = path.join(
		path.dirname(destinationPath),
		`.${path.basename(destinationPath)}.${process.pid}.${randomUUID()}.tmp`
	)

	try {
		await writeFile(temporaryPath, data, { flag: "wx" })
		await rename(temporaryPath, destinationPath)
	} finally {
		await rm(temporaryPath, { force: true })
	}
}

export async function writeCaptureCopiesAtomically(
	outputDirectories: readonly [string, string],
	fileName: string,
	data: Uint8Array
): Promise<void> {
	const destinationPaths = outputDirectories.map((directory) => path.join(directory, fileName))
	const results = await Promise.allSettled(
		destinationPaths.map((destinationPath) => writeFileAtomically(destinationPath, data))
	)
	const failures = results.filter(
		(result): result is PromiseRejectedResult => result.status === "rejected"
	)
	if (!failures.length) return

	await Promise.allSettled(
		destinationPaths.map((destinationPath) => rm(destinationPath, { force: true }))
	)
	throw new Error(
		`Unable to write both capture copies for ${fileName}: ` +
			failures.map((failure) => errorMessage(failure.reason)).join("; ")
	)
}

interface RunningSlidev {
	child: ChildProcess
	origin: string
	command: string
	readOutput: () => string
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error)
}

function stateKey(state: SlideState): string {
	return `${state.page}:${state.click}`
}

function slideStateUrl(origin: string, page: number): string {
	const url = new URL(`/${page}`, origin)
	url.searchParams.set("narrationCapture", "1")
	return url.href
}

function delay(milliseconds: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

async function readTimeline(): Promise<CompiledTimeline> {
	let source: string
	try {
		source = await readFile(generatedTimelinePath, "utf8")
	} catch (error) {
		throw new Error(
			`Unable to read ${path.relative(projectRoot, generatedTimelinePath)}. ` +
				`Run "pnpm narration:build" first. ${errorMessage(error)}`
		)
	}

	let parsed: unknown
	try {
		parsed = JSON.parse(source)
	} catch (error) {
		throw new Error(
			`Unable to parse ${path.relative(projectRoot, generatedTimelinePath)} as JSON: ` +
				errorMessage(error)
		)
	}

	const result = compiledTimelineSchema.safeParse(parsed)
	if (!result.success) {
		const issues = result.error.issues
			.map((issue) => `${issue.path.join(".") || "<root>"}: ${issue.message}`)
			.join("; ")
		throw new Error(
			`Invalid compiled timeline at ${path.relative(projectRoot, generatedTimelinePath)}: ${issues}`
		)
	}

	for (const entry of result.data.entries) {
		const expected = `narration/generated/states/${stateFileName(entry.page, entry.click)}`
		if (entry.stateImagePublicPath !== expected) {
			throw new Error(
				`Timeline entry ${entry.id} points to ${entry.stateImagePublicPath}; expected ${expected}`
			)
		}
	}

	return result.data
}

async function reserveUnusedPort(): Promise<number> {
	const server = createServer()

	return await new Promise<number>((resolve, reject) => {
		server.once("error", reject)
		server.listen(0, HOST, () => {
			const address = server.address()
			if (!address || typeof address === "string") {
				server.close()
				reject(new Error(`Unable to reserve an unused ${HOST} port`))
				return
			}

			const { port } = address
			server.close((error) => {
				if (error) reject(error)
				else resolve(port)
			})
		})
	})
}

function appendProcessOutput(current: string, chunk: unknown): string {
	const appended = `${current}${String(chunk)}`
	return appended.length <= PROCESS_LOG_LIMIT ? appended : appended.slice(-PROCESS_LOG_LIMIT)
}

async function startSlidev(): Promise<RunningSlidev> {
	const port = await reserveUnusedPort()
	const executable = path.join(projectRoot, "node_modules/.bin/slidev")
	const args = ["slides.md", "--port", String(port), "--remote", "--bind", HOST, "--log", "warn"]
	const command = `pnpm exec slidev ${args.join(" ")}`
	const child = spawn(executable, args, {
		cwd: projectRoot,
		env: { ...process.env, BROWSER: "none" },
		stdio: ["ignore", "pipe", "pipe"]
	})
	let output = ""
	let spawnError: Error | null = null

	child.stdout?.setEncoding("utf8")
	child.stderr?.setEncoding("utf8")
	child.stdout?.on("data", (chunk) => {
		output = appendProcessOutput(output, chunk)
	})
	child.stderr?.on("data", (chunk) => {
		output = appendProcessOutput(output, chunk)
	})
	child.once("error", (error) => {
		spawnError = error
	})

	return {
		child,
		origin: `http://${HOST}:${port}`,
		command,
		readOutput: () => {
			const failure = spawnError ? `\nSpawn error: ${spawnError.message}` : ""
			return `${output.trim()}${failure}`.trim()
		}
	}
}

function readinessError(server: RunningSlidev, reason: string): Error {
	const output = server.readOutput()
	return new Error(
		`${reason}\nCommand: ${server.command}\nEndpoint: ${server.origin}/` +
			(output ? `\nSlidev output:\n${output}` : "\nSlidev produced no output.")
	)
}

async function waitForSlidev(server: RunningSlidev): Promise<void> {
	const deadline = Date.now() + SERVER_READY_TIMEOUT_MS
	let lastRequestError = "no HTTP response received"

	while (Date.now() < deadline) {
		if (server.child.exitCode !== null || server.child.signalCode !== null) {
			throw readinessError(
				server,
				`Slidev exited before becoming ready ` +
					`(exit=${String(server.child.exitCode)}, signal=${String(server.child.signalCode)}).`
			)
		}

		try {
			const response = await fetch(`${server.origin}/`, {
				signal: AbortSignal.timeout(1_000)
			})
			if (response.ok) return
			lastRequestError = `HTTP ${response.status} ${response.statusText}`
		} catch (error) {
			lastRequestError = errorMessage(error)
		}

		await delay(100)
	}

	throw readinessError(
		server,
		`Slidev did not become ready within ${SERVER_READY_TIMEOUT_MS} ms. ` +
			`Last readiness error: ${lastRequestError}.`
	)
}

async function waitForChildExit(child: ChildProcess, timeoutMs: number): Promise<boolean> {
	if (child.exitCode !== null || child.signalCode !== null) return true

	return await new Promise((resolve) => {
		const timer = setTimeout(() => {
			child.removeListener("exit", onExit)
			resolve(false)
		}, timeoutMs)
		const onExit = () => {
			clearTimeout(timer)
			resolve(true)
		}
		child.once("exit", onExit)
	})
}

async function stopSlidev(server: RunningSlidev): Promise<void> {
	const { child } = server
	if (child.exitCode !== null || child.signalCode !== null) return

	if (!child.kill("SIGTERM")) {
		throw new Error(`Unable to send SIGTERM to the Slidev child process (pid ${child.pid})`)
	}
	if (await waitForChildExit(child, SERVER_STOP_TIMEOUT_MS)) return

	if (!child.kill("SIGKILL")) {
		throw new Error(`Unable to send SIGKILL to the Slidev child process (pid ${child.pid})`)
	}
	if (!(await waitForChildExit(child, SERVER_STOP_TIMEOUT_MS))) {
		throw new Error(`Slidev child process ${child.pid} did not exit after SIGKILL`)
	}
}

function readPngDimensions(buffer: Buffer, filePath: string): { width: number; height: number } {
	const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
	if (buffer.length < 24 || !buffer.subarray(0, 8).equals(pngSignature)) {
		throw new Error(`${filePath} is not a valid PNG file`)
	}

	return {
		width: buffer.readUInt32BE(16),
		height: buffer.readUInt32BE(20)
	}
}

async function assertPngDimensions(filePath: string): Promise<void> {
	let buffer: Buffer
	try {
		buffer = await readFile(filePath)
	} catch (error) {
		throw new Error(`Expected screenshot is absent: ${filePath}. ${errorMessage(error)}`)
	}

	const dimensions = readPngDimensions(buffer, filePath)
	if (dimensions.width !== CAPTURE_WIDTH || dimensions.height !== CAPTURE_HEIGHT) {
		throw new Error(
			`Screenshot ${filePath} is ${dimensions.width}x${dimensions.height}; ` +
				`expected ${CAPTURE_WIDTH}x${CAPTURE_HEIGHT}`
		)
	}
}

async function captureState(
	context: BrowserContext,
	origin: string,
	entry: CompiledTimelineEntry
): Promise<void> {
	const fileName = stateFileName(entry.page, entry.click)
	const outputPath = path.join(generatedStatesDirectory, fileName)
	const publicOutputPath = path.join(publicGeneratedStatesDirectory, fileName)
	const targetUrl = slideStateUrl(origin, entry.page)
	let page: Page | null = null

	try {
		page = await context.newPage()
		await page.goto(targetUrl, {
			waitUntil: "networkidle",
			timeout: PAGE_READY_TIMEOUT_MS
		})
		await page.locator(`.slidev-page[data-slidev-no="${entry.page}"]`).waitFor({
			state: "visible",
			timeout: PAGE_READY_TIMEOUT_MS
		})
		await page.evaluate(async () => {
			await document.fonts.ready
		})
		await page.waitForLoadState("networkidle", { timeout: PAGE_READY_TIMEOUT_MS })

		for (let click = 1; click <= entry.click; click += 1) {
			await page.keyboard.press("ArrowRight")
			await page.waitForFunction(
				(expectedClick) =>
					Number(new URLSearchParams(window.location.search).get("clicks") ?? 0) === expectedClick,
				click,
				{ timeout: PAGE_READY_TIMEOUT_MS }
			)
		}

		const location = new URL(page.url())
		const expectedPath = `/${entry.page}`
		if (location.pathname !== expectedPath) {
			throw new Error(`navigation reached ${location.pathname}; expected ${expectedPath}`)
		}
		if (location.searchParams.get("narrationCapture") !== "1") {
			throw new Error("the required ?narrationCapture=1 query parameter was lost")
		}
		if (await page.locator(".narration-controller").count()) {
			throw new Error("narration controls are present in capture mode")
		}

		await page.mouse.move(CAPTURE_WIDTH - 1, 1)
		await page.waitForTimeout(entry.transitionMs + 100)
		const screenshot = await page.screenshot({
			type: "png",
			fullPage: false,
			caret: "hide"
		})
		await writeCaptureCopiesAtomically(
			[generatedStatesDirectory, publicGeneratedStatesDirectory],
			fileName,
			screenshot
		)
		await Promise.all([assertPngDimensions(outputPath), assertPngDimensions(publicOutputPath)])
		console.log(`Captured ${fileName}`)
	} catch (error) {
		throw new Error(`Failed to capture ${fileName} from ${targetUrl}: ${errorMessage(error)}`)
	} finally {
		await page?.close()
	}
}

async function verifyCaptureSet(expectedFileNames: string[]): Promise<void> {
	await verifyCaptureDirectory(generatedStatesDirectory, expectedFileNames)
	await verifyCaptureDirectory(publicGeneratedStatesDirectory, expectedFileNames)

	for (const fileName of expectedFileNames) {
		const [canonical, publicMirror] = await Promise.all([
			readFile(path.join(generatedStatesDirectory, fileName)),
			readFile(path.join(publicGeneratedStatesDirectory, fileName))
		])
		if (!canonical.equals(publicMirror)) {
			throw new Error(`Public capture mirror differs from the canonical screenshot: ${fileName}`)
		}
	}
}

async function verifyCaptureDirectory(
	directory: string,
	expectedFileNames: string[]
): Promise<void> {
	for (const fileName of expectedFileNames) {
		await assertPngDimensions(path.join(directory, fileName))
	}

	const actualFileNames = (await readdir(directory))
		.filter((fileName) => fileName.endsWith(".png"))
		.sort()
	const expectedSorted = [...expectedFileNames].sort()
	if (
		actualFileNames.length !== expectedSorted.length ||
		actualFileNames.some((fileName, index) => fileName !== expectedSorted[index])
	) {
		throw new Error(
			`Capture directory ${path.relative(projectRoot, directory)} contains ` +
				`[${actualFileNames.join(", ")}]; ` +
				`expected exactly [${expectedSorted.join(", ")}]`
		)
	}
}

async function captureAllStates(): Promise<void> {
	const timeline = await readTimeline()
	const states = uniqueStates(timeline.entries)
	const firstEntryByState = new Map<string, CompiledTimelineEntry>()
	for (const entry of timeline.entries) {
		const key = stateKey(entry)
		if (!firstEntryByState.has(key)) firstEntryByState.set(key, entry)
	}
	const entries = states.map((state) => {
		const entry = firstEntryByState.get(stateKey(state))
		if (!entry) throw new Error(`No timeline entry found for state ${stateKey(state)}`)
		return entry
	})
	const expectedFileNames = states.map((state) => stateFileName(state.page, state.click))

	await rm(generatedStatesDirectory, { recursive: true, force: true })
	await rm(publicGeneratedStatesDirectory, { recursive: true, force: true })
	await Promise.all([
		mkdir(generatedStatesDirectory, { recursive: true }),
		mkdir(publicGeneratedStatesDirectory, { recursive: true })
	])

	const server = await startSlidev()
	let browser: Browser | null = null
	const failures: unknown[] = []

	try {
		await waitForSlidev(server)
		const { chromium } = await import("playwright")
		browser = await chromium.launch({ headless: true })
		const context = await browser.newContext({
			viewport: { width: CAPTURE_WIDTH, height: CAPTURE_HEIGHT },
			deviceScaleFactor: 1
		})

		for (const entry of entries) {
			await captureState(context, server.origin, entry)
		}

		await context.close()
		await verifyCaptureSet(expectedFileNames)
	} catch (error) {
		failures.push(error)
	} finally {
		if (browser) {
			try {
				await browser.close()
			} catch (error) {
				failures.push(new Error(`Unable to close Chromium: ${errorMessage(error)}`))
			}
		}
		try {
			await stopSlidev(server)
		} catch (error) {
			failures.push(new Error(`Unable to stop child Slidev process: ${errorMessage(error)}`))
		}
	}

	if (failures.length === 1) throw failures[0]
	if (failures.length > 1) throw new AggregateError(failures, "Capture and cleanup both failed")

	console.log(
		`Captured ${entries.length} unique Slidev states at ` +
			`${CAPTURE_WIDTH}x${CAPTURE_HEIGHT} in canonical and public asset directories`
	)
}

async function main(): Promise<void> {
	await captureAllStates()
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	main().catch((error) => {
		console.error(error instanceof Error ? error.message : String(error))
		process.exitCode = 1
	})
}
