// page start from 1

function fetchRequsetPageJson(page) {
  fetch(
    "https://buyertrade.taobao.com/trade/itemlist/asyncBought.htm?action=itemlist/BoughtQueryAction&event_submit_do_query=1&_input_charset=utf8",
    {
      credentials: "include",
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:144.0) Gecko/20100101 Firefox/144.0",
        Accept: "application/json, text/javascript, */*; q=0.01",
        "Accept-Language": "zh-TW,zh;q=0.8,en-US;q=0.5,en;q=0.3",
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        "X-Requested-With": "XMLHttpRequest",
        "bx-v": "2.5.31",
        "Sec-GPC": "1",
        "Sec-Fetch-Dest": "empty",
        "Sec-Fetch-Mode": "cors",
        "Sec-Fetch-Site": "same-origin",
        "x-forwarded-for": "13.1.200.233",
        Priority: "u=0",
      },
      referrer:
        "https://buyertrade.taobao.com/trade/itemlist/list_bought_items.htm?route_to=tm1",
      body: `buyerNick=&canGetHistoryCount=false&dateBegin=0&dateEnd=0&historyCount=0&lastStartRow=&logisticsService=&needQueryHistory=false&onlineCount=0&options=0&orderStatus=&pageNum=${page}&pageSize=50&queryBizType=&queryForV2=false&queryOrder=desc&rateStatus=&refund=&sellerNick=&unionSearchPageNum=0&unionSearchTotalNum=0&prePageNo=7`,
      method: "POST",
      mode: "cors",
    }
  )
    .then((response) => response.json())
    .then((data) => {
      console.log(data);
    });
}
