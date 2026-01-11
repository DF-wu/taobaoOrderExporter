<div align="center">

[**English**](./readme.md) | [**繁體中文**](./README_zh-Hant.md)

</div>

# 淘寶訂單批量導出工具 v2.0

這是一個 Userscript，能**自動化**淘寶官方的「導出訂單」功能，解決手動翻頁和重複點擊的煩惱。

[![Install](https://img.shields.io/badge/Install-Click_Here-green.svg)](https://github.com/DF-wu/taobaoOrderExporter/raw/main/taobaoOrderExporter.user.js)

## ✨ 主要功能

-   **🚀 批量自動導出**：設定好頁碼範圍，腳本會自動翻頁並下載每一頁的 Excel 訂單。
-   **⬇️ 一鍵下載本頁**：省去「點擊導出 -> 等待 -> 點擊下載」的繁瑣步驟，一鍵秒速下載。
-   **⚡ 極速響應**：自動偵測並點擊下載按鈕，無需等待。
-   **🔄 支援最新介面**：完美支援淘寶最新的 SPA (單頁應用) 架構，翻頁順暢不卡頓。

## 🚀 安裝步驟

1.  先安裝瀏覽器擴充功能：[**Tampermonkey**](https://www.tampermonkey.net/) (Chrome/Edge/Firefox)。
2.  [**點擊這裡安裝本腳本**](https://github.com/DF-wu/taobaoOrderExporter/raw/main/taobaoOrderExporter.user.js)。
3.  在跳出的視窗中點擊「安裝」。

## 📖 使用方法

1.  進入淘寶 [**已買到的寶貝**](https://buyertrade.taobao.com/trade/itemlist/list_bought_items.htm) 頁面。
2.  您會在訂單列表上方看到控制面板：
    *   **批量下載**：輸入起始頁和截止頁，點擊「**🚀 批量自動導出**」。
    *   **單頁下載**：直接點擊「**⬇️ 下載本頁**」。
    *   **中斷任務**：點擊「**🛑 停止/重置**」。

## 💡 小撇步

*   **推薦設定**：建議在瀏覽器設定中**關閉「下載前詢問每個檔案的儲存位置」**。這樣 Excel 檔案會自動儲存，不會一直彈出存檔視窗打斷流程。
*   **翻頁問題**：如果因網路卡頓導致翻頁檢測超時，請點擊「停止/重置」後重新開始，或在腳本開頭調整超時設定。

---
<div align="center">
僅供個人學習研究使用，請遵守淘寶使用者協議。
</div>