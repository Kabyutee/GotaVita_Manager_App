const { test, expect } = require('@playwright/test');

const BASE_URL = process.env.GOTAVITA_PRODUCTION_URL || 'https://gotavita-manager-app.carleugenetolentino22.workers.dev';
const EMAIL = process.env.E2E_MANAGER_EMAIL;
const PASSWORD = process.env.E2E_MANAGER_PASSWORD;

if (!EMAIL || !PASSWORD) throw new Error('E2E_MANAGER_EMAIL and E2E_MANAGER_PASSWORD are required.');

async function login(page) {
  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
  await page.locator('#gvAuthEmail').fill(EMAIL);
  await page.locator('#gvAuthPassword').fill(PASSWORD);
  await page.locator('#gvAuthForm button[type="submit"]').click();
  await expect(page.locator('html')).toHaveAttribute('data-gv-auth-state', 'unlocked', { timeout: 30000 });
  await expect(page.locator('#gvCloudLogoutBtn')).toBeVisible();
}

async function openOrderLog(page) {
  await page.locator('[data-tab="orderlog"]').click();
  await expect(page.locator('#panel-orderlog')).toHaveAttribute('aria-hidden', 'false');
}

function orderRow(page, marker) {
  return page.locator('#orderTableBody tr').filter({ hasText: marker }).first();
}

test.describe.configure({ mode: 'serial' });

test('production Browser A/B order create-edit-delete convergence', async ({ browser }) => {
  test.setTimeout(120000);

  const contextA = await browser.newContext();
  const contextB = await browser.newContext();
  const pageA = await contextA.newPage();
  const pageB = await contextB.newPage();
  const marker = `E2E-SYNC-${Date.now()}`;
  const editedMarker = `${marker}-EDITED`;

  pageA.on('dialog', dialog => dialog.accept());
  pageB.on('dialog', dialog => dialog.accept());

  try {
    await Promise.all([login(pageA), login(pageB)]);

    // Orders only: Clients/Employees/Products are read-only during this smoke test.
    await pageA.locator('[data-tab="neworder"]').click();
    await expect(pageA.locator('#orderForm')).toBeVisible();
    await pageA.locator('#clientSelect option').nth(1).waitFor();
    await pageA.locator('#custTypeSelect option').first().waitFor();
    await pageA.locator('#clientSelect').selectOption({ index: 1 });
    await pageA.locator('#custTypeSelect').selectOption({ index: 0 });
    await pageA.locator('#gallons').fill('1');
    await pageA.locator('#price').fill('30');
    await pageA.locator('#orderAddress').fill(marker);
    await pageA.locator('#orderNotes').fill(marker);
    await pageA.locator('#paymentStatus').selectOption('Unpaid');
    await pageA.locator('#orderForm button[type="submit"]').click();

    await openOrderLog(pageA);
    await expect(orderRow(pageA, marker)).toBeVisible({ timeout: 20000 });
    await openOrderLog(pageB);
    await expect.poll(() => orderRow(pageB, marker).count(), { timeout: 30000, intervals: [1000, 2000, 3000] }).toBe(1);

    // Edit in A; verify B receives the edit without refresh.
    await orderRow(pageA, marker).getByRole('button', { name: /Edit/ }).click();
    await expect(pageA.locator('#orderEditModal')).toBeVisible();
    await pageA.locator('#editOrderAddress').fill(editedMarker);
    await pageA.locator('#editOrderNotes').fill(editedMarker);
    await pageA.locator('#orderEditForm button[type="submit"]').click();
    await expect(pageA.locator('#orderEditModal')).toBeHidden();
    await expect.poll(() => orderRow(pageB, editedMarker).count(), { timeout: 30000, intervals: [1000, 2000, 3000] }).toBe(1);

    // Delete in A; verify B receives the tombstone/reconciliation without refresh.
    await orderRow(pageA, editedMarker).getByRole('button', { name: 'Del' }).click();
    await expect.poll(() => orderRow(pageA, editedMarker).count(), { timeout: 20000, intervals: [1000, 2000] }).toBe(0);
    await expect.poll(() => orderRow(pageB, editedMarker).count(), { timeout: 30000, intervals: [1000, 2000, 3000] }).toBe(0);
  } finally {
    await contextA.close();
    await contextB.close();
  }
});
