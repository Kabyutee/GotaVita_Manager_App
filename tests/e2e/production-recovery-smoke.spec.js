const { test, expect } = require('@playwright/test');

const BASE_URL = process.env.GOTAVITA_PRODUCTION_URL || 'https://gotavita-manager-app.carleugenetolentino22.workers.dev';
const EMAIL = process.env.E2E_MANAGER_EMAIL;
const PASSWORD = process.env.E2E_MANAGER_PASSWORD;

if (!EMAIL || !PASSWORD) throw new Error('E2E_MANAGER_EMAIL and E2E_MANAGER_PASSWORD are required.');

async function login(page) {
  const authResponses = [];
  page.on('response', response => {
    if (response.url().includes('/auth/v1/')) {
      authResponses.push(`${response.status()} ${response.request().method()} ${response.url()}`);
    }
  });
  await page.goto(BASE_URL, { waitUntil: 'networkidle' });
  await expect.poll(() => Boolean(page.locator('#gvAuthForm').count()), { timeout: 30000 }).toBeTruthy();
  await page.locator('#gvAuthEmail').fill(EMAIL);
  await page.locator('#gvAuthPassword').fill(PASSWORD);
  await page.locator('#gvAuthForm button[type="submit"]').click();
  await expect(page.locator('html')).toHaveAttribute('data-gv-auth-state', 'unlocked', { timeout: 30000 });
  await expect(page.locator('#gvCloudLogoutBtn')).toBeVisible();
  return authResponses;
}

function orderRow(page, marker) {
  return page.locator('#orderTableBody tr').filter({ hasText: marker }).first();
}

async function openOrders(page) {
  await page.locator('[data-tab="orderlog"]').click();
  await expect(page.locator('#panel-orderlog')).toHaveAttribute('aria-hidden', 'false');
}

test('production recovered runtime: login + order create/edit/delete convergence', async ({ browser }) => {
  test.setTimeout(150000);
  const contextA = await browser.newContext();
  const contextB = await browser.newContext();
  const a = await contextA.newPage();
  const b = await contextB.newPage();
  const marker = `RECOVERY-SMOKE-${Date.now()}`;
  const edited = `${marker}-EDITED`;

  try {
    const authA = await login(a);
    const authB = await login(b);
    console.log('[Recovery] authA', authA.slice(-5));
    console.log('[Recovery] authB', authB.slice(-5));

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

    await openOrders(a);
    await expect(orderRow(a, marker)).toBeVisible({ timeout: 30000 });
    const createdOrder = await orderRow(a, marker).innerText();
    console.log('[Recovery] created in A:', createdOrder);

    await openOrders(b);
    await expect.poll(() => orderRow(b, marker).count(), { timeout: 40000, intervals: [1000, 2000, 4000] }).toBe(1);

    await openOrders(a);
    await orderRow(a, marker).getByRole('button', { name: /Edit/ }).click();
    await expect(a.locator('#orderEditModal')).toBeVisible();
    await a.locator('#editOrderAddress').fill(edited);
    await a.locator('#editOrderNotes').fill(edited);
    await a.locator('#orderEditForm button[type="submit"]').click();
    await expect(a.locator('#orderEditModal')).toBeHidden();
    await expect.poll(() => orderRow(b, edited).count(), { timeout: 40000, intervals: [1000, 2000, 4000] }).toBe(1);

    await openOrders(a);
    await orderRow(a, edited).getByRole('button', { name: 'Del' }).click();
    await expect.poll(() => orderRow(a, edited).count(), { timeout: 30000, intervals: [1000, 2000] }).toBe(0);
    await expect.poll(() => orderRow(b, edited).count(), { timeout: 40000, intervals: [1000, 2000, 4000] }).toBe(0);

    console.log('[Recovery] CREATE ✅ EDIT ✅ DELETE ✅ A↔B convergence ✅');
  } catch (error) {
    console.log('[Recovery] Browser A HTML:', (await a.locator('html').getAttribute('data-gv-auth-state').catch(() => null)));
    console.log('[Recovery] Browser B HTML:', (await b.locator('html').getAttribute('data-gv-auth-state').catch(() => null)));
    console.log('[Recovery] Browser A URL:', a.url());
    console.log('[Recovery] Browser B URL:', b.url());
    throw error;
  } finally {
    await Promise.allSettled([contextA.close(), contextB.close()]);
  }
});
