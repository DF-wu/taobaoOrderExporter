const test = require('node:test');
const assert = require('node:assert/strict');
const core = require('../shengtian-predeclare.user.js');

// All products, identifiers, endpoints and credentials here are synthetic.
const TRACKING = 'JT0000000000001';
const ORDER_IDS = ['9000000000000000001', '9000000000000000002'];
const KEY = 'synthetic-secret-never-log-this';
const rawSettings = extra => ({ endpoint: 'https://llm.example.test/v1', model: 'custom-chat-model', ...extra });
const settings = extra => core.normalizeLLMSettings(rawSettings(extra));
const candidate = extra => ({
  trackingNumber: TRACKING, goods: '原始品名', memo: `[${ORDER_IDS[0]}]+[原始備註]`, number: 1,
  sourceOrderIds: [...ORDER_IDS], sourceProducts: [{ title: 'PEI 3D 打印板', sku: '双面 257mm', shopName: '示例店' }],
  status: 'pending', needsReview: false, reviewed: true, selected: true, ...extra,
});
const suggestion = { goods: '打印板', description: '示例PEI打印板' };
const completion = (value = suggestion, extra = {}) => ({
  choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(value) }, ...extra }],
});
const llmRecord = (entry, mode = 'both', value = suggestion) => ({
  suggestion: value, mode, base: { goods: entry.goods, memo: entry.memo },
});

function mockGM(respond) {
  const state = { calls: [], aborted: 0 };
  const gmRequest = details => {
    state.calls.push(details);
    const handle = { abort() { state.aborted++; details.onabort?.({}); } };
    if (respond) queueMicrotask(() => respond(details, state));
    return handle;
  };
  return { state, gmRequest };
}
const success = details => details.onload({ status: 200, finalUrl: details.url, responseText: JSON.stringify(completion()) });
const header = (headers, name) => Object.entries(headers || {}).find(([key]) => key.toLowerCase() === name.toLowerCase())?.[1];

test('LLM settings normalize compatible bases and full endpoints without retaining credentials', () => {
  for (const endpoint of ['https://llm.example.test/v1', 'https://llm.example.test/v1/', 'https://llm.example.test/v1/chat/completions']) {
    const value = core.normalizeLLMSettings({ ...rawSettings({ endpoint }), apiKey: KEY, unrelated: 'discard' });
    assert.equal(value.endpoint, 'https://llm.example.test/v1/chat/completions');
    assert.equal(value.model, 'custom-chat-model');
    assert.equal(value.mode, 'both');
    assert.equal(value.timeoutSeconds, 60);
    assert.equal(value.temperature, null);
    assert.equal(value.jsonMode, false);
    assert.equal(value.instructions, '');
    assert.equal(value.rememberKey, false);
    assert.ok(!JSON.stringify(value).includes(KEY));
    assert.equal(value.unrelated, undefined);
  }
  assert.equal(settings({ endpoint: 'https://llm.example.test' }).endpoint, 'https://llm.example.test/v1/chat/completions');
});

test('custom API endpoints accept loopback HTTP but reject credential-bearing or nonsecure remote URLs', () => {
  for (const endpoint of ['http://localhost:11434/v1', 'http://127.0.0.1:8080/v1', 'http://[::1]:1234/v1']) {
    assert.match(settings({ endpoint }).endpoint, /\/v1\/chat\/completions$/);
  }
  for (const endpoint of ['', 'ftp://llm.example.test/v1', 'javascript:alert(1)', 'http://llm.example.test/v1',
    'https://user:secret@llm.example.test/v1', 'https://llm.example.test/v1?api_key=secret', 'https://llm.example.test/v1#key']) {
    assert.throws(() => settings({ endpoint }));
  }
});

test('invalid model, generation mode and numeric controls fail before any request', () => {
  for (const extra of [{ model: '' }, { model: '   ' }, { mode: 'arbitrary' }, { temperature: -1 },
    { temperature: 3 }, { temperature: NaN }, { timeoutSeconds: 0 }, { timeoutSeconds: 100000 }, { timeoutSeconds: 'invalid' }]) {
    assert.throws(() => settings(extra));
  }
});

test('Taobao and standalone imports retain product facts needed for LLM generation', () => {
  const fromTaobao = core.normalizeInput({ schemaVersion: 1, orders: [{
    orderId: ORDER_IDS[0], shopName: '示例店', items: [{ subOrderId: '9000000000000000003', title: '廣告中的打印耗材', sku: 'PEI 打印板' }],
    packages: [{ trackingNumber: TRACKING, subOrderIds: ['9000000000000000003'] }],
  }] }).entries[0];
  assert.ok(fromTaobao.sourceProducts.some(product => product.title === '廣告中的打印耗材' && product.sku === 'PEI 打印板' && product.shopName === '示例店'));
  const standalone = core.normalizeInput([{ trackingNumber: TRACKING, title: '雙面打印板', sku: '257mm', shopName: '示例店' }]).entries[0];
  assert.ok(standalone.sourceProducts.some(product => product.title === '雙面打印板' && product.sku === '257mm'));
});

