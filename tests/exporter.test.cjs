const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {spawnSync}=require('node:child_process');
const core=require('../taobaoOrderExporter.user.js');
const fixture=require('./fixtures.cjs');

test('未完結訂單：多商品、多包裹、子訂單關係與長 ID 完整保留',()=>{
  const {orders}=core.parseList(fixture.list(),1),o=orders[0];
  assert.equal(o.orderId,fixture.ORDER);assert.equal(o.items.length,2);assert.equal(o.packages.length,2);
  assert.deepEqual(o.packages[0].subOrderIds,[fixture.SUB1]);assert.equal(o.packages[0].trackingNumber,'001234567890123456789');
  assert.equal(o.actualPaid,'￥32.68');assert.equal(o.logisticsStatus,'complete');assert.equal(o.items[0].displayedPrice,'￥12.34');
});
test('跨域詳情 URL 正規化，拒絕非 HTTP URL',()=>{
  const input=fixture.list();input.data.data.shop.fields.orderDetailUrl='javascript:alert(1)';
  assert.equal(core.parseList(input,1).orders[0].detailUrl,'');
});
test('超過安全整數的 number ID 不會被默默匯出',()=>{
  assert.throws(()=>core.id(9007199254740993123),{code:'UNSAFE_ID'});
  assert.equal(core.id(fixture.ORDER),fixture.ORDER);
});
test('驗證失敗立即停止、短暫伺服器故障可重試',()=>{
  assert.throws(()=>core.parseList({ret:['FAIL_SYS_USER_VALIDATE::驗證']},1),{code:'AUTH_OR_CHALLENGE'});
  assert.throws(()=>core.parseList({ret:['FAIL_SYS_SESSION_EXPIRED::登入過期']},1),{code:'AUTH_OR_CHALLENGE'});
  assert.throws(()=>core.parseList({ret:['FAIL_SYS_SERVICE_INNER_FAULT::內部故障']},1),e=>e.retryable===true);
});

test('請求間隔可調，限流不會自動重試',async()=>{
  assert.equal(core.CONFIG.REQUEST_INTERVAL,5000);
  assert.equal(core.requestInterval('7.5'),7500);
  for(const value of ['',1.5,121,Infinity,'bad']) assert.throws(()=>core.requestInterval(value),{code:'INVALID_INTERVAL'});
  for(const code of ['FAIL_SYS_TRAFFIC_LIMIT','FAIL_SYS_API_FREQUENCY','RATE_LIMIT','FAIL_SYS_CALL_LIMITED']) {
    let calls=0;
    await assert.rejects(core.retry(async()=>{calls++;return core.parseList({ret:[code]},1);}),{code:'AUTH_OR_CHALLENGE'});
    assert.equal(calls,1);
  }
});

