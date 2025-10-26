<script lang="ts">
	import { RPCChannel, WorkerParentIO, type DestroyableIoInterface, transfer } from 'kkrpc/browser';
	import { onMount } from 'svelte';
	import type { MainAPI, WorkerAPI, WorkerTransferReport } from '$lib/worker/contracts';

	type ChannelStatus = 'connecting' | 'ready' | 'busy';

	let bufferSize = $state(128 * 1024);
	let remote = $state<WorkerAPI | null>(null);
	let status = $state<ChannelStatus>('connecting');
	let logs = $state<string[]>([]);
	let workerReports = $state<WorkerTransferReport[]>([]);

	let localBefore = $state<number | null>(null);
	let localAfter = $state<number | null>(null);
	let workerReceivedLength = $state<number | null>(null);
	let workerChecksum = $state<number | null>(null);

	let receivedBufferLength = $state<number | null>(null);
	let receivedChecksum = $state<number | null>(null);
	let checksumVerification = $state<number | null>(null);
	let checksumMatches = $state<boolean | null>(null);

	let errorMessage = $state<string | null>(null);

	const localAPI: MainAPI = {
		reportWorkerTransfer(report) {
			workerReports.push(report);
			const label = report.direction === 'worker->main' ? 'Worker → Main' : 'Main → Worker';
			log(`${label}: before ${formatBytes(report.before)}, after ${formatBytes(report.after)}`);
		},
		log(message) {
			log(`Worker: ${message}`);
		}
	};

	const formattedSize = $derived(formatBytes(bufferSize));

	const latestMainToWorker = $derived.by((): WorkerTransferReport | null => {
		for (let i = workerReports.length - 1; i >= 0; i -= 1) {
			if (workerReports[i].direction === 'main->worker') {
				return workerReports[i];
			}
		}
		return null;
	});

	const latestWorkerToMain = $derived.by((): WorkerTransferReport | null => {
		for (let i = workerReports.length - 1; i >= 0; i -= 1) {
			if (workerReports[i].direction === 'worker->main') {
				return workerReports[i];
			}
		}
		return null;
	});

	const statusLabel = $derived.by(() => {
		if (status === 'connecting') return 'Connecting…';
		if (status === 'busy') return 'Processing…';
		return remote ? 'Worker ready' : 'Waiting for worker';
	});

	onMount(() => {
		status = 'connecting';
		const worker = new Worker(new URL('../lib/worker/transfer-worker.ts', import.meta.url), {
			type: 'module'
		});
		const io = new WorkerParentIO(worker);
		const rpc = new RPCChannel<MainAPI, WorkerAPI, DestroyableIoInterface>(io, {
			expose: localAPI,
			enableTransfer: true
		});
		remote = rpc.getAPI();
		status = 'ready';
		log('Worker connected');

		return () => {
			log('Tearing down worker');
			io.destroy();
			remote = null;
			status = 'connecting';
		};
	});

	function log(message: string) {
		const entry = `${new Date().toLocaleTimeString()} — ${message}`;
		logs.push(entry);
		if (logs.length > 50) {
			logs.shift();
		}
	}

	function formatBytes(value: number | null | undefined): string {
		if (value === null || value === undefined) {
			return '—';
		}
		if (value === 0) {
			return '0 B';
		}
		const units = ['B', 'KB', 'MB', 'GB'];
		let size = value;
		let unitIndex = 0;
		while (size >= 1024 && unitIndex < units.length - 1) {
			size /= 1024;
			unitIndex += 1;
		}
		const precision = unitIndex === 0 ? 0 : 1;
		return `${size.toFixed(precision)} ${units[unitIndex]}`;
	}

	function calculateChecksum(buffer: ArrayBuffer): number {
		const view = new Uint8Array(buffer);
		let sum = 0;
		for (const byte of view) {
			sum = (sum + byte) & 0xffff;
		}
		return sum;
	}

	async function sendBuffer() {
		if (!remote) return;
		errorMessage = null;
		status = 'busy';

		const arrayBuffer = new ArrayBuffer(bufferSize);
		const bytes = new Uint8Array(arrayBuffer);
		for (let i = 0; i < bytes.length; i += 1) {
			bytes[i] = i & 0xff;
		}

		localBefore = arrayBuffer.byteLength;
		localAfter = null;
		workerReceivedLength = null;
		workerChecksum = null;
		log(`Sending ${formatBytes(localBefore)} to worker…`);

		try {
			const result = await remote.processBuffer(transfer(arrayBuffer, [arrayBuffer]));
			localAfter = arrayBuffer.byteLength;
			workerReceivedLength = result.receivedLength;
			workerChecksum = result.checksum;

			if (arrayBuffer.byteLength === 0) {
				log('Main buffer was transferred (byteLength is 0).');
			} else {
				log('Main buffer was copied (byteLength unchanged).');
			}
		} catch (error) {
			errorMessage = error instanceof Error ? error.message : String(error);
			log(`Error: ${errorMessage}`);
		} finally {
			status = remote ? 'ready' : 'connecting';
		}
	}

	async function requestBuffer() {
		if (!remote) return;
		errorMessage = null;
		status = 'busy';
		log('Requesting buffer from worker…');

		try {
			const result = await remote.provideBuffer(bufferSize);
			const { buffer, checksum } = result;

			receivedBufferLength = buffer.byteLength;
			receivedChecksum = checksum;

			const localChecksum = calculateChecksum(buffer);
			checksumVerification = localChecksum;
			checksumMatches = localChecksum === checksum;

			log(`Received ${formatBytes(buffer.byteLength)} from worker.`);
			if (checksumMatches) {
				log('Checksum verified successfully.');
			} else {
				log('Checksum mismatch detected.');
			}
		} catch (error) {
			errorMessage = error instanceof Error ? error.message : String(error);
			log(`Error: ${errorMessage}`);
		} finally {
			status = remote ? 'ready' : 'connecting';
		}
	}