test('chat payload uses only product facts and removes identifiers instead of sending the raw export', () => {
  const entry = candidate({
    sourceInfo: 'PRIVATE_RAW_SOURCE_INFO', memo: 'PRIVATE_MEMO_MUST_NOT_SEND', accountMarker: 'PRIVATE_ACCOUNT', actualPaid: 'PRIVATE_AMOUNT',
    sourceProducts: [{ title: `PEI打印板 ${TRACKING} ${ORDER_IDS[0]}`, sku: '257mm 聯絡 0912345678', shopName: '示例店', address: 'PRIVATE_ADDRESS', apiKey: KEY }],
  });
  const body = core.buildLLMRequest(entry, settings());
  assert.equal(body.model, 'custom-chat-model'); assert.equal(body.stream, false);
  assert.equal(body.messages[0].role, 'system'); assert.equal(body.messages[1].role, 'user');
  const user = JSON.parse(body.messages[1].content);
  assert.ok(Array.isArray(user.products));
  assert.match(user.products[0].title, /PEI打印板/); assert.match(user.products[0].sku, /257mm/);
  assert.equal(body.temperature, undefined); assert.equal(body.response_format, undefined);
  const serialized = JSON.stringify(body);
  for (const value of [TRACKING, ...ORDER_IDS, '0912345678', 'PRIVATE_RAW_SOURCE_INFO', 'PRIVATE_MEMO_MUST_NOT_SEND', 'PRIVATE_ACCOUNT', 'PRIVATE_AMOUNT', 'PRIVATE_ADDRESS', KEY]) {
    assert.ok(!serialized.includes(value), `Must omit synthetic private marker ${value}`);
  }
});

test('optional JSON mode and temperature are sent only when enabled', () => {
  const body = core.buildLLMRequest(candidate(), settings({ jsonMode: true, temperature: 0.2, instructions: '用品名簡稱，保留混裝物品。' }));
  assert.deepEqual(body.response_format, { type: 'json_object' }); assert.equal(body.temperature, 0.2);
  assert.ok(JSON.stringify(body.messages).includes('用品名簡稱，保留混裝物品。'));
});

test('known mixed-letter tracking identifiers are redacted regardless of source text letter case', () => {
  const body = core.buildLLMRequest(candidate({ trackingNumber: 'AB12CD34EF56',
    sourceProducts: [{ title: 'PEI打印板 ab12cd34ef56', sku: '257mm', shopName: '示例店' }] }), settings());
  assert.ok(!JSON.stringify(body).toLowerCase().includes('ab12cd34ef56'));
});

test('missing or excessive product context does not silently use private notes or truncate source data', () => {
  assert.throws(() => core.buildLLMRequest(candidate({ sourceProducts: [], goods: '', sourceInfo: '有商品但也有私人訂單資訊' }), settings()), { code: 'LLM_SOURCE' });
  assert.throws(() => core.buildLLMRequest(candidate({ sourceProducts: [{ title: '甲'.repeat(20000), sku: '', shopName: '' }] }), settings()));
  const fallback = core.buildLLMRequest(candidate({ sourceProducts: [], goods: '已核對打印板' }), settings());
  assert.ok(JSON.stringify(fallback).includes('已核對打印板'));
});

test('suggestions accept ordinary, fenced and text-block chat JSON without taking over protected fields', () => {
  for (const response of [completion(), completion(null, { message: { content: '```json\n' + JSON.stringify(suggestion) + '\n```' } }),
    completion(null, { message: { content: [{ type: 'text', text: '{"goods":"打印板",' }, { type: 'text', text: '"description":"示例PEI打印板"}' }] } })]) {
    assert.deepEqual(core.parseLLMSuggestion(response, settings()), suggestion);
  }
  const parsed = core.parseLLMSuggestion(completion({ ...suggestion, trackingNumber: 'JT9999999999999', number: 999, sourceOrderIds: ['wrong'] }), settings());
  assert.deepEqual(parsed, suggestion);
});

