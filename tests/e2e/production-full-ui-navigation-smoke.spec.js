const { test, expect } = require('@playwright/test');

const BASE_URL = process.env.GOTAVITA_PRODUCTION_URL || 'https://gotavita-manager-app.carleugenetolentino22.workers.dev';
const EMAIL = process.env.E2E_MANAGER_EMAIL;
const PASSWORD = process.env.E2E_MANAGER_PASSWORD;

if (!EMAIL || !PASSWORD) throw new Error('E2E_MANAGER_EMAIL and E2E_MANAGER_PASSWORD are required.');

async function login(page) {
  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
  await expect.poll(() => page.evaluate(() => Boolean(window.GVAuth?.getClient?.())), {
    timeout: 30000,
    intervals: [250, 500, 1000]
  }).toBeTruthy();
  await page.locator('#gvAuthEmail').fill(EMAIL);
  await page.locator('#gvAuthPassword').fill(PASSWORD);
  await page.locator('#gvAuthForm button[type="submit"]').click();
  await expect(page.locator('html')).toHaveAttribute('data-gv-auth-state', 'unlocked', { timeout: 30000 });
  await expect(page.locator('#gvCloudLogoutBtn')).toBeVisible();
  await page.waitForFunction(() => !window.__GV_AUTH_HYDRATION_PROMISE, { timeout: 30000 });
  await expect.poll(() => page.evaluate(() => Boolean(window.__GV_CANONICAL_SYNC_V2__)), {
    timeout: 30000,
    intervals: [250, 500, 1000]
  }).toBeTruthy();
}

test('production primary business screens render and navigate without page errors', async ({ page }) => {
  test.setTimeout(120000);

  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(String(error?.message || error)));

  await login(page);

  const expectedTabs = [
    ['dashboard', 'panel-dashboard'],
    ['neworder', 'panel-neworder'],
    ['orderlog', 'panel-orderlog'],
    ['expenses', 'panel-expenses'],
    ['groups', 'panel-groups'],
    ['clients', 'panel-clients'],
    ['employees', 'panel-employees'],
    ['reports', 'panel-reports']
  ];

  for (const [tab, panel] of expectedTabs) {
    const button = page.locator(`[data-tab="${tab}"]`).first();
    const section = page.locator(`#${panel}`);
    await expect(button).toBeVisible();
    await expect(section).toHaveCount(1);
    await button.click();
    await expect(section).toBeVisible();
    await expect(section).toHaveAttribute('aria-hidden', 'false');

    const hiddenPanels = await page.locator('main .panel[aria-hidden="false"]').count();
    expect(hiddenPanels).toBe(1);
    console.log(`[UI smoke] ${tab} -> ${panel} PASS`);
  }

  await page.locator('[data-tab="dashboard"]').click();
  await expect(page.locator('#panel-dashboard')).toBeVisible();
  await expect(page.locator('#sumRevenue')).toBeVisible();
  await expect(page.locator('#sumExpense')).toBeVisible();
  await expect(page.locator('#sumNet')).toBeVisible();
  await expect(page.locator('#sumReceivable')).toBeVisible();
  await expect(page.locator('#syncNowBtn')).toBeVisible();
  await expect(page.locator('#undoBtn')).toBeVisible();
  await expect(page.locator('#gvCloudLogoutBtn')).toBeVisible();

  await page.locator('[data-action="toggleDarkMode"]').click();
  await page.locator('[data-action="toggleDarkMode"]').click();

  expect(pageErrors, `Unexpected browser page errors: ${pageErrors.join(' | ')}`).toEqual([]);
});
