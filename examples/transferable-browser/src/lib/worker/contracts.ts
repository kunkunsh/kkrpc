export type TransferDirection = 'main->worker' | 'worker->main';

export interface WorkerTransferReport {
	direction: TransferDirection;
	before: number;
	after: number;
	message?: string;
}

export interface WorkerProcessResult {
	receivedLength: number;
	checksum: number;
}

export interface WorkerProvidedBuffer {
	buffer: ArrayBuffer;
	checksum: number;
}

export interface MainAPI {
	reportWorkerTransfer(report: WorkerTransferReport): void;
	log(message: string): void;
}

export interface WorkerAPI {
	processBuffer(buffer: ArrayBuffer): Promise<WorkerProcessResult>;
	provideBuffer(size: number): Promise<WorkerProvidedBuffer>;
}
