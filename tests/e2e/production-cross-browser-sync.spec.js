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

async function runtimeSnapshot(page) {
  return page.evaluate(() => {
    const stateSnapshot = typeof window.getStateSnapshot === 'function' ? window.getStateSnapshot() : null;
    return {
      appReady: window.__GV_APP_READY === true,
      authorized: window.GVAuth?.isAuthorized?.() === true,
      orderCount: Array.isArray(stateSnapshot?.orders) ? stateSnapshot.orders.length : null,
      matchingOrders: Array.isArray(stateSnapshot?.orders) ? stateSnapshot.orders.filter(o => String(o?.address || '').includes('E2E-SYNC-') || String(o?.notes || '').includes('E2E-SYNC-')).map(o => ({ id: o.id, orderNumber: o.orderNumber, address: o.address, notes: o.notes })) : [],
      queue: typeof window.getSyncQueue === 'function' ? window.getSyncQueue() : null,
      syncMeta: typeof window.getSyncMeta === 'function' ? window.getSyncMeta() : null
    };
  });
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
  let stage = 'boot';

  for (const [name, page] of [['A', pageA], ['B', pageB]]) {
    page.on('console', msg => console.log(`[Browser ${name} console:${msg.type()}] ${msg.text()}`));
    page.on('pageerror', error => console.log(`[Browser ${name} pageerror] ${error.stack || error.message}`));
  }

  pageA.on('dialog', dialog => dialog.accept());
  pageB.on('dialog', dialog => dialog.accept());

  try {
    stage = 'login';
    await Promise.all([login(pageA), login(pageB)]);

    stage = 'create';
    await pageA.locator('[data-tab="neworder"]').click();
    await expect(pageA.locator('#orderForm')).toBeVisible();

    // Playwright treats HTML <option> nodes as hidden. Wait for population
    // by count instead of waiting for an option's visibility.
    await expect.poll(
      () => pageA.locator('#clientSelect option').count(),
      { timeout: 30000, intervals: [500, 1000, 2000] }
    ).toBeGreaterThan(1);
    await expect.poll(
      () => pageA.locator('#custTypeSelect option').count(),
      { timeout: 30000, intervals: [500, 1000, 2000] }
    ).toBeGreaterThan(0);

    await pageA.locator('#clientSelect').selectOption({ index: 1 });
    await pageA.locator('#custTypeSelect').selectOption({ index: 0 });
    await pageA.locator('#gallons').fill('1');
    await pageA.locator('#price').fill('30');
    await pageA.locator('#orderAddress').fill(marker);
    await pageA.locator('#orderNotes').fill(marker);
    await pageA.locator('#paymentStatus').selectOption('Unpaid');
    console.log('[Smoke] before Save Order', await runtimeSnapshot(pageA));
    await pageA.locator('#orderForm button[type="submit"]').click();
    await pageA.waitForTimeout(1000);
    console.log('[Smoke] after Save Order', await runtimeSnapshot(pageA));

    await openOrderLog(pageA);
    await expect(orderRow(pageA, marker)).toBeVisible({ timeout: 15000 });
    stage = 'create-A-persisted';

    await openOrderLog(pageB);
    await expect.poll(() => orderRow(pageB, marker).count(), { timeout: 30000, intervals: [1000, 2000, 3000] }).toBe(1);
    stage = 'create-B-converged';

    stage = 'edit';
    await orderRow(pageA, marker).getByRole('button', { name: /Edit/ }).click();
    await expect(pageA.locator('#orderEditModal')).toBeVisible();
    await pageA.locator('#editOrderAddress').fill(editedMarker);
    await pageA.locator('#editOrderNotes').fill(editedMarker);
    await pageA.locator('#orderEditForm button[type="submit"]').click();
    await expect(pageA.locator('#orderEditModal')).toBeHidden();
    await expect.poll(() => orderRow(pageB, editedMarker).count(), { timeout: 30000, intervals: [1000, 2000, 3000] }).toBe(1);
    stage = 'edit-B-converged';

    stage = 'delete';
    await orderRow(pageA, editedMarker).getByRole('button', { name: 'Del' }).click();
    await expect.poll(() => orderRow(pageA, editedMarker).count(), { timeout: 20000, intervals: [1000, 2000] }).toBe(0);
    await expect.poll(() => orderRow(pageB, editedMarker).count(), { timeout: 30000, intervals: [1000, 2000, 3000] }).toBe(0);
    stage = 'delete-B-converged';
  } catch (error) {
    const snapshotA = await runtimeSnapshot(pageA).catch(() => null);
    const snapshotB = await runtimeSnapshot(pageB).catch(() => null);
    console.log('[Smoke] FAILED STAGE', stage);
    console.log('[Smoke] Browser A snapshot', snapshotA);
    console.log('[Smoke] Browser B snapshot', snapshotB);
    throw new Error(`Production Browser A/B smoke failed at stage=${stage}: ${error.message}`);
  } finally {
    await Promise.allSettled([contextA.close(), contextB.close()]);
  }
});
