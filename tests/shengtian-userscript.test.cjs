const test = require('node:test');
const assert = require('node:assert/strict');
const core = require('../shengtian-predeclare.user.js');

// Every identifier and package below is synthetic; no account exports are fixtures.
const TRACKING = 'JT0000000000001';
const SECOND = 'JT0000000000002';
const ACCOUNT = '123456';
const declaration = (trackingNumber = TRACKING, extra = {}) => ({
  trackingNumber, goods: '打印板', memo: '[9000000000000000001]+[示例100%打印板]', number: 1, ...extra,
});
const entry = (trackingNumber = TRACKING, extra = {}) =>
  core.normalizeInput([declaration(trackingNumber, extra)]).entries[0];
const record = (candidate, extra = {}) => ({
  id: 'synthetic-pack-id', kdBillCode: candidate.trackingNumber,
  goods: candidate.goods, goods_memo: candidate.memo, Number: candidate.number, Is_Yb: 1, ...extra,
});
const newJob = (entries = [entry()]) => ({ accountMarker: ACCOUNT, entries });

function harness(overrides = {}) {
  const state = { rows: [], sent: [], snapshots: [], histories: [] };
  const adapter = {
    account: () => ACCOUNT,
    current: async () => structuredClone(state.rows),
    history: async tracking => { state.histories.push(tracking); return { count: 0 }; },
    submit: async candidate => {
      state.sent.push(candidate.trackingNumber);
      state.rows.push(record(candidate));
      return [{ State: true, MsgText: '提交成功' }];
    },
    ...overrides,
  };
  const save = async job => { state.snapshots.push(structuredClone(job)); };
  const run = (job, options = {}) => core.processQueue({
    job, adapter, save, report: () => {}, intervalMs: 0, wait: async () => {}, ...options,
  });
  return { state, adapter, save, run };
}

test('standalone JSON and reviewed CLI plans preserve string IDs and explicit declaration text', () => {
  for (const input of [[declaration()], { packages: [declaration()] }, { entries: [declaration()], accountMarker: ACCOUNT }]) {
    const normalized = core.normalizeInput(input);
    assert.equal(normalized.entries.length, 1);
    const candidate = normalized.entries[0];
    assert.equal(candidate.trackingNumber, TRACKING);
    assert.equal(candidate.memo, declaration().memo);
    assert.equal(candidate.number, 1);
    assert.deepEqual(core.validateEntry(candidate), []);
  }
  assert.equal(core.normalizeInput({ entries: [declaration()], accountMarker: ACCOUNT }).accountMarker, ACCOUNT);
  assert.equal(core.normalizeTracking('  jt0000000000001  '), TRACKING);
  assert.equal(core.normalizeTracking('001234567890123456789'), '001234567890123456789');
});

test('identical input duplicates become one candidate, conflicting declaration data is blocked', () => {
  const same = core.normalizeInput([declaration(), declaration('jt0000000000001')]);
  assert.equal(same.entries.length, 1);
  assert.notEqual(same.entries[0].status, 'conflict');
  const conflicting = core.normalizeInput([declaration(), declaration(TRACKING, { goods: '锅子' })]);
  assert.equal(conflicting.entries.length, 1);
  assert.equal(conflicting.entries[0].status, 'conflict');
  assert.ok(core.validateEntry(conflicting.entries[0]).length);
});

test('explicitly withholding review remains blocked even when another identical draft was reviewed', async () => {
  for (const input of [[declaration(TRACKING, { reviewed: false })], [declaration(), declaration(TRACKING, { reviewed: false })]]) {
    const candidate = core.normalizeInput(input).entries[0];
    assert.equal(candidate.reviewed, false);
    assert.ok(core.validateEntry(candidate).length);
    const h = harness(); await h.run(newJob([candidate])); assert.equal(h.state.sent.length, 0);
  }
});

