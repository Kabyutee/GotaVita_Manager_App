const { test, expect } = require('@playwright/test');

const BASE_URL = process.env.GOTAVITA_PRODUCTION_URL || 'https://gotavita-manager-app.carleugenetolentino22.workers.dev';
const EMAIL = process.env.E2E_MANAGER_EMAIL;
const PASSWORD = process.env.E2E_MANAGER_PASSWORD;

if (!EMAIL || !PASSWORD) throw new Error('E2E_MANAGER_EMAIL and E2E_MANAGER_PASSWORD are required.');

async function login(page) {
  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
  await expect.poll(() => page.evaluate(() => Boolean(window.GVAuth?.getClient?.())), { timeout: 30000, intervals: [250, 500, 1000] }).toBeTruthy();
  await page.locator('#gvAuthEmail').fill(EMAIL);
  await page.locator('#gvAuthPassword').fill(PASSWORD);
  await page.locator('#gvAuthForm button[type="submit"]').click();
  await expect(page.locator('html')).toHaveAttribute('data-gv-auth-state', 'unlocked', { timeout: 30000 });
  await expect(page.locator('#gvCloudLogoutBtn')).toBeVisible();
  await page.waitForFunction(() => !window.__GV_AUTH_HYDRATION_PROMISE, { timeout: 30000 });
  await expect.poll(() => page.evaluate(() => Boolean(window.__GV_CANONICAL_SYNC_V2__)), { timeout: 30000, intervals: [250, 500, 1000] }).toBeTruthy();
}

async function snapshot(page) {
  return page.evaluate(() => typeof window.getStateSnapshot === 'function' ? window.getStateSnapshot() : null);
}

async function matching(page, marker) {
  const current = await snapshot(page);
  return Array.isArray(current?.orders)
    ? current.orders.filter(o => String(o?.address || '').includes(marker) || String(o?.notes || '').includes(marker))
    : [];
}

async function remoteOrders(page, marker) {
  return page.evaluate(async (needle) => {
    const rows = await window.GVData.selectResource('orders');
    return rows.filter(o => String(o?.address || '').includes(needle) || String(o?.notes || '').includes(needle));
  }, marker);
}

async function remoteDeletedOrders(page, marker) {
  return page.evaluate(async (needle) => {
    const rows = await window.GVData.selectResource('deleted_orders');
    return rows.filter(o => String(o?.address || '').includes(needle) || String(o?.notes || '').includes(needle) || String(o?.legacy_payload?.address || '').includes(needle));
  }, marker);
}

async function cleanupCreatedOrder(page, orderId, marker) {
  if (!orderId) return;
  try {
    const live = await matching(page, marker);
    if (live.some((row) => String(row?.id) === String(orderId))) {
      await page.locator('[data-tab="orderlog"]').click();
      await page.locator('[data-sub="all"]').click();
      await page.evaluate((id) => { void window.deleteOrder(id); }, orderId);
      await expect(page.locator('#confirmModal')).toBeVisible({ timeout: 10000 });
      await page.locator('#confirmModalAccept').click();
      await expect(page.locator('#confirmModal')).toBeHidden({ timeout: 10000 });
    }

    await expect.poll(() => remoteOrders(page, marker).then(rows => rows.filter((row) => String(row?.id) === String(orderId)).length), {
      timeout: 30000,
      intervals: [1000, 2000, 3000]
    }).toBe(0);

    await expect.poll(() => remoteDeletedOrders(page, marker).then(rows => rows.length), {
      timeout: 30000,
      intervals: [1000, 2000, 3000]
    }).toBeGreaterThan(0);
  } catch (error) {
    console.warn('[Smoke] production order cleanup failed:', error?.message || error);
  }
}