test('refused, tool-call, truncated and malformed responses are rejected instead of becoming declarations', () => {
  for (const response of [null, {}, { choices: [] }, completion(null, { finish_reason: 'length' }),
    completion(null, { finish_reason: 'content_filter' }), completion(null, { message: { content: null, refusal: '拒絕回答' } }),
    completion(null, { message: { content: JSON.stringify(suggestion), tool_calls: [{ id: 'synthetic-tool' }] } }),
    completion(null, { message: { content: '不是 JSON' } }), completion([]), completion({ goods: 5, description: '示例' }), completion({ goods: '', description: '示例' })]) {
    assert.throws(() => core.parseLLMSuggestion(response, settings()));
  }
});

test('unsafe or overlong generated text and invented identifiers remain unaccepted suggestions', () => {
  for (const value of [{ goods: '<script>', description: '示例' }, { goods: '打印板', description: '含\u0000字元' },
    { goods: '甲'.repeat(81), description: '示例' }, { goods: '打印板', description: '甲'.repeat(201) },
    { goods: '打印板', description: '新訂單 9000000000000000009' }]) {
    assert.throws(() => core.parseLLMSuggestion(completion(value), settings()));
  }
  assert.equal(core.parseLLMSuggestion(completion({ goods: '打印板' }), settings({ mode: 'goods' })).goods, '打印板');
  assert.equal(core.parseLLMSuggestion(completion({ description: '示例打印板' }), settings({ mode: 'memo' })).description, '示例打印板');
});

test('applying a suggestion preserves exact IDs and quantity and requires human review again', () => {
  const entry = candidate({ number: 7, conflict: true });
  const originalIds = [...entry.sourceOrderIds];
  assert.equal(core.applyLLMSuggestion(entry, llmRecord(entry)), entry);
  assert.equal(entry.goods, suggestion.goods);
  assert.equal(entry.memo, ORDER_IDS.map(id => `[${id}]+[${suggestion.description}]`).join('；'));
  assert.equal(entry.trackingNumber, TRACKING); assert.equal(entry.number, 7); assert.deepEqual(entry.sourceOrderIds, originalIds);
  assert.equal(entry.conflict, true); assert.equal(entry.needsReview, true); assert.equal(entry.reviewed, false); assert.equal(entry.status, 'pending');
});

test('goods-only and memo-only application change exactly the selected fields', () => {
  const goodsOnly = candidate(); const oldMemo = goodsOnly.memo;
  core.applyLLMSuggestion(goodsOnly, llmRecord(goodsOnly, 'goods'));
  assert.equal(goodsOnly.memo, oldMemo); assert.equal(goodsOnly.goods, suggestion.goods);
  const memoOnly = candidate({ sourceOrderIds: [] }); const oldGoods = memoOnly.goods;
  core.applyLLMSuggestion(memoOnly, llmRecord(memoOnly, 'memo'));
  assert.equal(memoOnly.goods, oldGoods); assert.equal(memoOnly.memo, suggestion.description);
});

test('stale suggestions and already-sent or server-preserved records cannot be overwritten by the LLM', () => {
  for (const status of ['verified', 'existing', 'historical', 'rejected', 'not_found', 'duplicate']) {
    const entry = candidate({ status }); const snapshot = structuredClone(entry);
    assert.throws(() => core.applyLLMSuggestion(entry, llmRecord(entry))); assert.deepEqual(entry, snapshot);
  }
  const attempted = candidate({ attempt: { goods: '已送出', memo: '已送出', number: 1 } });
  assert.throws(() => core.applyLLMSuggestion(attempted, llmRecord(attempted)));
  const stale = candidate(); const before = llmRecord(stale); stale.goods = '使用者剛改的品名';
  assert.throws(() => core.applyLLMSuggestion(stale, before)); assert.equal(stale.goods, '使用者剛改的品名');
});

test('failed memo validation cannot partially change the goods while retaining old approval flags', () => {
  const entry = candidate({ sourceOrderIds: [9000000000000000001] });
  const before = structuredClone(entry);
  assert.throws(() => core.applyLLMSuggestion(entry, llmRecord(entry)));
  assert.deepEqual(entry, before);
});

