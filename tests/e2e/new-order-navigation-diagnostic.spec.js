const { test, expect } = require('@playwright/test');

const BASE_URL = process.env.GOTAVITA_PRODUCTION_URL;
const EMAIL = process.env.E2E_MANAGER_EMAIL;
const PASSWORD = process.env.E2E_MANAGER_PASSWORD;

if (!BASE_URL || !EMAIL || !PASSWORD) throw new Error('GOTAVITA_PRODUCTION_URL, E2E_MANAGER_EMAIL and E2E_MANAGER_PASSWORD are required.');

async function login(page) {
  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
  await expect.poll(() => page.evaluate(() => Boolean(window.GVAuth?.getClient?.())), { timeout: 30000, intervals: [250, 500, 1000] }).toBeTruthy();
  await page.locator('#gvAuthEmail').fill(EMAIL);
  await page.locator('#gvAuthPassword').fill(PASSWORD);
  await page.locator('#gvAuthForm button[type="submit"]').click();
  await expect(page.locator('html')).toHaveAttribute('data-gv-auth-state', 'unlocked', { timeout: 30000 });
  await page.waitForFunction(() => !window.__GV_AUTH_HYDRATION_PROMISE, { timeout: 30000 });
  await expect.poll(() => page.evaluate(() => Boolean(window.__GV_CANONICAL_SYNC_V2__)), { timeout: 30000, intervals: [250, 500, 1000] }).toBeTruthy();
}

test('diagnose New Order navigation path', async ({ page }) => {
  test.setTimeout(120000);
  const browserErrors = [];
  const pageErrors = [];
  page.on('console', msg => browserErrors.push({ type: msg.type(), text: msg.text() }));
  page.on('pageerror', error => pageErrors.push(String(error?.message || error)));

  await login(page);

  const before = await page.evaluate(() => ({
    authState: document.documentElement.dataset.gvAuthState,
    authorized: window.GVAuth?.isAuthorized?.() === true,
    delegation: document.documentElement.dataset.uiDelegationInstalled || null,
    switchTabType: typeof window.switchTab,
    currentTab: document.querySelector('.tab.active')?.dataset.tab || null,
    currentPanels: [...document.querySelectorAll('.panel')].map(p => ({ id: p.id, active: p.classList.contains('active'), ariaHidden: p.getAttribute('aria-hidden'), display: getComputedStyle(p).display, visibility: getComputedStyle(p).visibility }))
  }));

  await page.locator('[data-tab="neworder"]').click();
  await page.waitForTimeout(250);

  const afterClick = await page.evaluate(() => {
    const panel = document.querySelector('#panel-neworder');
    const tab = document.querySelector('[data-tab="neworder"]');
    const form = document.querySelector('#orderForm');
    return {
      authState: document.documentElement.dataset.gvAuthState,
      authorized: window.GVAuth?.isAuthorized?.() === true,
      delegation: document.documentElement.dataset.uiDelegationInstalled || null,
      tabActive: tab?.classList.contains('active'),
      tabSelected: tab?.getAttribute('aria-selected'),
      panelActive: panel?.classList.contains('active'),
      panelAriaHidden: panel?.getAttribute('aria-hidden'),
      panelDisplay: panel ? getComputedStyle(panel).display : null,
      panelVisibility: panel ? getComputedStyle(panel).visibility : null,
      formDisplay: form ? getComputedStyle(form).display : null,
      formVisibility: form ? getComputedStyle(form).visibility : null,
      switchTabType: typeof window.switchTab,
      inlinePanelStyle: panel?.getAttribute('style') || null,
      browserErrors,
      pageErrors
    };
  });

  let direct = null;
  if (!afterClick.panelActive || afterClick.panelAriaHidden !== 'false' || afterClick.formVisibility === 'hidden' || afterClick.formDisplay === 'none') {
    direct = await page.evaluate(() => {
      try {
        window.switchTab('neworder');
        const panel = document.querySelector('#panel-neworder');
        const tab = document.querySelector('[data-tab="neworder"]');
        const form = document.querySelector('#orderForm');
        return {
          ok: true,
          tabActive: tab?.classList.contains('active'),
          panelActive: panel?.classList.contains('active'),
          panelAriaHidden: panel?.getAttribute('aria-hidden'),
          panelDisplay: panel ? getComputedStyle(panel).display : null,
          panelVisibility: panel ? getComputedStyle(panel).visibility : null,
          formDisplay: form ? getComputedStyle(form).display : null,
          formVisibility: form ? getComputedStyle(form).visibility : null,
          inlinePanelStyle: panel?.getAttribute('style') || null
        };
      } catch (error) {
        return { ok: false, error: String(error?.message || error) };
      }
    });
  }

  console.log(JSON.stringify({ before, afterClick, direct }));
  expect(afterClick.panelActive && afterClick.panelAriaHidden === 'false' && afterClick.formDisplay !== 'none' && afterClick.formVisibility !== 'hidden').toBeTruthy();
});
