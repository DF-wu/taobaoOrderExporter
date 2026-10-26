/** Predeclare through the signed-in page. No cookies or credentials are exported.
 * scan: read current packs and history; prepare: apply reviewed product labels;
 * submit: use the real form, acknowledge its native alert, then reread the server.
 */
import fs from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { CDP } from './cdp.mjs';

export const normalizeTracking = value => {
  if (typeof value !== 'string') throw new Error('Tracking IDs must be strings');
  const result = value.trim().toUpperCase();
  if (!/^[A-Z0-9]{8,40}$/.test(result)) throw new Error(`Invalid or masked tracking ID: ${value}`);
  return result;
};

// Shengtian URL-decodes submitted text a second time. Escape these characters
// before the normal form encoding, then compare the readback with the real text.
export const wireText = value => value.replace(/%/g, '%25').replace(/\+/g, '%2B');

export function groupPackages(source) {
  if (source.schemaVersion !== 1 || !Array.isArray(source.orders)) throw new Error('Unsupported export schema');
  const grouped = new Map(), seen = new Set(), noTracking = [];
  for (const order of source.orders) {
    if (typeof order.orderId !== 'string' || !/^\d+$/.test(order.orderId) || seen.has(order.orderId)) throw new Error('Invalid or duplicate order ID');
    seen.add(order.orderId);
    if (!order.packages?.length) noTracking.push({ orderId: order.orderId, status: order.logisticsStatus, reason: order.logisticsError || '' });
    for (const pack of order.packages || []) {
      const trackingNumber = normalizeTracking(pack.trackingNumber);
      if (!grouped.has(trackingNumber)) grouped.set(trackingNumber, { trackingNumber, orders: [] });
      const entry = grouped.get(trackingNumber);
      if (entry.orders.some(o => o.orderId === order.orderId)) continue;
      const ids = pack.subOrderIds || [];
      const matched = (order.items || []).filter(i => ids.includes(i.subOrderId));
      const wholeOrder = order.packages.length === 1;
      entry.orders.push({ orderId: order.orderId, shopName: order.shopName, status: order.status,
        items: matched.length ? matched : wholeOrder ? order.items : [],
        allOrderItems: order.items, packageGoods: pack.goods || [],
        needsPackageReview: !matched.length && !wholeOrder });
    }
  }
  return { packages: [...grouped.values()], noTracking };
}

export function classify(pack, current, history) {
  if (history?.count > 0) return 'historical';
  if (!current) return 'new';
  // Manually edited warehouse entries can have Is_Yb=0. Preserve their content.
  if (current.Is_Yb === 1 || current.Is_Yb === true || current.Is_Yb === '1' || current.goods?.trim() || current.goods_memo?.trim()) return 'existing';
  return 'blank-arrived';
}

export function makePlan(scan, labels) {
  const entries = [];
  for (const pack of scan.packages.filter(p => ['new', 'blank-arrived'].includes(p.disposition))) {
    const goods = [], memos = [];
    for (const order of pack.orders) {
      const label = labels[`${pack.trackingNumber}:${order.orderId}`] || labels[order.orderId];
      if (!label?.goods || !label?.description) throw new Error(`Review a concise product label for ${order.orderId}`);
      if (order.needsPackageReview && !label.packageReviewed) throw new Error(`Unresolved package-to-item relation for ${order.orderId}`);
      goods.push(label.goods.trim());
      memos.push(`[${order.orderId}]+[${label.description.trim()}]`);
    }
    const entry = { trackingNumber: pack.trackingNumber, goods: [...new Set(goods)].join('、'),
      memo: [...new Set(memos)].join('；'), number: 1, disposition: pack.disposition,
      before: pack.current || null, orderIds: pack.orders.map(o => o.orderId) };
    // Do not silently trim a long merged memo: verify the full text after saving.
    if (!entry.goods || !entry.memo || /[<>]/.test(entry.goods + entry.memo)) throw new Error('Invalid product label');
    entries.push(entry);
  }
  return { schemaVersion: 1, createdAt: new Date().toISOString(), accountMarker: scan.accountMarker,
    sourceSummary: scan.summary, entries };
}

async function openSession() {
  const cdp = await CDP.connect(process.env.BRAVE_CDP_ENDPOINT);
  try {
    const targets = (await cdp.targets()).filter(t => {
      try { const u = new URL(t.url); return u.hostname === 'member.stjh168.com' && u.pathname.toLowerCase() === '/member/mypack'; } catch { return false; }
    });
    if (targets.length !== 1) throw new Error(`Keep exactly one signed-in Shengtian MyPack tab open; found ${targets.length}`);
    const session = await cdp.attach(targets[0].targetId);
    await cdp.send('Page.enable', {}, session);
    return { cdp, session };
  } catch (error) { cdp.close(); throw error; }
}

