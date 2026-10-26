# 匯出資料格式（schemaVersion 1）

JSON 根物件包含 `schemaVersion`、`exporterVersion`、`exportedAt`、`job`、`orders`、`errors`。
`job.completed` 代表指定的頁面範圍已處理完，不代表每筆物流都查詢成功；需要一起檢查 `errors`。
`job.requestIntervalMs` 是該次擷取使用的最小請求間隔（毫秒）；預設 5000，可在面板調為 2000–120000。所有 API 與網路重試共用間隔，限流回應則直接暫停。

每個 `orders[]` 是一筆主訂單：

| 欄位 | 說明 |
| --- | --- |
| `orderId` | 主訂單號，字串 |
| `createdAt`, `shopName`, `sellerName`, `status` | 原頁購買時間、店舖、賣家及交易狀態 |
| `actualPaid`, `totalPrice`, `shippingFee`, `currency` | 主訂單實付、總額、運費與幣別；保留官方顯示文字 |
| `items[]` | 子訂單商品；包含 `subOrderId`, `productId`, `title`, `sku`, `quantity`, `displayedPrice`, `originalPrice`, `refundStatus`, `itemUrl`, `imageUrl` |
| `packages[]` | 所有取得的包裹，可能超過一個 |
| `logisticsStatus`, `logisticsError` | 物流完整性與查詢錯誤 |
| `sourcePage`, `sourceTab`, `collectedAt`, `detailUrl` | 來源頁面、訂單範圍、擷取時間與詳情連結 |

`packages[]` 包含：

| 欄位 | 說明 |
| --- | --- |
| `trackingNumber`, `company`, `companyCode` | 單號、物流公司名稱與代碼；沒有代碼時留空 |
| `subOrderIds[]` | 官方提供的包裹與商品對應；未提供時留空，不憑位置猜測 |
| `goods[]` | 詳情頁若提供包裹商品描述則保留；可能不存在 |
| `events[]` | 物流時間、狀態與描述；預設從列表取得的包裹不另查軌跡，勾選補查可取得 |
| `source`, `checkedAt` | 資料來源與查詢時間 |
| `logisticsOrderId` | 物流頁提供的內部物流訂單號；可能不存在 |

物流狀態：

- `complete`：取得的完整包裹清單均有公司與未遮蔽單號。
- `not_shipped`：列表明確表示待付款／待發貨，且未提供包裹。之後按「重試物流」或重新擷取會更新；沒有 `logisticsError` 時不列入 `errors`。
- `pending`：已儲存列表，尚未完成物流查詢（例如中途停止）。重新擷取時可能暫留上次取得的包裹，補查完成前不代表已重新驗證。
- `partial`：仍有不完整或遮蔽的包裹資料，或重新查詢失敗而保留先前取得的包裹（原因見 `logisticsError`）。
- `failed`：物流頁與詳情補查均未成功，原因保留在 `logisticsError`。

`errors[]` 收集 pending、partial、failed 和其他補查問題。查不到物流不代表沒有物流，不會填入假的單號。

`status` 是最後一次讀取列表時的交易狀態。「重試物流」在原頁找不到訂單而改用訂單號查物流時，只更新 `packages` 與物流狀態，`status` 保留原值；查詢失敗時物流狀態也保留原值，原因寫入 `logisticsError`。

XLSX 有五張表：`Orders`、`Items`、`Packages`、`Errors`、`Metadata`。它們與 JSON 對應，ID 與內容均使用文字儲存格，保留前導零與長整數，商品文字不會被 Excel 當公式執行。需要運算時請另行把金額／數量轉成數值。

主訂單實付只在 Orders 出現；不可把它複製到每筆商品或包裹後再次加總。透過主訂單號與子訂單號關聯資料。

超過 Excel 單格 32,767 字元或單表 1,048,576 列時，XLSX 會明確提示改用 JSON，不會截斷資料。

## 維護 API 時的注意事項

訂單列表使用 `mtop.taobao.order.queryboughtlistV2`，訂單詳情使用 `mtop.taobao.order.query.detailv2`。物流頁另用 `mtop.taobao.logistics.detailorlist.query`，不能只靠前兩者判定沒有物流。

物流請求沿用官方頁面的 JSONP：實測同一訂單的 POST JSON 回應會把長 `orderId` 傳成數字，JSONP 才保留完整字串。不得把已失去精度的數字轉成字串後當成有效訂單號。

請求設定 `AntiCreep: false`、`AntiFlood: false`，讓 SDK 交回驗證錯誤，由腳本立即暫停並提供官方驗證連結。否則 SDK 可能停在內部驗證浮層而使請求看似逾時。這不改變服務端的驗證要求；需完成官方驗證才能續抓。

多包裹的 `logisticsPackageList` 使用官方拼字 `pakcage`，需逐一查詢連結中的包裹識別；單包裹的 `logisticsDetailH5` 使用 `popupBodyCompony` 提供公司與單號。解析時核對主訂單與指定包裹單號；後續包裹查詢失敗會保留已成功核對的部分並標示錯誤。

若官方物流頁回傳 `NoPackageInfo`，或顯示「暂无单号」而沒有 `mailNo`，仍列為待核對，不推斷該交易永遠沒有物流。