</script>

<div class="page">
	<header>
		<h1>Browser Worker Transferables</h1>
		<p>
			This example uses <code>kkrpc</code> transfer support to move <code>ArrayBuffer</code> instances
			between the UI thread and a dedicated worker without copying.
		</p>
	</header>

	<section class="controls">
		<label for="buffer-size">Buffer size</label>
		<div class="slider">
			<input
				id="buffer-size"
				type="range"
				min="1024"
				max="5242880"
				step="1024"
				bind:value={bufferSize}
				aria-describedby="buffer-size-value"
			/>
			<span id="buffer-size-value" data-testid="selected-size">{formattedSize}</span>
		</div>
		<p data-testid="worker-status"><strong>Status:</strong> {statusLabel}</p>
		<div class="actions">
			<button
				data-testid="send-buffer"
				onclick={sendBuffer}
				disabled={!remote || status !== 'ready'}
			>
				Send buffer to worker
			</button>
			<button
				data-testid="request-buffer"
				onclick={requestBuffer}
				disabled={!remote || status !== 'ready'}
			>
				Request buffer from worker
			</button>
		</div>
		{#if errorMessage}
			<p role="alert" class="error">{errorMessage}</p>
		{/if}
	</section>

	<section class="results">
		<h2>Main → Worker</h2>
		<dl>
			<div>
				<dt>Local buffer before send</dt>
				<dd data-testid="local-before">{formatBytes(localBefore)}</dd>
			</div>
			<div>
				<dt>Local buffer after send</dt>
				<dd data-testid="local-after">{formatBytes(localAfter)}</dd>
			</div>
			<div>
				<dt>Worker observed length</dt>
				<dd data-testid="worker-received">{formatBytes(workerReceivedLength)}</dd>
			</div>
			<div>
				<dt>Worker checksum</dt>
				<dd data-testid="worker-checksum">
					{workerChecksum === null ? '—' : `0x${workerChecksum.toString(16)}`}
				</dd>
			</div>
			<div>
				<dt>Worker report (after transfer)</dt>
				<dd data-testid="main-to-worker-report">
					{formatBytes(latestMainToWorker?.after ?? null)}
				</dd>
			</div>
		</dl>
	</section>

	<section class="results">
		<h2>Worker → Main</h2>
		<dl>
			<div>
				<dt>Received buffer length</dt>
				<dd data-testid="received-buffer">{formatBytes(receivedBufferLength)}</dd>
			</div>
			<div>
				<dt>Worker checksum</dt>
				<dd data-testid="received-checksum">
					{receivedChecksum === null ? '—' : `0x${receivedChecksum.toString(16)}`}
				</dd>
			</div>
			<div>
				<dt>Main checksum</dt>
				<dd data-testid="local-checksum">
					{checksumVerification === null ? '—' : `0x${checksumVerification.toString(16)}`}
				</dd>
			</div>
			<div>
				<dt>Checksum match</dt>
				<dd data-testid="checksum-match">
					{checksumMatches === null ? '—' : checksumMatches ? '✅ match' : '⚠️ mismatch'}
				</dd>
			</div>
			<div>
				<dt>Worker report (after transfer)</dt>
				<dd data-testid="worker-to-main-report">
					{formatBytes(latestWorkerToMain?.after ?? null)}
				</dd>
			</div>
		</dl>
	</section>

	<section class="log">
		<h2>Event log</h2>
		<ul data-testid="event-log">
			{#each logs as entry, index (entry + index)}
				<li>{entry}</li>
			{/each}
			{#if logs.length === 0}
				<li>No events yet</li>
			{/if}
		</ul>
	</section>
</div>

<style>
	.page {
		display: flex;
		flex-direction: column;
		gap: 1.5rem;
		padding: 2rem 1.5rem 4rem;
		max-width: 960px;
		margin: 0 auto;
	}

	header > h1 {
		margin-bottom: 0.5rem;
	}

	.controls {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
		border: 1px solid var(--border-color, rgba(0, 0, 0, 0.1));
		border-radius: 0.75rem;
		padding: 1.25rem;
		background: var(--panel-background, rgba(0, 0, 0, 0.02));
	}

	.slider {
		display: flex;
		align-items: center;
		gap: 1rem;
	}

	.slider span {
		min-width: 80px;
		text-align: right;
		font-variant-numeric: tabular-nums;
	}

	input[type='range'] {
		flex: 1;
	}

	.actions {
		display: flex;
		flex-wrap: wrap;
		gap: 0.75rem;
	}

	.actions button {
		padding: 0.6rem 1.2rem;
		border-radius: 9999px;
		border: none;
		background: var(--button-background, #111827);
		color: white;
		font-weight: 600;
		cursor: pointer;
		transition:
			transform 150ms ease,
			opacity 150ms ease;
	}

	.actions button[disabled] {
		opacity: 0.45;
		cursor: not-allowed;
	}

	.actions button:not([disabled]):hover {
		transform: translateY(-1px);
	}

	.results {
		border: 1px solid var(--border-color, rgba(0, 0, 0, 0.1));
		border-radius: 0.75rem;
		padding: 1.25rem;
		background: var(--panel-background, rgba(0, 0, 0, 0.02));
	}

	dl {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
		gap: 0.75rem 1.5rem;
		margin: 0;
	}

	dt {
		font-weight: 600;
		color: var(--dt-color, #374151);
	}

	dd {
		margin: 0.25rem 0 0;
		font-family:
			'JetBrains Mono', Consolas, ui-monospace, SFMono-Regular, Menlo, Monaco, 'Courier New',
			monospace;
	}

	.log {
		border: 1px solid var(--border-color, rgba(0, 0, 0, 0.1));
		border-radius: 0.75rem;
		padding: 1.25rem;
		background: var(--panel-background, rgba(0, 0, 0, 0.02));
	}

	.log ul {
		margin: 0;
		padding-left: 1.25rem;
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
		max-height: 240px;
		overflow-y: auto;
		font-family:
			'JetBrains Mono', Consolas, ui-monospace, SFMono-Regular, Menlo, Monaco, 'Courier New',
			monospace;
		font-size: 0.9rem;
	}

	.error {
		color: #b91c1c;
	}
</style>