test('batch generation skips protected and source-less rows, remains sequential and saves suggestions without applying', async () => {
  const skipped = [candidate({ status: 'existing' }), candidate({ status: 'unknown' }), candidate({ status: 'submitting' }),
    candidate({ status: 'duplicate_server' }), candidate({ attempt: { goods: '送出中' } }), candidate({ selected: false })];
  const empty = candidate({ trackingNumber: 'JT0000000000002', goods: '', sourceProducts: [] });
  const first = candidate({ trackingNumber: 'JT0000000000003' }), second = candidate({ trackingNumber: 'JT0000000000004' });
  const job = { entries: [...skipped, empty, first, second] }, snapshots = [], calls = [];
  let active = 0, maxActive = 0;
  const before = [first, second].map(entry => ({ goods: entry.goods, memo: entry.memo, reviewed: entry.reviewed }));
  const result = await core.generateLLMSuggestions({ job, settings: settings(), apiKey: KEY,
    save: async current => snapshots.push(structuredClone(current)),
    request: async ({ entry }) => {
      if (entry === second) assert.ok(snapshots.some(snapshot => snapshot.entries.find(row => row.trackingNumber === first.trackingNumber)?.llm));
      calls.push(entry.trackingNumber); active++; maxActive = Math.max(maxActive, active); await Promise.resolve(); active--;
      return { ...suggestion };
    } });
  assert.equal(result, job); assert.deepEqual(calls, [first.trackingNumber, second.trackingNumber]); assert.equal(maxActive, 1);
  assert.match(empty.llmError, /LLM_SOURCE/); assert.equal(job.llmPausedReason, '');
  for (const entry of skipped) assert.equal(entry.llm, undefined);
  for (const [index, entry] of [first, second].entries()) {
    assert.deepEqual({ goods: entry.goods, memo: entry.memo, reviewed: entry.reviewed }, before[index]);
    assert.deepEqual(entry.llm.suggestion, suggestion); assert.deepEqual(entry.llm.base, { goods: entry.goods, memo: entry.memo });
  }
  assert.ok(!JSON.stringify(snapshots).includes(KEY));
});

test('batch authentication or rate failure persists a redacted reason and stops before a later paid request', async () => {
  for (const code of ['LLM_AUTH', 'LLM_RATE_LIMIT']) {
    const first = candidate(), second = candidate({ trackingNumber: 'JT0000000000002' });
    const job = { entries: [first, second] }, snapshots = []; let calls = 0;
    await core.generateLLMSuggestions({ job, settings: settings(), apiKey: KEY,
      save: async current => snapshots.push(structuredClone(current)),
      request: async () => { calls++; throw new core.PredeclareError(code, `Provider rejected Bearer ${KEY}`); } });
    assert.equal(calls, 1); assert.ok(job.llmPausedReason.includes(code)); assert.ok(first.llmError.includes(code));
    assert.equal(second.llm, undefined); assert.equal(first.goods, '原始品名'); assert.equal(first.reviewed, true);
    assert.ok(!JSON.stringify(snapshots).includes(KEY)); assert.ok(!job.llmPausedReason.includes(KEY));
  }
});

test('source preflight failure clears an old LLM suggestion without making a request', async () => {
  const entry = candidate({ goods: '', sourceProducts: [] });
  entry.llm = llmRecord(entry);
  const job = { entries: [entry] }; let calls = 0;
  await core.generateLLMSuggestions({ job, settings: settings(), save: async () => {},
    request: async () => { calls++; return { ...suggestion }; } });
  assert.equal(calls, 0); assert.equal(entry.llm, undefined); assert.match(entry.llmError, /LLM_SOURCE/);
});

test('memo generation rejects invalid source order IDs before paying for a request while goods-only remains available', () => {
  for (const sourceOrderIds of [[9000000000000000001], ['not-an-order-id'], ['']]) {
    const entry = candidate({ sourceOrderIds });
    for (const mode of ['both', 'memo']) assert.throws(() => core.buildLLMRequest(entry, settings({ mode })), { code: 'LLM_SOURCE' });
    assert.doesNotThrow(() => core.buildLLMRequest(entry, settings({ mode: 'goods' })));
  }
});

test('cancelled batch discards the interrupted suggestion and never generates or applies the next row', async () => {
  const controller = new AbortController(), first = candidate(), second = candidate({ trackingNumber: 'JT0000000000002' });
  const job = { entries: [first, second] }; let calls = 0;
  await core.generateLLMSuggestions({ job, settings: settings(), signal: controller.signal, save: async () => {},
    request: async () => { calls++; controller.abort(); return { ...suggestion }; } });
  assert.equal(calls, 1); assert.equal(first.llm, undefined); assert.equal(second.llm, undefined);
  assert.equal(first.goods, '原始品名'); assert.equal(first.reviewed, true); assert.ok(job.llmPausedReason);
});

