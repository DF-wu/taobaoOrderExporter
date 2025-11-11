## 背景
我之前一直在用 https://github.com/Sky-seeker/BuyerOrdersExport.git 這個userscript專案把我在淘寶上面的訂單輸出爲csv 方便我整理訂單。
但是由於不明原因 該腳本已經失效。
先clone後分析該repo瞭解相關做法

目前已知淘寶在訂單詳情頁面會把第一頁的所有訂單的json資料（如orders.json）直接SSR在HTML內 （會以 `var data = JSON.parse(內容)` ）的方式呈現，因此在網頁console可以直接透過javascript存取。
爲了保證一致性，直接把該script區塊執行並獲取訂單資料

而在每一筆訂單的詳情頁面中(需點擊訂單詳情跳轉)，也會SSR在該網頁HTML原始碼內，該json如ordersdetails.json所示。這部分最重要的資訊是獲得物流號碼（快遞號碼）

當我畫面上點擊下一頁或是跳至指定頁面以後。訂單資料會透過淘寶官方api獲取，我已經從瀏覽器devtool抓取到關鍵api 如 @dffetch.js 呈現，我把關鍵頁面變數改成template string的形式了。可能需要將其改寫成userscript可以使用的形式。body參數不可隨意變更因爲不知道是否有預期外的行爲。



orders.json的typescript schema爲  orders_schema.ts
orderdetails.json的typescript schema爲 orderdetails_schema.ts


 
## 目標

生成一段production ready的userscript可裝在violatemonkey這類瀏覽器工具中。並提供以下功能。（可以參考BuyerOrdersExport的做法）
1. 將指定頁面範圍內的資訊（可以參考BuyerOrdersExport的做法，用每一頁手動點擊獲取資料的按鈕獲得該頁面的訂單資訊），收集並儲存至一個可供存取的資料結構內（稱爲allOrders）。
allOrders中，每一個訂單資料必須包含：
    1. 商品名稱
    2. 商家名稱
    3. 購買日期
    4. 訂單號碼（主訂單號碼）
    5. 付款價格
    6. 物流資訊(物流公司和號碼要分開)
2. 將allOrders轉換成csv檔案提供excel存取。
3. 在畫面上增加相關的操作gui界面，可以直接用https://github.com/Sky-seeker/BuyerOrdersExport.git的實現來改寫以保證確實能夠渲染。
4. 需要提供指定頁面範圍的訂單資料抓取功能。起始頁與截止頁
5. 必須要有詳細的debug資訊

## 預期的使用方法
我打開淘寶訂單頁面，填寫預期抓取的起始頁和截止頁（含，  起始頁永遠<=截止頁）以後，點擊腳本工具的抓取資料按鈕，腳本隨即開始執行工作，腳本會顯示目前抓取到的資料筆數。工作完成以後腳本顯示資料抓取完成可供下載，我點擊下載按鈕把csv下載下來。最後我點擊清除儲存的訂單資料按鈕把腳本暫存的資料清空以便下一次開始作業


## 要求
我是軟體工程上但我在前端與js方面是新手，因此所有程式碼都必須有清楚詳細完整的註解說明變數或函式的行爲。


## 工具
盡可能的使用你可以使用的mcp工具，尤其是serena, sequentialthinking 絕對必須使用。
每一次思考都要用sequentialthinking
可以用browsermcp獲得我打開的淘寶訂單頁面

## 限制 
不可損壞本電腦。