test('驗證立即交回使用者，連結只接受淘寶官方 HTTPS 網域',()=>{
  const response={ret:['FAIL_SYS_USER_VALIDATE','RGV587_ERROR::SM::驗證'],data:{url:'https://h5api.m.taobao.com/punish?test=synthetic'}};
  assert.throws(()=>core.parseList(response,1),e=>e.code==='AUTH_OR_CHALLENGE'&&e.verificationUrl===response.data.url);
  for(const url of ['https://taobao.com.invalid.example/','javascript:alert(1)','http://taobao.com/']){
    response.data.url=url;assert.throws(()=>core.parseList(response,1),e=>e.code==='AUTH_OR_CHALLENGE'&&!e.verificationUrl);
  }
  for(const options of [core.listRequest(1),core.logisticsRequest(fixture.ORDER)]){
    assert.equal(options.AntiCreep,false);assert.equal(options.AntiFlood,false);
  }
});
test('格式漂移、錯頁、空頁仍 hasMore 不會被當作完成',()=>{
  assert.throws(()=>core.parseList({ret:['SUCCESS::ok'],data:{}},1),{code:'SCHEMA_CHANGED'});
  assert.throws(()=>core.parseList(fixture.list(2),1),{code:'PAGE_MISMATCH'});
  const empty=fixture.list(1,true);empty.data.data={paging:empty.data.data.paging};
  assert.throws(()=>core.parseList(empty,1),{code:'EMPTY_PAGE'});
  empty.data.data.paging.fields.hasMore=false;assert.equal(core.parseList(empty,1).orders.length,0);
});
test('商品不能被歸屬到不相符的主訂單',()=>{
  const input=fixture.list();input.data.data.first.id='wrong_order';
  assert.throws(()=>core.parseList(input,1),{code:'SCHEMA_CHANGED'});
});
test('物流清單缺漏時保留待補查，已付款未發貨另行標示',()=>{
  const input=fixture.list();delete input.data.data.logistics;
  assert.equal(core.parseList(input,1).orders[0].logisticsStatus,'pending');
  input.data.data.shop.fields.tradeTitle='买家已付款';assert.equal(core.parseList(input,1).orders[0].logisticsStatus,'not_shipped');
  input.data.data.shop.fields.tradeTitle='交易关闭';assert.equal(core.parseList(input,1).orders[0].logisticsStatus,'pending');
});
test('只有單號或遮蔽的單號都標示 partial',()=>{
  const input=fixture.list();input.data.data.logistics.fields.packagePreview.packageViewList[0].cpName='';
  assert.equal(core.parseList(input,1).orders[0].logisticsStatus,'partial');
  assert.equal(core.packageStatus([{trackingNumber:'123***456',company:'測試'}]),'partial');
});
test('已完成訂單詳情讀取所有包裹，不憑商品順序猜測子訂單 ID',()=>{
  const packages=core.parseDetail(fixture.detail(),fixture.ORDER);
  assert.equal(packages.length,2);assert.deepEqual(packages[0].subOrderIds,[]);assert.equal(packages[0].goods[0].quantity,'2');
  assert.throws(()=>core.parseDetail(fixture.detail(),'wrong'),{code:'ORDER_MISMATCH'});
  const empty=fixture.detail();empty.data.data.packages.fields.packageInfos=[];
  assert.throws(()=>core.parseDetail(empty,fixture.ORDER),{code:'LOGISTICS_UNAVAILABLE'});
  assert.deepEqual(core.parseDetail(empty,fixture.ORDER,true),[]);
});
test('去重保留不同包裹及商品關係，不改寫呼叫者輸入',()=>{
  const pkg=core.parseList(fixture.list(),1).orders[0].packages[0];
  const result=core.mergePackages([pkg],[{...pkg,subOrderIds:[fixture.SUB2],company:'更新物流'}]);
  assert.equal(result.length,1);assert.equal(result[0].company,'更新物流');assert.deepEqual(result[0].subOrderIds,[fixture.SUB1,fixture.SUB2]);
  assert.deepEqual(pkg.subOrderIds,[fixture.SUB1]);
});
test('查看物流：資料正確歸屬訂單與單號，保留軌跡',()=>{
  const parsed=core.parseLogistics(fixture.logistics(),fixture.ORDER);
  assert.equal(parsed.packages[0].trackingNumber,'001234567890123456789');
  assert.equal(parsed.packages[0].events[0].description,'測試物流站');
  assert.throws(()=>core.parseLogistics(fixture.logistics(),'wrong'),{code:'ORDER_MISMATCH'});
  assert.throws(()=>core.parseLogistics(fixture.logistics(),fixture.ORDER,'wrong-number'),{code:'LOGISTICS_MISMATCH'});
});

