import { access } from 'node:fs/promises'
import { execFile as execFileCallback } from 'node:child_process'
import { promisify } from 'node:util'

const execFile = promisify(execFileCallback)

export async function probeAudioDurationMs(absolutePath: string): Promise<number> {
	try {
		await access(absolutePath)
	} catch {
		throw new Error(`Audio file does not exist: ${absolutePath}`)
	}

	let stdout: string
	try {
		;({ stdout } = await execFile('ffprobe', [
			'-v',
			'error',
			'-show_entries',
			'format=duration',
			'-of',
			'json',
			absolutePath
		]))
	} catch (error) {
		if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
			throw new Error('ffprobe is unavailable; install FFmpeg and ensure ffprobe is on PATH')
		}

		const message = error instanceof Error ? error.message : String(error)
		throw new Error(`Unable to probe audio duration for ${absolutePath}: ${message}`)
	}

	let duration: unknown
	try {
		duration = (JSON.parse(stdout) as { format?: { duration?: unknown } }).format?.duration
	} catch {
		throw new Error(`ffprobe returned invalid JSON for ${absolutePath}`)
	}

	const durationMs = Number(duration) * 1000
	if (!Number.isFinite(durationMs) || durationMs <= 0) {
		throw new Error(`ffprobe returned an invalid duration for ${absolutePath}`)
	}

	return durationMs
}