test('numeric or masked IDs and invalid package quantities never become sendable candidates', () => {
  for (const value of [123456789012345678, 'JT123***456', '', 'JT12 345678', 'https://example.test/x']) {
    assert.throws(() => core.normalizeTracking(value));
    const normalized = core.normalizeInput([declaration(value)]);
    assert.ok(normalized.issues.length || normalized.entries.some(e => core.validateEntry(e).length));
  }
  for (const number of [0, -1, 1.5, NaN, 'wrong']) {
    const normalized = core.normalizeInput([declaration(TRACKING, { number })]);
    assert.ok(normalized.issues.length || normalized.entries.some(e => core.validateEntry(e).length));
  }
  for (const input of [null, {}, { orders: [] }, 'arbitrary text']) assert.throws(() => core.normalizeInput(input));
});

test('Taobao imports merge shared tracking and preserve source order IDs without summing item quantities', () => {
  const ids = ['9000000000000000001', '9000000000000000002'];
  const source = { schemaVersion: 1, orders: ids.map(orderId => ({
    orderId, shopName: '示例店', logisticsStatus: 'complete',
    items: [{ subOrderId: orderId, title: '示例打印板', sku: 'PEI', quantity: '8' }],
    packages: [{ trackingNumber: TRACKING, subOrderIds: [orderId] }],
  })) };
  const normalized = core.normalizeInput(source);
  assert.equal(normalized.entries.length, 1);
  const candidate = normalized.entries[0];
  assert.deepEqual([...candidate.sourceOrderIds].sort(), ids);
  assert.equal(candidate.number, 1);
  for (const id of ids) assert.ok(candidate.memo.includes(id));
  assert.ok(core.validateEntry(candidate).length, 'unreviewed imported product titles must not be submitted as labels');
  const prepared = core.normalizeInput({ ...source, declarations: { [TRACKING]: { goods: '打印板', memo: candidate.memo } } });
  assert.deepEqual(core.validateEntry(prepared.entries[0]), []);
});

test('Taobao multi-package imports without item evidence require review and do not guess by position', () => {
  const source = { schemaVersion: 1, orders: [{
    orderId: '9000000000000000001', shopName: '示例店', logisticsStatus: 'complete',
    items: [{ subOrderId: 'a', title: '锅子' }, { subOrderId: 'b', title: '打印板' }],
    packages: [{ trackingNumber: TRACKING, subOrderIds: ['b'] }, { trackingNumber: SECOND, subOrderIds: [] }],
  }], declarations: { [SECOND]: { goods: '锅子' } } };
  const normalized = core.normalizeInput(source);
  const ambiguous = normalized.entries.find(e => e.trackingNumber === SECOND);
  assert.ok(core.validateEntry(ambiguous).length);
  source.declarations[SECOND].packageReviewed = true;
  assert.deepEqual(core.validateEntry(core.normalizeInput(source).entries.find(e => e.trackingNumber === SECOND)), []);
});

test('no-logistics orders remain reported exceptions rather than fabricated package numbers', () => {
  const normalized = core.normalizeInput({ schemaVersion: 1, orders: [
    { orderId: '9000000000000000000', logisticsStatus: 'complete', shopName: '示例店', items: [], packages: [{ trackingNumber: TRACKING }] },
    { orderId: '9000000000000000001', logisticsStatus: 'not_required', packages: [], items: [] },
    { orderId: '9000000000000000002', logisticsStatus: 'failed', logisticsError: 'NoPackageInfo', packages: [], items: [] },
  ] });
  assert.equal(normalized.entries.length, 1);
  assert.equal(normalized.entries[0].trackingNumber, TRACKING);
  assert.equal(normalized.issues.length, 2);
  assert.ok(JSON.stringify(normalized.issues).includes('not_required'));
  assert.ok(JSON.stringify(normalized.issues).includes('failed'));
});

test('success parsing uses explicit booleans rather than JavaScript truthiness', () => {
  for (const State of [true, 1, '1', 'true']) assert.equal(core.parseAddResponse([{ State, MsgText: '提交成功' }]).kind, 'success');
  for (const State of [false, 0, '0', 'false']) assert.equal(core.parseAddResponse([{ State, MsgText: '数据无效' }]).kind, 'rejected');
  for (const value of [[], null, {}, [{ State: 'maybe' }], [{ State: true }, { State: true }]]) {
    assert.equal(core.parseAddResponse(value).kind, 'unknown');
  }
  assert.equal(core.parseAddResponse([{ State: false, MsgText: '此快递单号已预报' }]).kind, 'duplicate');
  assert.equal(core.parseAddResponse([{ State: false, MsgText: '查无此快递单号' }]).kind, 'not_found');
  assert.equal(core.parseAddResponse([{ State: false, MsgText: '请先登录' }]).kind, 'auth');
});