test('物流使用官方 JSONP 避免 POST JSON 將長訂單號轉成浮點數',()=>{
  const options=core.logisticsRequest(fixture.ORDER);
  assert.equal(options.dataType,'jsonp');assert.equal(options.type,undefined);
  assert.equal(options.valueType,undefined);assert.equal(options.ecode,undefined);
  assert.equal(options.data.orderId,fixture.ORDER);
  const rounded=fixture.logistics();rounded.data.global.utData.orderId=Number(fixture.ORDER);
  assert.throws(()=>core.parseLogistics(rounded,fixture.ORDER),{code:'UNSAFE_ID'});
});
test('查看物流：逐一載入多包裹分頁，不只取第一個包裹',async()=>{
  const calls=[];
  const packages=await core.loadLogistics(fixture.ORDER,async options=>{
    calls.push(options.data);
    return options.data.mailNo?fixture.logistics(options.data.mailNo):fixture.logisticsList();
  });
  assert.equal(calls.length,3);assert.equal(calls[1].logisticsOrderId,'LP-ONE');assert.equal(calls[2].logisticsOrderId,'LP-TWO');
  assert.equal(packages.length,2);assert.deepEqual(packages.map(p=>p.trackingNumber),['001234567890123456789','AB0987654321']);
  assert.equal(packages[1].events[0].description,'測試物流站');
});
test('多包裹連結不符或明細持續回列表時，不會套錯單或無限迴圈',async()=>{
  const wrong=fixture.logisticsList();wrong.data.data.first.fields.rightBtnUrl='https://invalid.example/?orderId=wrong&mailNo=123';
  assert.throws(()=>core.parseLogistics(wrong,fixture.ORDER),{code:'ORDER_MISMATCH'});
  await assert.rejects(core.loadLogistics(fixture.ORDER,async()=>fixture.logisticsList()),{code:'SCHEMA_CHANGED'});
});

