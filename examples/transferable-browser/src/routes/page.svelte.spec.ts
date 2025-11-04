import { page } from '@vitest/browser/context';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import Page from './+page.svelte';

describe('/+page.svelte', () => {
	const originalWorker = globalThis.Worker;

	beforeAll(() => {
		class MockWorker {
			onmessage: ((event: MessageEvent) => void) | null = null;
			postMessage() {}
			terminate() {}
			addEventListener() {}
			removeEventListener() {}
		}

		// @ts-expect-error - we are running tests in a mocked environment
		globalThis.Worker = MockWorker;
	});

	afterAll(() => {
		globalThis.Worker = originalWorker;
	});

	it('should render h1', async () => {
		render(Page);

		const heading = page.getByRole('heading', { level: 1 });
		await expect.element(heading).toBeInTheDocument();

		const status = page.getByTestId('worker-status');
		await expect.element(status).toHaveTextContent(/Status:/);
	});
});
