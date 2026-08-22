import assert from 'node:assert/strict';
import test from 'node:test';

// Pure reconciliation contracts for the L300 reporting projection.
// These tests intentionally use representative source records so they can run
// without touching production data or mutating application state.

function sum(rows, key) {
  return rows.reduce((total, row) => total + Number(row[key] || 0), 0);
}

function reconcileRun(run) {
  const expectedRevenue = sum(run.orders, 'expectedRevenue');
  const paid = sum(run.orders, 'paid');
  const gallons = sum(run.orders, 'gallons');
  const delivered = run.orders.filter((order) => order.status === 'delivered').length;
  const pending = run.orders.length - delivered;
  const receivable = Math.max(0, expectedRevenue - paid);

  return {
    orders: run.orders.length,
    gallons,
    expectedRevenue,
    paid,
    receivable,
    delivered,
    pending,
    containersReturned: sum(run.orders, 'containersReturned'),
  };
}

test('L300 run projection reconciles authoritative order values', () => {
  const run = {
    orders: [
      { expectedRevenue: 900, paid: 900, gallons: 10, status: 'delivered', containersReturned: 2 },
      { expectedRevenue: 600, paid: 300, gallons: 8, status: 'pending', containersReturned: 1 },
    ],
  };

  assert.deepEqual(reconcileRun(run), {
    orders: 2,
    gallons: 18,
    expectedRevenue: 1500,
    paid: 1200,
    receivable: 300,
    delivered: 1,
    pending: 1,
    containersReturned: 3,
  });
});

test('weekly and monthly totals equal the sum of their daily run projections', () => {
  const days = [
    { orders: 2, gallons: 18, expectedRevenue: 1500, paid: 1200, receivable: 300, delivered: 1, pending: 1, containersReturned: 3 },
    { orders: 1, gallons: 5, expectedRevenue: 450, paid: 450, receivable: 0, delivered: 1, pending: 0, containersReturned: 1 },
  ];

  const aggregate = days.reduce((total, day) => ({
    orders: total.orders + day.orders,
    gallons: total.gallons + day.gallons,
    expectedRevenue: total.expectedRevenue + day.expectedRevenue,
    paid: total.paid + day.paid,
    receivable: total.receivable + day.receivable,
    delivered: total.delivered + day.delivered,
    pending: total.pending + day.pending,
    containersReturned: total.containersReturned + day.containersReturned,
  }), {
    orders: 0, gallons: 0, expectedRevenue: 0, paid: 0, receivable: 0,
    delivered: 0, pending: 0, containersReturned: 0,
  });

  assert.equal(aggregate.orders, 3);
  assert.equal(aggregate.gallons, 23);
  assert.equal(aggregate.expectedRevenue, 1950);
  assert.equal(aggregate.paid, 1650);
  assert.equal(aggregate.receivable, 300);
  assert.equal(aggregate.delivered, 2);
  assert.equal(aggregate.pending, 1);
  assert.equal(aggregate.containersReturned, 4);
});

test('empty periods produce zero totals', () => {
  const empty = reconcileRun({ orders: [] });
  assert.deepEqual(empty, {
    orders: 0,
    gallons: 0,
    expectedRevenue: 0,
    paid: 0,
    receivable: 0,
    delivered: 0,
    pending: 0,
    containersReturned: 0,
  });
});
