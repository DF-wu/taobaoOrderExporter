// ==UserScript==
// @name         淘寶訂單批量導出工具
// @namespace    http://tampermonkey.net/
// @version      3.1.0
// @description  直接讀取新版訂單及多包裹物流，支援大量分頁、斷點續抓、XLSX 與 JSON。
// @author       df
// @match        https://buyertrade.taobao.com/trade/itemlist/list_bought_items.htm*
// @grant        unsafeWindow
// @run-at       document-idle
// @noframes
// @license      MIT
// ==/UserScript==

(function () {
  'use strict';

  const VERSION = '3.1.0';
  // UI 檢查與 API 節流分開；API 預設逐筆間隔 5 秒，使用者可在面板調慢。
  const CONFIG = { SDK_CHECK_INTERVAL: 250, REQUEST_INTERVAL: 5000, UI_TASK_DELAY: 100, TIMEOUT: 30000, RETRIES: 2 };
  const LIST_API = 'mtop.taobao.order.queryboughtlistV2';
  // 交易已結束的狀態，包裹清單不會再變動；狀態未變且物流完整時可直接沿用先前結果。
  const SETTLED_STATUS = /交易成功|交易关闭/;
  // 這兩種錯誤代表使用者停止或淘寶要求驗證，必須立即中止整個流程。
  const PAUSE_CODES = ['CANCELLED', 'AUTH_OR_CHALLENGE'];

  class ExportError extends Error {
    constructor(code, message, retryable = false) {
      super(message);
      this.name = 'ExportError';
      this.code = code;
      this.retryable = retryable;
    }
  }

  // ID 必須來自字串。大於 JS 安全整數的 number 已失去精度，不能再猜回原始訂單號。
  function id(value) {
    if (typeof value === 'number' && !Number.isSafeInteger(value)) {
      throw new ExportError('UNSAFE_ID', '收到已失去精度的訂單／物流 ID，已停止避免匯出錯誤號碼。');
    }
    return value == null ? '' : String(value);
  }

  function text(value) {
    if (value == null) return '';
    if (typeof value === 'object') return text(value.value ?? value.text ?? '');
    return String(value);
  }

  function absoluteUrl(value) {
    if (!value) return '';
    try {
      const url = new URL(value, 'https://buyertrade.taobao.com');
      return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : '';
    } catch { return ''; }
  }

  function apiError(response) {
    const codes = Array.isArray(response?.ret) ? response.ret.join('; ') : '';
    if (/SUCCESS(?:::|$)/.test(codes)) return null;
    if (/SESSION|TOKEN|LOGIN|AUTH|VALIDATE|RGV|SID_INVALID|CHECKJS|ASSIST_FLAG|ACCESS_DENIED|ILLEGAL_ACCESS|CREEP|FLOW_LIMIT|TRAFFIC_LIMIT|RATE_LIMIT|FREQUEN|CALL_LIMIT|LIMIT_CALL|THROTTL/i.test(codes)) {
      const error=new ExportError('AUTH_OR_CHALLENGE', `淘寶要求登入／驗證或限制頻率，請完成驗證後續抓。${codes}`);
      // 驗證連結只用於目前面板，不儲存至訂單或輸出檔案。
      const url=absoluteUrl(response?.data?.url);
      if (url && new URL(url).protocol==='https:' && /(^|\.)(taobao|tmall)\.com$/.test(new URL(url).hostname)) error.verificationUrl=url;
      return error;
    }
    return new ExportError('API_ERROR', codes || '訂單 API 回傳未知格式', /TIMEOUT|NETWORK|INNER_FAULT|SYSTEM_ERROR/i.test(codes));
  }

  /** 將官方 Ultron 節點轉成一個主訂單 + 商品陣列 + 包裹陣列，不把商品與包裹做笛卡兒乘積。 */
  function parseList(response, requestedPage) {
    const failure = apiError(response);
    if (failure) throw failure;
    const protocol = response.data;
    const nodes = protocol?.data;
    if (!nodes || Array.isArray(nodes) || protocol?.endpoint?.page !== 'pcTaoBoughtList') {
      throw new ExportError('SCHEMA_CHANGED', '新版訂單 API 結構不符，已停止；未將空資料視為完成。');
    }
    const entries = Object.values(nodes);
    const paging = entries.find(node => node.tag === 'pagination')?.fields;
    const control = protocol.global?.pageControl;
    if (!paging || !Number.isSafeInteger(Number(paging.currentPage)) || Number(paging.currentPage) !== requestedPage) {
      throw new ExportError('PAGE_MISMATCH', `請求第 ${requestedPage} 頁，但回傳頁碼不符。`);
    }
    const orders = new Map();
    for (const node of entries.filter(node => node.tag === 'shopInfo')) {
      const f = node.fields || {};
      const orderId = id(f.orderId);
      if (!orderId || orders.has(orderId)) throw new ExportError('SCHEMA_CHANGED', '主訂單 ID 缺漏或重複。');
      orders.set(orderId, {
        orderId, createdAt: text(f.createTime || f.createDay), shopName: text(f.shopName), sellerName: text(f.sellerName),
        status: text(f.tradeTitle), actualPaid: '', totalPrice: '', shippingFee: '', currency: 'CNY',
        detailUrl: absoluteUrl(f.orderDetailUrl), sourcePage: requestedPage,
        collectedAt: new Date().toISOString(), items: [], packages: [],
        logisticsStatus: 'pending', logisticsError: '',
      });
    }
    for (const node of entries) {
      const f = node.fields || {};
      if (node.tag === 'orderItemInfo') {
        const order = orders.get(id(f.orderId));
        const item = f.item;
        if (!order || !item || !node.id) throw new ExportError('SCHEMA_CHANGED', '商品資料缺少所屬主訂單。');
        const prefix = `${order.orderId}_`;
        const rawId = id(node.id);
        if (!rawId.startsWith(prefix)) throw new ExportError('SCHEMA_CHANGED', '商品節點 ID 與主訂單不符。');
        order.items.push({
          subOrderId: rawId.slice(prefix.length), productId: id(item.itemId), title: text(item.title),
          sku: text(item.skuText), quantity: text(item.quantity),
          // 官方欄位名為 actualTotalFee；保留原語意，不將它誤稱為單價或拿來分攤訂單實付。
          displayedPrice: text(item.priceInfo?.actualTotalFee), originalPrice: text(item.priceInfo?.promotion),
          refundStatus: text(item.refundStatus), itemUrl: absoluteUrl(item.itemUrl), imageUrl: absoluteUrl(item.pic),
        });
      } else if (node.tag === 'orderPayment') {
        const order = orders.get(id(node.id));
        if (order) Object.assign(order, {actualPaid: text(f.actualFee), totalPrice: text(f.totalFee), shippingFee: text(f.pcPostFee)});
      } else if (node.tag === 'orderLogistics') {
        const order = orders.get(id(f.packagePreview?.mainOrderId || node.id));
        if (order) {
          for (const pkg of f.packagePreview?.packageViewList || []) {
            order.packages.push(normalizePackage(pkg, 'list.packagePreview'));
          }
        }
      } else if (node.tag === 'orderStatus') {
        const order = orders.get(id(node.id));
        if (order) {
          order.shippingStatus = text(f.title);
          order.shippingSummary = text(f.subTitle);
          // 狀態卡只有代碼／單號，缺公司名時仍需補查，不能視作完整物流。
          if (f.mailNo && !entries.some(n => n.tag === 'orderLogistics' && id(n.id) === order.orderId)) {
            order.packages.push(normalizePackage({mailNo:f.mailNo, cpCode:f.cpCode}, 'list.orderStatus'));
          }
        }
      }
    }
    for (const order of orders.values()) {
      if (!order.items.length) throw new ExportError('SCHEMA_CHANGED', '主訂單沒有商品資料，已停止避免漏單。');
      order.packages = mergePackages([], order.packages);
      order.logisticsStatus = packageStatus(order.packages);
      if (!order.packages.length && /买家已付款|等待买家付款|待付款|待发货/.test(order.status)) order.logisticsStatus = 'not_shipped';
    }
    const hasMore = paging.hasMore ?? control?.hasMore;
    if (typeof hasMore !== 'boolean') throw new ExportError('SCHEMA_CHANGED', 'API 缺少 hasMore，無法安全判斷是否已抓完。');
    if (!orders.size && hasMore) throw new ExportError('EMPTY_PAGE', 'API 回傳空頁卻仍有下一頁，已暫停避免跳過訂單。');
    return {orders:[...orders.values()], page:requestedPage, hasMore, total:Number(paging.totalNum) || 0, pageSize:Number(paging.pageSize) || 30};
  }

  function normalizePackage(pkg, source) {
    return {
      trackingNumber:id(pkg.mailNo ?? pkg.expressId), company:text(pkg.cpName ?? pkg.expressName), companyCode:text(pkg.cpCode),
      subOrderIds:(pkg.subOrderList || []).map(id), source, events:[], checkedAt:new Date().toISOString(),
    };
  }

  function packageStatus(packages) {
    if (!packages.length) return 'pending';
    return packages.every(p => p.trackingNumber && p.company && !/[*＊]/.test(p.trackingNumber)) ? 'complete' : 'partial';
  }

  /** 「重試物流」的對象：物流未完整、有錯誤，或擷取當時尚未發貨（之後可能已出貨）。 */
  function needsLogisticsRetry(order) {
    return Boolean(order.logisticsError) || ['pending','partial','failed','not_shipped'].includes(order.logisticsStatus);
  }

  /** 列表沒有完整包裹時需要查物流；勾選補查軌跡時，已有包裹的訂單也要讀物流頁。 */
  function shouldEnrich(order, includeEvents) {
    return ['pending','partial'].includes(order.logisticsStatus) || (includeEvents && order.packages.length > 0);
  }

  /**
   * 用新列表資料更新已儲存的同一訂單（會修改 order）。
   * - 已結束交易且狀態未變：沿用完整物流，不再逐筆查詢；其他狀態只沿用一小時內驗證過的結果。
   * - 列表包裹不完整或不再附包裹時（已完成訂單常見），先併入舊包裹；補查成功會整份取代，失敗則保留而非清空。
   * - 同一物流單號保留已查到的軌跡。
   */
  function mergePrevious(order, previous, now = Date.now()) {
    if (!previous) return order;
    const recentVerified = previous.packages.length > 0 && previous.packages.every(pkg => now - Date.parse(pkg.checkedAt) < 3600000);
    const reusable = previous.logisticsStatus === 'complete' && previous.status === order.status && previous.packages.length > 0 &&
      (SETTLED_STATUS.test(order.status) || recentVerified);
    if (order.logisticsStatus === 'pending' && reusable) {
      order.packages = previous.packages; order.logisticsStatus = 'complete';
    } else if (['pending','partial'].includes(order.logisticsStatus) && previous.packages.length) {
      order.packages = mergePackages(previous.packages, order.packages);
    }
    for (const pkg of order.packages) {
      const old = previous.packages.find(p => p.trackingNumber === pkg.trackingNumber);
      if (old?.events?.length && !pkg.events?.length) pkg.events = old.events;
    }
    return order;
  }

  /** 只在同一主訂單內合併包裹，保留同單多包裹與商品對應關係。 */
  function mergePackages(previous, incoming) {
    const result = [];
    for (const pkg of [...previous, ...incoming]) {
      const found = pkg.trackingNumber && result.find(p => p.trackingNumber === pkg.trackingNumber &&
        (!p.companyCode || !pkg.companyCode || p.companyCode === pkg.companyCode));
      if (!found) { result.push({...pkg, subOrderIds:[...pkg.subOrderIds]}); continue; }
      found.company = pkg.company || found.company;
      found.companyCode = pkg.companyCode || found.companyCode;
      found.subOrderIds = [...new Set([...found.subOrderIds, ...pkg.subOrderIds])];
      if (pkg.events?.length) found.events = pkg.events;
      found.checkedAt = pkg.checkedAt;
    }
    return result;
  }

  /** 已完成訂單通常不在列表帶包裹；從新版詳情 API 的 logisticsPackages 取完整清單。 */
  function parseDetail(response, orderId, allowEmpty = false) {
    const failure=apiError(response);
    if (failure) throw failure;
    const protocol=response.data;
    if (protocol?.endpoint?.page !== 'pcTaoDetail' || !protocol.data) throw new ExportError('SCHEMA_CHANGED','訂單詳情 API 結構不符。');
    const nodes=Object.values(protocol.data);
    const labels=nodes.filter(n=>n.tag==='detailInfo' || n.tag==='detailInfoTm1').flatMap(n=>n.fields?.labels || []);
    if (!labels.some(label=>label.tag==='ORDER_ID' && id(label.value)===orderId)) throw new ExportError('ORDER_MISMATCH','訂單詳情的主訂單號不符，未寫入物流。');
    const packages=nodes.filter(n=>n.tag==='logisticsPackages').flatMap(n=>n.fields?.packageInfos || []).map(pkg=>({
      trackingNumber:id(pkg.mailNo),company:(pkg.companyInfos || []).map(c=>text(c.companyName)).filter(Boolean).join(' / '),
      companyCode:'',subOrderIds:[],source:'detail.logisticsPackages',events:[],checkedAt:new Date().toISOString(),
      // 詳情 API 未提供子訂單 ID 時保留原始商品描述，不能憑位置猜測對應商品。
      goods:(pkg.goodsInfos || []).map(g=>({title:text(g.goodsName),quantity:text(g.goodsQuantity),sku:text(g.sellProperty),itemUrl:absoluteUrl(g.tradeGoodUrl)})),
    }));
    if (!packages.length && !allowEmpty) throw new ExportError('LOGISTICS_UNAVAILABLE','訂單詳情未提供包裹清單。');
    return mergePackages([],packages);
  }

  function detailRequest(orderId) {
    const options=listRequest(1);
    options.api='mtop.taobao.order.query.detailv2';
    options.data={useV2:'true',appVersion:'3.0',archive:false,appName:'tborder',from:'OrderListActivity',
      extParams:JSON.stringify({weexPage:'neworderdetail4',openFrom:'taoBoughtList'}),bizOrderId:orderId};
    return options;
  }

  function logisticsRequest(orderId, query = {}) {
    // 必須沿用官方物流頁的 JSONP。此 API 的 POST JSON 會將長 orderId
    // 回傳成 number；JSONP 則保留字串，解析後才轉字串已無法挽回精度。
    const options={api:'mtop.taobao.logistics.detailorlist.query',v:'1.0',appKey:'12574478',
      ttid:'#t#ip##_h5_web_default',dataType:'jsonp',needLogin:true,LoginRequest:true,
      AntiCreep:false,AntiFlood:false,preventFallback:true,timeout:CONFIG.TIMEOUT,data:{orderId:id(orderId)}};
    for (const key of ['logisticsOrderId','mailNo']) if(query[key]) options.data[key]=id(query[key]);
    return options;
  }

  /** 「查看物流」回傳單包裹明細或多包裹列表；多包裹列表需逐一查詢，不能只讀預設第一個分頁。 */
  function parseLogistics(response, orderId, expectedMailNo = '') {
    const failure=apiError(response);
    if (failure) throw failure;
    const protocol=response.data, nodes=Object.values(protocol?.data || {});
    if (protocol?.endpoint?.page==='logisticsPackageList') {
      const queries=nodes.filter(n=>n.tag==='pakcage').map(n=>{
        // pakcage 是官方協議原本的拼字；官方 home.js 也以此識別包裹。
        const url=new URL(n.fields?.rightBtnUrl || '', 'https://market.m.taobao.com');
        const query=Object.fromEntries(url.searchParams);
        if (id(query.orderId)!==orderId || (!query.mailNo && !query.logisticsOrderId)) throw new ExportError('ORDER_MISMATCH','物流包裹連結缺少正確訂單或包裹識別。');
        return {orderId,mailNo:query.mailNo || '',logisticsOrderId:query.logisticsOrderId || ''};
      });
      if (!queries.length) throw new ExportError('LOGISTICS_UNAVAILABLE','物流頁沒有提供可查詢的包裹。');
      return {queries,packages:[]};
    }
    if (protocol?.endpoint?.page!=='logisticsDetailH5') throw new ExportError('SCHEMA_CHANGED','物流頁 API 結構不符。');
    if (id(protocol.global?.utData?.orderId)!==orderId) throw new ExportError('ORDER_MISMATCH','物流頁的訂單號不符，未寫入物流。');
    const company=nodes.find(n=>n.tag==='popupBodyCompony')?.fields;
    const trackingNumber=id(company?.mailNo);
    if (!trackingNumber || !company?.name) throw new ExportError('LOGISTICS_UNAVAILABLE','物流頁未提供完整公司及單號。');
    if ((expectedMailNo && trackingNumber!==expectedMailNo) || (protocol.global?.utData?.mailNo && id(protocol.global.utData.mailNo)!==trackingNumber)) {
      throw new ExportError('LOGISTICS_MISMATCH','物流頁回傳不同包裹的單號，已停止避免套用錯誤物流。');
    }
    const order=protocol.hierarchy?.structure?.logisticsDetail || [];
    const events=order.map(key=>protocol.data[key]).filter(n=>n?.tag==='logisticsDetailLine').map(n=>({
      time:text(n.fields?.subTitle),status:text(n.fields?.title),description:(n.fields?.desc || []).map(text).join(''),
    }));
    return {queries:[],packages:[{trackingNumber,company:text(company.name),companyCode:'',subOrderIds:[],
      logisticsOrderId:id(protocol.global?.utData?.logisticsOrderId),source:'logistics.detailorlist',events,checkedAt:new Date().toISOString()}]};
  }

  async function loadLogistics(orderId,request,signal) {
    const root=parseLogistics(await request(logisticsRequest(orderId),signal),orderId);
    let packages=root.packages;
    for (const query of root.queries) {
      checkAbort(signal);
      try {
        const detail=parseLogistics(await request(logisticsRequest(orderId,query),signal),orderId,query.mailNo);
        if (detail.queries.length) throw new ExportError('SCHEMA_CHANGED','包裹明細仍回傳列表，已停止避免無限查詢。');
        packages=mergePackages(packages,detail.packages);
      } catch(error) {
        // 後續包裹失敗時仍保留已核對成功的包裹，整筆訂單會另標為 partial。
        error.packages=packages;
        throw error;
      }
    }
    return packages;
  }

  /** 以訂單號補查物流：先讀「查看物流」，失敗再用訂單詳情；兩者都不需要訂單在列表中的頁碼。 */
  async function enrichOrder(order,request,signal,includeEvents) {
    if (order.logisticsStatus==='complete' && !includeEvents) return;
    let packages=[];
    try {
      packages=await loadLogistics(order.orderId,request,signal);
    } catch(error) {
      if (error.packages?.length) order.packages=mergePackages(order.packages,error.packages);
      if (['CANCELLED','AUTH_OR_CHALLENGE','ORDER_MISMATCH','LOGISTICS_MISMATCH','SCHEMA_CHANGED'].includes(error.code)) throw error;
      // 物流頁服務暫時不可用時，以同一訂單的詳情頁完整包裹清單作後備；不把失敗當無物流。
      try {packages=parseDetail(await request(detailRequest(order.orderId),signal),order.orderId);}
      catch(detailError) {
        if (['CANCELLED','AUTH_OR_CHALLENGE','ORDER_MISMATCH','SCHEMA_CHANGED'].includes(detailError.code)) throw detailError;
        throw new ExportError('LOGISTICS_UNAVAILABLE',`查看物流：${error.message}；訂單詳情：${detailError.message}`);
      }
      if (includeEvents) order.logisticsError='單號已從訂單詳情取得；物流頁暫不可用，軌跡待補查。';
    }
    // 新取得的完整清單為準；依相同單號保留可驗證的商品關係，詳情後備沒有軌跡時保留先前查到的軌跡。
    for (const pkg of packages) {
      const previous=order.packages.find(p=>p.trackingNumber===pkg.trackingNumber);
      if (!previous) continue;
      pkg.subOrderIds=previous.subOrderIds;pkg.companyCode=previous.companyCode;
      if (!pkg.events.length && previous.events?.length) pkg.events=previous.events;
    }
    order.packages=packages;order.logisticsStatus=packageStatus(packages);
    if (!order.logisticsError?.startsWith('單號已從訂單詳情')) order.logisticsError='';
    if (order.logisticsStatus!=='complete') throw new ExportError('LOGISTICS_UNAVAILABLE','物流頁包裹仍缺少完整單號或公司，已保留可用資料。');
  }

  function listRequest(page, tabCode = 'all') {
    return {
      api:LIST_API, v:'1.0', appKey:'12574478', ttid:'1@tbwang_windows_1.0.0#pc',
      type:'POST', dataType:'json', valueType:'original', ecode:'1', needLogin:true, isHttps:'1', timeout:CONFIG.TIMEOUT,
      AntiCreep:false,AntiFlood:false,
      data:{tabCode, page, OrderType:'OrderList', appName:'tborder', appVersion:'3.0', condition:JSON.stringify({directRouteToTm2Scene:'1'}), __needlessClearProtocol__:true},
    };
  }

  function abortError() { return new ExportError('CANCELLED', '已停止，可從斷點繼續。'); }
  function requestInterval(seconds) {
    const value=Number(seconds);
    if (!Number.isFinite(value) || value<2 || value>120) throw new ExportError('INVALID_INTERVAL','請求間隔需介於 2 至 120 秒。');
    return Math.round(value*1000);
  }
  function checkAbort(signal) { if (signal?.aborted) throw abortError(); }
  function sleep(ms, signal) {
    checkAbort(signal);
    return new Promise((resolve, reject) => {
      const abort = () => {clearTimeout(timer); signal?.removeEventListener('abort',abort); reject(abortError());};
      const timer = setTimeout(() => {signal?.removeEventListener('abort',abort); resolve();},ms);
      signal?.addEventListener('abort',abort,{once:true});
    });
  }

  /** SDK 的伺服器錯誤可退避重試；登入、驗證和格式改動一律停止，不重複轟炸 API。 */
  async function retry(operation, signal, report = () => {}, retries = CONFIG.RETRIES) {
    for (let attempt = 0; ; attempt++) {
      checkAbort(signal);
      try { return await operation(); }
      catch (error) {
        checkAbort(signal);
        if (!error.retryable || attempt >= retries) throw error;
        report(`連線失敗，${attempt+1}/${retries} 次重試…`);
        await sleep(2000 * 2 ** attempt,signal);
      }
    }
  }

  /** 每頁先儲存訂單、再補物流、最後前進斷點。取消或失敗不會把尚未完成的頁面標記完成。 */
  async function collect({job, store, fetchPage, enrich, signal, report = () => {}}) {
    let lastFingerprint = job.lastFingerprint || '';
    for (let page = job.nextPage; page <= job.endPage; page++) {
      checkAbort(signal);
      report(`正在讀取第 ${page} 頁…`);
      const parsed = await fetchPage(page,job.tabCode,signal);
      checkAbort(signal);
      const fingerprint = parsed.orders.map(order=>order.orderId).sort().join(',');
      if (fingerprint && fingerprint === lastFingerprint) throw new ExportError('REPEATED_PAGE', 'API 重複回傳同一批訂單，已停止避免漏單。');
      for (const order of parsed.orders) {
        order.sourceTab=job.tabCode;
        // 未發貨／失敗資料永不快取為完成；舊包裹只在補查前暫留，避免中途停止時清掉已知單號。
        mergePrevious(order,await store.getOrder(order.orderId));
      }
      await store.savePage(parsed.orders, {...job,nextPage:page});
      for (const order of parsed.orders) {
        checkAbort(signal);
        if (shouldEnrich(order,job.includeEvents)) {
          report(`第 ${page} 頁：補查物流 ${order.orderId}`);
          try { await enrich(order,signal,job.includeEvents); }
          catch (error) {
            if (PAUSE_CODES.includes(error.code)) throw error;
            order.logisticsError = error.message;
            order.logisticsStatus = order.packages.length ? 'partial' : 'failed';
          }
          await store.putOrder(order);
        }
      }
      job = {...job,nextPage:page+1,lastFingerprint:fingerprint,lastPage:page,total:parsed.total,completed:!parsed.hasMore || page === job.endPage};
      await store.savePage([],job);
      lastFingerprint = fingerprint;
      report(`第 ${page} 頁已儲存（${parsed.orders.length} 筆），可隨時下載。`);
      if (job.completed) return job;
    }
    return job;
  }

  /**
   * 重試物流：先重讀訂單的來源頁，取得最新交易狀態與列表包裹。
   * 新訂單會把舊訂單往後推，篩選分頁（如待發貨）的訂單出貨後也會離開該分頁；
   * 原頁找不到時改用訂單號直接查物流，不要求重新擷取整個範圍。
   * 補查失敗只更新錯誤，不清掉已知包裹；直接查詢失敗時保留原狀態（例如未發貨）並記錄原因。
   */
  async function retryLogistics({store, fetchPage, enrich, signal, includeEvents = false, report = () => {}}) {
    const targets = (await store.allOrders()).filter(needsLogisticsRetry);
    const pages = new Map(), summary = {total:targets.length, complete:0, notShipped:0, unresolved:0};
    for (let index = 0; index < targets.length; index++) {
      checkAbort(signal);
      const original = structuredClone(targets[index]);
      const tabCode = original.sourceTab || 'all', pageKey = `${tabCode}:${original.sourcePage}`;
      report(`重試物流 ${index+1}/${targets.length}：${original.orderId}`);
      if (!pages.has(pageKey)) {
        try { pages.set(pageKey, await fetchPage(original.sourcePage,tabCode,signal)); }
        catch (error) {
          // 只有頁碼已不存在才改直接查；網路或格式錯誤照舊停止，避免逐筆白跑。
          if (!['PAGE_MISMATCH','EMPTY_PAGE'].includes(error.code)) throw error;
          report(`第 ${original.sourcePage} 頁讀取失敗（${error.message}），改以訂單號直接查物流。`);
          pages.set(pageKey, null);
        }
      }
      const fresh = pages.get(pageKey)?.orders.find(o=>o.orderId===original.orderId);
      let order;
      if (fresh) {
        order = mergePrevious(fresh, original);
        order.sourceTab = tabCode;
      } else {
        // 交易狀態文字無法用物流 API 更新，保留原值；需要最新狀態時重新擷取範圍。
        if (pages.get(pageKey)) report(`第 ${original.sourcePage} 頁已找不到 ${original.orderId}（頁碼移動或已離開分頁），改以訂單號直接查物流。`);
        order = {...original, logisticsStatus:'pending', logisticsError:''};
      }
      if (!fresh || shouldEnrich(order,includeEvents)) {
        try { await enrich(order,signal,includeEvents); }
        catch (error) {
          if (PAUSE_CODES.includes(error.code)) throw error;
          if (fresh) {
            order.logisticsStatus = order.packages.length ? 'partial' : 'failed'; order.logisticsError = error.message;
          } else {
            // 不知道最新交易狀態時不降級：未發貨維持未發貨、完整包裹維持完整，失敗原因列入 Errors。
            if (!order.packages.length) order.logisticsStatus = original.logisticsStatus==='not_shipped' ? 'not_shipped' : 'failed';
            else order.logisticsStatus = original.logisticsStatus==='complete' ? packageStatus(order.packages) : 'partial';
            order.logisticsError = `原頁找不到此訂單，以訂單號查物流未成功；交易狀態可能已改變，可重新擷取範圍確認。${error.message}`;
          }
        }
      }
      await store.putOrder(order);
      if (order.logisticsStatus==='not_shipped' && !order.logisticsError) summary.notShipped++;
      else if (needsLogisticsRetry(order)) summary.unresolved++;
      else summary.complete++;
    }
    return summary;
  }

  function exportDocument(orders, job) {
    return {schemaVersion:1,exporterVersion:VERSION,exportedAt:new Date().toISOString(),job:job || null,orders,
      errors:orders.filter(o=>o.logisticsError || ['failed','partial','pending'].includes(o.logisticsStatus))
        .map(o=>({orderId:o.orderId,status:o.logisticsStatus,error:o.logisticsError || '物流尚未完整取得'}))};
  }

  function workbookTables(document) {
    const orders = [['主訂單號','購買時間','店舖','賣家','訂單狀態','實付款（訂單）','訂單總價','運費','幣別','物流狀態','物流錯誤','來源頁','擷取時間','訂單詳情']];
    const items = [['主訂單號','子訂單號','商品ID','商品名稱','規格','數量','商品顯示價格','原顯示價格','退款狀態','商品URL','圖片URL']];
    const packages = [['主訂單號','物流公司','物流公司代碼','物流單號','對應子訂單號（JSON）','資料來源','查詢時間','物流軌跡（JSON）','包裹商品描述（JSON）']];
    const errors = [['主訂單號','物流狀態','錯誤']];
    for (const o of document.orders) {
      orders.push([o.orderId,o.createdAt,o.shopName,o.sellerName,o.status,o.actualPaid,o.totalPrice,o.shippingFee,o.currency,o.logisticsStatus,o.logisticsError,o.sourcePage,o.collectedAt,o.detailUrl]);
      for (const i of o.items) items.push([o.orderId,i.subOrderId,i.productId,i.title,i.sku,i.quantity,i.displayedPrice,i.originalPrice,i.refundStatus,i.itemUrl,i.imageUrl]);
      for (const p of o.packages) packages.push([o.orderId,p.company,p.companyCode,p.trackingNumber,JSON.stringify(p.subOrderIds),p.source,p.checkedAt,JSON.stringify(p.events),JSON.stringify(p.goods || [])]);
    }
    for (const e of document.errors) errors.push([e.orderId,e.status,e.error]);
    const metadata = [['欄位','內容'],['schemaVersion',document.schemaVersion],['exporterVersion',document.exporterVersion],['exportedAt',document.exportedAt],['job',JSON.stringify(document.job)],['說明','主訂單實付款只記在 Orders；Items 與 Packages 透過訂單號／子訂單號關聯，不重複加總付款。']];
    return {Orders:orders,Items:items,Packages:packages,Errors:errors,Metadata:metadata};
  }

  // XLSX 使用標準 OOXML + 無壓縮 ZIP，無 CDN 依賴；所有儲存格都是文字，長 ID 不會變科學記號，也不會執行公式。
  function xml(value) {
    return text(value).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/g,'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&apos;');
  }
  function columnName(index) {
    let result = '';
    for (index++; index; index=Math.floor((index-1)/26)) result=String.fromCharCode(65+(index-1)%26)+result;
    return result;
  }
  function sheetXml(rows) {
    if (rows.length > 1048576) throw new ExportError('XLSX_LIMIT','工作表超過 Excel 的列數限制，請改用 JSON。');
    const data = rows.map((row,r)=>`<row r="${r+1}">${row.map((value,c)=>{
      const s = text(value);
      if (s.length > 32767) throw new ExportError('XLSX_LIMIT','儲存格超過 Excel 長度限制，請改用 JSON 保留完整資料。');
      return `<c r="${columnName(c)}${r+1}" t="inlineStr"><is><t xml:space="preserve">${xml(s)}</t></is></c>`;
    }).join('')}</row>`).join('');
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><sheetData>${data}</sheetData><autoFilter ref="A1:${columnName(rows[0].length-1)}${rows.length}"/></worksheet>`;
  }
  function crc32(bytes) {
    let crc = 0xffffffff;
    for (const byte of bytes) {
      crc ^= byte;
      for (let i=0;i<8;i++) crc=(crc>>>1) ^ ((crc&1) ? 0xedb88320 : 0);
    }
    return (crc ^ 0xffffffff) >>> 0;
  }
  function zip(files) {
    const encoder = new TextEncoder(), chunks = [], directory = [];
    let offset = 0;
    for (const [filename,content] of Object.entries(files)) {
      const name = encoder.encode(filename), data = encoder.encode(content), crc = crc32(data);
      const header = new Uint8Array(30+name.length), view = new DataView(header.buffer);
      view.setUint32(0,0x04034b50,true); view.setUint16(4,20,true); view.setUint16(6,0x800,true); view.setUint16(12,0x21,true);
      view.setUint32(14,crc,true); view.setUint32(18,data.length,true); view.setUint32(22,data.length,true); view.setUint16(26,name.length,true); header.set(name,30);
      const central = new Uint8Array(46+name.length), cv = new DataView(central.buffer);
      cv.setUint32(0,0x02014b50,true); cv.setUint16(4,20,true); cv.setUint16(6,20,true); cv.setUint16(8,0x800,true); cv.setUint16(14,0x21,true);
      cv.setUint32(16,crc,true); cv.setUint32(20,data.length,true); cv.setUint32(24,data.length,true); cv.setUint16(28,name.length,true); cv.setUint32(42,offset,true); central.set(name,46);
      chunks.push(header,data); directory.push(central); offset+=header.length+data.length;
    }
    const size = directory.reduce((sum,part)=>sum+part.length,0), end = new Uint8Array(22), ev = new DataView(end.buffer);
    if (offset+size > 0xffffffff) throw new ExportError('XLSX_LIMIT','XLSX 超過 ZIP 容量限制，請縮小範圍。');
    ev.setUint32(0,0x06054b50,true); ev.setUint16(8,directory.length,true); ev.setUint16(10,directory.length,true); ev.setUint32(12,size,true); ev.setUint32(16,offset,true);
    const result = new Uint8Array(offset+size+end.length);
    let cursor=0;
    for (const part of [...chunks,...directory,end]) {result.set(part,cursor);cursor+=part.length;}
    return result;
  }
  function createXlsx(document) {
    const tables = Object.entries(workbookTables(document));
    const files = {
      '[Content_Types].xml':`<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${tables.map((_,i)=>`<Override PartName="/xl/worksheets/sheet${i+1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>`,
      '_rels/.rels':'<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
      'xl/workbook.xml':`<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${tables.map(([name],i)=>`<sheet name="${name}" sheetId="${i+1}" r:id="rId${i+1}"/>`).join('')}</sheets></workbook>`,
      'xl/_rels/workbook.xml.rels':`<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${tables.map((_,i)=>`<Relationship Id="rId${i+1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i+1}.xml"/>`).join('')}</Relationships>`,
    };
    tables.forEach(([,rows],i)=>{files[`xl/worksheets/sheet${i+1}.xml`]=sheetXml(rows);});
    return zip(files);
  }

  const core = {VERSION,CONFIG,ExportError,id,parseList,parseDetail,parseLogistics,loadLogistics,enrichOrder,mergePackages,mergePrevious,packageStatus,needsLogisticsRetry,listRequest,detailRequest,logisticsRequest,requestInterval,retry,collect,retryLogistics,exportDocument,workbookTables,createXlsx};
  // Node 測試直接載入相同程式碼；瀏覽器不公開任何含私人資料的全域 API。
  if (typeof module === 'object' && module.exports) {module.exports=core;return;}

  const pageWindow = typeof unsafeWindow === 'undefined' ? window : unsafeWindow;
  let store, activeController, activeJob, initialized = false;
  let lastRequestAt = 0;
  let activeRequestInterval = CONFIG.REQUEST_INTERVAL;
  const ui = {};

  /** 只讀取登入者識別 ID 來隔離本機資料庫；不儲存、匯出或記錄 session cookie。 */
  function currentAccount() {
    const cookies = document.cookie;
    // 新版登入會把 unb 設成 HttpOnly；使用非機密的登入暱稱作為後備識別。
    for (const name of ['unb','_nk_','lgc','tracknick']) {
      const value=new RegExp(`(?:^|;\\s*)${name}=([^;]+)`).exec(cookies)?.[1];
      if (value) return `${name}:${value}`;
    }
    throw new ExportError('AUTH_OR_CHALLENGE','無法辨識登入帳號，請重新登入淘寶後重新整理。');
  }

  class OrderStore {
    constructor(db, account) {this.db=db;this.account=account;}
    static async open(account) {
      const db = await new Promise((resolve,reject)=>{
        const request=indexedDB.open(`taobao-order-exporter-v3-${account}`,1);
        request.onupgradeneeded=()=>{
          request.result.createObjectStore('orders',{keyPath:'orderId'});
          request.result.createObjectStore('meta');
        };
        request.onsuccess=()=>resolve(request.result);
        request.onerror=()=>reject(request.error);
        request.onblocked=()=>reject(new ExportError('STORAGE_BLOCKED','請關閉其他舊版匯出分頁再重試。'));
      });
      db.onversionchange=()=>db.close();
      return new OrderStore(db,account);
    }
    async read(name,method,key) {
      return new Promise((resolve,reject)=>{
        const request=this.db.transaction(name).objectStore(name)[method](key);
        request.onsuccess=()=>resolve(request.result);
        request.onerror=()=>reject(request.error);
      });
    }
    getOrder(orderId) {return this.read('orders','get',orderId);}
    allOrders() {return this.read('orders','getAll');}
    getJob() {return this.read('meta','get','job');}
    count() {return this.read('orders','count');}
    async savePage(orders,job) {
      // 同一 transaction 寫訂單和斷點；容量不足時整筆回滾並停止，不顯示假完成。
      return new Promise((resolve,reject)=>{
        const tx=this.db.transaction(['orders','meta'],'readwrite');
        for (const order of orders) tx.objectStore('orders').put(order);
        if (job) tx.objectStore('meta').put(job,'job');
        tx.oncomplete=()=>resolve();
        tx.onerror=()=>reject(tx.error || new ExportError('STORAGE_ERROR','本機資料儲存失敗。'));
        tx.onabort=()=>reject(tx.error || new ExportError('STORAGE_ERROR','本機資料寫入已中止。'));
      });
    }
    putOrder(order) {return this.savePage([order]);}
    async clear() {
      return new Promise((resolve,reject)=>{
        const tx=this.db.transaction(['orders','meta'],'readwrite');
        tx.objectStore('orders').clear();tx.objectStore('meta').clear();
        tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);
      });
    }
  }

  function status(message) {
    ui.status.textContent=message;
    const line=`${new Date().toLocaleTimeString()} ${message}`;
    ui.log.textContent=(line+'\n'+ui.log.textContent).split('\n').slice(0,50).join('\n');
    console.info('[淘寶訂單匯出]',message);
    if (store && /頁已儲存/.test(message)) refreshCount().catch(error=>console.error('[淘寶訂單匯出] 統計失敗',error));
  }
  async function refreshCount() {
    const orders=await store.allOrders();
    const unresolved=orders.filter(o=>o.logisticsError || ['pending','partial','failed'].includes(o.logisticsStatus)).length;
    const notShipped=orders.filter(o=>o.logisticsStatus==='not_shipped' && !o.logisticsError).length;
    const packages=orders.reduce((sum,o)=>sum+o.packages.length,0);
    ui.count.textContent=`已儲存 ${orders.length} 筆主訂單／${packages} 個包裹；${unresolved} 筆物流待補查、${notShipped} 筆擷取時未發貨`;
  }
  function assertAccount() {
    if (currentAccount() !== store.account) throw new ExportError('AUTH_OR_CHALLENGE','登入帳號已切換；請重新整理以隔離不同帳號的訂單。');
  }
  async function paced(signal) {
    assertAccount();checkAbort(signal);
    await sleep(Math.max(0,activeRequestInterval-(Date.now()-lastRequestAt)),signal);
    lastRequestAt=Date.now();
  }

  /** SDK 使用原頁面的簽章、session 與瀏覽器環境，無需複製 Cookie 或自行計算簽章。 */
  async function requestApi(requestOptions,signal) {
    return retry(async()=>{
      await paced(signal);
      const sdk=pageWindow.lib?.mtop || pageWindow.mtop;
      if (!sdk?.request) throw new ExportError('SDK_MISSING','淘寶頁面 SDK 尚未載入，請稍後再試。');
      let options=requestOptions;
      // Firefox userscript 的隔離環境需要把參數複製至頁面；Chromium 直接傳入即可。
      if (typeof cloneInto === 'function') options=cloneInto(options,pageWindow);
      const result=await new Promise((resolve,reject)=>{
        const cleanup=()=>{clearTimeout(timer);signal?.removeEventListener('abort',abort);};
        const abort=()=>{cleanup();reject(abortError());};
        const timer=setTimeout(()=>{cleanup();reject(new ExportError('TIMEOUT','訂單 API 逾時',true));},CONFIG.TIMEOUT+1000);
        signal?.addEventListener('abort',abort,{once:true});
        Promise.resolve().then(()=>sdk.request(options)).then(value=>{cleanup();resolve(value);},error=>{
          cleanup();reject((error?.ret && apiError(error)) || new ExportError('NETWORK','訂單 API 連線失敗',true));
        });
      });
      checkAbort(signal);assertAccount();
      const failure=apiError(result);
      if (failure) throw failure;
      return result;
    },signal,status);
  }

  async function fetchPage(page,tabCode,signal) {
    return parseList(await requestApi(listRequest(page,tabCode),signal),page);
  }

  function enrich(order,signal,includeEvents) {
    return enrichOrder(order,requestApi,signal,includeEvents);
  }

  async function exclusive(operation) {
    if (!navigator.locks) throw new ExportError('LOCK_UNAVAILABLE','瀏覽器不支援跨分頁鎖，請使用新版 Brave／Chrome／Firefox。');
    return navigator.locks.request(`taobao-export-${store.account}`,{ifAvailable:true},async lock=>{
      if (!lock) throw new ExportError('BUSY','另一個淘寶分頁正在抓取或清除資料，請先停止該任務。');
      return operation();
    });
  }
  function busy(value) {
    for (const button of ui.actions) button.disabled=value;
    ui.stop.disabled=!value;
    ui.startPage.disabled=value;ui.endPage.disabled=value;ui.tab.disabled=value;ui.events.disabled=value;ui.interval.disabled=value;
  }
  async function run(operation) {
    if (activeController) return;
    activeController=new AbortController();busy(true);ui.verification.hidden=true;
    const signal=activeController.signal;
    try {
      activeRequestInterval=requestInterval(ui.interval.value);
      await exclusive(()=>operation(signal));
    }
    catch(error) {
      status(`${error.code || 'ERROR'}：${error.message || error}`);
      if (error.verificationUrl) {ui.verification.href=error.verificationUrl;ui.verification.hidden=false;}
    }
    finally {activeController=null;busy(false);await refreshCount();}
  }
  function readJob() {
    const startPage=Number(ui.startPage.value), endPage=ui.endPage.value.trim() ? Number(ui.endPage.value) : Number.MAX_SAFE_INTEGER;
    if (!Number.isSafeInteger(startPage) || !Number.isSafeInteger(endPage) || startPage<1 || endPage<startPage) {
      throw new ExportError('INVALID_RANGE','請輸入有效頁碼，起始頁需大於 0，截止頁需大於等於起始頁。');
    }
    return {startPage,endPage,nextPage:startPage,tabCode:ui.tab.value,includeEvents:ui.events.checked,completed:false,startedAt:new Date().toISOString()};
  }
  async function start(resume,signal) {
    assertAccount();
    if (!resume) {
      const previous=await store.getJob();
      // 開始新範圍會覆寫斷點；誤按時讓使用者有機會改按續抓。
      if (previous && !previous.completed && !confirm(`目前有未完成斷點（第 ${previous.nextPage} 頁）。開始新範圍會取代此斷點，確定？`)) {status('已保留原斷點，可按「斷點續抓」繼續。');return;}
    }
    activeJob=resume ? await store.getJob() : readJob();
    if (!activeJob || (resume && activeJob.completed)) throw new ExportError('NO_CHECKPOINT','沒有未完成斷點，請開始新範圍。');
    // 續抓時以目前面板為準，允許使用者在限流後放慢速度。
    activeJob.requestIntervalMs=activeRequestInterval;
    await store.savePage([],activeJob);
    activeJob=await collect({job:activeJob,store,fetchPage,enrich,signal,report:status});
    status(`範圍擷取完成，最後處理第 ${activeJob.lastPage} 頁。請檢查物流待補查筆數後下載。`);
  }
  async function retryMissing(signal) {
    assertAccount();
    const job=await store.getJob();
    if (job) await store.savePage([],{...job,requestIntervalMs:activeRequestInterval});
    const result=await retryLogistics({store,fetchPage,enrich,signal,includeEvents:ui.events.checked,report:status});
    if (!result.total) {status('沒有需要補查物流的訂單。');return;}
    status(`物流補查完成：${result.total} 筆中 ${result.complete} 筆已完整、${result.notShipped} 筆仍未發貨、${result.unresolved} 筆待核對（見 Errors）。`);
  }
  async function download(format) {
    try {
      if (!store) throw new ExportError('NOT_READY','面板尚未初始化完成，請依狀態訊息處理後重新整理。');
      assertAccount();
      const orders=await store.allOrders();
      if (!orders.length) throw new ExportError('NO_DATA','尚未擷取任何訂單。');
      orders.sort((a,b)=>b.createdAt.localeCompare(a.createdAt) || a.orderId.localeCompare(b.orderId));
      const document=exportDocument(orders,await store.getJob());
      const content=format==='json' ? JSON.stringify(document,null,2) : createXlsx(document);
      const blob=new Blob([content],{type:format==='json'?'application/json;charset=utf-8':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
      const url=URL.createObjectURL(blob), link=window.document.createElement('a');
      link.href=url;link.download=`taobao-orders-${new Date().toISOString().replace(/[:.]/g,'-')}.${format}`;
      window.document.body.appendChild(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);
      status(`已匯出 ${orders.length} 筆訂單／${document.errors.length} 筆待核對：${format.toUpperCase()}。`);
    } catch(error) {status(`${error.code || 'ERROR'}：${error.message}`);}
  }

  /** Shadow DOM 避免淘寶 SPA 樣式干擾；固定於右下角且可收合，不依賴易變動的容器 class。 */
  function createUI() {
    if (document.getElementById('taobao-order-exporter-v3')) return false;
    const host=document.createElement('section');host.id='taobao-order-exporter-v3';
    const shadow=host.attachShadow({mode:'open'});
    shadow.innerHTML=`<style>
      :host{all:initial;position:fixed;right:16px;bottom:16px;z-index:2147483646;font:14px/1.5 system-ui,sans-serif;color:#242424}
      details{width:450px;max-width:calc(100vw - 32px);background:#fff;border:2px solid #e94d00;border-radius:10px;box-shadow:0 4px 24px #0003}
      summary{padding:10px 14px;cursor:pointer;font-weight:700;background:#fff4ec;border-radius:8px}
      .body{padding:12px} .row{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:10px}
      input[type=number]{width:60px} input,select,button{font:inherit;padding:5px;border:1px solid #bbb;border-radius:4px;background:#fff;color:#242424}
      button{cursor:pointer} button.primary{background:#c94300;color:#fff;border-color:#c94300} button:disabled{opacity:.5;cursor:default}
      p{margin:8px 0} #status{white-space:pre-wrap;overflow-wrap:anywhere} pre{max-height:140px;overflow:auto;font:11px/1.4 monospace;white-space:pre-wrap}
      .hint{font-size:12px;color:#555} #count{font-weight:600}
    </style><details open><summary>淘寶訂單匯出 v${VERSION}（可收合）</summary><div class="body">
      <div class="row"><label>起始 <input id="startPage" aria-label="起始頁" type="number" min="1" value="1"></label><label>截止 <input id="endPage" aria-label="截止頁" type="number" min="1" placeholder="最後"></label>
      <select id="tab" aria-label="訂單範圍"><option value="all">所有訂單</option><option value="waitConfirm">待收貨</option><option value="waitSend">待發貨</option><option value="waitPay">待付款</option><option value="waitRate">待評價</option></select></div>
      <div class="row"><label>請求間隔（秒）<input id="interval" aria-label="請求間隔秒數" type="number" min="2" max="120" step="0.5" value="${CONFIG.REQUEST_INTERVAL/1000}"></label><span class="hint">逐筆查詢；限流時暫停</span></div>
      <label class="hint"><input id="events" type="checkbox">補查物流軌跡（較慢，單號預設已包含）</label>
      <div class="row" id="actions"></div><div class="row" id="downloads"></div>
      <p id="count"></p><p id="status" role="status" aria-live="polite">正在初始化…</p>
      <a id="verification" hidden target="_blank" rel="noopener noreferrer">開啟淘寶驗證，完成後回來續抓</a>
      <p class="hint">截止留空會抓至最後一頁，無十頁上限。重新整理後按續抓；待核對資料列在 Errors。物流有更新時按「重試物流」，會補查待補查與擷取時未發貨的訂單。大量擷取期間請勿切換登入帳號。</p>
      <details><summary>執行紀錄</summary><pre id="log"></pre></details>
    </div></details>`;
    for (const key of ['startPage','endPage','tab','events','interval','count','status','log','verification']) ui[key]=shadow.getElementById(key);
    ui.actions=[];
    const button=(label,container,action,primary=false)=>{
      const b=document.createElement('button');b.type='button';b.textContent=label;if(primary)b.className='primary';b.onclick=action;shadow.getElementById(container).appendChild(b);return b;
    };
    ui.actions.push(button('開始擷取','actions',()=>run(signal=>start(false,signal)),true));
    ui.actions.push(button('斷點續抓','actions',()=>run(signal=>start(true,signal))));
    ui.actions.push(button('重試物流','actions',()=>run(retryMissing)));
    ui.stop=button('停止','actions',()=>{activeController?.abort();status('正在停止，已儲存資料仍可下載。');});ui.stop.disabled=true;
    button('下載 XLSX','downloads',()=>download('xlsx'),true);
    button('下載 JSON','downloads',()=>download('json'));
    ui.actions.push(button('清除本機資料','downloads',()=>run(async()=>{
      assertAccount();
      if (!confirm('確定清除目前帳號的本機匯出資料及斷點？請先下載備份。')) return;
      await store.clear();activeJob=null;status('已清除目前帳號的本機資料。');
    })));
    busy(true);document.body.appendChild(host);return true;
  }

  async function main() {
    if (initialized || !document.body) return;
    initialized=true;
    if (!createUI()) return;
    try {
      store=await OrderStore.open(currentAccount());
      activeJob=await store.getJob();
      if (activeJob) {
        ui.startPage.value=activeJob.startPage;
        ui.endPage.value=activeJob.endPage===Number.MAX_SAFE_INTEGER?'':activeJob.endPage;
        ui.tab.value=activeJob.tabCode;ui.events.checked=activeJob.includeEvents;
        ui.interval.value=(activeJob.requestIntervalMs || CONFIG.REQUEST_INTERVAL)/1000;
      }
      // 原站 SDK 可能晚於 userscript 載入；以 250ms 檢查，最多等待 15 秒。
      for (let i=0;i<60 && !(pageWindow.lib?.mtop || pageWindow.mtop)?.request;i++) await sleep(CONFIG.SDK_CHECK_INTERVAL);
      if (!(pageWindow.lib?.mtop || pageWindow.mtop)?.request) throw new ExportError('SDK_MISSING','淘寶 SDK 未載入，請重新整理後重試。');
      busy(false);await refreshCount();
      status(activeJob && !activeJob.completed ? `發現斷點：第 ${activeJob.nextPage} 頁，按「斷點續抓」繼續。` : '準備就緒。截止頁留空會讀取至最後一頁。');
    } catch(error) {status(`${error.code || 'ERROR'}：${error.message}`);}
  }
  if (document.readyState==='loading') document.addEventListener('DOMContentLoaded',()=>setTimeout(main,CONFIG.UI_TASK_DELAY),{once:true});
  else setTimeout(main,CONFIG.UI_TASK_DELAY);
})();
