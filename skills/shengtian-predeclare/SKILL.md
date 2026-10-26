---
name: shengtian-predeclare
description: 將淘寶訂單匯出工具的 XLSX 或 JSON 核對聖天集運現有包裹及歷史訂單，合併快遞單號、產生簡短品名與訂單備註，自動提交預報、處理彈窗並驗證儲存結果。適用於聖天預報、補報或淘寶包裹登記。
---

# 聖天集運自動預報

使用者提供訂單匯出檔並要求預報時，完成核對、填寫、提交及彈窗確認。使用者已授權這批預報時，不要逐筆請他按確認。這個 skill 不授權申請打包、付款、確認淘寶收貨或刪除紀錄。

## 連線與來源

- 使用者已開啟並登入的 Brave，聖天頁為 `http://member.stjh168.com/Member/MyPack`。
- 需要 Node 24 以上及 Python 3，輔助程式沒有第三方套件依賴。
- 讀取 Brave 的 `DevToolsActivePort` 取得 WebSocket 位址。9222 的 `/json/version`、`/json/list` 可能回 404，不能因此認定 CDP 沒開。`scripts/cdp.mjs` 已支援這種情況。
- 預設 Windows 路徑由 `LOCALAPPDATA` 組合，不硬編碼使用者名稱。可用 `BRAVE_DEVTOOLS_FILE` 指定該檔，或以 `BRAVE_CDP_ENDPOINT` 指定 WebSocket。
- 以使用者指定的附件為準。不要擅自換成瀏覽器快取或擴大到整個帳號歷史。完整 ID 必須保持字串；不得把不精確的數字轉成字串補救。
- 在 repo 外或本 skill 的 `.local/` 保存輸入、掃描結果及提交日誌。不要把真實訂單、帳號、Cookie、地址或執行日誌加入 Git。

## 核對與品名

先讀 [references/site-workflow.md](references/site-workflow.md)，再操作網站。它記錄實測 API、表單與編碼細節。

1. XLSX 用 `scripts/read_export.py` 轉成 JSON；原生 JSON 可直接使用。
2. 執行 `scan`：以快遞單號合併各訂單，查詢目前包裹；目前列表沒有的單號再查歷史集運訂單。
3. `existing`、`historical` 已有紀錄，保留。`blank-arrived` 是已入庫但品名、備註都空白且尚未預報，要補報；不能只因單號已在倉庫就跳過。`new` 則新增。
4. 逐筆讀取候選包裹的 `items` 與 `sku`，建立 `labels.json`。SKU 可能才是真正購買物品，例如標題是噴嘴但選購的是 PEI 打印板。品牌用已知品牌，沒有明確品牌時可用店舖簡稱，不把「適用拓竹／TP-LINK」寫成原廠品牌。
5. `货物品名` 用最簡且準確名稱，例如 `甲片`、`锅子`、`打印板`。混裝不同物品用 `、` 列出，不能把果凍膠或潤滑脂都省略成甲片或配件。
6. `备注` 為 `[主訂單號]+[品牌或店舖簡稱＋簡易商品名稱]`。同一快遞單號有多筆訂單時，逐筆組合，以 `；` 分隔，保留每個主訂單號。不要用子訂單號代替主訂單號。若網站明確拒收過長備註，確認該次沒有寫入後，可改為一個完整主訂單號加品牌品名及「合併N筆訂單」；所有完整對照保留在本機計畫與結果報告，並向使用者說明這個例外。不得截短 ID 或假裝全部 ID 已儲存在聖天。
7. 未知包裹商品關聯時不要按順序猜。`needsPackageReview` 必須核對 `allOrderItems`、`packageGoods` 或官方物流資料後才能設 `packageReviewed: true`。
8. 數量沿用聖天單個包裹預設 `1`，不是把商品件數加總成包裹數。

標籤格式（鍵可用主訂單號；多包裹時優先使用 `快遞單號:主訂單號`）：

```json
{
  "JT0000000000000:1234567890123456789": {
    "goods": "甲片、果冻胶",
    "description": "悦馨甲片、果冻胶"
  }
}
```

## 執行

以下以 repo 根目錄為工作目錄，先建立 `skills/shengtian-predeclare/.local`。`labels.json` 由執行任務的 agent 按上述規則寫入，不能把未審閱的完整商品標題當簡稱。

```powershell
python skills/shengtian-predeclare/scripts/read_export.py INPUT.xlsx skills/shengtian-predeclare/.local/source.json
node skills/shengtian-predeclare/scripts/predeclare.mjs scan skills/shengtian-predeclare/.local/source.json skills/shengtian-predeclare/.local/scan.json
node skills/shengtian-predeclare/scripts/predeclare.mjs prepare skills/shengtian-predeclare/.local/scan.json skills/shengtian-predeclare/.local/labels.json skills/shengtian-predeclare/.local/plan.json
node skills/shengtian-predeclare/scripts/predeclare.mjs submit skills/shengtian-predeclare/.local/plan.json skills/shengtian-predeclare/.local/journal.jsonl
```

讀取產生的 `plan.json`，確認所有候選都有合理品名、備註、合併單號及來源訂單，再提交。這是 agent 自己的資料核對，不要求使用者重新批准已授權的同一批預報。

提交程式會在真正的頁面表單按「提交」，透過 CDP `Page.javascriptDialogOpening` 接收彈窗並呼叫 `Page.handleJavaScriptDialog` 自動按確定。每次收到「提交成功」後，再從服務端核對完整品名、備註及數量；光看到成功提示不算完成。

## 失敗、續跑與交付

- 登入失效、未知彈窗、HTTP／格式錯誤、重複服務端紀錄、長備註遭截斷或回讀不同時，停止提交並診斷。不要盲目重試新增。
- `.lock` 防止同一日誌並行提交。崩潰留下 lock 時，先確認原程序已結束，再移除該 lock；不要刪日誌。
- 可用相同計畫及日誌續跑：與計畫完全一致的服務端資料直接記為已驗證。已有 `submitting` 而回讀不符的紀錄需要先查明，不自動再次提交。
- 需要修正本次剛寫入的資料時，只修改該筆，先保留原內容並確認原因；不能覆蓋使用者原先已有的備註。
- 最後重跑 `scan`，核對沒有剩餘 `new`／`blank-arrived` 候選，並比較原有非空紀錄未被改寫。
- 回報新增／補報數、跳過數及沒有單號的例外。`not_required` 與 `no_package` 有官方依據，與查詢 `failed` 分開說明。不要猜測失敗訂單的快遞單號。

本流程實測於 2026-10-26。網站改版時先重新讀取頁面表單及官方前端腳本，更新選擇器與回應驗證再執行。
