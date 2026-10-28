// ==UserScript==
// @name         聖天集運 JSON 包裹預報
// @namespace    https://github.com/DF-wu/taobaoOrderExporter
// @version      1.0.0
// @description  匯入 JSON、核對現有與歷史包裹，逐筆預報並回讀驗證，保存例外與斷點。
// @match        http://member.stjh168.com/Member/MyPack*
// @match        https://member.stjh168.com/Member/MyPack*
// @downloadURL  https://github.com/DF-wu/taobaoOrderExporter/raw/main/shengtian-predeclare.user.js
// @updateURL    https://github.com/DF-wu/taobaoOrderExporter/raw/main/shengtian-predeclare.user.js
// @grant        none
// @run-at       document-idle
// @noframes
// @license      MIT
// ==/UserScript==

(function () {
  'use strict';
  const VERSION = '1.0.0';
  const HOST_ID = 'shengtian-json-predeclare';
  const FINAL = ['verified', 'existing', 'historical', 'rejected', 'not_found', 'duplicate'];
  const UNCERTAIN = ['submitting', 'unknown'];
  class PredeclareError extends Error {
    constructor(code, message) { super(message); this.name = 'PredeclareError'; this.code = code; }
  }
  const fail = (code, message) => { throw new PredeclareError(code, message); };
  const string = value => typeof value === 'string' ? value.trim() : '';
  const unique = values => [...new Set(values)];
  function normalizeTracking(value) {
    if (typeof value !== 'string') fail('INVALID_TRACKING', '物流單號必須是字串，不能以數字輸入。');
    const result = value.trim().toUpperCase();
    if (!/^[A-Z0-9]{8,40}$/.test(result)) fail('INVALID_TRACKING', '物流單號須為 8–40 個英數字，不可包含遮蔽符號或空白。');
    return result;
  }
  // 該站額外 URL decode 一次；先保護文字中的百分比與加號，再交給正常表單編碼。
  const wireText = value => value.replace(/%/g, '%25').replace(/\+/g, '%2B');
  function validateEntry(entry) {
    const errors = [];
    try { normalizeTracking(entry.trackingNumber); } catch (error) { errors.push(error.message); }
    if (!string(entry.goods)) errors.push('請填寫已核對的簡短貨物品名。');
    if (typeof entry.memo !== 'string') errors.push('備註必須是字串。');
    if (!Number.isSafeInteger(entry.number) || entry.number < 1 || entry.number > 2147483647) errors.push('數量必須是正整數（預設一個包裹為 1）。');
    if (/[\u0000-\u001f<>]/.test((entry.goods || '') + (entry.memo || ''))) errors.push('品名／備註包含控制字元或尖括號，請修正。');
    if (entry.conflict) errors.push('同一單號有不同申報內容，請核對並勾選採用此列內容。');
    if (entry.needsReview && !entry.reviewed) errors.push('請核對品名及包裹商品關聯後勾選此列「已核對」。');
    return errors;
  }

  /** 只建議來源資訊，不從商品廣告標題猜測報關品名；只有明確提供的 goods 才能直接提交。 */
  function normalizeInput(input) {
    if (typeof input === 'string') {
      try { input = JSON.parse(input.replace(/^\uFEFF/, '')); } catch { fail('INPUT', 'JSON 格式錯誤，請檢查引號及逗號。'); }
    }
    const issues = [], grouped = new Map();
    let source, taobao = false;
    if (Array.isArray(input)) source = input;
    else if (input && Array.isArray(input.entries)) source = input.entries;
    else if (input && Array.isArray(input.packages)) source = input.packages;
    else if (input?.schemaVersion === 1 && Array.isArray(input.orders)) { source = input.orders; taobao = true; }
    else fail('INPUT', '支援包裹陣列、packages、entries 計畫或 schemaVersion 1 淘寶 JSON。');
    if (source.length > 5000) fail('INPUT', '每批最多 5,000 筆來源，請分批匯入。');
    function add(raw, index) {
      let trackingNumber, invalid = '';
      try { trackingNumber = normalizeTracking(raw?.trackingNumber); }
      catch (error) { trackingNumber = typeof raw?.trackingNumber === 'string' ? raw.trackingNumber : ''; invalid = error.message; }
      const entry = { trackingNumber, goods: typeof raw?.goods === 'string' ? raw.goods.trim() : '',
        memo: raw?.memo == null ? '' : raw.memo, number: raw?.number ?? 1,
        sourceOrderIds: raw?.sourceOrderIds || [], sourceInfo: raw?.sourceInfo || '',
        needsReview: !!raw?.needsReview || raw?.reviewed === false, reviewed: raw?.reviewed !== false && !raw?.needsReview,
        selected: true, status: 'pending', message: invalid };
      // 結果匯出檔帶回另一瀏覽器時，也必須保留未知寫入的原始比對內容。
      if (UNCERTAIN.includes(raw?.status)) {
        const sent = raw?.attempt || raw;
        if (normalizeTracking(sent.trackingNumber) !== trackingNumber || typeof sent.goods !== 'string' || typeof sent.memo !== 'string' || !Number.isSafeInteger(sent.number) || sent.number < 1) fail('INPUT', '未知提交紀錄缺少完整原始內容，不能當成新計畫匯入。');
        Object.assign(entry, { goods: sent.goods, memo: sent.memo, number: sent.number,
          attempt: { trackingNumber, goods: sent.goods, memo: sent.memo, number: sent.number },
          needsReview: false, reviewed: true, status: 'unknown', message: '匯入的未知提交必須先只讀回查，不能直接重送。' });
      }
      const key = invalid ? `invalid:${index}` : trackingNumber;
      const previous = grouped.get(key);
      if (previous) {
        previous.sourceOrderIds = unique([...previous.sourceOrderIds, ...entry.sourceOrderIds]);
        previous.sourceInfo = unique([previous.sourceInfo, entry.sourceInfo].filter(Boolean)).join('；');
        previous.needsReview ||= entry.needsReview; previous.reviewed &&= entry.reviewed;
        if (previous.goods !== entry.goods || previous.memo !== entry.memo || previous.number !== entry.number) {
          previous.conflict = true; previous.needsReview = true; previous.reviewed = false;
          previous.status = 'conflict';
          previous.message = '重複單號的品名／備註／數量不一致，請核對所有來源後採用此列內容。';
        }
        if (entry.attempt || previous.attempt) {
          const uncertain = previous.attempt ? previous : entry;
          Object.assign(previous, { goods: uncertain.goods, memo: uncertain.memo, number: uncertain.number,
            attempt: uncertain.attempt, status: 'unknown', message: '同一單號含未知提交紀錄，必須先回查。' });
        } else if (previous.needsReview && !previous.reviewed && !previous.conflict) previous.status = 'invalid';
        issues.push({ code: previous.conflict ? 'conflict' : 'duplicate_input', trackingNumber, message: '相同物流單號合併為一列。' });
        return;
      }
      const errors = validateEntry(entry);
      if (!entry.attempt) { entry.status = entry.conflict ? 'conflict' : errors.length ? 'invalid' : 'pending'; entry.message = invalid || errors.join(' '); }
      grouped.set(key, entry);
    }
    if (!taobao) source.forEach((raw, index) => add(raw, index));
    else {
      const packs = new Map(), seenOrders = new Set();
      for (const order of source) {
        if (typeof order?.orderId !== 'string' || !/^\d+$/.test(order.orderId) || seenOrders.has(order.orderId)) fail('INPUT', '淘寶主訂單號必須是唯一的數字字串。');
        seenOrders.add(order.orderId);
        if (!Array.isArray(order.packages)) fail('INPUT', '淘寶訂單缺少 packages 陣列。');
        if (!order.packages.length) issues.push({ code: order.logisticsStatus || 'no_tracking', orderId: order.orderId,
          message: order.logisticsError || order.logisticsNote || '這筆訂單沒有可預報的物流單號。' });
        for (const pack of order.packages) {
          let tracking;
          try { tracking = normalizeTracking(pack.trackingNumber); }
          catch (error) { issues.push({ code: 'invalid_tracking', orderId: order.orderId, message: error.message }); continue; }
          if (!packs.has(tracking)) packs.set(tracking, { trackingNumber: tracking, orders: new Map(), ambiguous: false });
          const target = packs.get(tracking);
          const items = Array.isArray(order.items) ? order.items : [];
          const ids = Array.isArray(pack.subOrderIds) ? pack.subOrderIds : [];
          const matched = items.filter(item => ids.includes(item.subOrderId));
          const related = matched.length && ids.every(id => matched.some(item => item.subOrderId === id)) ? matched
            : order.packages.length === 1 ? items : [];
          const goods = Array.isArray(pack.goods) ? pack.goods : [];
          if (!related.length && !goods.length && order.packages.length > 1) target.ambiguous = true;
          const description = (goods.length ? goods : related).map(item => [item.title, item.sku].filter(Boolean).join('／')).join('、');
          target.orders.set(order.orderId, { shop: string(order.shopName), description });
        }
      }
      for (const pack of packs.values()) {
        const label = input.declarations && Object.hasOwn(input.declarations, pack.trackingNumber) ? input.declarations[pack.trackingNumber] : {};
        const sources = [...pack.orders];
        add({ trackingNumber: pack.trackingNumber, goods: label?.goods, number: label?.number ?? 1,
          memo: label?.memo ?? sources.map(([id, value]) => `[${id}]+[${value.shop}]`).join('；'),
          sourceOrderIds: sources.map(([id]) => id), sourceInfo: sources.map(([id, value]) => `${id} ${value.shop} ${value.description}`).join('；'),
          needsReview: !string(label?.goods) || (pack.ambiguous && label?.packageReviewed !== true) }, grouped.size);
      }
    }
    if (!grouped.size) fail('INPUT', '沒有可匯入的包裹。沒有單號的訂單不會建立預報。');
    return { entries: [...grouped.values()], issues, accountMarker: input?.accountMarker == null ? undefined : String(input.accountMarker) };
  }

  function parseAddResponse(value) {
    if (!Array.isArray(value) || value.length !== 1 || !value[0] || typeof value[0] !== 'object') return { kind: 'unknown', message: '預報回應不是單筆結果陣列。' };
    const row = value[0], message = typeof row.MsgText === 'string' ? row.MsgText : '';
    if (row.State === true || row.State === 1 || row.State === '1' || row.State === 'true') return { kind: 'success', message };
    if (![false, 0, '0', 'false'].includes(row.State)) return { kind: 'unknown', message: message || '預報回應缺少明確成功／失敗狀態。' };
    if (/登入|登录|登錄|login|session|驗證碼|验证码/i.test(message)) return { kind: 'auth', message };
    if (/查無|查无|查不到|不存在|未找到|not.?found/i.test(message)) return { kind: 'not_found', message };
    if (/重複|重复|已預報|已预报|已登記|已登记|已存在|已经|已經|duplicate/i.test(message)) return { kind: 'duplicate', message };
    return { kind: 'rejected', message: message || '網站明確拒絕預報。' };
  }
  function currentMatches(rows, trackingNumber) {
    if (!Array.isArray(rows) || rows.some(row => !row || typeof row.kdBillCode !== 'string' || row.id == null ||
      (row.goods != null && typeof row.goods !== 'string') || (row.goods_memo != null && typeof row.goods_memo !== 'string'))) fail('SCHEMA', '目前包裹回應格式改變或登入已失效。');
    return rows.filter(row => row.kdBillCode.trim().toUpperCase() === trackingNumber);
  }
  function matchesSaved(entry, pack) {
    return !!pack && string(pack.kdBillCode).toUpperCase() === entry.trackingNumber &&
      (pack.goods ?? '') === entry.goods && (pack.goods_memo ?? '') === entry.memo && Number(pack.Number) === entry.number;
  }
  function classifyCurrent(entry, rows, history) {
    const matches = currentMatches(rows, entry.trackingNumber);
    if (matches.length > 1) return { status: 'duplicate_server', message: '服務端有多筆相同單號，停止並保留所有原紀錄。' };
    if (matches.length) {
      const row = matches[0];
      if (row.Is_Yb === 1 || row.Is_Yb === '1' || row.Is_Yb === true || string(row.goods) || string(row.goods_memo)) return { status: 'existing', message: '目前包裹已有預報或已填寫內容，保留原資料。', before: row };
      if ([0, '0', false].includes(row.Is_Yb)) return { status: 'blank-arrived', message: '已自動入庫但尚無品名／備註，可以補報。', before: row };
      return { status: 'unknown', message: '目前包裹的預報狀態未知，不自動修改。', before: row };
    }
    if (!history || !Number.isSafeInteger(history.count) || history.count < 0) return { status: 'unknown', message: '尚未完成歷史集運訂單核對。' };
    return history.count > 0 ? { status: 'historical', message: '歷史集運訂單已有此單號，保留原資料。' }
      : { status: 'ready', message: '目前包裹與歷史訂單都沒有此單號，可以新增。', before: null };
  }
  function payload(entry) {
    const errors = validateEntry(entry); if (errors.length) fail('INVALID_ENTRY', errors.join(' '));
    return [{ kdBillcode: normalizeTracking(entry.trackingNumber), Number: entry.number, Goods: wireText(entry.goods),
      Goodsid: 0, Goods_meno: wireText(entry.memo), Immediatrly: 0, GoodsType: '' }];
  }
  function wait(ms, signal) {
    return new Promise((resolve, reject) => {
      const stop = () => { clearTimeout(timer); signal?.removeEventListener('abort', stop); reject(new PredeclareError('CANCELLED', '已停止；已送出的請求仍會先回讀核對。')); };
      const timer = setTimeout(() => { signal?.removeEventListener('abort', stop); resolve(); }, ms);
      if (signal?.aborted) stop(); else signal?.addEventListener('abort', stop, { once: true });
    });
  }
  function unchanged(before, after) {
    if (!before || !after) return !before && !after;
    return ['id', 'goods', 'goods_memo', 'Number', 'Is_Yb'].every(key => String(before[key] ?? '') === String(after[key] ?? ''));
  }

  /** 非冪等寫入：先記錄 submitting；送出後即使逾時／停止，也先查服務端，絕不盲目重送。 */
  async function processQueue({ job, adapter, save, report = () => {}, signal, intervalMs = 1500, wait: pause = wait }) {
    job.pausedReason = '';
    const account = () => { if (String(adapter.account()) !== String(job.accountMarker)) fail('ACCOUNT_CHANGED', '登入帳號已變更，請回到原帳號再繼續。'); };
    for (const entry of job.entries) {
      if (signal?.aborted) { job.pausedReason = '已停止。'; break; }
      if (entry.selected === false || FINAL.includes(entry.status)) continue;
      account();
      if (UNCERTAIN.includes(entry.status)) {
        const matches = currentMatches(await adapter.current(), entry.trackingNumber);
        if (matches.length === 1 && matchesSaved(entry.attempt || entry, matches[0])) {
          entry.status = 'verified'; entry.message = '已從服務端核對先前送出的結果，沒有再次提交。';
          await save(job, entry); report(entry); continue;
        }
        entry.status = 'unknown'; entry.message = '先前提交結果仍不明，請先人工核對；本工具不會再次送出。';
        job.pausedReason = entry.message; await save(job, entry); report(entry); break;
      }
      const invalid = validateEntry(entry);
      if (invalid.length) { entry.status = entry.conflict ? 'conflict' : 'invalid'; entry.message = invalid.join(' '); await save(job, entry); report(entry); continue; }
      await pause(intervalMs, signal);
      const rows = await adapter.current(); account();
      const history = currentMatches(rows, entry.trackingNumber).length ? undefined : await adapter.history(entry.trackingNumber);
      const check = classifyCurrent(entry, rows, history);
      Object.assign(entry, check); await save(job, entry); report(entry);
      if (['unknown', 'duplicate_server'].includes(check.status)) { job.pausedReason = check.message; break; }
      if (!['ready', 'blank-arrived'].includes(check.status)) continue;
      if (signal?.aborted) { job.pausedReason = '已停止。'; break; }
      account();
      entry.attempt = { trackingNumber: entry.trackingNumber, goods: entry.goods, memo: entry.memo, number: entry.number };
      entry.status = 'submitting'; entry.message = '正在預報，接著會從服務端回讀核對。';
      await save(job, entry); report(entry);
      let response;
      try { response = parseAddResponse(await adapter.submit(entry)); }
      catch (error) { response = { kind: 'unknown', message: error.message }; }
      entry.response = response; entry.attemptedAt = new Date().toISOString();
      try {
        account();
        // 不使用使用者的停止 signal 中止這次回讀；停止只能阻止下一筆寫入。
        const matches = currentMatches(await adapter.current(), entry.trackingNumber); account();
        if (matches.length === 1 && matchesSaved(entry.attempt, matches[0])) {
          entry.status = 'verified'; entry.message = '已回讀確認品名、完整備註及數量。'; entry.savedId = matches[0].id;
        } else if (response.kind !== 'success' && response.kind !== 'unknown' && response.kind !== 'auth' && matches.length <= 1 && unchanged(check.before, matches[0] || null)) {
          entry.status = response.kind === 'not_found' ? 'not_found' : response.kind === 'duplicate' ? 'duplicate' : 'rejected';
          entry.message = response.message;
        } else { entry.status = 'unknown'; entry.message = `${response.message || '網站回應未能驗證。'} 服務端回讀與預報內容不一致，停止並保留紀錄。`; }
      } catch (error) { entry.status = 'unknown'; entry.message = `提交後無法確認結果：${error.message}`; }
      await save(job, entry); report(entry);
      if (entry.status === 'unknown') { job.pausedReason = entry.message; break; }
    }
    await save(job);
    return job;
  }
  const core = { VERSION, PredeclareError, normalizeTracking, wireText, normalizeInput, validateEntry,
    parseAddResponse, classifyCurrent, matchesSaved, payload, processQueue };
  if (typeof module === 'object' && module.exports) { module.exports = core; return; }

  if (location.hostname !== 'member.stjh168.com' || location.pathname.toLowerCase() !== '/member/mypack' || window.top !== window || document.getElementById(HOST_ID)) return;
  const LABELS = { pending: '待檢查', invalid: '待修正／核對', conflict: '輸入衝突', ready: '可新增',
    'blank-arrived': '可補報', existing: '已有資料', historical: '歷史已集運', duplicate_server: '服務端重複',
    submitting: '正在提交', verified: '已回讀驗證', rejected: '網站拒絕', not_found: '網站回報查無', duplicate: '網站回報重複', unknown: '結果待核對' };
  let db, job, active, accountId, lastRequestAt = 0, leaseLost = false;
  const owner = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const ui = {};
  function account() {
    if (!document.querySelector('.billcode_form .submit_one input[name=kd_billcode]')) fail('AUTH', '找不到登入後的單筆預報表單，請先登入聖天。');
    const ids = unique([...document.querySelectorAll('a font')].map(e => /[（(](\d{4,})[）)]/.exec(e.textContent)?.[1]).filter(Boolean));
    if (ids.length !== 1) fail('AUTH', '無法確認目前會員編號，已停止。');
    return ids[0];
  }
  function supportedForm() {
    if (account() !== accountId) fail('ACCOUNT_CHANGED', '登入帳號已切換，請重新整理後使用對應帳號的紀錄。');
    if (document.querySelector('#Common_CountryId')?.value !== '0' || !['', '0'].includes(document.querySelector('#IsNeedGoodsType')?.value ?? '')) fail('SCHEMA', '倉庫或貨物類型設定與已驗證介面不同，請停止並更新腳本。');
  }
  function dbOp(mode, operation) {
    return new Promise((resolve, reject) => {
      let result, reason;
      const tx = db.transaction('meta', mode), store = tx.objectStore('meta');
      const abort = error => { reason = error; tx.abort(); };
      try { operation(store, value => { result = value; }, abort); } catch (error) { abort(error); }
      tx.oncomplete = () => resolve(result);
      tx.onerror = tx.onabort = () => reject(reason || tx.error || new PredeclareError('STORAGE', '本機資料寫入失敗，已停止。'));
    });
  }
  const read = key => dbOp('readonly', (store, done) => { const r = store.get(key); r.onsuccess = () => done(r.result); });
  async function openStore() {
    db = await new Promise((resolve, reject) => {
      const r = indexedDB.open(`shengtian-json-predeclare-v1-${accountId}`, 1);
      r.onupgradeneeded = () => r.result.createObjectStore('meta');
      r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error);
      r.onblocked = () => reject(new PredeclareError('STORAGE', '資料庫升級受其他分頁阻擋，請關閉舊分頁。'));
    });
    db.onversionchange = () => db.close();
  }
  // HTTP 頁沒有 Web Locks；用 IndexedDB 的單一 readwrite transaction 原子取得跨分頁租約。
  function lease(action) {
    return dbOp('readwrite', (store, done, abort) => {
      const r = store.get('lease');
      r.onsuccess = () => {
        const previous = r.result, now = Date.now();
        if (action === 'release') { if (previous?.owner === owner) store.delete('lease'); return; }
        if (action === 'renew' && previous?.owner !== owner) return abort(new PredeclareError('BUSY', '批次執行權已移轉至另一分頁。'));
        if (previous && previous.owner !== owner && previous.expires > now) return abort(new PredeclareError('BUSY', '另一個聖天腳本分頁正在執行，請等候完成。'));
        store.put({ owner, expires: now + 120000 }, 'lease'); done(true);
      };
    });
  }
  async function guards() {
    return dbOp('readonly', (store, done) => { const r = store.getAll(); r.onsuccess = () => done(r.result.filter(v => v?.kind === 'attempt')); });
  }
  function save(currentJob, entry) {
    supportedForm();
    if (leaseLost) fail('BUSY', '執行權已失效，已停止。');
    return dbOp('readwrite', (store, done, abort) => {
      const check = store.get('lease');
      check.onsuccess = () => {
        if (check.result?.owner !== owner || check.result.expires <= Date.now()) return abort(new PredeclareError('BUSY', '執行權已失效，已停止。'));
        function persist() { currentJob.updatedAt = new Date().toISOString(); store.put(currentJob, 'job'); }
        if (!entry) { persist(); return; }
        const key = `guard:${entry.trackingNumber}`, r = store.get(key);
        r.onsuccess = () => {
          // 即使租約失效／匯入新 JSON，先前不確定的寫入也不能藉此再送一次。
          if (entry.status === 'submitting' && r.result) return abort(new PredeclareError('UNCERTAIN', '此單號已有未核對的提交紀錄，請先只讀回查。'));
          if (entry.attempt && UNCERTAIN.includes(entry.status)) store.put({ kind: 'attempt', trackingNumber: entry.trackingNumber,
            record: { ...entry, status: 'unknown', message: '先前的提交需要服務端核對，不能直接重送。' } }, key);
          else if (FINAL.includes(entry.status)) store.delete(key);
          persist();
        };
      };
    });
  }
  async function restoreGuards(currentJob) {
    for (const guard of await guards()) {
      const entry = currentJob.entries.find(e => e.trackingNumber === guard.trackingNumber);
      if (entry) Object.assign(entry, guard.record, { selected: true });
      else currentJob.entries.push({ ...guard.record, selected: true });
    }
  }
  function status(message) { ui.status.textContent = message; }
  function updateCounts() {
    if (!job) { ui.count.textContent = '尚未匯入 JSON。'; return; }
    const counts = job.entries.reduce((sum, entry) => { sum[entry.status] = (sum[entry.status] || 0) + 1; return sum; }, {});
    ui.count.textContent = `${job.entries.length} 個單號；${Object.entries(counts).map(([key, n]) => `${LABELS[key] || key} ${n}`).join('／')}`;
  }
  function updateRow(entry) {
    const tr = ui.rows.get(entry);
    if (tr) { tr.querySelector('[data-status]').textContent = `${LABELS[entry.status] || entry.status}：${entry.message || ''}`; tr.dataset.state = entry.status; }
    updateCounts();
  }
  function render() {
    ui.tbody.replaceChildren(); ui.rows = new Map();
    for (const entry of job?.entries || []) {
      const tr = document.createElement('tr');
      function cell() { const td = document.createElement('td'); tr.append(td); return td; }
      const select = document.createElement('input'); select.type = 'checkbox'; select.checked = entry.selected !== false;
      select.dataset.edit = '1'; select.onchange = () => { entry.selected = select.checked; }; cell().append(select);
      const tracking = cell(); tracking.textContent = entry.trackingNumber || '無效單號';
      if (entry.sourceInfo || entry.sourceOrderIds?.length) {
        const detail = document.createElement('details'), summary = document.createElement('summary'), text = document.createElement('div');
        summary.textContent = '來源商品／訂單'; text.textContent = entry.sourceInfo || entry.sourceOrderIds.join('；'); detail.append(summary, text); tracking.append(detail);
      }
      const frozen = !!entry.attempt || FINAL.includes(entry.status);
      function edit(field, type = 'text') {
        const input = document.createElement(field === 'memo' ? 'textarea' : 'input');
        if (input.tagName === 'INPUT') input.type = type;
        input.value = entry[field] ?? ''; input.disabled = frozen; input.dataset.edit = frozen ? 'frozen' : '1';
        input.setAttribute('aria-label', `${entry.trackingNumber} ${field}`);
        input.onchange = () => { entry[field] = field === 'number' ? Number(input.value) : input.value.trim();
          entry.status = 'pending'; entry.message = validateEntry(entry).join(' '); updateRow(entry); };
        cell().append(input);
      }
      edit('goods'); edit('memo'); edit('number', 'number');
      const review = document.createElement('input'); review.type = 'checkbox'; review.checked = !!entry.reviewed;
      review.disabled = frozen; review.dataset.edit = frozen ? 'frozen' : '1';
      review.onchange = () => { entry.reviewed = review.checked; entry.needsReview = true; if (review.checked) entry.conflict = false;
        entry.status = 'pending'; entry.message = validateEntry(entry).join(' '); updateRow(entry); };
      const reviewCell = cell(); reviewCell.append(review, '已核對');
      const result = cell(); result.dataset.status = '1'; ui.rows.set(entry, tr); ui.tbody.append(tr); updateRow(entry);
    }
    ui.issues.textContent = (job?.issues || []).map(issue => `${issue.code} ${issue.orderId || issue.trackingNumber || ''}：${issue.message}`).join('\n') || '無來源例外。';
    updateCounts();
  }
  function busy(value) {
    for (const button of ui.actions) button.disabled = value;
    ui.stop.disabled = !value;
    for (const element of ui.shadow.querySelectorAll('[data-edit="1"]')) element.disabled = value;
  }
  async function run(operation) {
    if (active) return;
    if (!db) { status('本機資料庫尚未就緒。'); return; }
    active = new AbortController(); busy(true); leaseLost = false;
    let heartbeat;
    try {
      supportedForm(); await lease('acquire');
      heartbeat = setInterval(() => { lease('renew').catch(() => { leaseLost = true; active?.abort(); }); }, 20000);
      const latest = await read('job');
      if (operation !== importJson && latest && job && latest.id !== job.id) fail('OTHER_TAB', '另一分頁已匯入不同任務，請重新整理後再操作。');
      if (job) await restoreGuards(job);
      await operation(active.signal);
    } catch (error) {
      const message = `${error.code || 'ERROR'}：${error.message}`;
      if (job) { job.pausedReason = message; try { await save(job); } catch { /* 原 submitting 保護紀錄仍保留。 */ } }
      status(message);
    } finally {
      clearInterval(heartbeat); await lease('release').catch(() => {});
      active = null; render(); busy(false);
    }
  }
  async function request(path, options = {}) {
    supportedForm();
    const seconds = Number(ui.interval.value);
    if (!Number.isFinite(seconds) || seconds < 1 || seconds > 30) fail('INTERVAL', '請求間隔需為 1–30 秒。');
    await wait(Math.max(0, seconds * 1000 - (Date.now() - lastRequestAt)));
    supportedForm(); if (leaseLost) fail('BUSY', '執行權已失效。');
    lastRequestAt = Date.now();
    const response = await fetch(path, { credentials: 'same-origin', cache: 'no-store', ...options, signal: AbortSignal.timeout(20000) });
    const expected = new URL(path, location.href), actual = new URL(response.url);
    if (actual.origin !== location.origin || actual.pathname.toLowerCase() !== expected.pathname.toLowerCase() || [401, 403].includes(response.status)) fail('AUTH', '網站要求重新登入，請登入後回到原帳號續跑。');
    if (!response.ok) fail('HTTP', `網站回傳 HTTP ${response.status}，已停止。`);
    const text = await response.text();
    if (/type\s*=\s*["']password["']|name\s*=\s*["'](?:password|pwd)["']/i.test(text)) fail('AUTH', '網站回傳登入頁，請重新登入。');
    return text;
  }
  const adapter = {
    account,
    async current() {
      const raw = await request('/Member/QueryMyPack', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'X-Requested-With': 'XMLHttpRequest' }, body: 'country_id=0' });
      let rows; try { rows = JSON.parse(raw); } catch { fail('SCHEMA', '目前包裹不是 JSON，請檢查登入或網站改版。'); }
      currentMatches(rows, ''); return rows;
    },
    async history(tracking) {
      const raw = await request('/Member/OrderRecord?ordercode=' + encodeURIComponent(tracking));
      const doc = new DOMParser().parseFromString(raw, 'text/html'), field = doc.querySelector('#AllCount');
      if (!field || !doc.querySelector('input[name=QueryByCode]')) fail('SCHEMA', '歷史訂單查詢缺少控制項，不能當成查無紀錄。');
      if (string(doc.querySelector('input[name=QueryByCode]').value).toUpperCase() !== tracking) fail('SCHEMA', '歷史查詢沒有保留指定單號，不能當成查無紀錄。');
      const count = Number(field.value), rows = [...doc.querySelectorAll('tr[data-id]')].filter(tr => tr.querySelector('a[href*="OrderPrint"]'));
      if (!/^\d+$/.test(field.value) || !Number.isSafeInteger(count) || count < 0 || (count > 0 && !rows.length) || (count === 0 && rows.length)) fail('SCHEMA', '歷史訂單筆數與資料不一致，已停止。');
      return { count };
    },
    async submit(entry) {
      // 使用官方 API，完全不執行頁面的同步 AJAX／alert／reload，也不改寫全站 alert。
      const raw = await request('/Member/AddBillcode', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'X-Requested-With': 'XMLHttpRequest' }, body: new URLSearchParams({ datas: JSON.stringify(payload(entry)) }).toString() });
      try { return JSON.parse(raw); } catch { fail('SCHEMA', '預報回應不是 JSON；結果須回查。'); }
    }
  };
  async function importJson() {
    const parsed = normalizeInput(ui.json.value);
    if (parsed.accountMarker && parsed.accountMarker !== accountId) fail('ACCOUNT_CHANGED', 'JSON 計畫指定的會員與目前帳號不符。');
    job = { id: `${Date.now()}-${Math.random().toString(36).slice(2)}`, version: VERSION, accountMarker: accountId,
      createdAt: new Date().toISOString(), entries: parsed.entries, issues: parsed.issues, pausedReason: '' };
    await restoreGuards(job); await save(job);
    status('已匯入。請核對品名與備註，可先檢查已預報，再開始預報。');
  }
  async function scan(signal) {
    if (!job) fail('INPUT', '請先匯入 JSON。');
    await save(job); const rows = await adapter.current();
    for (const entry of job.entries) {
      if (signal.aborted) break;
      if (entry.selected === false) continue;
      if (FINAL.includes(entry.status)) continue;
      if (entry.attempt && UNCERTAIN.includes(entry.status)) {
        const matches = currentMatches(rows, entry.trackingNumber);
        entry.status = matches.length === 1 && matchesSaved(entry.attempt, matches[0]) ? 'verified' : 'unknown';
        entry.message = entry.status === 'verified' ? '已回讀核對先前提交，沒有重送。' : '提交結果仍不明，請人工核對；不會重送。';
      } else {
        try { normalizeTracking(entry.trackingNumber); } catch { continue; }
        const history = currentMatches(rows, entry.trackingNumber).length ? undefined : await adapter.history(entry.trackingNumber);
        Object.assign(entry, classifyCurrent(entry, rows, history));
        const errors = validateEntry(entry);
        if (errors.length && ['ready', 'blank-arrived'].includes(entry.status)) { entry.status = entry.conflict ? 'conflict' : 'invalid'; entry.message = errors.join(' '); }
      }
      await save(job, entry); updateRow(entry);
    }
    status(signal.aborted ? '已停止檢查，沒有提交預報。' : '只讀檢查完成；已有／歷史紀錄會保留。');
  }
  async function submit(signal) {
    if (!job) fail('INPUT', '請先匯入 JSON。');
    await save(job);
    status('逐筆檢查並預報；已送出的請求會先回讀核對。');
    await processQueue({ job, adapter, save, report: updateRow, signal, intervalMs: 0 });
    status(job.pausedReason || '本批處理完成，請檢查逐筆結果與來源例外。');
  }
  async function download() {
    if (!job) { status('請先匯入 JSON。'); return; }
    const snapshot = { ...job, exportedAt: new Date().toISOString(), unresolvedAttempts: await guards() };
    const url = URL.createObjectURL(new Blob([JSON.stringify(snapshot, null, 2)], { type: 'application/json;charset=utf-8' }));
    const a = document.createElement('a'); a.href = url; a.download = `shengtian-results-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
    document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 60000);
  }
  async function main() {
    const host = document.createElement('div'); host.id = HOST_ID;
    const shadow = host.attachShadow({ mode: 'open' }); ui.shadow = shadow;
    shadow.innerHTML = `<style>
      :host{all:initial;position:fixed;z-index:2147483600;right:16px;bottom:16px;font:14px/1.45 system-ui,sans-serif;color:#172438}
      *{box-sizing:border-box} section{background:white;border:1px solid #b7c6d6;box-shadow:0 8px 40px #00152f44;border-radius:10px;width:min(1080px,96vw);max-height:88vh;overflow:auto}
      header{display:flex;align-items:center;justify-content:space-between;background:#174a70;color:white;padding:10px 14px;border-radius:9px 9px 0 0} h2{font-size:16px;margin:0} main{padding:12px}
      p{margin:8px 0}button{cursor:pointer;padding:7px 12px;border:1px solid #abc;background:#eef5fb;color:#123;border-radius:5px;margin:3px}button:disabled{opacity:.5;cursor:default}
      textarea{font:12px/1.4 ui-monospace,monospace;padding:6px}#json{width:100%;height:90px}input,textarea{border:1px solid #b7c6d6;border-radius:3px;color:#172438;background:white}input[type=number]{width:65px}input[type=text]{width:160px;padding:5px}td textarea{width:215px;min-height:54px}
      #status{white-space:pre-wrap;background:#edf5fb;padding:9px;border-radius:5px}#count{font-weight:600}table{border-collapse:collapse;font-size:12px;width:100%}th,td{padding:6px;vertical-align:top;text-align:left;border-bottom:1px solid #dce3eb}th{position:sticky;top:0;background:#e8f0f6}td[data-status]{min-width:175px}
      details{font-size:12px;max-width:260px;overflow-wrap:anywhere}summary{cursor:pointer}pre{white-space:pre-wrap;max-height:150px;overflow:auto;font-size:12px}tr[data-state=unknown],tr[data-state=conflict],tr[data-state=duplicate_server]{background:#fff0e7}tr[data-state=verified]{background:#edf9ef}.table-wrap{max-height:40vh;overflow:auto}.hint{font-size:12px;color:#52657a}
      #body[hidden]{display:none} header button{padding:2px 9px}
    </style><section><header><h2>聖天 JSON 預報 ${VERSION}</h2><button id="collapse" type="button">收合</button></header><main id="body">
      <p class="hint">貼上包裹 JSON 或淘寶匯出檔。品名需準確簡短；數量預設為一個包裹 1。已有資料會保留。</p>
      <textarea id="json" aria-label="包裹 JSON" placeholder='[{"trackingNumber":"JT0000000000000","goods":"打印板","memo":"自訂備註","number":1}]'></textarea>
      <input id="file" type="file" accept=".json,application/json" data-edit="1" aria-label="開啟 JSON 檔"><span class="hint" id="account"></span>
      <p id="actions"></p><p><label>請求間隔（秒） <input id="interval" type="number" min="1" max="30" step="0.5" value="1.5" data-edit="1"></label></p>
      <p id="status">正在確認登入與本機紀錄…</p><p id="count"></p>
      <div class="table-wrap"><table><thead><tr><th>處理</th><th>單號／來源</th><th>貨物品名</th><th>備註</th><th>數量</th><th>核對</th><th>結果</th></tr></thead><tbody id="entries"></tbody></table></div>
      <details><summary>來源例外／輸入重複</summary><pre id="issues"></pre></details>
      <p class="hint">「檢查已預報」只讀取資料。「開始／續跑」會提交已選取且核對完成的包裹。停止後會先核對已送出的請求；未知結果不自動重送。結果按本帳號保存在此瀏覽器。</p>
    </main></section>`;
    document.body.append(host);
    for (const name of ['json', 'file', 'interval', 'status', 'count', 'issues']) ui[name] = shadow.getElementById(name);
    ui.tbody = shadow.getElementById('entries'); ui.rows = new Map(); ui.actions = [];
    const actions = shadow.getElementById('actions');
    function button(label, fn) { const b = document.createElement('button'); b.type = 'button'; b.textContent = label; b.onclick = fn; actions.append(b); return b; }
    ui.actions.push(button('匯入 JSON', () => run(importJson)), button('檢查已預報（只讀）', () => run(scan)), button('開始／續跑預報', () => run(submit)));
    ui.stop = button('停止', () => { active?.abort(); status('已要求停止；已送出的請求會先回讀核對，再停止下一筆。'); }); ui.stop.disabled = true;
    button('匯出結果 JSON', () => download().catch(error => status(error.message)));
    shadow.getElementById('collapse').onclick = e => { const body = shadow.getElementById('body'); body.hidden = !body.hidden; e.target.textContent = body.hidden ? '展開' : '收合'; };
    ui.file.onchange = async () => { try { const file = ui.file.files[0]; if (!file) return;
      if (file.size > 10 * 1024 * 1024) fail('INPUT', 'JSON 檔案超過 10 MiB，請先分批。');
      ui.json.value = await file.text(); status('檔案已讀入，請按「匯入 JSON」。'); } catch (error) { status(error.message); } };
    try {
      accountId = account(); supportedForm(); await openStore(); job = await read('job');
      shadow.getElementById('account').textContent = ` 會員 ${accountId}`;
      render();
      status(job ? `已還原 ${job.entries.length} 個單號。${job.pausedReason || ''} 不會自動提交；可先只讀檢查。` : '準備就緒，請匯入 JSON。');
    } catch (error) { status(`${error.code || 'ERROR'}：${error.message}`); ui.actions.forEach(b => { b.disabled = true; }); }
  }
  main().catch(error => console.error('[聖天 JSON 預報]', error));
})();
