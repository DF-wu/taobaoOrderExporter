<div align="center">

[**English**](./readme.md) | [**繁體中文**](./README_zh-Hant.md)

</div>

# 淘寶訂單匯出 Userscript v2.0

[![Language](https://img.shields.io/badge/language-JavaScript-yellow.svg)](https://www.javascript.com/)
[![License](https://img.shields.io/badge/license-MIT-blue.svg)](https://opensource.org/licenses/MIT)

這是一個功能強大的 Userscript，專為需要從淘寶/天貓「已買到的寶貝」頁面批量匯出訂單資料的使用者設計。

**v2.0 重大更新：** 由於淘寶前端介面改版，本腳本已全面升級為**自動化官方導出功能**。現在腳本會自動點擊官方的「導出訂單」按鈕，並自動處理翻頁和下載，解決了官方功能只能下載單頁的限制。

## ✨ 核心功能

-   **🚀 批量自動導出**：一鍵啟動，自動遍歷您設定的頁碼範圍，將每一頁的訂單匯出為 Excel 檔案。
-   **⬇️ 下載本頁**：一鍵完成「點擊導出 -> 等待對話框 -> 點擊下載」的繁瑣流程，秒速下載當前頁面訂單。
-   **🔄 SPA 翻頁支援**：完美支援淘寶最新的單頁應用 (SPA) 架構，自動檢測頁面變化並繼續任務，無需重新加載。
-   **⚡ 極速響應**：使用 MutationObserver 技術，一旦官方下載按鈕出現立即點擊，無需無謂等待。
-   **🛑 隨時停止**：提供重置按鈕，可隨時中斷自動化任務並清除狀態。
-   **⚙️ 高度可配置**：腳本開頭提供詳細的配置參數 (如超時時間、檢測間隔)，可根據您的網絡環境自行調整。

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

    *(介面示意圖已更新)*

4.  **操作流程**:
    -   **批量導出**：在「起始頁」和「截止頁」輸入框中設定範圍，點擊「**🚀 批量自動導出**」。腳本將自動翻頁並下載每一頁的 Excel 檔。
    -   **單頁下載**：直接點擊「**⬇️ 下載本頁**」，腳本會自動完成當前頁面的導出流程。
    -   **停止任務**：若需中斷，點擊「**🛑 停止/重置**」。

## 💡 常見問題與技巧

-   **瀏覽器詢問儲存位置？**
    為了實現全自動批量下載，建議您在瀏覽器設定中**關閉**「下載前詢問每個檔案的儲存位置」。這樣 Excel 檔案將會自動儲存到您的預設下載資料夾，不會彈出視窗打斷流程。

-   **翻頁卡住？**
    腳本內建了 SPA 翻頁檢測機制。如果因網絡延遲導致翻頁檢測超時，您可以手動點擊下一頁，或者點擊「停止/重置」後重新開始。您也可以在腳本開頭的 `CONFIG` 區域調整超時時間。

## ⚠️ 免責聲明

-   本腳本僅供個人學習和研究 JavaScript 及 Web 自動化技術使用。
-   請在遵守淘寶網使用者協議的前提下，合理使用本腳本。
-   作者不對任何因使用本腳本而導致的直接或間接後果負責。

## 📄 授權

本專案採用 [MIT License](https://github.com/DF-wu/taobaoOrderExporter/blob/main/LICENSE) 授權。