import type { InspectEvent, InspectorBackend } from "../types.ts"

const colors = {
	reset: "\x1b[0m",
	cyan: "\x1b[36m",
	green: "\x1b[32m",
	yellow: "\x1b[33m",
	red: "\x1b[31m",
	gray: "\x1b[90m",
	bold: "\x1b[1m"
}

function truncate(str: string, maxLen: number): string {
	if (str.length <= maxLen) return str
	return str.slice(0, maxLen - 3) + "..."
}

function formatPayload(args: unknown): string {
	if (args === undefined || args === null) return ""
	try {
		const str = JSON.stringify(args)
		return truncate(str, 80)
	} catch {
		return "[unserializable]"
	}
}

function getMessageTypeIcon(event: InspectEvent): string {
	const { type } = event.message
	if (type === "request") return "→"
	if (type === "response") return "←"
	if (type.startsWith("stream-")) return "~"
	if (type === "callback") return "↻"
	return "•"
}

function getMessageColor(event: InspectEvent): string {
	if (event.direction === "sent") return colors.cyan
	return colors.green
}

export const consolePrettyBackend: InspectorBackend = {
	log(event: InspectEvent): void {
		const time = new Date(event.timestamp).toLocaleTimeString("en-US", {
			hour12: false,
			hour: "2-digit",
			minute: "2-digit",
			second: "2-digit"
		})

		const icon = getMessageTypeIcon(event)
		const color = getMessageColor(event)
		const reset = colors.reset

		const method = event.message.method || event.message.type
		const paddedMethod = method.slice(0, 25).padEnd(25)

		const payload = formatPayload(event.message.args || event.message.value)

		const latency = event.duration !== undefined ? `${colors.gray}${event.duration}ms${reset} ` : ""

		const session = colors.gray + event.sessionId.slice(0, 8) + reset

		console.log(
			`${colors.gray}[${time}]${reset} ${session} ${color}${icon}${reset} ${paddedMethod} ${latency}${payload}`
		)

		const msgArgs = event.message.args as { error?: unknown } | undefined
		if (msgArgs && "error" in msgArgs && msgArgs.error) {
			console.log(`  ${colors.red}✖ Error: ${String(msgArgs.error)}${reset}`)
		}
	}
}

export const consoleJsonBackend: InspectorBackend = {
	log(event: InspectEvent): void {
		console.log(JSON.stringify(event))
	}
}