test('privileged chat request is anonymous, one-shot and uses only the configured Authorization header', async () => {
  const h = mockGM(success);
  assert.deepEqual(await core.requestLLM({ entry: candidate(), settings: settings(), apiKey: KEY, gmRequest: h.gmRequest }), suggestion);
  assert.equal(h.state.calls.length, 1);
  const request = h.state.calls[0];
  assert.equal(request.method, 'POST'); assert.equal(request.url, 'https://llm.example.test/v1/chat/completions');
  assert.equal(request.anonymous, true); assert.equal(request.redirect, 'error');
  assert.equal(header(request.headers, 'Authorization'), `Bearer ${KEY}`);
  assert.match(header(request.headers, 'Content-Type'), /application\/json/);
  assert.equal(header(request.headers, 'Cookie'), undefined);
  const body = JSON.parse(request.data); assert.equal(body.stream, false);
  assert.ok(!JSON.stringify(body).includes(KEY)); assert.ok(!JSON.stringify(body).includes(TRACKING));
});

test('an API without a key does not receive an empty Bearer header or browser cookies', async () => {
  const h = mockGM(success);
  await core.requestLLM({ entry: candidate(), settings: settings({ endpoint: 'http://localhost:11434/v1' }), apiKey: '', gmRequest: h.gmRequest });
  assert.equal(header(h.state.calls[0].headers, 'Authorization'), undefined); assert.equal(h.state.calls[0].anonymous, true);
});

test('a successful response echoing the exact API key in goods or description is rejected without leaking that key', async () => {
  for (const apiKey of [KEY, 'synthetic-token"with\\escapes']) {
    for (const field of ['goods', 'description']) {
      const echoed = { ...suggestion, [field]: apiKey };
      const h = mockGM(details => details.onload({ status: 200, finalUrl: details.url, responseText: JSON.stringify(completion(echoed)) }));
      await assert.rejects(core.requestLLM({ entry: candidate(), settings: settings(), apiKey, gmRequest: h.gmRequest }), error => {
        assert.equal(error.code, 'LLM_FORMAT'); assert.ok(!String(error).includes(apiKey)); assert.ok(!JSON.stringify(error).includes(apiKey)); return true;
      });
      assert.equal(h.state.calls.length, 1);
    }
  }
});

test('HTTP authentication and rate errors do not retry or expose the API key', async () => {
  for (const status of [401, 403, 429]) {
    const h = mockGM(details => details.onload({ status, finalUrl: details.url,
      responseText: JSON.stringify({ error: { message: `Request refused: Bearer ${KEY}` } }) }));
    await assert.rejects(core.requestLLM({ entry: candidate(), settings: settings(), apiKey: KEY, gmRequest: h.gmRequest }), error => {
      assert.ok(!String(error).includes(KEY)); assert.ok(!JSON.stringify(error).includes(KEY)); return true;
    });
    assert.equal(h.state.calls.length, 1);
  }
});

test('unexpected redirect and non-JSON success responses are not accepted as generated text', async () => {
  for (const reply of [{ status: 200, finalUrl: 'https://different.example.test/chat/completions', responseText: JSON.stringify(completion()) },
    { status: 200, responseText: '<html>sign in</html>' }]) {
    const h = mockGM(details => details.onload(reply));
    await assert.rejects(core.requestLLM({ entry: candidate(), settings: settings(), apiKey: KEY, gmRequest: h.gmRequest }));
    assert.equal(h.state.calls.length, 1);
  }
});

test('pre-cancelled and in-flight cancellation never continue an abandoned generation', async () => {
  const before = new AbortController(); before.abort();
  const never = mockGM();
  await assert.rejects(core.requestLLM({ entry: candidate(), settings: settings(), apiKey: KEY, gmRequest: never.gmRequest, signal: before.signal }));
  assert.equal(never.state.calls.length, 0);
  const controller = new AbortController(), pending = mockGM();
  const promise = core.requestLLM({ entry: candidate(), settings: settings(), apiKey: KEY, gmRequest: pending.gmRequest, signal: controller.signal });
  await new Promise(resolve => setImmediate(resolve)); controller.abort();
  await assert.rejects(promise); assert.equal(pending.state.calls.length, 1); assert.equal(pending.state.aborted, 1);
});

test('a local deadline aborts a stalled GM request even if its own timeout callback never arrives', async () => {
  const original = global.setTimeout; let deadline;
  const h = mockGM(); let promise;
  try {
    global.setTimeout = (callback, delay, ...args) => {
      if (delay >= 5000) { deadline = () => callback(...args); return 0; }
      return original(callback, delay, ...args);
    };
    promise = core.requestLLM({ entry: candidate(), settings: settings({ timeoutSeconds: 10 }), apiKey: KEY, gmRequest: h.gmRequest });
  } finally { global.setTimeout = original; }
  assert.equal(typeof deadline, 'function'); deadline();
  await assert.rejects(promise, error => /逾時|超時|timeout|deadline/i.test(error.message));
  assert.equal(h.state.calls.length, 1); assert.equal(h.state.aborted, 1);
});