test('current package classification preserves manual edits and checks historical shipped records', () => {
  const candidate = entry();
  assert.equal(core.classifyCurrent(candidate, [], { count: 0 }).status, 'ready');
  assert.equal(core.classifyCurrent(candidate, [], { count: 2 }).status, 'historical');
  assert.equal(core.classifyCurrent(candidate, [record(candidate, { Is_Yb: 0, goods: '', goods_memo: null })], { count: 0 }).status, 'blank-arrived');
  for (const data of [{ goods: '手动品名', goods_memo: '' }, { goods: '', goods_memo: '手动备注' }, { goods: '', goods_memo: '', Is_Yb: 1 }]) {
    assert.equal(core.classifyCurrent(candidate, [record(candidate, { Is_Yb: 0, ...data })], { count: 0 }).status, 'existing');
  }
  assert.equal(core.classifyCurrent(candidate, [record(candidate), record(candidate, { id: 'another-id' })], { count: 0 }).status, 'duplicate_server');
});

test('saved record verification compares literal text and quantity and rejects a different tracking number', () => {
  const candidate = entry();
  assert.equal(core.matchesSaved(candidate, record(candidate)), true);
  for (const changes of [{ kdBillCode: SECOND }, { goods: '配件' }, { goods_memo: candidate.memo.replace('+', ' ') }, { Number: 2 }]) {
    assert.equal(core.matchesSaved(candidate, record(candidate, changes)), false);
  }
});

test('official payload preserves plus and percent through the extra server decode and stays one record', () => {
  const candidate = entry(TRACKING, { goods: 'A+B 100%打印板' });
  const body = core.payload(candidate);
  assert.equal(body.length, 1);
  assert.equal(body[0].kdBillcode, TRACKING);
  assert.equal(body[0].Number, 1);
  assert.equal(body[0].Immediatrly, 0);
  assert.equal(body[0].Goodsid, 0);
  assert.equal(body[0].GoodsType, '');
  const form = new URLSearchParams({ datas: JSON.stringify(body) });
  const afterNormalFormDecode = JSON.parse(new URLSearchParams(form.toString()).get('datas'))[0];
  const decodeExtra = text => decodeURIComponent(text.replace(/\+/g, ' '));
  assert.equal(decodeExtra(afterNormalFormDecode.Goods), candidate.goods);
  assert.equal(decodeExtra(afterNormalFormDecode.Goods_meno), candidate.memo);
});

test('submission is journaled before POST and counted complete only after exact server readback', async () => {
  const h = harness();
  const originalSubmit = h.adapter.submit;
  h.adapter.submit = async candidate => {
    assert.ok(h.state.snapshots.some(j => j.entries[0].status === 'submitting'));
    return originalSubmit(candidate);
  };
  const result = await h.run(newJob());
  assert.equal(result.entries[0].status, 'verified');
  assert.deepEqual(h.state.sent, [TRACKING]);
  assert.ok(h.state.histories.includes(TRACKING));
});

test('preexisting and historical packages are skipped without altering their contents', async () => {
  const h = harness({ history: async tracking => ({ count: tracking === SECOND ? 1 : 0 }) });
  h.state.rows = [record(entry(), { goods: '使用者原有品名', goods_memo: '使用者原有备注', Is_Yb: 0 })];
  const before = structuredClone(h.state.rows);
  const result = await h.run(newJob([entry(), entry(SECOND)]));
  assert.equal(result.entries[0].status, 'existing');
  assert.equal(result.entries[1].status, 'historical');
  assert.deepEqual(h.state.sent, []);
  assert.deepEqual(h.state.rows, before);
});

test('blank automatic warehouse arrival can be declared and its existing server ID retained', async () => {
  const h = harness();
  h.state.rows = [record(entry(), { goods: '', goods_memo: '', Is_Yb: 0 })];
  h.adapter.submit = async candidate => {
    h.state.sent.push(candidate.trackingNumber);
    h.state.rows[0] = record(candidate, { id: h.state.rows[0].id });
    return [{ State: true }];
  };
  const result = await h.run(newJob());
  assert.equal(result.entries[0].status, 'verified');
  assert.equal(h.state.rows[0].id, 'synthetic-pack-id');
  assert.deepEqual(h.state.sent, [TRACKING]);
});

