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

test('production Browser A/B order create-edit-delete convergence', async ({ browser }) => {
  test.setTimeout(150000);
  const contextA = await browser.newContext();
  const contextB = await browser.newContext();
  const a = await contextA.newPage();
  const b = await contextB.newPage();
  const marker = `E2E-SYNC-${Date.now()}`;
  const edited = `${marker}-EDITED`;

  a.on('dialog', dialog => dialog.accept());
  b.on('dialog', dialog => dialog.accept());

  try {
    await login(a);
    await login(b);

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
    expect(created?.id).toBeTruthy();
    expect(created?.orderNumber).toBeTruthy();

    await expect.poll(() => matching(b, marker).then(rows => rows.length), { timeout: 30000, intervals: [1000, 2000, 3000] }).toBe(1);

    const editorDebug = await a.evaluate((id) => {
      const orders = window.getStateSnapshot?.()?.orders || [];
      const matches = orders.filter((o) => String(o?.id) === String(id)).map((o) => ({ id: o.id, idType: typeof o.id, orderNumber: o.orderNumber, address: o.address }));
      const fn = window.openOrderEditor;
      const before = document.querySelector('#orderEditModal')?.getAttribute('aria-hidden');
      const result = typeof fn === 'function' ? fn(id) : 'missing';
      const after = document.querySelector('#orderEditModal')?.getAttribute('aria-hidden');
      return {
        functionType: typeof fn,
        functionSource: typeof fn === 'function' ? String(fn).slice(0, 500) : '',
        toIdType: typeof window.toId,
        id,
        idType: typeof id,
        matches,
        before,
        after,
        result
      };
    }, created.id);
    console.log('[Smoke] editor binding debug', editorDebug);
    await expect(a.locator('#orderEditModal')).toBeVisible();

    await a.locator('#editOrderAddress').fill(edited);
    await a.locator('#editOrderNotes').fill(edited);
    await a.locator('#orderEditForm button[type="submit"]').click();
    await expect(a.locator('#orderEditModal')).toBeHidden();
    await expect.poll(() => matching(a, edited).then(rows => rows.length), { timeout: 20000, intervals: [500, 1000, 2000] }).toBe(1);
    await expect.poll(() => matching(b, edited).then(rows => rows.length), { timeout: 30000, intervals: [1000, 2000, 3000] }).toBe(1);

    await a.evaluate((id) => window.deleteOrder(id), created.id);
    await expect.poll(() => matching(a, edited).then(rows => rows.length), { timeout: 30000, intervals: [1000, 2000] }).toBe(0);
    await expect.poll(() => matching(b, edited).then(rows => rows.length), { timeout: 30000, intervals: [1000, 2000, 3000] }).toBe(0);
  } finally {
    await Promise.allSettled([contextA.close(), contextB.close()]);
  }
});
