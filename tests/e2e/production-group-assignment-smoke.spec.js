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
  await page.waitForFunction(() => !window.__GV_AUTH_HYDRATION_PROMISE, { timeout: 30000 });
  await expect.poll(() => page.evaluate(() => Boolean(window.__GV_CANONICAL_SYNC_V2__)), { timeout: 30000, intervals: [250, 500, 1000] }).toBeTruthy();
}

async function snapshot(page) {
  return page.evaluate(() => typeof window.getStateSnapshot === 'function' ? window.getStateSnapshot() : null);
}

async function remoteGroupMembership(page, groupName, orderId) {
  return page.evaluate(async ({ groupName: name, orderId: id }) => {
    const [groups, items] = await Promise.all([
      window.GVData.selectResource('order_groups'),
      window.GVData.selectResource('order_group_items')
    ]);
    const group = groups.find((row) => String(row?.name || '').toLowerCase() === String(name).toLowerCase());
    if (!group) return { group: null, item: null };
    const item = items.find((row) => String(row?.groupLegacyId || '') === String(group.id) && String(row?.orderLegacyId || '') === String(id));
    return { group, item };
  }, { groupName, orderId });
}

async function clickDisbandGroup(page, groupName) {
  const card = page.locator('.group-card').filter({ hasText: groupName }).first();
  await expect(card).toBeVisible();
  await card.locator('[data-action="disbandGroup"]').click();
  await expect(page.locator('#confirmModal')).toBeVisible();
  await page.locator('#confirmModalAccept').click();
  await expect(page.locator('#confirmModal')).toBeHidden();
  await expect(page.locator('.group-card').filter({ hasText: groupName })).toHaveCount(0);
}