test('timeout after server acceptance is recovered by readback without a second POST', async () => {
  const h = harness();
  h.adapter.submit = async candidate => {
    h.state.sent.push(candidate.trackingNumber);
    h.state.rows.push(record(candidate));
    throw new Error('Request timed out after the server accepted it');
  };
  const result = await h.run(newJob());
  assert.equal(result.entries[0].status, 'verified');
  assert.deepEqual(h.state.sent, [TRACKING]);
});

test('success without readback, malformed response and unresolved timeout pause before later packages', async () => {
  for (const response of ['success-without-save', 'malformed', 'timeout']) {
    const h = harness();
    h.adapter.submit = async candidate => {
      h.state.sent.push(candidate.trackingNumber);
      if (response === 'timeout') throw new Error('Network timeout');
      return response === 'malformed' ? { unexpected: true } : [{ State: true }];
    };
    const result = await h.run(newJob([entry(), entry(SECOND)]));
    assert.equal(result.entries[0].status, 'unknown');
    assert.deepEqual(h.state.sent, [TRACKING]);
    assert.notEqual(result.entries[1].status, 'verified');
  }
});

test('explicit per-package not-found response is preserved and does not report a false success', async () => {
  const h = harness();
  h.adapter.submit = async candidate => {
    h.state.sent.push(candidate.trackingNumber);
    return [{ State: false, MsgText: '查无此快递单号' }];
  };
  const result = await h.run(newJob());
  assert.equal(result.entries[0].status, 'not_found');
  assert.deepEqual(h.state.sent, [TRACKING]);
});

test('resume reconciles prior submitting records and never resubmits an uncertain write', async () => {
  for (const status of ['submitting', 'unknown']) {
    const h = harness();
    const candidate = entry(); candidate.status = status;
    const unresolved = await h.run(newJob([candidate]));
    assert.equal(unresolved.entries[0].status, 'unknown');
    assert.deepEqual(h.state.sent, []);
    h.state.rows = [record(candidate)];
    const recovered = await h.run(unresolved);
    assert.equal(recovered.entries[0].status, 'verified');
    assert.deepEqual(h.state.sent, []);
  }
});

test('uncertain reconciliation uses the original sent snapshot even if draft fields were changed', async () => {
  const h = harness();
  const candidate = entry();
  candidate.attempt = { trackingNumber: candidate.trackingNumber, goods: candidate.goods, memo: candidate.memo, number: candidate.number };
  candidate.status = 'unknown';
  h.state.rows = [record(candidate)];
  candidate.goods = '尚未提交的修改品名';
  candidate.memo = '尚未提交的修改备注';
  const result = await h.run(newJob([candidate]));
  assert.equal(result.entries[0].status, 'verified');
  assert.deepEqual(h.state.sent, []);
});

test('portable exported unknown results retain their sent snapshot in a fresh import and cannot double-submit', async () => {
  for (const status of ['submitting', 'unknown']) {
    const original = declaration();
    const exported = { accountMarker: ACCOUNT, entries: [{
      ...original, goods: '修改後但未提交的品名', memo: '修改後但未提交的备注', status, attempt: original,
    }] };
    const imported = core.normalizeInput(JSON.stringify(exported));
    const candidate = imported.entries[0];
    assert.equal(candidate.status, 'unknown');
    assert.equal(candidate.goods, original.goods);
    assert.equal(candidate.memo, original.memo);
    assert.equal(candidate.attempt.memo, original.memo);
    const h = harness();
    const job = { accountMarker: imported.accountMarker, entries: imported.entries };
    const unresolved = await h.run(job);
    assert.equal(unresolved.entries[0].status, 'unknown');
    assert.deepEqual(h.state.sent, []);
    h.state.rows = [record(original)];
    const reconciled = await h.run(unresolved);
    assert.equal(reconciled.entries[0].status, 'verified');
    assert.deepEqual(h.state.sent, []);
  }
});