test('第二包裹失敗時保留第一包裹，並回報未完成而非成功',async()=>{
  await assert.rejects(core.loadLogistics(fixture.ORDER,async options=>{
    if (!options.data.mailNo) return fixture.logisticsList();
    if (options.data.mailNo==='AB0987654321') throw new core.ExportError('API_ERROR','第二包裹失敗');
    return fixture.logistics(options.data.mailNo);
  }),error=>{
    assert.equal(error.code,'API_ERROR');assert.equal(error.packages.length,1);
    assert.equal(error.packages[0].trackingNumber,'001234567890123456789');return true;
  });
});
test('大量擷取跨越十頁，反覆執行不重複訂單',async()=>{
  const store=fixture.memoryStore(),called=[];
  const fetchPage=async page=>{called.push(page);const parsed=core.parseList(fixture.list(page,page<12),page);parsed.orders[0].orderId=`${fixture.ORDER}-${page}`;return parsed;};
  const job={startPage:1,endPage:12,nextPage:1,tabCode:'all',requestIntervalMs:9000};
  await core.collect({job,store,fetchPage,enrich:async()=>{throw Error('不應補查完整物流');}});
  assert.equal(called.length,12);assert.equal((await store.allOrders()).length,12);assert.equal((await store.getJob()).completed,true);
  assert.equal((await store.getJob()).requestIntervalMs,9000);
  await core.collect({job,store,fetchPage,enrich:async()=>{}});assert.equal((await store.allOrders()).length,12);
});
test('任一頁 API 失敗保留斷點，續抓從失敗頁開始',async()=>{
  const store=fixture.memoryStore(),called=[];
  const fetchPage=async page=>{called.push(page);if(page===2)throw new core.ExportError('API_ERROR','失敗');const r=core.parseList(fixture.list(page,true),page);r.orders[0].orderId+='-'+page;return r;};
  await assert.rejects(core.collect({job:{nextPage:1,endPage:3,tabCode:'all'},store,fetchPage,enrich:async()=>{}}),{code:'API_ERROR'});
  assert.equal((await store.getJob()).nextPage,2);assert.equal((await store.allOrders()).length,1);
  const resumed=[];
  await core.collect({job:await store.getJob(),store,fetchPage:async page=>{resumed.push(page);const r=core.parseList(fixture.list(page,page<3),page);r.orders[0].orderId+='-'+page;return r;},enrich:async()=>{}});
  assert.deepEqual(resumed,[2,3]);
});
test('停止時本頁訂單已落盤，但頁面斷點尚未前進',async()=>{
  const store=fixture.memoryStore(),controller=new AbortController();const input=fixture.list(1,true);delete input.data.data.logistics;
  await assert.rejects(core.collect({job:{nextPage:1,endPage:2,tabCode:'all'},store,signal:controller.signal,fetchPage:async()=>core.parseList(input,1),enrich:async()=>{controller.abort();throw new core.ExportError('CANCELLED','停止');}}),{code:'CANCELLED'});
  assert.equal((await store.allOrders()).length,1);assert.equal((await store.getJob()).nextPage,1);
});
test('物流單筆失敗明確記錄並繼續，驗證要求則停止',async()=>{
  const store=fixture.memoryStore(),input=fixture.list();delete input.data.data.logistics;
  await core.collect({job:{nextPage:1,endPage:1,tabCode:'all'},store,fetchPage:async()=>core.parseList(input,1),enrich:async()=>{throw new core.ExportError('LOGISTICS_UNAVAILABLE','缺資料');}});
  const orders=await store.allOrders();assert.equal(orders[0].logisticsStatus,'failed');assert.equal(core.exportDocument(orders).errors.length,1);
  await assert.rejects(core.collect({job:{nextPage:1,endPage:1,tabCode:'all'},store,fetchPage:async()=>core.parseList(input,1),enrich:async()=>{throw new core.ExportError('AUTH_OR_CHALLENGE','驗證');}}),{code:'AUTH_OR_CHALLENGE'});
});
test('重複頁面與儲存失敗不能跳頁或宣稱完成',async()=>{
  const store=fixture.memoryStore();
  await assert.rejects(core.collect({job:{nextPage:1,endPage:2,tabCode:'all'},store,fetchPage:async page=>core.parseList(fixture.list(page,true),page),enrich:async()=>{}}),{code:'REPEATED_PAGE'});
  assert.equal((await store.getJob()).nextPage,2);
  const broken={...fixture.memoryStore(),savePage:async()=>{throw Error('QuotaExceededError');}};
  await assert.rejects(core.collect({job:{nextPage:1,endPage:1},store:broken,fetchPage:async()=>core.parseList(fixture.list(),1),enrich:async()=>{}}),/QuotaExceeded/);
  assert.equal(await broken.getJob(),undefined);
});
test('JSON 可完整還原 Unicode、長單號與 Errors',()=>{
  const orders=core.parseList(fixture.list(),1).orders;orders[0].logisticsError='軌跡僅部分可用';
  const document=JSON.parse(JSON.stringify(core.exportDocument(orders,{nextPage:2})));
  assert.equal(document.schemaVersion,1);assert.equal(document.orders[0].items[0].title,'商品甲<&>');assert.equal(document.errors.length,1);
  assert.equal(document.orders[0].packages[0].trackingNumber,'001234567890123456789');
});
test('XLSX 以獨立 ZIP/XML 讀取器驗證、長 ID／公式樣式字串皆為文字',()=>{
  const orders=core.parseList(fixture.list(),1).orders;orders[0].items[0].title='=HYPERLINK("https://invalid.example") 中文<&>';
  const document=core.exportDocument(orders);const dir=fs.mkdtempSync(path.join(os.tmpdir(),'taobao-xlsx-test-'));
  try {
    const target=path.join(dir,'orders.xlsx');fs.writeFileSync(target,core.createXlsx(document));
    const python=process.platform==='win32'?'python':'python3';
    const check=spawnSync(python,[path.join(__dirname,'verify_xlsx.py'),target],{encoding:'utf8'});
    assert.equal(check.status,0,check.stdout+check.stderr);
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('Excel 儲存格限制不截斷，明確提示改 JSON',()=>{
  const orders=core.parseList(fixture.list(),1).orders;orders[0].items[0].title='a'.repeat(32768);
  assert.throws(()=>core.createXlsx(core.exportDocument(orders)),{code:'XLSX_LIMIT'});
});
test('已取消工作不再送請求，永久錯誤不重試',async()=>{
  const controller=new AbortController();controller.abort();let count=0;
  await assert.rejects(core.retry(async()=>count++,controller.signal),{code:'CANCELLED'});assert.equal(count,0);
  await assert.rejects(core.retry(async()=>{count++;throw new core.ExportError('AUTH_OR_CHALLENGE','驗證');}),{code:'AUTH_OR_CHALLENGE'});assert.equal(count,1);
});
