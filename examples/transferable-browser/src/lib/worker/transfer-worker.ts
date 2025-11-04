import { RPCChannel, WorkerChildIO, transfer } from 'kkrpc/browser';
import type {
	MainAPI,
	WorkerAPI,
	WorkerProcessResult,
	WorkerProvidedBuffer,
	WorkerTransferReport
} from './contracts';

function checksum(data: ArrayBuffer | Uint8Array): number {
	const view = data instanceof Uint8Array ? data : new Uint8Array(data);
	let sum = 0;
	for (const byte of view) {
		sum = (sum + byte) & 0xffff;
	}
	return sum;
}

const io = new WorkerChildIO();
let hostApi: MainAPI | null = null;

const workerAPI: WorkerAPI = {
	async processBuffer(buffer: ArrayBuffer): Promise<WorkerProcessResult> {
		const report: WorkerTransferReport = {
			direction: 'main->worker',
			before: buffer.byteLength,
			after: buffer.byteLength,
			message: 'Worker received buffer from main thread'
		};

		queueMicrotask(() => {
			hostApi?.reportWorkerTransfer(report);
		});

		return {
			receivedLength: buffer.byteLength,
			checksum: checksum(buffer)
		};
	},

	async provideBuffer(size: number): Promise<WorkerProvidedBuffer> {
		const buffer = new ArrayBuffer(size);
		const view = new Uint8Array(buffer);

		if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
			const chunkSize = 65536;
			for (let offset = 0; offset < view.length; offset += chunkSize) {
				const slice = view.subarray(offset, Math.min(offset + chunkSize, view.length));
				crypto.getRandomValues(slice);
			}
		} else {
			for (let i = 0; i < view.length; i += 1) {
				view[i] = (i * 31) & 0xff;
			}
		}

		const checksumValue = checksum(view);
		const descriptor = transfer(buffer, [buffer]);
		const before = buffer.byteLength;

		setTimeout(() => {
			hostApi?.reportWorkerTransfer({
				direction: 'worker->main',
				before,
				after: buffer.byteLength,
				message: 'Worker transferred buffer to main thread'
			});
		}, 0);

		return {
			buffer: descriptor,
			checksum: checksumValue
		};
	}
};

const rpc = new RPCChannel<WorkerAPI, MainAPI>(io, { expose: workerAPI });
hostApi = rpc.getAPI();

hostApi.log('Worker initialised');
