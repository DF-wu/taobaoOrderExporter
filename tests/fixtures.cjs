// 完全合成的新版 Ultron 回應；不含真實訂單、帳號、地址、cookie 或 API 簽章。
const ORDER='9007199254740993123';
const SUB1='9007199254740993124';
const SUB2='9007199254740993125';
function list(page=1,hasMore=false) {
  return {ret:['SUCCESS::调用成功'],data:{endpoint:{page:'pcTaoBoughtList'},global:{pageControl:{hasMore}},data:{
    shop:{tag:'shopInfo',id:ORDER,fields:{orderId:ORDER,createTime:'2026-10-15 12:00:00',shopName:'合成測試店',sellerName:'測試賣家',tradeTitle:'卖家已发货',orderDetailUrl:`//trade.taobao.com/detail?biz_order_id=${ORDER}`}},
    first:{tag:'orderItemInfo',id:`${ORDER}_${SUB1}`,fields:{orderId:ORDER,item:{itemId:'1234',title:'商品甲<&>',quantity:'2',skuText:'白色',priceInfo:{actualTotalFee:'￥12.34',promotion:'￥15.00'}}}},
    second:{tag:'orderItemInfo',id:`${ORDER}_${SUB2}`,fields:{orderId:ORDER,item:{itemId:'5678',title:'商品乙',quantity:'1',skuText:'黑色',priceInfo:{actualTotalFee:'￥8.00'}}}},
    payment:{tag:'orderPayment',id:ORDER,fields:{actualFee:{value:'￥32.68'},pcPostFee:{value:'￥0.00'},totalFee:{value:'￥38.00'}}},
    logistics:{tag:'orderLogistics',id:ORDER,fields:{packagePreview:{mainOrderId:ORDER,packageViewList:[
      {cpName:'測試物流甲',cpCode:'TEST-A',mailNo:'001234567890123456789',subOrderList:[SUB1]},
      {cpName:'測試物流乙',cpCode:'TEST-B',mailNo:'AB0987654321',subOrderList:[SUB2]},
    ]}}},
    paging:{tag:'pagination',fields:{currentPage:page,pageSize:30,totalNum:30,hasMore}},
  }}};
}
function detail() {
  return {ret:['SUCCESS::调用成功'],data:{endpoint:{page:'pcTaoDetail'},data:{
    identity:{tag:'detailInfo',fields:{labels:[{tag:'ORDER_ID',value:ORDER}]}},
    packages:{tag:'logisticsPackages',fields:{packageInfos:[
      {mailNo:'001234567890123456789',companyInfos:[{companyName:'測試物流甲'}],goodsInfos:[{goodsName:'商品甲',goodsQuantity:'2',sellProperty:'白色',tradeGoodUrl:'//item.taobao.com/item.htm?id=1234'}]},
      {mailNo:'AB0987654321',companyInfos:[{companyName:'測試物流乙'}],goodsInfos:[{goodsName:'商品乙',goodsQuantity:'1'}]},
    ]}},
  }}};
}
function memoryStore() {
  const orders=new Map();let job;
  return {
    getOrder:async key=>structuredClone(orders.get(key)),
    putOrder:async order=>{orders.set(order.orderId,structuredClone(order));},
    savePage:async (page,nextJob)=>{page.forEach(o=>orders.set(o.orderId,structuredClone(o)));if(nextJob)job=structuredClone(nextJob);},
    allOrders:async()=>[...orders.values()], getJob:async()=>structuredClone(job),
  };
}
function logistics(mailNo='001234567890123456789') {
  return {ret:['SUCCESS::调用成功'],data:{endpoint:{page:'logisticsDetailH5'},global:{utData:{orderId:ORDER,mailNo,logisticsOrderId:'LP-TEST'}},hierarchy:{structure:{logisticsDetail:['line1']}},data:{
    company:{tag:'popupBodyCompony',fields:{mailNo,name:'測試物流'}},
    line1:{tag:'logisticsDetailLine',fields:{subTitle:{text:'10-15 12:00'},title:{text:'運輸中'},desc:[{text:'測試物流站'}]}},
  }}};
}
function logisticsList() {
  return {ret:['SUCCESS::调用成功'],data:{endpoint:{page:'logisticsPackageList'},data:{
    first:{tag:'pakcage',fields:{rightBtnUrl:`https://market.m.taobao.com/logistics?orderId=${ORDER}&mailNo=001234567890123456789&logisticsOrderId=LP-ONE`}},
    second:{tag:'pakcage',fields:{rightBtnUrl:`https://market.m.taobao.com/logistics?orderId=${ORDER}&mailNo=AB0987654321&logisticsOrderId=LP-TWO`}},
  }}};
}
module.exports={ORDER,SUB1,SUB2,list,detail,logistics,logisticsList,memoryStore};