test('production Browser A/B order create-edit-status-delete convergence at state boundary', async ({ browser }) => {
  test.setTimeout(180000);
  const contextA = await browser.newContext();
  const contextB = await browser.newContext();
  const a = await contextA.newPage();
  const b = await contextB.newPage();
  const marker = `E2E-SYNC-${Date.now()}`;
  const edited = `${marker}-EDITED`;
  let createdOrderId = null;

  a.on('dialog', dialog => dialog.accept());
  b.on('dialog', dialog => dialog.accept());

  try {
    await login(a);
    await login(b);

    const authority = await a.evaluate(() => ({
      canonicalFlag: window.__GV_CANONICAL_SYNC_V2__ === true,
      hasGVSync: Boolean(window.GVSync?.flush),
      syncAliasUsesCanonical: /GVSync\.flush/.test(String(window.syncChangedResources)),
      syncNowUsesCanonical: /GVSync\.flush/.test(String(window.syncNow))
    }));
    expect(authority).toEqual({
      canonicalFlag: true,
      hasGVSync: true,
      syncAliasUsesCanonical: true,
      syncNowUsesCanonical: true
    });
    console.log('[Smoke] canonical runtime authority PASS', authority);

    await a.locator('[data-tab="neworder"]').click();
    await expect(a.locator('#orderForm')).toBeVisible();
    await expect.poll(() => a.locator('#clientSelect option').count(), { timeout: 30000 }).toBeGreaterThan(1);
    await expect.poll(() => a.locator('#custTypeSelect option').count(), { timeout: 30000 }).toBeGreaterThan(0);
    await a.locator('#clientSelect').selectOption({ index: 1 });
    await a.locator('#custTypeSelect').selectOption({ index: 0 });
    await a.locator('#gallons').fill('1');
    await a.locator('#price').fill('30');
    await a.locator('#orderAddress').fill(marker);
    await a.locator('#orderNotes').fill(marker);
    await a.locator('#paymentStatus').selectOption('Unpaid');
    await a.locator('#orderForm button[type="submit"]').click();

    await expect.poll(() => matching(a, marker).then(rows => rows.length), { timeout: 20000, intervals: [500, 1000, 2000] }).toBe(1);
    const created = (await matching(a, marker))[0];
    createdOrderId = created.id;
    expect(created?.id).toBeTruthy();
    expect(created?.orderNumber).toBeTruthy();
    await expect.poll(() => remoteOrders(a, marker).then(rows => rows.length), { timeout: 30000, intervals: [1000, 2000, 3000] }).toBe(1);
    expect((await remoteOrders(a, marker))[0]?.orderNumber).toBe(created.orderNumber);
    console.log('[Smoke] create A + remote canonical PASS', { orderNumber: created.orderNumber });

    await expect.poll(() => matching(b, marker).then(rows => rows.length), { timeout: 30000, intervals: [1000, 2000, 3000] }).toBe(1);
    console.log('[Smoke] create B state PASS');

    await a.evaluate((id) => window.openOrderEditor(id), created.id);
    await expect(a.locator('#orderEditModal')).toBeVisible();
    await a.locator('#editOrderAddress').fill(edited);
    await a.locator('#editOrderNotes').fill(edited);
    await a.locator('#orderEditForm button[type="submit"]').click();
    await expect(a.locator('#orderEditModal')).toBeHidden();
    await expect.poll(() => matching(a, edited).then(rows => rows.length), { timeout: 20000, intervals: [500, 1000, 2000] }).toBe(1);
    await expect.poll(() => remoteOrders(a, edited).then(rows => rows.length), { timeout: 30000, intervals: [1000, 2000, 3000] }).toBe(1);
    expect((await remoteOrders(a, edited))[0]?.updatedAt).toBeTruthy();
    await expect.poll(() => matching(b, edited).then(rows => rows.length), { timeout: 30000, intervals: [1000, 2000, 3000] }).toBe(1);
    console.log('[Smoke] edit A + remote canonical + B state PASS');

    // Exercise the real Paid -> Revert to Unpaid UI path. The Revert action
    // must also reset deliveryStatus from Delivered back to Out for Delivery.
    await a.locator('[data-tab="orderlog"]').click();
    await a.locator('[data-sub="all"]').click();
    const allRow = a.locator('#allOrdersTableBody tr').filter({ hasText: edited }).first();
    await expect(allRow).toBeVisible();
    await allRow.locator('[data-action="updateOrderStatus"]').click();
    await expect.poll(() => matching(a, edited).then(rows => rows[0]?.status), { timeout: 20000, intervals: [500, 1000, 2000] }).toBe('Paid');
    await expect.poll(() => matching(a, edited).then(rows => rows[0]?.deliveryStatus), { timeout: 20000, intervals: [500, 1000, 2000] }).toBe('Delivered');

    await a.locator('[data-sub="completed"]').click();
    const completedRow = a.locator('#billingTableBody tr').filter({ hasText: edited }).first();
    await expect(completedRow).toBeVisible();
    await completedRow.locator('[data-action="revertOrderToUnpaid"]').click();
    await expect.poll(() => matching(a, edited).then(rows => rows[0]?.status), { timeout: 20000, intervals: [500, 1000, 2000] }).toBe('Unpaid');
    await expect.poll(() => matching(a, edited).then(rows => rows[0]?.deliveryStatus), { timeout: 20000, intervals: [500, 1000, 2000] }).toBe('Out for Delivery');
    await expect.poll(() => remoteOrders(a, edited).then(rows => rows[0]?.status), { timeout: 30000, intervals: [1000, 2000, 3000] }).toBe('Unpaid');
    await expect.poll(() => remoteOrders(a, edited).then(rows => rows[0]?.deliveryStatus), { timeout: 30000, intervals: [1000, 2000, 3000] }).toBe('Out for Delivery');
    await expect.poll(() => matching(b, edited).then(rows => rows[0]?.status), { timeout: 30000, intervals: [1000, 2000, 3000] }).toBe('Unpaid');
    await expect.poll(() => matching(b, edited).then(rows => rows[0]?.deliveryStatus), { timeout: 30000, intervals: [1000, 2000, 3000] }).toBe('Out for Delivery');
    console.log('[Smoke] Paid -> Revert to Unpaid delivery/status consistency PASS');

    await a.evaluate((id) => { void window.deleteOrder(id); }, created.id);
    await expect(a.locator('#confirmModal')).toBeVisible();
    await expect(a.locator('#confirmModalAccept')).toBeVisible();
    await a.locator('#confirmModalAccept').click();
    await expect(a.locator('#confirmModal')).toBeHidden();
    await expect.poll(() => matching(a, edited).then(rows => rows.length), { timeout: 30000, intervals: [1000, 2000] }).toBe(0);
    await expect.poll(() => remoteOrders(a, edited).then(rows => rows.length), { timeout: 30000, intervals: [1000, 2000, 3000] }).toBe(0);
    await expect.poll(() => remoteDeletedOrders(a, marker).then(rows => rows.length), { timeout: 30000, intervals: [1000, 2000, 3000] }).toBeGreaterThan(0);
    await expect.poll(() => matching(b, edited).then(rows => rows.length), { timeout: 30000, intervals: [1000, 2000, 3000] }).toBe(0);
    console.log('[Smoke] delete A + remote tombstone + B convergence PASS');
  } finally {
    await cleanupCreatedOrder(a, createdOrderId, marker);
    await Promise.allSettled([contextA.close(), contextB.close()]);
  }
});
