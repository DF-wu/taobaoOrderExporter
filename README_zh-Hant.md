<div align="center">

[**English**](./readme.md) | [**繁體中文**](./README_zh-Hant.md)

</div>

# 淘寶訂單匯出 Userscript

[![Language](https://img.shields.io/badge/language-JavaScript-yellow.svg)](https://www.javascript.com/)
[![License](https://img.shields.io/badge/license-MIT-blue.svg)](https://opensource.org/licenses/MIT)

這是一個功能強大的 Userscript，專為需要從淘寶/天貓「已買到的寶貝」頁面批量匯出訂單資料的使用者設計。它可以抓取包括商品名稱、價格、數量、SKU、賣家資訊，甚至是**物流單號**在內的詳細資料，並將其匯出為 Excel 相容的 CSV 檔案。

與其他類似工具相比，本腳本特別針對淘寶複雜的前端環境進行了優化，解決了諸如**跨域請求 (CORS)**、**GBK 編碼亂碼**以及**API 風控**等常見的技術難題。

## ✨ 核心功能

-   **一鍵抓取**：在「已買到的寶貝」頁面注入操作面板，輕鬆啟動。
-   **批量處理**：支援自訂要抓取的訂單頁碼範圍，自動翻頁。
-   **物流追蹤**：自動訪問每個訂單的詳情頁，獲取物流公司和快遞單號。
-   **本地儲存**：抓取進度會自動儲存在瀏覽器中，即使關閉頁面也不會遺失資料。
-   **智慧去重**：多次執行抓取時，能自動合併資料並移除重複的訂單記錄。
-   **Excel 友善**：匯出的 CSV 檔案包含 BOM 標頭，可直接用 Excel 開啟，不會有中文亂碼問題。
-   **高相容性**：同時支援淘寶和天貓的訂單格式。

## 🚀 安裝與使用

### 步驟 1: 安裝 Userscript 管理器

您需要在瀏覽器中安裝一個 Userscript 管理器。推薦使用以下任一擴充功能：

-   [**Tampermonkey**](https://www.tampermonkey.net/) (支援 Chrome, Firefox, Edge, Safari)
-   [**Violentmonkey**](https://violentmonkey.github.io/) (支援 Chrome, Firefox, Edge)

### 步驟 2: 安裝本腳本

1.  點擊此處安裝腳本：[**taobaoOrderExporter.user.js**](https://github.com/DF-wu/taobaoOrderExporter/raw/main/taobaoOrderExporter.user.js)
2.  您的 Userscript 管理器將會自動開啟一個安裝頁面。
3.  點擊頁面上的「安裝」按鈕。

### 步驟 3: 開始使用

1.  安裝完畢後，打開淘寶網站並登入您的帳號。
2.  進入「**已買到的寶貝**」頁面 (https://buyertrade.taobao.com/trade/itemlist/list_bought_items.htm)。
3.  您會在訂單列表的**正上方**看到一個由本腳本新增的控制面板。

    ![腳本操作示意圖](https://github.com/DF-wu/taobaoOrderExporter/blob/main/assets/demo.png?raw=true)

4.  **操作流程**:
    -   在「起始頁」和「結束頁」輸入框中，設定您想抓取的頁碼範圍。
    -   點擊「**開始抓取指定頁碼訂單**」按鈕。
    -   腳本會開始自動執行，您可以在「狀態」區域看到即時進度。
    -   抓取過程中，腳本會自動處理翻頁和獲取物流詳情。
    -   完成後，點擊「**下載CSV**」按鈕，即可將所有已抓取的訂單儲存為 `.csv` 檔案。

## 🛠️ 技術亮點

本腳本克服了在淘寶環境下進行自動化抓取的幾個主要障礙：

1.  **繞過 API 風控**: 透過將 `fetch` 請求注入到頁面自身上下文 (`unsafeWindow`) 中執行，使得請求能攜帶正確的 Cookie 和 Session，模擬正常使用者行為，極大降低了被伺服器拒絕的風險。
2.  **解決 CORS 跨域問題**: 使用 Tampermonkey 提供的 `GM_xmlhttpRequest` 特權 API，成功從 `taobao.com` 網域請求 `tmall.com` 的訂單詳情頁，從而獲取天貓訂單的物流資訊。
3.  **處理 GBK 編碼**: 在 `fetch` 請求的回應中，先取得 `ArrayBuffer` 格式的原始資料，再使用 `TextDecoder('gbk')` 進行解碼，從根本上解決了中文亂碼問題。

## ⚠️ 免責聲明

-   本腳本僅供個人學習和研究 JavaScript 及 Web 自動化技術使用。
-   請在遵守淘寶網使用者協議的前提下，合理使用本腳本。
-   過於頻繁地使用可能觸發淘寶的風控機制，導致帳號需要驗證。建議每次抓取的頁數不宜過多，並在兩次抓取之間間隔一段時間。
-   作者不對任何因使用本腳本而導致的直接或間接後果負責。

## 📄 授權

本專案採用 [MIT License](https://github.com/DF-wu/taobaoOrderExporter/blob/main/LICENSE) 授權。