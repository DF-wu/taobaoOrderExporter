import assert from 'node:assert/strict';
import test from 'node:test';
import { classify, groupPackages, makePlan, normalizeTracking, wireText } from '../skills/shengtian-predeclare/scripts/predeclare.mjs';

const order = (id, packages, items = [{ subOrderId: id, title: '甲片', sku: '红色' }]) => ({ orderId: id, shopName: '示例店', status: '卖家已发货', items, packages });
const pack = (trackingNumber, subOrderIds = []) => ({ trackingNumber, subOrderIds });

test('merges tracking numbers while preserving exact full order IDs', () => {
  const ids = ['9000000000000000001', '9000000000000000002'];
  const grouped = groupPackages({ schemaVersion: 1, orders: ids.map(id => order(id, [pack('jt0000000000000')])) });
  assert.equal(grouped.packages.length, 1);
  assert.deepEqual(grouped.packages[0].orders.map(o => o.orderId), ids);
  const p = grouped.packages[0]; p.disposition = 'new';
  const labels = Object.fromEntries(ids.map(id => [id, { goods: '甲片', description: '示例甲片' }]));
  const plan = makePlan({ ...grouped, accountMarker: '123456' }, labels);
  assert.equal(plan.entries.length, 1);
  assert.equal(plan.entries[0].number, 1);
  for (const id of ids) assert.ok(plan.entries[0].memo.includes(`[${id}]+[示例甲片]`));
});

test('does not confuse blank warehouse arrivals, manual edits and shipped history', () => {
  assert.equal(classify({}, undefined, { count: 1 }), 'historical');
  assert.equal(classify({}, undefined, { count: 0 }), 'new');
  assert.equal(classify({}, { Is_Yb: 0, goods: '', goods_memo: null }), 'blank-arrived');
  assert.equal(classify({}, { Is_Yb: 0, goods: '甲片', goods_memo: '旧备注' }), 'existing');
  assert.equal(classify({}, { Is_Yb: 1, goods: '', goods_memo: null }), 'existing');
});

test('multi-package item relationships require evidence and never use array position', () => {
  const source = { schemaVersion: 1, orders: [order('1234567890123456789', [pack('JT0000000000001', ['b']), pack('JT0000000000002')],
    [{ subOrderId: 'a', title: '锅子' }, { subOrderId: 'b', title: '甲片' }])] };
  const scan = groupPackages(source);
  assert.deepEqual(scan.packages[0].orders[0].items.map(i => i.subOrderId), ['b']);
  assert.equal(scan.packages[1].orders[0].needsPackageReview, true);
  scan.packages[1].disposition = 'new';
  assert.throws(() => makePlan(scan, { '1234567890123456789': { goods: '甲片', description: '示例甲片' } }), /Unresolved package/);
});

test('rejects masked or numeric tracking and imprecise numeric order IDs', () => {
  assert.throws(() => normalizeTracking('JT123***456'), /masked/);
  assert.throws(() => normalizeTracking(123456789012345678), /strings/);
  assert.throws(() => groupPackages({ schemaVersion: 1, orders: [order(9000000000000000001, [])] }), /Invalid/);
});

test('preserves literal plus/percent through the observed extra server URL decode', () => {
  const original = '[1234567890123456789]+[示例100%甲片]';
  const wire = wireText(original);
  assert.equal(decodeURIComponent(wire.replace(/\+/g, ' ')), original);
  assert.equal(wire, '[1234567890123456789]%2B[示例100%25甲片]');
});

test('long merged memos keep all source IDs until a reviewed alternative is chosen', () => {
  const orders = Array.from({ length: 25 }, (_, i) => ({ orderId: `12345678901234567${String(i).padStart(2, '0')}`, items: [] }));
  const scan = { packages: [{ trackingNumber: 'JT0000000000000', disposition: 'new', orders }] };
  const labels = Object.fromEntries(orders.map(o => [o.orderId, { goods: '甲片', description: '示例甲片' }]));
  const plan = makePlan(scan, labels);
  assert.equal(plan.entries[0].orderIds.length, 25);
  for (const o of orders) assert.ok(plan.entries[0].memo.includes(o.orderId));
  assert.ok(plan.entries[0].memo.length > 500);
});
