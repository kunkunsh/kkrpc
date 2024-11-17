import { expect, test } from "@playwright/test"

test("home page contains iframe", async ({ page }) => {
	await page.goto("/")
	await expect(page.locator("iframe")).toBeVisible()
})
