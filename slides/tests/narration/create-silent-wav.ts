import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

const CHANNELS = 1
const SAMPLE_RATE = 8_000
const BITS_PER_SAMPLE = 16
const BYTES_PER_SAMPLE = BITS_PER_SAMPLE / 8

export async function createSilentWav(filePath: string, durationMs = 500): Promise<void> {
	const sampleCount = Math.round((SAMPLE_RATE * durationMs) / 1_000)
	const dataSize = sampleCount * CHANNELS * BYTES_PER_SAMPLE
	const bytesPerSecond = SAMPLE_RATE * CHANNELS * BYTES_PER_SAMPLE
	const blockAlign = CHANNELS * BYTES_PER_SAMPLE
	const wav = Buffer.alloc(44 + dataSize)

	wav.write('RIFF', 0)
	wav.writeUInt32LE(36 + dataSize, 4)
	wav.write('WAVEfmt ', 8)
	wav.writeUInt32LE(16, 16)
	wav.writeUInt16LE(1, 20)
	wav.writeUInt16LE(CHANNELS, 22)
	wav.writeUInt32LE(SAMPLE_RATE, 24)
	wav.writeUInt32LE(bytesPerSecond, 28)
	wav.writeUInt16LE(blockAlign, 32)
	wav.writeUInt16LE(BITS_PER_SAMPLE, 34)
	wav.write('data', 36)
	wav.writeUInt32LE(dataSize, 40)

	await mkdir(path.dirname(filePath), { recursive: true })
	await writeFile(filePath, wav)
}