async function accountMarker(cdp, session) {
  return cdp.evaluate(session, `(() => {
    if (location.hostname !== 'member.stjh168.com' || !document.querySelector('.billcode_form .submit_one input[name=kd_billcode]')) throw Error('Signed-in MyPack form missing');
    const match = document.body.innerText.match(/[（(](\\d{4,})[）)]/);
    if (!match) throw Error('Cannot identify signed-in Shengtian account');
    return match[1];
  })()`);
}

async function currentPacks(cdp, session) {
  const packs = await cdp.evaluate(session, `(async()=>{
    const r = await fetch('/Member/QueryMyPack', {method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:'country_id=0',signal:AbortSignal.timeout(15000)});
    if(!r.ok) throw Error('QueryMyPack HTTP '+r.status);
    const data = await r.json(); if(!Array.isArray(data)) throw Error('Invalid pack response or expired login'); return data;
  })()`);
  const seen = new Set();
  for (const pack of packs) {
    const t = normalizeTracking(pack.kdBillCode);
    if (seen.has(t)) throw new Error(`Duplicate server pack: ${t}`);
    seen.add(t);
  }
  return packs;
}

async function historyFor(cdp, session, tracking) {
  return cdp.evaluate(session, `(async()=>{
    const r=await fetch('/Member/OrderRecord?ordercode='+encodeURIComponent(${JSON.stringify(tracking)}),{signal:AbortSignal.timeout(15000)});
    if(!r.ok)throw Error('History HTTP '+r.status);
    const doc=new DOMParser().parseFromString(await r.text(),'text/html');
    const field=doc.querySelector('#AllCount');
    if(!field||!doc.querySelector('input[name=QueryByCode]'))throw Error('Invalid history response or expired login');
    const count=Number(field.value);if(!Number.isInteger(count)||count<0)throw Error('Invalid history count');
    const orders=[...doc.querySelectorAll('tr[data-id]')].filter(t=>t.querySelector('a[href*="OrderPrint"]')).map(t=>({orderId:t.dataset.id,detail:t.querySelector('a[href*="OrderPrint"]').getAttribute('href')}));
    if(count>0&&!orders.length)throw Error('History count without order rows');
    return {count,orders};
  })()`);
}

export async function scanSource(source) {
  const result = groupPackages(source);
  const { cdp, session } = await openSession();
  try {
    result.accountMarker = await accountMarker(cdp, session);
    const packs = await currentPacks(cdp, session);
    const index = new Map(packs.map(p => [normalizeTracking(p.kdBillCode), p]));
    for (const pack of result.packages) {
      const current = index.get(pack.trackingNumber);
      const history = current ? undefined : await historyFor(cdp, session, pack.trackingNumber);
      pack.disposition = classify(pack, current, history);
      if (current) pack.current = { id: current.id, goods: current.goods || '', memo: current.goods_memo || '', isYb: current.Is_Yb, number: current.Number };
      if (history) pack.history = history;
    }
    result.summary = { orders: source.orders.length, packages: result.packages.length, noTracking: result.noTracking.length,
      dispositions: result.packages.reduce((acc, p) => { acc[p.disposition] = (acc[p.disposition] || 0) + 1; return acc; }, {}) };
    return result;
  } finally { cdp.close(); }
}