test('unknown imported entries take precedence over fresh same-tracking drafts in either order', async () => {
  const sent = declaration();
  const unknown = { ...declaration(TRACKING, { goods: '其他草稿品名' }), status: 'unknown', attempt: sent };
  const fresh = declaration(TRACKING, { goods: '新的申报品名' });
  for (const rows of [[fresh, unknown], [unknown, fresh]]) {
    const imported = core.normalizeInput({ accountMarker: ACCOUNT, entries: rows });
    assert.equal(imported.entries.length, 1);
    assert.equal(imported.entries[0].status, 'unknown');
    assert.equal(imported.entries[0].attempt.goods, sent.goods);
    const h = harness();
    const result = await h.run({ accountMarker: ACCOUNT, entries: imported.entries });
    assert.equal(result.entries[0].status, 'unknown');
    assert.deepEqual(h.state.sent, []);
  }
});

test('portable uncertain snapshots with missing or inconsistent identifiers and types are rejected', () => {
  for (const changes of [
    { trackingNumber: SECOND }, { trackingNumber: 9000000000000000001 },
    { goods: null }, { memo: undefined }, { number: '1' }, { number: 0 }, { number: Number.MAX_SAFE_INTEGER + 1 },
  ]) {
    assert.throws(() => core.normalizeInput({ entries: [{
      ...declaration(), status: 'unknown', attempt: { ...declaration(), ...changes },
    }] }));
  }
});

test('malformed existing goods or memo fields cannot become an eligible blank arrival or trigger a POST', async () => {
  for (const changes of [{ goods: 0, goods_memo: '' }, { goods: '', goods_memo: [] }, { goods: {}, goods_memo: '' }]) {
    const h = harness();
    h.state.rows = [record(entry(), { Is_Yb: 0, ...changes })];
    assert.throws(() => core.classifyCurrent(entry(), h.state.rows, { count: 0 }), { code: 'SCHEMA' });
    await assert.rejects(h.run(newJob()), { code: 'SCHEMA' });
    assert.deepEqual(h.state.sent, []);
  }
});

test('deselected candidates and imported labels awaiting review never trigger a write', async () => {
  const h = harness();
  const deselected = entry(); deselected.selected = false;
  const unreviewed = entry(SECOND); unreviewed.needsReview = true; unreviewed.reviewed = false;
  const result = await h.run(newJob([deselected, unreviewed]));
  assert.deepEqual(h.state.sent, []);
  assert.notEqual(result.entries[1].status, 'verified');
});

test('changed/truncated readback and duplicate server records cannot be counted as verified', async () => {
  for (const kind of ['truncated', 'duplicates']) {
    const h = harness();
    h.adapter.submit = async candidate => {
      h.state.sent.push(candidate.trackingNumber);
      h.state.rows = kind === 'truncated'
        ? [record(candidate, { goods_memo: candidate.memo.slice(0, 15) })]
        : [record(candidate), record(candidate, { id: 'second-id' })];
      return [{ State: true }];
    };
    const result = await h.run(newJob([entry(), entry(SECOND)]));
    assert.notEqual(result.entries[0].status, 'verified');
    assert.deepEqual(h.state.sent, [TRACKING]);
  }
});

test('storage failure prevents POST, and account mismatch prevents cross-account declarations', async () => {
  const h = harness();
  await assert.rejects(h.run(newJob(), { save: async () => { throw new Error('Storage quota exceeded'); } }));
  assert.deepEqual(h.state.sent, []);
  h.adapter.account = () => '654321';
  await h.run(newJob()).catch(() => {});
  assert.deepEqual(h.state.sent, []);
});

test('stop during an in-flight write still verifies it and stops before the next candidate', async () => {
  const controller = new AbortController();
  const h = harness();
  const originalSubmit = h.adapter.submit;
  h.adapter.submit = async candidate => {
    const result = await originalSubmit(candidate);
    controller.abort();
    return result;
  };
  const job = newJob([entry(), entry(SECOND)]);
  await h.run(job, { signal: controller.signal }).catch(() => {});
  assert.equal(job.entries[0].status, 'verified');
  assert.deepEqual(h.state.sent, [TRACKING]);
});
