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
  await expect.poll(() => page.evaluate(() => Boolean(window.__GV_CANONICAL_SYNC_V2__)), { timeout: 30000 }).toBeTruthy();
}

test('destructive actions abort before mutation when safety backup fails', async ({ page }) => {
  await login(page);

  const result = await page.evaluate(async () => {
    const appState = window.GVData.getState();
    const originalBackup = window.makeAutoBackup;
    const originalConfirm = window.requestConfirmation;
    const originalFileReader = window.FileReader;

    appState.expenses = [{ id: 'guard-expense', amount: 100, category: 'Test', employeeId: null }];
    appState.dailyReports = [{ id: 'guard-report', type: 'Daily', date: new Date().toISOString(), revenue: 0, expense: 0, net: 0, note: 'guard' }];

    window.requestConfirmation = async () => true;
    window.makeAutoBackup = () => false;

    try {
      await window.deleteExpense('guard-expense');
      await window.deleteDailyReport('guard-report');
      await window.resetToSeed();

      // importData() performs its destructive replacement inside a FileReader
      // callback, so the safety boundary must remain active until onload runs.
      const importPayload = {
        clients: [],
        products: [],
        orders: [],
        expenses: [{ id: 'imported-expense', amount: 1, category: 'Imported', employeeId: null }],
        employees: [],
        orderGroups: [],
        dailyReports: []
      };
      const fileInput = document.createElement('input');
      fileInput.type = 'file';
      const file = new File([JSON.stringify(importPayload)], 'guard-import.json', { type: 'application/json' });
      const transfer = new DataTransfer();
      transfer.items.add(file);
      fileInput.files = transfer.files;
      document.body.appendChild(fileInput);
      window.importData({ target: fileInput });
      await new Promise((resolve) => setTimeout(resolve, 200));
      fileInput.remove();

      return {
        expenseStillPresent: appState.expenses.some((x) => x.id === 'guard-expense'),
        reportStillPresent: appState.dailyReports.some((x) => x.id === 'guard-report'),
        guardLoaded: window.__GV_DESTRUCTIVE_SAFETY_GUARD__ === true,
        importDidNotReplaceState: appState.expenses.some((x) => x.id === 'guard-expense') &&
          !appState.expenses.some((x) => x.id === 'imported-expense'),
        fileReaderRestored: window.FileReader === originalFileReader
      };
    } finally {
      window.makeAutoBackup = originalBackup;
      window.requestConfirmation = originalConfirm;
      window.FileReader = originalFileReader;
      appState.expenses = [];
      appState.dailyReports = [];
    }
  });

  expect(result).toEqual({
    expenseStillPresent: true,
    reportStillPresent: true,
    guardLoaded: true,
    importDidNotReplaceState: true,
    fileReaderRestored: true
  });
});
