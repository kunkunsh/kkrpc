import { expect, test } from '@playwright/test';

test('transfers buffers between main thread and worker', async ({ page }) => {
	await page.goto('/');

	const status = page.getByTestId('worker-status');
	await expect(status).toContainText('Worker ready', { timeout: 7000 });

	const sendButton = page.getByTestId('send-buffer');
	await expect(sendButton).toBeEnabled();
	await sendButton.click();

	await expect(page.getByTestId('local-after')).toHaveText('0 B', { timeout: 7000 });

	const requestButton = page.getByTestId('request-buffer');
	await expect(requestButton).toBeEnabled();
	await requestButton.click();

	await expect(page.getByTestId('received-buffer')).not.toHaveText('—', { timeout: 7000 });
	await expect(page.getByTestId('worker-to-main-report')).toHaveText('0 B', { timeout: 7000 });
	await expect(page.getByTestId('checksum-match')).toContainText('match', { timeout: 7000 });
});