test('production Group assignment, edit/reassign, and manager membership persistence', async ({ page }) => {
  test.setTimeout(180000);
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(String(error?.message || error)));

  const marker = `E2E-GROUP-${Date.now()}`;
  const groupA = `${marker}-A`;
  const groupB = `${marker}-B`;
  let orderId = null;

  try {
    await login(page);

    // Create two temporary groups through the real Routes/Groups UI.
    await page.locator('[data-tab="groups"]').click();
    await expect(page.locator('#panel-groups')).toBeVisible();
    await page.locator('#newGroupName').fill(groupA);
    await page.locator('[data-action="createGroup"]').click();
    await expect(page.locator('.group-card').filter({ hasText: groupA })).toBeVisible();
    await page.locator('#newGroupName').fill(groupB);
    await page.locator('[data-action="createGroup"]').click();
    await expect(page.locator('.group-card').filter({ hasText: groupB })).toBeVisible();

    // Create one disposable real order for membership testing.
    await page.locator('[data-tab="neworder"]').click();
    await expect(page.locator('#orderForm')).toBeVisible();
    await expect.poll(() => page.locator('#clientSelect option').count(), { timeout: 30000 }).toBeGreaterThan(1);
    await expect.poll(() => page.locator('#custTypeSelect option').count(), { timeout: 30000 }).toBeGreaterThan(0);
    await page.locator('#clientSelect').selectOption({ index: 1 });
    await page.locator('#custTypeSelect').selectOption({ index: 0 });
    await page.locator('#gallons').fill('1');
    await page.locator('#price').fill('30');
    await page.locator('#orderAddress').fill(marker);
    await page.locator('#orderNotes').fill(marker);
    await page.locator('#paymentStatus').selectOption('Unpaid');
    await page.locator('#orderForm button[type="submit"]').click();

    await expect.poll(() => snapshot(page).then((s) => (s?.orders || []).filter((o) => String(o?.address || '').includes(marker)).length), { timeout: 30000, intervals: [500, 1000, 2000] }).toBe(1);
    const created = (await snapshot(page)).orders.find((o) => String(o?.address || '').includes(marker));
    orderId = created.id;
    expect(orderId).toBeTruthy();
    console.log('[Group Smoke] disposable order created', { orderNumber: created.orderNumber });

    // Use the real bulk Group picker. This exercises dynamic data-action-args serialization.
    await page.locator('[data-tab="orderlog"]').click();
    await page.locator('[data-sub="all"]').click();
    await expect(page.locator(`.all-order-checkbox[value="${orderId}"]`)).toBeVisible();
    await page.locator(`.all-order-checkbox[value="${orderId}"]`).check();
    await page.locator('#allOrdersBulkAction').selectOption('group');
    await page.locator('[data-action="applyAllOrdersBulkAction"]').click();
    await expect(page.locator('#groupPickerModal')).toBeVisible();
    await page.locator('#groupPickerBody .gp-item-btn').filter({ hasText: groupA }).click();
    await expect(page.locator('#groupPickerModal')).toBeHidden();

    await expect.poll(() => snapshot(page).then((s) => {
      const g = (s?.orderGroups || []).find((row) => row.name === groupA);
      return Boolean(g?.orderIds?.some((id) => String(id) === String(orderId))) && Boolean((s?.orderGroupItems || []).some((item) => String(item.groupLegacyId) === String(g?.id) && String(item.orderLegacyId) === String(orderId)));
    }), { timeout: 30000, intervals: [500, 1000, 2000] }).toBeTruthy();
    await expect.poll(() => remoteGroupMembership(page, groupA, orderId).then((x) => Boolean(x.item)), { timeout: 30000, intervals: [1000, 2000, 3000] }).toBeTruthy();
    console.log('[Group Smoke] assign via picker + local child row + remote child row PASS');

    // Edit the order and move it to a second group through the injected group selector.
    await page.evaluate((id) => window.openOrderEditor(id), orderId);
    await expect(page.locator('#orderEditModal')).toBeVisible();
    await expect(page.locator('#editOrderGroup')).toBeVisible();
    await page.locator('#editOrderGroup').selectOption({ label: groupB });
    await page.locator('#orderEditForm button[type="submit"]').click();
    await expect(page.locator('#orderEditModal')).toBeHidden();

    await expect.poll(() => snapshot(page).then((s) => {
      const a = (s?.orderGroups || []).find((row) => row.name === groupA);
      const b = (s?.orderGroups || []).find((row) => row.name === groupB);
      const inA = Boolean(a?.orderIds?.some((id) => String(id) === String(orderId)));
      const inB = Boolean(b?.orderIds?.some((id) => String(id) === String(orderId)));
      return !inA && inB;
    }), { timeout: 30000, intervals: [500, 1000, 2000] }).toBeTruthy();
    await expect.poll(() => remoteGroupMembership(page, groupA, orderId).then((x) => Boolean(x.item)), { timeout: 30000, intervals: [1000, 2000, 3000] }).toBeFalsy();
    await expect.poll(() => remoteGroupMembership(page, groupB, orderId).then((x) => Boolean(x.item)), { timeout: 30000, intervals: [1000, 2000, 3000] }).toBeTruthy();
    console.log('[Group Smoke] edit/reassign + remote membership move PASS');

    // Use Manage Orders to remove the order from the second group.
    await page.locator('[data-tab="groups"]').click();
    const groupBCard = page.locator('.group-card').filter({ hasText: groupB }).first();
    await groupBCard.locator('[data-action="openGroupManager"]').click();
    await expect(page.locator('#groupManageModal')).toBeVisible();
    const managerCheckbox = page.locator(`.group-manage-check[value="${orderId}"]`);
    await expect(managerCheckbox).toBeChecked();
    await managerCheckbox.uncheck();
    await page.locator('[data-action="saveGroupManager"]').click();
    await expect(page.locator('#groupManageModal')).toBeHidden();

    await expect.poll(() => snapshot(page).then((s) => {
      const b = (s?.orderGroups || []).find((row) => row.name === groupB);
      return !Boolean(b?.orderIds?.some((id) => String(id) === String(orderId))) && !(s?.orderGroupItems || []).some((item) => String(item.groupLegacyId) === String(b?.id) && String(item.orderLegacyId) === String(orderId));
    }), { timeout: 30000, intervals: [500, 1000, 2000] }).toBeTruthy();
    await expect.poll(() => remoteGroupMembership(page, groupB, orderId).then((x) => Boolean(x.item)), { timeout: 30000, intervals: [1000, 2000, 3000] }).toBeFalsy();
    console.log('[Group Smoke] Manage Orders removal + remote deletion PASS');

    // Delete the temporary order through the real destructive workflow.
    await page.locator('[data-tab="orderlog"]').click();
    await page.locator('[data-sub="all"]').click();
    await page.evaluate((id) => { void window.deleteOrder(id); }, orderId);
    await expect(page.locator('#confirmModal')).toBeVisible();
    await page.locator('#confirmModalAccept').click();
    await expect(page.locator('#confirmModal')).toBeHidden();
    await expect.poll(() => snapshot(page).then((s) => (s?.orders || []).some((o) => String(o.id) === String(orderId))), { timeout: 30000, intervals: [500, 1000, 2000] }).toBeFalsy();
    console.log('[Group Smoke] temporary order cleanup PASS');

    // Remove the temporary groups through the real Groups UI.
    await page.locator('[data-tab="groups"]').click();
    await clickDisbandGroup(page, groupA);
    await clickDisbandGroup(page, groupB);
    await expect.poll(() => page.evaluate(async ({ names, id }) => {
      const [groups, items] = await Promise.all([
        window.GVData.selectResource('order_groups'),
        window.GVData.selectResource('order_group_items')
      ]);
      return { groups: groups.filter((row) => names.includes(row.name)), orphanedItems: items.filter((row) => String(row.orderLegacyId) === String(id)) };
    }, { names: [groupA, groupB], id: orderId }), { timeout: 30000, intervals: [1000, 2000, 3000] }).toEqual({ groups: [], orphanedItems: [] });
    console.log('[Group Smoke] temporary groups and membership cleanup PASS');

    expect(pageErrors, `Unexpected browser page errors: ${pageErrors.join(' | ')}`).toEqual([]);
  } finally {
    if (orderId) {
      try {
        const state = await snapshot(page);
        if (state?.orders?.some((o) => String(o.id) === String(orderId))) {
          await page.evaluate((id) => { void window.deleteOrder(id); }, orderId);
          if (await page.locator('#confirmModal').isVisible().catch(() => false)) await page.locator('#confirmModalAccept').click();
        }
      } catch (_) {}
    }
  }
});
