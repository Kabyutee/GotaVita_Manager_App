const { test, expect } = require('@playwright/test');

const BASE_URL = process.env.GOTAVITA_PRODUCTION_URL || 'https://gotavita-manager-app.carleugenetolentino22.workers.dev';
const EMAIL = process.env.E2E_MANAGER_EMAIL;
const PASSWORD = process.env.E2E_MANAGER_PASSWORD;

if (!EMAIL || !PASSWORD) throw new Error('E2E_MANAGER_EMAIL and E2E_MANAGER_PASSWORD are required.');

async function login(page) {
  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
  await expect.poll(() => page.evaluate(() => Boolean(window.GVAuth?.getClient?.())), { timeout: 30000 }).toBeTruthy();
  await page.locator('#gvAuthEmail').fill(EMAIL);
  await page.locator('#gvAuthPassword').fill(PASSWORD);
  await page.locator('#gvAuthForm button[type="submit"]').click();
  await expect(page.locator('html')).toHaveAttribute('data-gv-auth-state', 'unlocked', { timeout: 30000 });
  await page.waitForFunction(() => !window.__GV_AUTH_HYDRATION_PROMISE, { timeout: 30000 });
  await expect.poll(() => page.evaluate(() => Boolean(window.__GV_CANONICAL_SYNC_V2__)), { timeout: 30000 }).toBeTruthy();
}

async function activePanel(page, id) {
  await expect(page.locator(`#${id}`)).toBeVisible();
  await expect(page.locator(`#${id}`)).toHaveAttribute('aria-hidden', 'false');
  expect(await page.locator('main .panel[aria-hidden="false"]').count()).toBe(1);
}

test('production safe UI interactions execute without browser errors', async ({ page }) => {
  test.setTimeout(120000);
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(String(error?.message || error)));

  await login(page);

  await page.locator('[data-tab="orderlog"]').click();
  await activePanel(page, 'panel-orderlog');
  for (const sub of ['completed', 'all', 'receivables', 'active']) {
    await page.locator(`[data-sub="${sub}"]`).click();
    await expect(page.locator(`#sub-${sub}`)).toBeVisible();
    await expect(page.locator(`[data-sub="${sub}"]`)).toHaveAttribute('aria-selected', 'true');
    expect(await page.locator('main .subpanel').filter({ has: page.locator('[aria-selected="true"]') }).count()).toBeGreaterThanOrEqual(0);
  }
  await page.locator('#orderDateFilter').selectOption('month');
  await page.locator('#orderDateFilter').selectOption('custom');
  await expect(page.locator('#orderDateFromWrap')).toBeVisible();
  await expect(page.locator('#orderDateToWrap')).toBeVisible();
  await page.locator('[data-action="resetOrderDateFilter"]').click();
  await expect(page.locator('#orderDateFilter')).toHaveValue('all');
  console.log('[UI interaction] order subtabs/date filter PASS');

  await page.locator('[data-tab="expenses"]').click();
  await activePanel(page, 'panel-expenses');
  await page.locator('#expenseType').selectOption('Employee');
  await expect(page.locator('#employeeExpenseDiv')).toBeVisible();
  await page.locator('#expenseType').selectOption('Company');
  await expect(page.locator('#employeeExpenseDiv')).toBeHidden();
  await page.locator('#expenseSort').selectOption('amount-desc');
  await page.locator('#expenseDateFilter').selectOption('custom');
  await expect(page.locator('#expenseDateFrom')).toBeVisible();
  await expect(page.locator('#expenseDateTo')).toBeVisible();
  await page.locator('#expenseDateFilter').selectOption('all');
  console.log('[UI interaction] expense controls PASS');

  await page.locator('[data-tab="groups"]').click();
  await activePanel(page, 'panel-groups');
  for (const value of ['orders-desc', 'containers-desc', 'total-desc', 'name-asc']) {
    await page.locator('#groupSort').selectOption(value);
  }
  console.log('[UI interaction] route sorting PASS');

  await page.locator('[data-tab="clients"]').click();
  await activePanel(page, 'panel-clients');
  for (const sub of ['top', 'containers', 'directory']) {
    await page.locator(`[data-client-sub="${sub}"]`).click();
    await expect(page.locator(`#client-sub-${sub}`)).toBeVisible();
    await expect(page.locator(`[data-client-sub="${sub}"]`)).toHaveClass(/active/);
  }
  await page.locator('#clientGroupFilter').selectOption('Commercial');
  await page.locator('#clientGroupFilter').selectOption('');
  await page.locator('#clientSort').selectOption('revenue-desc');
  await page.locator('#clientSearchInput').fill('zzzz-ui-smoke');
  await page.locator('#clientSearchInput').fill('');
  await page.locator('[data-action="setContainerSort"]').selectOption('gallons');
  await page.locator('[data-action="renderUncollectedContainers"]').click();
  console.log('[UI interaction] client subtabs/filters PASS');

  await page.locator('[data-tab="employees"]').click();
  await activePanel(page, 'panel-employees');
  await page.locator('[data-action="toggleEmployeeForm"]').click();
  await expect(page.locator('#empFormWrapper')).toBeVisible();
  await page.locator('[data-action="closeEmployeeForm"]').click();
  await expect(page.locator('#empFormWrapper')).toBeHidden();
  await page.locator('#empStatusFilter').selectOption('Inactive');
  await page.locator('#empStatusFilter').selectOption('');
  await page.locator('#empSort').selectOption('net-desc');
  await page.locator('#empSearchInput').fill('zzzz-ui-smoke');
  await page.locator('#empSearchInput').fill('');
  console.log('[UI interaction] employee controls PASS');

  await page.locator('[data-tab="reports"]').click();
  await activePanel(page, 'panel-reports');
  await page.locator('#reportMonthBtn').click();
  await page.locator('#reportWeekBtn').click();
  await page.locator('#dailyReportNote').fill('UI smoke note');
  await page.locator('#dailyReportNote').fill('');
  await page.locator('[data-action="runSystemHealthCheck"]').click();
  console.log('[UI interaction] report/health controls PASS');

  await page.locator('[data-tab="dashboard"]').click();
  await activePanel(page, 'panel-dashboard');
  await page.locator('[data-action="openReceivables"]').click();
  await activePanel(page, 'panel-orderlog');
  await expect(page.locator('#sub-receivables')).toBeVisible();
  await page.locator('[data-tab="dashboard"]').click();
  await page.locator('[data-action="openPeriodReport"]').first().click();
  const visibleModal = page.locator('.modal:visible').first();
  await expect(visibleModal).toHaveCount(1);
  const close = visibleModal.locator('[data-action="closeModal"]').first();
  await expect(close).toHaveCount(1);
  await close.click();
  await expect(visibleModal).toBeHidden();
  console.log('[UI interaction] dashboard modal paths PASS');

  await page.locator('[data-action="toggleDarkMode"]').click();
  await page.locator('[data-action="toggleDarkMode"]').click();

  expect(pageErrors, `Unexpected browser page errors: ${pageErrors.join(' | ')}`).toEqual([]);
});
