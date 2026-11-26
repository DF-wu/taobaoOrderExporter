# 聖天網站實測細節

2026-10-26 在登入後的會員頁實測，2026-11-26 再核對網站提供的 `/Scripts/js/common.js?v=1022` 與編輯頁面。這些端點是聖天會員網站的內部實作。腳本在 `member.stjh168.com/Member/MyPack` 以同源 `fetch` 沿用瀏覽器登入。目前會員頁使用 HTTP。API 範例及測試使用合成資料。

| 目的 | 請求 | 判讀 |
| --- | --- | --- |
| 目前包裹 | `POST /Member/QueryMyPack`，表單 `country_id=0` | JSON 陣列，按 `kdBillCode` 精確核對 |
| 歷史單號 | `GET /Member/OrderRecord?ordercode=<單號>` | HTML，核對搜尋欄、`#AllCount` 與結果列 |
| 歷史明細 | `GET /Member/OrderPrint?orderid=<集運訂單ID>` | 從歷史結果開啟「明細」，查看快遞單號、品名及備註 |
| 新增預報 | `POST /Member/AddBillcode`，表單 `datas` | 單筆結果 JSON 陣列，每筆有 `State` 及 `MsgText` |
| 按原 ID 補欄 | `POST /Member/EditPackByID`，個別表單參數 | JSON 物件，含 `State` 及 `MsgText` |

## 判斷有沒有報過

`POST /Member/QueryMyPack`，表單參數 `country_id=0`，回傳目前包裹陣列。

- 單號 `kdBillCode`，資料 ID `id`。
- 品名 `goods`，備註 `goods_memo`，數量 `Number`。
- 預報標記 `Is_Yb`，入庫時間 `dd_time`。
- 以品名和備註是否都非空判斷完整性。手動編輯過的紀錄也可能維持 `Is_Yb=0`。
- Userscript 1.2.0 用原包裹 ID 補齊空白欄位，沿用非空欄位及 `Number`。兩欄都齊全就保留。舊 CLI 的 `blank-arrived` 流程沿用新增表單補報，曾在兩欄皆空白的自動入庫包裹上確認 ID 不變。

目前列表缺少的單號要查 `GET /Member/OrderRecord?ordercode=<單號>`。官方「單號查詢」按鈕使用此路徑。解析 `#AllCount` 與含 `a[href*="OrderPrint"]` 的 `tr[data-id]`，有資料就保留為歷史已報。登入頁或缺少查詢控制項不是零筆。

不可只根據目前包裹列表判斷缺漏，因為已集運出庫的單號可能只在歷史訂單。例如實測中一批 93 個單號，有 3 個僅存在歷史訂單。

## 表單及提交

單筆區域 `.billcode_form .submit_one`：

| 欄位 | 選擇器 |
| --- | --- |
| 快遞單號 | `input[name=kd_billcode]` |
| 品名 | `input[name=goods]` |
| 數量 | `input[name=goods_number]` |
| 備註 | `input[name=goods_memo]` |
| 提交 | `.btn_submit` |

使用單列逐筆處理。頁面另有「批量預報」共用品名區域，不能拿來提交每筆不同的品名與備註。

前端 `/Scripts/js/common.js?v=1022` 把預報送到 `POST /Member/AddBillcode`，`datas` 是以下物件陣列的 JSON：

```json
[{"kdBillcode":"JT0000000000000","Number":1,"Goods":"甲片","Goodsid":0,"Goods_meno":"[1234567890123456789]+[悦馨甲片]","Immediatrly":0,"GoodsType":""}]
```

注意官方欄位拼字是 `Goods_meno`、`Immediatrly`。頁面透過同步 AJAX 提交，然後使用原生 `alert("提交成功")` 並 reload。頁面的批量成功判斷有缺陷，不能依賴它判斷每筆是否成功；單筆提交加服務端回讀更容易核實。

處理彈窗前需先啟用 `Page.enable` 並安裝事件監聽，才呼叫 `.click()`。等點擊返回才接受 alert 會形成阻塞。對這次提交的資訊型 alert 可自動按確定；未知 confirm／prompt 保留並停止。

## 額外 URL decode

實測正常提交的備註 `[...] + [...]` 中，字元 `+` 會被網站存成空白，預報及編輯皆如此。用額外一層跳脫後可正確儲存：

1. 備註原文的 `%` 先轉 `%25`，`+` 再轉 `%2B`。
2. 把處理後的字串放入頁面欄位，讓 jQuery 再正常編碼送出。
3. 服務端回讀必須等於原文，不能把 `%2B` 留在最後的備註。

`wireText()` 已實作。這一層是修正該站額外 decode，不能對一般網站照用。若網站修正後改存 `%2B`，立即停止並移除此額外編碼。

## 補填既有包裹

`EditPackByID` 使用 `Content-Type: application/x-www-form-urlencoded` 及 `X-Requested-With: XMLHttpRequest`。從當次查詢結果取得原 ID 和數量。下方為省略貨物類型的會員頁所用欄位。

```js
const fields = new URLSearchParams({
  id: '1001',
  goods_id: '0',
  goods: '甲片',
  goods_memo: '[9000000000000000001] %2B [示例甲片]',
  kd_billcode: 'JT0000000000001',
  immediately: '0',
  goodstype: '',
  Number: '1'
});
// 將 fields 作為同源 POST /Member/EditPackByID 的 body。
```

`State` 的成功值可為布林、`1` 或大小寫不同的 `"True"`。用回讀判定是否完成，因為頁面的「保存成功」後會先用輸入文字更新當前表格。重新讀取才能驗證備註實際儲存的是 `+`。

## 完成標準

`QueryMyPack` 回讀同一單號只有一筆，品名、完整備註與實際送出的數量相符。補填還需比對原包裹 ID。逾時後先查詢，並在結果不明時暫停整批。

實測含 25 筆主訂單、732 字元的合併備註遭明確拒收，提示「将截断字符串或二进制数据。语句已终止。」未測得確切上限，不宣稱是固定 500 字。遇到此錯誤，先回讀確認資料仍未寫入；改用一個完整主訂單號與品牌品名並標示合併筆數，所有完整訂單號另存本機對照。這是明確錯誤後的修改計畫，不是逾時後重送。不要靠刪除日誌繞過未知結果的保護。

提交日誌只能保存在本機忽略目錄，不把實際訂單號、帳號標記或執行結果寫進 skill 的範例與 Git 紀錄。