async function waitForPage(cdp, session) {
  const deadline = Date.now() + 25000;
  while (Date.now() < deadline) {
    try {
      if (await cdp.evaluate(session, `document.readyState==='complete' && !!document.querySelector('.billcode_form .submit_one .btn_submit')`)) return;
    } catch (error) {
      if (!/context|navigat|Cannot find/i.test(error.message)) throw error;
    }
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw new Error('MyPack did not reload after submission');
}

async function submitOne(cdp, session, entry) {
  const fill = await cdp.evaluate(session, `(() => {
    const root=document.querySelector('.billcode_form .submit_one');
    if(!root || root.querySelectorAll('input[name=kd_billcode]').length!==1)throw Error('Expected one single-declaration form row');
    const data=${JSON.stringify({ kd_billcode: entry.trackingNumber, goods: wireText(entry.goods), goods_memo: wireText(entry.memo), goods_number: '1' })};
    for(const [key,value] of Object.entries(data)){
      const input=root.querySelector('input[name='+key+']');if(!input)throw Error('Missing form field '+key);
      if(input.maxLength>=0&&value.length>input.maxLength)throw Error('Value exceeds form limit '+key);
      input.value=value;input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));
    }
    return Object.fromEntries(Object.keys(data).map(key=>[key,root.querySelector('input[name='+key+']').value]));
  })()`);
  if (fill.kd_billcode !== entry.trackingNumber || fill.goods_memo !== wireText(entry.memo) || fill.goods !== wireText(entry.goods)) throw new Error('Form fill verification failed');
  const dialogs = [];
  let dialogError;
  const handler = message => {
    if (message.sessionId !== session || message.method !== 'Page.javascriptDialogOpening') return;
    dialogs.push({ type: message.params.type, message: message.params.message });
    if (message.params.type !== 'alert') { dialogError = new Error('Unexpected confirmation; left open for inspection'); return; }
    cdp.send('Page.handleJavaScriptDialog', { accept: true }, session).catch(error => { dialogError = error; });
  };
  cdp.listeners.add(handler);
  try {
    // A synchronous AJAX request opens a native alert before click() returns.
    // Install the CDP event listener first so the browser cannot remain blocked.
    try {
      await cdp.evaluate(session, `document.querySelector('.billcode_form .submit_one .btn_submit').click(); true`);
    } catch (error) {
      if (!/context.*destroyed|Cannot find context/i.test(error.message)) throw error;
    }
    if (dialogError) throw dialogError;
    if (!dialogs.length || dialogs.some(d => d.type !== 'alert' || !/^提交成功[！!。\s]*$/.test(d.message))) {
      throw new Error(`Submission did not report success: ${JSON.stringify(dialogs)}`);
    }
    await waitForPage(cdp, session);
    const saved = (await currentPacks(cdp, session)).find(p => normalizeTracking(p.kdBillCode) === entry.trackingNumber);
    if (!saved || saved.goods !== entry.goods || saved.goods_memo !== entry.memo || saved.Number !== entry.number) throw new Error('Server readback differs from the full declaration; stop before retrying');
    return { dialogs, saved: { id: saved.id, trackingNumber: saved.kdBillCode, goods: saved.goods, memo: saved.goods_memo, number: saved.Number, isYb: saved.Is_Yb } };
  } finally { cdp.listeners.delete(handler); }
}

export async function submitPlan(plan, journalPath) {
  if (plan.schemaVersion !== 1 || !Array.isArray(plan.entries) || !plan.accountMarker) throw new Error('Invalid plan');
  const lock = await fs.open(journalPath + '.lock', 'wx');
  let cdp;
  const journal = async record => fs.appendFile(journalPath, JSON.stringify({ at: new Date().toISOString(), ...record }) + '\n');
  try {
    const priorText = await fs.readFile(journalPath, 'utf8').catch(e => { if (e.code === 'ENOENT') return ''; throw e; });
    const prior = priorText.trim() ? priorText.trim().split('\n').map(line => JSON.parse(line)) : [];
    const connection = await openSession();
    cdp = connection.cdp;
    const session = connection.session;
    for (const entry of plan.entries) {
      normalizeTracking(entry.trackingNumber);
      if (await accountMarker(cdp, session) !== plan.accountMarker) throw new Error('Signed-in account differs from scanned plan');
      const packs = await currentPacks(cdp, session);
      const current = packs.find(p => normalizeTracking(p.kdBillCode) === entry.trackingNumber);
      const attempted = prior.some(r => r.trackingNumber === entry.trackingNumber && r.state === 'submitting');
      if (current?.goods === entry.goods && current?.goods_memo === entry.memo && current?.Number === entry.number) {
        await journal({ state: 'already-verified', trackingNumber: entry.trackingNumber });
        console.log(`Already saved: ${entry.trackingNumber}`); continue;
      }
      if (attempted) throw new Error(`Unresolved prior attempt for ${entry.trackingNumber}; inspect the server before retrying`);
      if (current && classify(entry, current) === 'existing') throw new Error(`Pack acquired declaration content since scan: ${entry.trackingNumber}`);
      if (entry.before && (!current || current.id !== entry.before.id)) throw new Error('Existing pack identity changed since scan');
      if (!current && (await historyFor(cdp, session, entry.trackingNumber)).count) throw new Error(`Pack is already in shipment history: ${entry.trackingNumber}`);
      await journal({ state: 'submitting', trackingNumber: entry.trackingNumber, entry });
      try {
        const result = await submitOne(cdp, session, entry);
        await journal({ state: 'verified', trackingNumber: entry.trackingNumber, ...result });
        console.log(`Verified: ${entry.trackingNumber} ${entry.goods}`);
      } catch (error) {
        await journal({ state: 'unknown-or-failed', trackingNumber: entry.trackingNumber, error: error.message });
        throw error;
      }
    }
  } finally {
    cdp?.close();
    await lock.close();
    await fs.unlink(journalPath + '.lock');
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [command, input, output, extra] = process.argv.slice(2);
  const read = async file => JSON.parse((await fs.readFile(file, 'utf8')).replace(/^\uFEFF/, ''));
  if (command === 'scan' && input && output) {
    const scan = await scanSource(await read(input));
    await fs.writeFile(output, JSON.stringify(scan, null, 2));
    console.log(JSON.stringify(scan.summary, null, 2));
  } else if (command === 'prepare' && input && output && extra) {
    const plan = makePlan(await read(input), await read(output));
    await fs.writeFile(extra, JSON.stringify(plan, null, 2));
    console.log(`Prepared ${plan.entries.length} declarations. Review the saved plan before submit.`);
  } else if (command === 'submit' && input && output) {
    await submitPlan(await read(input), output);
  } else {
    console.error('Usage: predeclare.mjs scan source.json scan.json | prepare scan.json labels.json plan.json | submit plan.json journal.jsonl');
    process.exitCode = 1;
  }
}
