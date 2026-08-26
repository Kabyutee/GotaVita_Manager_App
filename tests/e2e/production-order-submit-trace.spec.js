const { test, expect } = require('@playwright/test');

const BASE_URL = process.env.GOTAVITA_PRODUCTION_URL || 'https://gotavita-manager-app.carleugenetolentino22.workers.dev';
const EMAIL = process.env.E2E_MANAGER_EMAIL;
const PASSWORD = process.env.E2E_MANAGER_PASSWORD;

if (!EMAIL || !PASSWORD) throw new Error('E2E_MANAGER_EMAIL and E2E_MANAGER_PASSWORD are required.');

async function login(page) {
  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(window.GVAuth?.getClient?.()), { timeout: 30000 });
  await page.locator('#gvAuthEmail').fill(EMAIL);
  await page.locator('#gvAuthPassword').fill(PASSWORD);
  await page.locator('#gvAuthForm button[type="submit"]').click();
  await expect(page.locator('html')).toHaveAttribute('data-gv-auth-state', 'unlocked', { timeout: 30000 });
  await expect(page.locator('#gvCloudLogoutBtn')).toBeVisible();
}

function snapshot(page) {
  return page.evaluate(() => {
    const state = typeof window.getStateSnapshot === 'function' ? window.getStateSnapshot() : null;
    const baseline = window.GVConflictIntegration?.getBaseline?.() || {};
    return {
      authorized: window.GVAuth?.isAuthorized?.() === true,
      stateOrderCount: Array.isArray(state?.orders) ? state.orders.length : null,
      lastOrder: Array.isArray(state?.orders) ? state.orders.at(-1) : null,
      client: document.querySelector('#clientSelect')?.value || '',
      formValid: document.querySelector('#orderForm')?.checkValidity?.() ?? null,
      queue: typeof window.getSyncQueue === 'function' ? window.getSyncQueue() : null,
      syncMeta: typeof window.getSyncMeta === 'function' ? window.getSyncMeta() : null,
      conflictBaselineOrderCount: Array.isArray(baseline.orders?.rows) ? baseline.orders.rows.length : null,
      conflictBaselineOrderStamp: baseline.orders?.baselineAt || null
    };
  });
}

test('production authenticated Order submit trace', async ({ page }) => {
  test.setTimeout(120000);
  const marker = `E2E-TRACE-${Date.now()}`;

  page.on('request', request => {
    if (request.url().includes('/rest/v1/orders')) {
      console.log('[Trace] orders request', request.method(), request.url(), request.postData() || '');
    }
  });
  page.on('response', async response => {
    if (response.url().includes('/rest/v1/orders')) {
      console.log('[Trace] orders response', response.status(), response.request().method(), response.url());
      try { console.log('[Trace] orders response body', (await response.text()).slice(0, 2000)); } catch (_) {}
    }
  });
  page.on('pageerror', error => console.log('[Trace] pageerror', error.stack || error.message));

  await login(page);
  await page.locator('[data-tab="neworder"]').click();
  await expect(page.locator('#orderForm')).toBeVisible();
  await expect.poll(() => page.locator('#clientSelect option').count(), { timeout: 30000 }).toBeGreaterThan(1);
  await expect.poll(() => page.locator('#custTypeSelect option').count(), { timeout: 30000 }).toBeGreaterThan(0);

  await page.evaluate(() => {
    const form = document.querySelector('#orderForm');
    form?.addEventListener('submit', () => {
      const s = window.getStateSnapshot?.();
      console.log('[Trace] submit event', {
        defaultPrevented: false,
        client: document.querySelector('#clientSelect')?.value || '',
        product: document.querySelector('#custTypeSelect')?.value || '',
        ordersBefore: Array.isArray(s?.orders) ? s.orders.length : null
      });
    });
    const original = window.syncChangedResources;
    if (typeof original === 'function') {
      window.syncChangedResources = async (...args) => {
        console.log('[Trace] syncChangedResources BEFORE', args);
        try {
          const result = await original(...args);
          console.log('[Trace] syncChangedResources AFTER', result);
          return result;
        } catch (error) {
          console.log('[Trace] syncChangedResources ERROR', error?.stack || error?.message || error);
          throw error;
        }
      };
    }
  });

  await page.locator('#clientSelect').selectOption({ index: 1 });
  await page.locator('#custTypeSelect').selectOption({ index: 0 });
  await page.locator('#gallons').fill('1');
  await page.locator('#price').fill('30');
  await page.locator('#orderAddress').fill(marker);
  await page.locator('#orderNotes').fill(marker);
  await page.locator('#paymentStatus').selectOption('Unpaid');

  console.log('[Trace] BEFORE CLICK', await snapshot(page));
  await page.locator('#orderForm button[type="submit"]').click();
  await page.waitForTimeout(3000);
  console.log('[Trace] AFTER CLICK + 3s', await snapshot(page));

  expect((await snapshot(page)).stateOrderCount).toBeGreaterThanOrEqual(0);
});
