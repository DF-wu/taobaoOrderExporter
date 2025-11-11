// ==UserScript==
// @name         淘寶訂單匯出工具 (Kilo Code版)
// @namespace    http://tampermonkey.net/
// @version      1.0
// @description  一個用於從淘寶訂單頁面匯出訂單資料為 CSV 檔案的 userscript 工具。
// @author       Kilo Code
// @match        https://buyertrade.taobao.com/trade/itemlist/list_bought_items.htm*
// @grant        unsafeWindow
// @grant        GM_xmlhttpRequest
// @grant        GM.xmlHttpRequest
// @connect      buyertrade.taobao.com
// @connect      trade.taobao.com
// @connect      trade.tmall.com
// @connect      detail.tmall.com
// @connect      *
// @license      MIT
// ==/UserScript==

/*
 * ═══════════════════════════════════════════════════════════════════════════
 *                      淘寶訂單匯出工具 - 學習指南
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * 【功能概述】
 * 這是一個瀏覽器 userscript，用於批量抓取淘寶訂單資料並匯出為 CSV 檔案。
 *
 * 【核心功能】
 * 1. 批量抓取多頁訂單資料
 * 2. 獲取每個訂單的物流資訊
 * 3. 資料持久化儲存（localStorage）
 * 4. 自動去重（避免重複抓取相同訂單）
 * 5. 匯出為 Excel 相容的 CSV 檔案
 *
 * 【技術要點】
 * - Userscript API：GM_xmlhttpRequest, unsafeWindow
 * - 異步流程控制：async/await, Promise
 * - 編碼處理：GBK → UTF-8 轉換
 * - 資料持久化：localStorage API
 * - 去重算法：Set 資料結構（O(n) 時間複雜度）
 * - CSV 生成：BOM 字節序標記、特殊字符過濾
 *
 * 【資料流程】
 * 淘寶訂單頁面
 *   ↓ (fetchInPageContext)
 * 訂單列表 JSON (GBK 編碼)
 *   ↓ (parseOrdersFromData)
 * 結構化訂單物件
 *   ↓ (fetchOrderDetail)
 * 補充物流資訊
 *   ↓ (StorageManager.mergeOrders)
 * 去重合併
 *   ↓ (StorageManager.saveOrders)
 * localStorage 持久化
 *   ↓ (downloadCSV)
 * CSV 檔案下載
 *
 * 【學習重點】
 * 本腳本適合學習以下主題：
 * - Userscript 開發基礎
 * - 異步 JavaScript 編程
 * - 瀏覽器 API（fetch, localStorage, Blob）
 * - 資料結構與算法（Set, 去重）
 * - 字符編碼（GBK, UTF-8）
 * - CSV 檔案格式處理
 *
 * ═══════════════════════════════════════════════════════════════════════════
 */

(function () {
  "use strict";

  // ═════════════════════════════════════════════════════════════════════════
  //                           全域變數與常數
  // ═════════════════════════════════════════════════════════════════════════

  /**
   * 【全局訂單陣列】
   * 用途：儲存所有已抓取的訂單資料（包含從 localStorage 載入的歷史資料）
   *
   * 資料結構：
   * [
   *   {
   *     mainOrderId: "主訂單ID",        // 一個主訂單可能包含多個商品
   *     subOrderId: "子訂單ID",         // 每個商品對應一個子訂單
   *     productName: "商品名稱",
   *     productId: "商品ID",
   *     productSku: "商品規格",
   *     quantity: "數量",
   *     unitPrice: "單價",
   *     totalPrice: "總價",
   *     picUrl: "商品圖片URL",
   *     sellerName: "賣家名稱",
   *     sellerId: "賣家ID",
   *     purchaseDate: "購買日期",
   *     orderStatus: "訂單狀態",
   *     orderTotalPrice: "訂單總價",
   *     actualFee: "實付金額",
   *     logisticsCompany: "物流公司",
   *     trackingNumber: "物流單號",
   *     detailUrl: "訂單詳情URL"
   *   },
   *   ...
   * ]
   *
   * 注意：使用 let 而非 const，因為需要重新賦值（從 localStorage 載入時）
   */
  let allOrders = [];

  /**
   * 【localStorage 管理模塊】
   * 用途：負責訂單資料的持久化儲存和去重管理
   *
   * 核心概念：
   * - localStorage：瀏覽器提供的本地儲存 API，容量約 5-10MB
   * - 資料格式：JSON 字符串（序列化儲存，反序列化讀取）
   * - 唯一鍵：mainOrderId_subOrderId 組合，確保訂單唯一性
   *
   * 學習要點：
   * 1. localStorage 只能儲存字符串，所以需要 JSON.stringify/parse
   * 2. 使用 try-catch 處理潛在錯誤（容量超限、解析失敗）
   * 3. Set 資料結構提供 O(1) 查找性能，適合去重場景
   */
  const StorageManager = {
    // 儲存鍵名（帶版本號，方便未來升級時區分）
    STORAGE_KEY: "taobao_orders_v1",

    /**
     * 【載入訂單】
     * 從 localStorage 讀取已保存的訂單資料
     *
     * @returns {Array<Object>} 訂單陣列，載入失敗時返回空陣列
     *
     * 技術細節：
     * - localStorage.getItem() 返回字符串或 null
     * - JSON.parse() 將 JSON 字符串轉換為 JavaScript 物件
     * - 使用 try-catch 捕獲解析錯誤（例如資料損壞）
     */
    loadOrders() {
      try {
        const data = localStorage.getItem(this.STORAGE_KEY);
        const orders = data ? JSON.parse(data) : [];
        console.log(`從 localStorage 載入 ${orders.length} 筆訂單`);
        return orders;
      } catch (error) {
        console.error("從 localStorage 載入訂單失敗:", error);
        return []; // 載入失敗時返回空陣列，避免程序崩潰
      }
    },

    /**
     * 【保存訂單】
     * 將訂單陣列保存到 localStorage
     *
     * @param {Array<Object>} orders - 訂單陣列
     * @returns {boolean} 是否保存成功
     *
     * 技術細節：
     * - JSON.stringify() 將 JavaScript 物件轉換為 JSON 字符串
     * - QuotaExceededError：localStorage 容量超限錯誤
     *   （通常為 5-10MB，具體取決於瀏覽器）
     */
    saveOrders(orders) {
      try {
        localStorage.setItem(this.STORAGE_KEY, JSON.stringify(orders));
        console.log(`已保存 ${orders.length} 筆訂單到 localStorage`);
        return true;
      } catch (error) {
        console.error("保存訂單到 localStorage 失敗:", error);
        // 檢查是否因容量超限
        if (error.name === "QuotaExceededError") {
          alert("localStorage 容量已滿，請先清除舊資料！");
        }
        return false;
      }
    },

    /**
     * 【清空訂單】
     * 從 localStorage 刪除所有訂單資料
     *
     * @returns {boolean} 是否清空成功
     */
    clearOrders() {
      try {
        localStorage.removeItem(this.STORAGE_KEY);
        console.log("已清空 localStorage 中的訂單資料");
        return true;
      } catch (error) {
        console.error("清空 localStorage 失敗:", error);
        return false;
      }
    },

    /**
     * 【生成唯一鍵】
     * 為訂單生成唯一標識符，用於去重
     *
     * @param {Object} order - 訂單物件
     * @returns {string} 唯一鍵格式為 "mainOrderId_subOrderId"
     *
     * 設計思路：
     * - 主訂單ID：一次購買可能包含多個商品
     * - 子訂單ID：每個商品對應一個子訂單
     * - 組合鍵：確保每個商品訂單的唯一性
     *
     * 示例：
     * mainOrderId: "4865640015090004803"
     * subOrderId: "4865640015090005000"
     * 唯一鍵: "4865640015090004803_4865640015090005000"
     */
    getOrderKey(order) {
      return `${order.mainOrderId}_${order.subOrderId}`;
    },

    /**
     * 【合併訂單（去重）】
     * 將新抓取的訂單與已有訂單合併，自動過濾重複項
     *
     * @param {Array<Object>} existingOrders - 已有訂單陣列
     * @param {Array<Object>} newOrders - 新訂單陣列
     * @returns {Object} { mergedOrders, addedCount, duplicateCount }
     *
     * 算法分析：
     * - 時間複雜度：O(n + m)，其中 n 為已有訂單數，m 為新訂單數
     * - 空間複雜度：O(n)，用於 Set 儲存已有訂單的鍵
     *
     * 為什麼使用 Set？
     * - Set.has() 的時間複雜度為 O(1)，比陣列的 includes() 快得多
     * - 陣列 includes() 的時間複雜度為 O(n)，會導致整體複雜度變為 O(n*m)
     *
     * 對比：
     * 使用陣列：10000 筆舊訂單 + 1000 筆新訂單 = 10,000,000 次比較
     * 使用 Set：10000 筆舊訂單 + 1000 筆新訂單 = 11,000 次操作
     */
    mergeOrders(existingOrders, newOrders) {
      // 步驟 1：構建已有訂單的 Set（用於快速查找）
      const existingKeys = new Set(
        existingOrders.map((order) => this.getOrderKey(order))
      );

      let addedCount = 0; // 新增訂單計數
      let duplicateCount = 0; // 重複訂單計數
      const mergedOrders = [...existingOrders]; // 複製已有訂單（避免修改原陣列）

      // 步驟 2：遍歷新訂單，檢查是否重複
      for (const newOrder of newOrders) {
        const key = this.getOrderKey(newOrder);

        if (existingKeys.has(key)) {
          // 重複訂單，跳過
          duplicateCount++;
          console.log(`[去重] 跳過重複訂單: ${key}`);
        } else {
          // 新訂單，添加到合併陣列
          mergedOrders.push(newOrder);
          existingKeys.add(key); // 同時添加到 Set，避免後續新訂單中的重複
          addedCount++;
        }
      }

      console.log(
        `合併完成：新增 ${addedCount} 筆，跳過重複 ${duplicateCount} 筆，總計 ${mergedOrders.length} 筆`
      );
      return { mergedOrders, addedCount, duplicateCount };
    },
  };

  /**
   * 【異步狀態管理】
   * 用途：追蹤異步操作的狀態，防止重複操作和並發衝突
   *
   * 屬性說明：
   * - pendingRequests：正在進行的請求數（用於追蹤物流資訊抓取）
   * - isFetching：是否正在抓取訂單（防止重複點擊"抓取資料"按鈕）
   *
   * 為什麼需要狀態管理？
   * - 防止用戶在抓取過程中多次點擊按鈕，導致重複請求
   * - 追蹤異步操作完成情況，確保所有資料都已抓取完成
   */
  const asyncState = {
    pendingRequests: 0,
    isFetching: false,
  };

  /**
   * 【錯誤追踪系統】
   * 用途：記錄抓取過程中的各類錯誤，便於除錯和追踪問題
   *
   * 錯誤類型：
   * - logisticsFailed：物流資訊獲取失敗次數（訂單詳情頁解析失敗或無物流資訊）
   * - parseErrors：訂單列表解析錯誤次數（JSON 格式錯誤或資料結構異常）
   * - apiFailed：API 請求失敗次數（網絡錯誤、超時、回應異常）
   *
   * 資料記錄：
   * - failedOrders：失敗訂單的 ID 列表（便於重新抓取）
   * - errorDetails：詳細錯誤資訊陣列（包含訂單ID、錯誤類型、錯誤訊息）
   *
   * 使用場景：
   * 1. 實時顯示錯誤統計在 UI 上
   * 2. Console 輸出詳細錯誤日誌
   * 3. 定位問題訂單便於手動處理
   *
   * 清空時機：
   * - 開始新的抓取流程時（startFetchingProcess）
   * - 清空所有訂單時（clearAllOrders）
   */
  const errorTracker = {
    logisticsFailed: 0, // 物流資訊獲取失敗次數
    parseErrors: 0, // 訂單解析錯誤次數
    apiFailed: 0, // API 請求失敗次數
    failedOrders: [], // 失敗的訂單 ID 列表
    errorDetails: [], // 詳細錯誤資訊
  };

  /**
   * 【CSV 檔案標頭欄位】
   * 用途：定義匯出的 CSV 檔案的欄位順序和名稱
   *
   * 欄位說明：
   * 1. 主訂單號碼 - 淘寶的主訂單 ID（一次購買的唯一識別碼）
   * 2. 子訂單號碼 - 每個商品的子訂單 ID（用於去重和追蹤單一商品）
   * 3. 商品名稱 - 商品標題
   * 4. 購買日期 - 訂單建立時間
   * 5. 訂單狀態 - 交易成功、已取消等狀態
   * 6. 訂單總價 - 主訂單的總金額（含所有商品）
   * 7. 實付金額 - 實際支付金額（含折扣）
   * 8. 物流公司 - 快遞公司名稱（從詳情頁獲取）
   * 9. 物流號碼 - 快遞單號（從詳情頁獲取）
   * 10. 商品ID - 淘寶商品 ID
   * 11. 商品規格 - SKU 資訊（顏色、尺寸等）
   * 12. 商品數量 - 購買數量
   * 13. 商品單價 - 單個商品的價格（計算得出）
   * 14. 商品總價 - 該商品的小計（單價 × 數量）
   * 15. 商家名稱 - 店鋪名稱
   * 16. 商家ID - 賣家 ID
   * 17. 商品圖片URL - 商品主圖連結
   * 18. 訂單詳情URL - 訂單詳情頁連結
   *
   * 注意：此欄位順序必須與 downloadCSV() 中的資料欄位順序一致
   */
  const CSV_HEADERS = [
    "主訂單號碼",
    "子訂單號碼",
    "商品名稱",
    "購買日期",
    "訂單狀態",
    "訂單總價",
    "實付金額",
    "物流公司",
    "物流號碼",
    "商品ID",
    "商品規格",
    "商品數量",
    "商品單價",
    "商品總價",
    "商家名稱",
    "商家ID",
    "商品圖片URL",
    "訂單詳情URL",
  ];

  // ═════════════════════════════════════════════════════════════════════════
  //                               UI 生成
  // ═════════════════════════════════════════════════════════════════════════

  /**
   * 【建立並注入操作介面】
   * 用途：在淘寶訂單頁面頂部建立工具面板 GUI
   *
   * UI 結構：
   * ┌─────────────────────────────────────────────────────────────┐
   * │  淘寶訂單匯出工具 (Kilo Code 版)                            │
   * ├─────────────────────────────────────────────────────────────┤
   * │  起始頁: [1]  截止頁: [1]  |  狀態: 待命中  |  按鈕區域      │
   * │                             已儲存訂單: 0 筆                 │
   * └─────────────────────────────────────────────────────────────┘
   *
   * 技術細節：
   * - 注入目標：ID 為 "J_bought_main" 的容器（淘寶訂單頁面的主容器）
   * - 注入方式：prepend()，將面板插入到訂單列表上方
   * - 樣式：inline styles（避免依賴外部 CSS）
   * - 按鈕功能：抓取資料、下載 CSV、清除資料、測試跨域、自訂功能
   *
   * 學習要點：
   * 1. DOM 操作：createElement(), appendChild(), prepend()
   * 2. 樣式設定：element.style.property = value
   * 3. Flexbox 佈局：display: flex, justify-content, align-items
   * 4. 表單元素：<input type="number">
   */
  function createUI() {
    const targetContainer = document.getElementById("J_bought_main");
    if (!targetContainer) {
      console.error("找不到目標容器 'J_bought_main'，無法注入 UI。");
      return;
    }

    // 創建主面板
    const panel = document.createElement("div");
    panel.id = "kilo-exporter-panel";
    panel.style.padding = "20px";
    panel.style.backgroundColor = "#f5f5f5";
    panel.style.border = "1px solid #ccc";
    panel.style.borderRadius = "8px";
    panel.style.marginBottom = "20px"; // 與下方訂單列表的間距
    panel.style.fontFamily = "Arial, sans-serif";

    // 標題
    const title = document.createElement("h2");
    title.textContent = "淘寶訂單匯出工具 (Kilo Code 版)";
    title.style.margin = "0 0 15px 0";
    title.style.fontSize = "18px";
    title.style.color = "#333";
    title.style.textAlign = "center";
    panel.appendChild(title);

    // 操作區塊
    const controlsContainer = document.createElement("div");
    controlsContainer.style.display = "flex";
    controlsContainer.style.justifyContent = "space-between";
    controlsContainer.style.alignItems = "center";
    panel.appendChild(controlsContainer);

    // 左側：頁碼範圍
    const pageRangeContainer = document.createElement("div");

    const startPageLabel = document.createElement("label");
    startPageLabel.textContent = "起始頁: ";
    startPageLabel.style.marginRight = "5px";
    const startPageInput = document.createElement("input");
    startPageInput.type = "number";
    startPageInput.id = "kilo-start-page";
    startPageInput.min = "1";
    startPageInput.value = "1";
    startPageInput.style.width = "50px";
    startPageInput.style.marginRight = "15px";

    const endPageLabel = document.createElement("label");
    endPageLabel.textContent = "截止頁: ";
    endPageLabel.style.marginRight = "5px";
    const endPageInput = document.createElement("input");
    endPageInput.type = "number";
    endPageInput.id = "kilo-end-page";
    endPageInput.min = "1";
    endPageInput.value = "1";
    endPageInput.style.width = "50px";

    pageRangeContainer.appendChild(startPageLabel);
    pageRangeContainer.appendChild(startPageInput);
    pageRangeContainer.appendChild(endPageLabel);
    pageRangeContainer.appendChild(endPageInput);
    controlsContainer.appendChild(pageRangeContainer);

    // 中間：進度顯示
    const progressLabel = document.createElement("p");
    progressLabel.id = "kilo-progress-label";
    progressLabel.textContent = "狀態: 待命中";
    progressLabel.style.margin = "0";
    progressLabel.style.fontSize = "14px";
    progressLabel.style.color = "#666";
    progressLabel.style.textAlign = "center";
    controlsContainer.appendChild(progressLabel);

    // 訂單數量顯示
    const orderCountLabel = document.createElement("p");
    orderCountLabel.id = "kilo-order-count-label";
    orderCountLabel.textContent = "已儲存訂單: 0 筆";
    orderCountLabel.style.margin = "5px 0 0 0";
    orderCountLabel.style.fontSize = "14px";
    orderCountLabel.style.color = "#409EFF";
    orderCountLabel.style.fontWeight = "bold";
    orderCountLabel.style.textAlign = "center";
    controlsContainer.appendChild(orderCountLabel);

    // 錯誤資訊顯示
    const errorLabel = document.createElement("p");
    errorLabel.id = "kilo-error-label";
    errorLabel.textContent = "";
    errorLabel.style.margin = "5px 0 0 0";
    errorLabel.style.fontSize = "13px";
    errorLabel.style.color = "#F56C6C";
    errorLabel.style.textAlign = "center";
    errorLabel.style.fontWeight = "bold";
    errorLabel.style.display = "none"; // 默認隱藏，有錯誤時才顯示
    controlsContainer.appendChild(errorLabel);

    // 右側：按鈕
    const buttonContainer = document.createElement("div");
    buttonContainer.style.display = "flex";
    buttonContainer.style.gap = "10px";
    buttonContainer.style.flexWrap = "wrap";

    const fetchButton = createButton("抓取資料", "kilo-fetch-btn", "#409EFF");
    const downloadButton = createButton(
      "下載 CSV",
      "kilo-download-btn",
      "#67C23A"
    );
    downloadButton.disabled = true;
    const clearButton = createButton("清除資料", "kilo-clear-btn", "#F56C6C");

    // 測試按鈕
    const testTmallButton = createButton(
      "測試天貓跨域",
      "kilo-test-tmall-btn",
      "#E6A23C"
    );
    const customButton = createButton("自訂功能", "kilo-custom-btn", "#909399");

    buttonContainer.appendChild(fetchButton);
    buttonContainer.appendChild(downloadButton);
    buttonContainer.appendChild(clearButton);
    buttonContainer.appendChild(testTmallButton);
    buttonContainer.appendChild(customButton);
    controlsContainer.appendChild(buttonContainer);

    // 將面板注入到目標容器的頂部
    targetContainer.prepend(panel);
  }

  /**
   * 【建立按鈕元素】
   * 用途：產生統一樣式的按鈕（輔助函數）
   *
   * @param {string} text - 按鈕顯示文字
   * @param {string} id - 按鈕的 DOM ID（用於事件綁定）
   * @param {string} color - 按鈕背景顏色（十六進位色碼）
   * @returns {HTMLButtonElement} 建立好的按鈕元素
   *
   * 樣式設計：
   * - 統一尺寸：padding 10px
   * - 圓角：border-radius 4px
   * - 無邊框：border: none
   * - 懸停效果：opacity 0.8（僅在未禁用時）
   * - 平滑過渡：transition 0.3s
   *
   * 使用範例：
   * const btn = createButton("抓取資料", "kilo-fetch-btn", "#409EFF");
   * container.appendChild(btn);
   *
   * 學習要點：
   * 1. 函數式編程：封裝重複邏輯為可重用函數
   * 2. 事件處理：onmouseover, onmouseout
   * 3. CSS transition：平滑視覺效果
   * 4. 條件樣式：根據 disabled 狀態調整效果
   */
  function createButton(text, id, color) {
    const button = document.createElement("button");
    button.textContent = text;
    button.id = id;
    button.style.padding = "10px";
    button.style.border = "none";
    button.style.borderRadius = "4px";
    button.style.backgroundColor = color;
    button.style.color = "white";
    button.style.cursor = "pointer";
    button.style.fontSize = "14px";
    button.style.transition = "background-color 0.3s";

    button.onmouseover = () => {
      if (!button.disabled) button.style.opacity = "0.8";
    };
    button.onmouseout = () => {
      button.style.opacity = "1";
    };

    return button;
  }

  // ═════════════════════════════════════════════════════════════════════════
  //                              輔助函數
  // ═════════════════════════════════════════════════════════════════════════

  /**
   * 【在頁面上下文中執行 fetch 請求】
   * 用途：繞過淘寶的安全檢查和 CORS 限制，並正確處理 GBK 編碼
   *
   * 問題背景：
   * 1. 淘寶 API 有反爬蟲機制，直接從 userscript 發送請求會被攔截
   * 2. 淘寶 API 返回 GBK 編碼的資料，但 fetch API 預設使用 UTF-8 解碼
   *
   * 解決方案：
   * 1. 將 fetch 程式碼注入到頁面的 <script> 標籤中執行
   * 2. 頁面上下文的 fetch 會攜帶正確的 Cookie 和安全 Token，不會被攔截
   * 3. 使用 TextDecoder('gbk') 正確解碼中文字符
   *
   * @param {string} url - 請求的 URL
   * @param {object} options - fetch 選項物件（method, headers, body 等）
   * @returns {Promise<object>} 包含 status, statusText, responseText 的物件
   *
   * 工作流程：
   * 1. 產生唯一的回調 ID（避免多個請求互相干擾）
   * 2. 建立 <script> 標籤，內容為 fetch 程式碼
   * 3. 在 window 物件上註冊回調函數
   * 4. 注入 <script> 到頁面中執行
   * 5. fetch 完成後，呼叫回調函數傳回結果
   * 6. 清理：移除 script 標籤和回調函數
   *
   * 技術要點：
   * - unsafeWindow：Greasemonkey API，存取頁面的真實 window 物件
   * - TextDecoder('gbk')：GBK 解碼器（關鍵！否則中文會顯示為 Сѩ�� 等亂碼）
   * - ArrayBuffer：二進位資料緩衝區，用於手動解碼
   * - 動態回調：使用 window[callbackId] 建立動態函數名稱
   * - 超時處理：30 秒超時，防止請求卡住
   *
   * 為什麼不能直接使用 fetch？
   * 1. 淘寶會檢查請求來源，userscript 發送的請求會被識別為異常
   * 2. CORS 政策限制跨域請求
   * 3. 頁面上下文的 fetch 會自動攜帶淘寶的安全 Token
   *
   * GBK 編碼處理：
   * - 淘寶 API 返回的資料使用 GBK 編碼（中國常用編碼）
   * - 如果用 UTF-8 解碼，中文會變成亂碼：小雪主播 → Сѩ��
   * - 必須使用 TextDecoder('gbk') 正確解碼
   *
   * 使用範例：
   * const result = await fetchInPageContext(apiUrl, {
   *   method: "POST",
   *   headers: { "Content-Type": "application/x-www-form-urlencoded" },
   *   body: "pageNum=2&pageSize=50"
   * });
   * const data = JSON.parse(result.responseText);
   */
  async function fetchInPageContext(url, options) {
    return new Promise((resolve, reject) => {
      // 生成唯一的回調 ID
      const callbackId = `fetchCallback_${Date.now()}_${Math.random()
        .toString(36)
        .substr(2, 9)}`;

      // 在頁面上下文中注入 fetch 執行腳本
      const script = document.createElement("script");
      script.textContent = `
        (async function() {
          try {
            const response = await fetch(${JSON.stringify(
              url
            )}, ${JSON.stringify(options)});

            if (!response.ok) {
              window.${callbackId}({
                success: false,
                error: 'HTTP ' + response.status + ' ' + response.statusText
              });
              return;
            }

            // 使用 GBK 解碼（淘寶 API 返回 GBK 編碼的數據）
            const buffer = await response.arrayBuffer();
            const decoder = new TextDecoder('gbk');
            const text = decoder.decode(buffer);

            window.${callbackId}({
              success: true,
              data: text,
              status: response.status,
              statusText: response.statusText
            });
          } catch (error) {
            window.${callbackId}({
              success: false,
              error: error.message
            });
          }
        })();
      `;

      // 設置回調函數
      unsafeWindow[callbackId] = (result) => {
        // 清理
        delete unsafeWindow[callbackId];
        document.head.removeChild(script);

        if (result.success) {
          resolve({
            status: result.status,
            statusText: result.statusText,
            responseText: result.data,
          });
        } else {
          reject(new Error(result.error));
        }
      };

      // 執行腳本
      document.head.appendChild(script);

      // 設置超時
      setTimeout(() => {
        if (unsafeWindow[callbackId]) {
          delete unsafeWindow[callbackId];
          document.head.removeChild(script);
          reject(new Error("請求超時"));
        }
      }, 30000); // 30 秒超時
    });
  }

  /**
   * 【GM_xmlhttpRequest 的 Promise 包裝器】
   * 用途：將 GM API 轉換為 async/await 風格，用於跨域請求訂單詳情頁
   *
   * 問題背景：
   * - 訂單詳情頁可能在不同域名（taobao.com 或 tmall.com）
   * - 瀏覽器的同源政策（Same-Origin Policy）會阻擋跨域請求
   * - 普通 fetch 無法存取 tmall.com 的訂單詳情（CORS 錯誤）
   *
   * 解決方案：
   * - GM_xmlhttpRequest 是 Greasemonkey API，可以繞過 CORS 限制
   * - 此函數將其包裝為 Promise，便於使用 async/await
   *
   * @param {object} options - GM_xmlhttpRequest 的選項物件
   *   - method: HTTP 方法（GET, POST 等）
   *   - url: 請求 URL（可以是跨域 URL）
   *   - headers: 請求標頭（選填）
   *   - data: 請求內容（選填）
   * @returns {Promise<object>} 回應物件，包含 status, responseText 等屬性
   *
   * GM API 相容性處理：
   * - GM.xmlHttpRequest：Violentmonkey, Tampermonkey 4.0+ 推薦的新版 API
   * - GM_xmlhttpRequest：舊版 API（向後相容）
   * - 優先使用新版 API，回退到舊版 API
   *
   * 使用範例：
   * const response = await gmXhrRequest({
   *   method: "GET",
   *   url: "https://trade.tmall.com/detail/orderDetail.htm?bizOrderId=123"
   * });
   * console.log(response.responseText);
   *
   * 學習要點：
   * 1. Promise 包裝回調函數：將 callback 風格轉為 Promise 風格
   * 2. async/await：現代 JavaScript 異步編程模式
   * 3. API 相容性處理：優先使用新 API，回退到舊 API
   * 4. 錯誤處理：onload（成功）、onerror（失敗）、ontimeout（超時）
   */
  function gmXhrRequest(options) {
    return new Promise((resolve, reject) => {
      // 優先使用 GM.xmlHttpRequest（Violentmonkey 推薦），回退到 GM_xmlhttpRequest
      const gmXhr =
        typeof GM !== "undefined" && GM.xmlHttpRequest
          ? GM.xmlHttpRequest
          : GM_xmlhttpRequest;

      gmXhr({
        ...options,
        onload: (response) => resolve(response),
        onerror: (error) => reject(error),
        ontimeout: () => reject(new Error("請求超時")),
      });
    });
  }

  // ═════════════════════════════════════════════════════════════════════════
  //                              資料處理
  // ═════════════════════════════════════════════════════════════════════════

  /**
   * 【解析訂單資料】
   * 用途：從淘寶 API 回應或頁面內嵌 JSON 中提取訂單資訊
   *
   * 資料來源：
   * 1. 第一頁：window.data（頁面內嵌的 JavaScript 變數）
   * 2. 第二頁起：API 回應 JSON
   *
   * @param {object} data - 淘寶訂單資料物件（參考 orders_schema.ts）
   * @param {Array<Object>} targetArray - 目標陣列（預設為 allOrders）
   *
   * 資料結構（簡化版）：
   * {
   *   mainOrders: [
   *     {
   *       orderInfo: { id, createTime },
   *       seller: { shopName, id },
   *       payInfo: { actualFee },
   *       statusInfo: { text, operations },
   *       subOrders: [
   *         {
   *           id,
   *           itemInfo: { title, id, pic, skuText },
   *           quantity: { count },
   *           priceInfo: { realTotal }
   *         }
   *       ]
   *     }
   *   ]
   * }
   *
   * 處理邏輯：
   * 1. 遍歷每個主訂單（mainOrders）
   * 2. 從 statusInfo.operations 中提取訂單詳情頁 URL
   * 3. 遍歷每個子訂單（subOrders，即商品）
   * 4. 提取並組合 SKU 資訊（商品規格）
   * 5. 計算商品單價（總價 ÷ 數量）
   * 6. 建立標準化的訂單物件
   * 7. 推入目標陣列
   *
   * 技術要點：
   * - Optional Chaining (?.): 安全存取巢狀屬性，避免 TypeError
   *   例如：order.statusInfo?.operations 如果 statusInfo 是 null，不會報錯
   * - Array.isArray(): 驗證陣列型別，避免對非陣列使用 forEach
   * - parseFloat() / parseInt(): 字串轉數字，用於計算單價
   * - toFixed(2): 保留兩位小數（金額格式）
   * - String(): 強制轉換為字串（確保 ID 型別一致）
   *
   * SKU 處理範例：
   * 輸入：[{name: "颜色", value: "黑色"}, {name: "尺码", value: "L"}]
   * 輸出："颜色:黑色; 尺码:L"
   *
   * 為什麼需要 targetArray 參數？
   * - 抓取新資料時先推入臨時陣列（tempOrders）
   * - 避免直接修改 allOrders（方便去重和回滾）
   */
  function parseOrdersFromData(data, targetArray = allOrders) {
    console.log("parseOrdersFromData 收到資料:", data);

    if (!data || !data.mainOrders) {
      console.error("無效的訂單資料格式:", data);
      // 記錄解析錯誤
      errorTracker.parseErrors++;
      errorTracker.errorDetails.push({
        type: "parseError",
        error: "訂單資料格式無效或缺少 mainOrders",
        data: data ? "資料存在但格式錯誤" : "資料為 null/undefined",
      });
      updateErrorDisplay(); // 實時更新 UI
      return;
    }

    data.mainOrders.forEach((order) => {
      // 從 statusInfo.operations 中找到 "訂單詳情" 的 URL
      let detailUrl = "";
      if (
        order.statusInfo?.operations &&
        Array.isArray(order.statusInfo.operations)
      ) {
        order.statusInfo.operations.forEach((entry) => {
          if (entry.id === "viewDetail" && entry.url) {
            detailUrl = entry.url;
          }
        });
      }

      // 遍歷每個主訂單下的所有子訂單 (商品)
      if (!order.subOrders || !Array.isArray(order.subOrders)) {
        console.warn(`訂單 ${order.orderInfo?.id} 沒有 subOrders`);
        return;
      }

      order.subOrders.forEach((item, index) => {
        // 組合 SKU 文字（商品規格）
        let skuText = "N/A";
        if (item?.itemInfo?.skuText && Array.isArray(item.itemInfo.skuText)) {
          const skuParts = item.itemInfo.skuText
            .filter((sku) => sku && sku.name && sku.value)
            .map((sku) => `${sku.name}:${sku.value}`);
          if (skuParts.length > 0) {
            skuText = skuParts.join("; ");
          }
        }

        // 計算商品單價（總價 ÷ 數量）
        const totalPriceStr = item?.priceInfo?.realTotal || "0";
        const quantityStr = item?.quantity?.count || "1";
        const totalPrice = parseFloat(totalPriceStr);
        const quantity = parseInt(quantityStr, 10);
        const unitPrice =
          quantity > 0 && !isNaN(totalPrice)
            ? (totalPrice / quantity).toFixed(2)
            : "0.00";

        const newOrder = {
          // 主訂單資訊
          mainOrderId: order.orderInfo?.id || "N/A",
          subOrderId:
            item?.id !== undefined && item?.id !== null
              ? String(item.id)
              : "N/A",

          // 商品資訊
          productName: item?.itemInfo?.title || "N/A",
          productId:
            item?.itemInfo?.id !== undefined && item?.itemInfo?.id !== null
              ? String(item.itemInfo.id)
              : "N/A",
          productSku: skuText,
          quantity: quantityStr,
          unitPrice: unitPrice,
          totalPrice: totalPriceStr,
          picUrl: item?.itemInfo?.pic || "N/A",

          // 賣家資訊
          sellerName: order.seller?.shopName || "N/A",
          sellerId:
            order.seller?.id !== undefined && order.seller?.id !== null
              ? String(order.seller.id)
              : "N/A",

          // 訂單基本資訊
          purchaseDate: order.orderInfo?.createTime || "N/A",
          orderStatus: order.statusInfo?.text || "N/A",

          // 價格資訊
          orderTotalPrice: order.payInfo?.actualFee || "0.00",
          actualFee: order.payInfo?.actualFee || "0.00",

          // 物流資訊（待從詳情頁獲取）
          logisticsCompany: "",
          trackingNumber: "",

          // 其他
          detailUrl: detailUrl ? `https:${detailUrl}` : "N/A",
        };

        console.log(
          `[解析] 主訂單 ${newOrder.mainOrderId} 子訂單 ${index + 1}/${
            order.subOrders.length
          }:`,
          newOrder
        );
        targetArray.push(newOrder);
      });
    });

    console.log(
      `已成功解析 ${data.mainOrders.length} 筆主訂單，目標陣列共 ${targetArray.length} 筆子訂單。`
    );
    updateProgress(`已擷取 ${targetArray.length} 筆商品...`);
  }

  /**
   * 【獲取第一頁訂單】
   * 用途：從淘寶訂單頁面的 window.data 變數中讀取第一頁訂單資料
   *
   * @param {Array<Object>} targetArray - 目標陣列（預設為 allOrders）
   *
   * 為什麼第一頁不用 API？
   * - 淘寶訂單頁面載入時，第一頁的資料已經 SSR（Server-Side Rendering）到 HTML 中
   * - 資料儲存在 <script> 標籤內的 window.data 變數中
   * - 直接讀取比發送 API 請求更快、更可靠
   *
   * 技術要點：
   * - unsafeWindow：存取頁面的真實 window 物件（Greasemonkey API）
   * - SSR（Server-Side Rendering）：伺服器端渲染，資料直接內嵌在 HTML 中
   *
   * 錯誤處理：
   * - 如果 window.data 不存在或無效，呼叫備用方法（手動解析 script 標籤）
   */
  function getFirstPageOrders(targetArray = allOrders) {
    console.log("正在嘗試從 window 物件獲取第一頁的訂單資料...");
    try {
      // 使用 unsafeWindow 存取頁面本身的全域變數
      const pageData = unsafeWindow.data;
      if (pageData && pageData.mainOrders) {
        parseOrdersFromData(pageData, targetArray);
      } else {
        console.warn("在 window.data 中未找到有效的訂單資料。");
      }
    } catch (error) {
      console.error("直接讀取 window.data 時發生錯誤:", error);
      console.log("將嘗試備用方法：手動解析 script 標籤。");
      // 在此處可以保留舊的解析方法作為備用
      getFirstPageOrdersFallback(targetArray);
    }
  }

  /**
   * @description getFirstPageOrders 的備用方法，手動解析 script 標籤。
   *              僅在直接讀取 window.data 失敗時呼叫。
   * @param {Array<Object>} targetArray - 目標陣列，解析後的訂單將推入此陣列（預設為 allOrders）。
   */
  function getFirstPageOrdersFallback(targetArray = allOrders) {
    const scripts = document.querySelectorAll("script");
    let found = false;
    for (const script of scripts) {
      if (script.textContent.includes("var data = JSON.parse")) {
        const match = script.textContent.match(/JSON\.parse\('(.+)'\)/);
        if (match && match[1]) {
          try {
            const jsonData = JSON.parse(match[1]);
            parseOrdersFromData(jsonData, targetArray);
            found = true;
            break;
          } catch (error) {
            console.error("備用方法解析內嵌 JSON 時發生錯誤:", error);
          }
        }
      }
    }
    if (!found) {
      console.warn("備用方法也未能在頁面中找到內嵌的訂單資料。");
    }
  }

  /**
   * 【透過 API 獲取指定頁碼的訂單】
   * 用途：發送 POST 請求到淘寶訂單 API，獲取指定頁碼的訂單資料
   *
   * @param {number} pageNum - 頁碼（從 1 開始）
   * @param {Array<Object>} targetArray - 目標陣列（預設為 allOrders）
   * @returns {Promise<void>}
   *
   * API 資訊：
   * - URL: https://buyertrade.taobao.com/trade/itemlist/asyncBought.htm
   * - Method: POST
   * - Content-Type: application/x-www-form-urlencoded
   * - 編碼: GBK（關鍵！）
   *
   * 請求參數說明（requestBody）：
   * - pageNum: 頁碼
   * - pageSize: 每頁訂單數（固定 50 筆）
   * - queryOrder: desc（降序，最新訂單在前）
   * - _input_charset: utf8（請求參數編碼）
   * - 其他參數：保持原值，避免觸發安全檢查
   *
   * 工作流程：
   * 1. 構建 API 請求 URL 和參數
   * 2. 使用 fetchInPageContext 發送請求（繞過安全檢查 + GBK 解碼）
   * 3. 解析 JSON 回應
   * 4. 檢查 mainOrders 是否存在
   * 5. 呼叫 parseOrdersFromData 解析訂單
   * 6. 更新進度顯示
   *
   * 錯誤處理：
   * - 回應為空：拋出錯誤
   * - JSON 解析失敗：記錄前 1000 字元，拋出錯誤
   * - mainOrders 為空：警告（可能超出總頁數）
   * - mainOrders 不存在：拋出錯誤
   *
   * 技術要點：
   * - URL-encoded body：表單格式（key1=value1&key2=value2）
   * - GBK 解碼：fetchInPageContext 自動處理
   * - 錯誤傳播：throw error 讓呼叫方處理
   *
   * 為什麼不能隨意修改 requestBody？
   * - 淘寶 API 可能會驗證參數完整性
   * - 缺少某些參數可能觸發安全檢查，導致請求被攔截
   */
  async function fetchOrdersByPage(pageNum, targetArray = allOrders) {
    updateProgress(`準備抓取第 ${pageNum} 頁...`);
    const apiUrl =
      "https://buyertrade.taobao.com/trade/itemlist/asyncBought.htm?action=itemlist/BoughtQueryAction&event_submit_do_query=1&_input_charset=utf8";
    const requestBody = `buyerNick=&canGetHistoryCount=false&dateBegin=0&dateEnd=0&historyCount=0&lastStartRow=&logisticsService=&needQueryHistory=false&onlineCount=0&options=0&orderStatus=&pageNum=${pageNum}&pageSize=50&queryBizType=&queryForV2=false&queryOrder=desc&rateStatus=&refund=&sellerNick=&unionSearchPageNum=0&unionSearchTotalNum=0&prePageNo=1`;

    console.log(`[除錯] 準備發送請求至: ${apiUrl}`);
    console.log(`[除錯] 請求頁碼: ${pageNum}`);
    console.log(`[除錯] 請求內文: ${requestBody}`);

    try {
      // 使用頁面上下文的 fetch（繞過淘寶的安全檢查）
      const response = await fetchInPageContext(apiUrl, {
        method: "POST",
        credentials: "include",
        headers: {
          Accept: "application/json, text/javascript, */*; q=0.01",
          "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
          "X-Requested-With": "XMLHttpRequest",
        },
        body: requestBody,
      });

      console.log(`[除錯] 第 ${pageNum} 頁響應狀態碼: ${response.status}`);
      console.log(
        `[除錯] 第 ${pageNum} 頁響應狀態文本: ${response.statusText}`
      );

      // 獲取響應文本
      const responseText = response.responseText;
      console.log(
        `[除錯] 第 ${pageNum} 頁 responseText 長度:`,
        responseText.length
      );
      console.log(
        `[除錯] 第 ${pageNum} 頁 API 原始回應 (前 500 字元):`,
        responseText.substring(0, 500)
      );

      // 檢查回應是否為空
      if (!responseText || responseText.trim() === "") {
        updateProgress(`第 ${pageNum} 頁回應為空。`);
        console.error(`第 ${pageNum} 頁回應為空`);
        throw new Error(`第 ${pageNum} 頁回應為空`);
      }

      // 解析 JSON
      let responseData;
      try {
        responseData = JSON.parse(responseText);
      } catch (parseError) {
        console.error(`第 ${pageNum} 頁 JSON 解析失敗:`, parseError);
        console.error(
          `無法解析的內容 (前 1000 字元):`,
          responseText.substring(0, 1000)
        );
        throw new Error(`JSON 解析失敗: ${parseError.message}`);
      }

      console.log(`[除錯] 第 ${pageNum} 頁解析後的 JSON 結構:`, {
        hasMainOrders: !!responseData.mainOrders,
        mainOrdersCount: responseData.mainOrders?.length || 0,
        keys: Object.keys(responseData),
      });

      // 檢查資料格式
      if (responseData && responseData.mainOrders) {
        if (responseData.mainOrders.length === 0) {
          console.warn(`第 ${pageNum} 頁沒有訂單資料（可能已超出總頁數）`);
          updateProgress(`第 ${pageNum} 頁無訂單資料。`);
        } else {
          parseOrdersFromData(responseData, targetArray);
          updateProgress(
            `第 ${pageNum} 頁抓取成功，獲得 ${responseData.mainOrders.length} 筆訂單。`
          );
        }
      } else {
        updateProgress(`第 ${pageNum} 頁回應格式錯誤。`);
        console.error(`第 ${pageNum} 頁回應格式錯誤:`, responseData);
        throw new Error(`第 ${pageNum} 頁回應格式錯誤：缺少 mainOrders 屬性`);
      }
    } catch (error) {
      updateProgress(`第 ${pageNum} 頁抓取失敗: ${error.message}`);
      console.error(`解析第 ${pageNum} 頁的 API 回應時發生錯誤:`, error);
      // 記錄 API 錯誤
      errorTracker.apiFailed++;
      errorTracker.errorDetails.push({
        page: pageNum,
        type: "apiFetchError",
        error: error.message || String(error),
      });
      updateErrorDisplay(); // 實時更新 UI
      throw error;
    }
  }

  /**
   * 【獲取訂單詳情（物流資訊）】
   * 用途：從訂單詳情頁 HTML 中提取物流公司和快遞單號
   *
   * @param {object} order - 訂單物件（會直接修改其 logisticsCompany 和 trackingNumber 屬性）
   * @returns {Promise<void>}
   *
   * 問題背景：
   * - 訂單列表 API 不包含物流資訊
   * - 必須進入每個訂單的詳情頁才能獲取快遞單號
   * - 詳情頁可能在不同域名（taobao.com 或 tmall.com）
   *
   * 工作流程：
   * 1. 從訂單物件中獲取 detailUrl（詳情頁 URL）
   * 2. 檢查 URL 是否有效
   * 3. 隨機延遲 300-700ms（避免請求過快被封鎖）
   * 4. 使用 gmXhrRequest 發送跨域 GET 請求（繞過 CORS）
   * 5. 解析 HTML 回應，提取 detailData 變數
   * 6. 從 detailData.deliveryInfo 中獲取物流資訊
   * 7. 更新訂單物件的 logisticsCompany 和 trackingNumber
   *
   * HTML 解析邏輯：
   * - 淘寶格式：var data = JSON.parse('...');
   * - 天貓格式：var detailData = {...};
   * - 使用正則表達式匹配並提取 JSON
   *
   * 為什麼需要隨機延遲？
   * - 短時間內大量請求會觸發淘寶的反爬蟲機制
   * - 隨機延遲模擬人類行為，降低被封鎖的風險
   * - 延遲範圍：300-700ms（Math.random() * 400 + 300）
   *
   * asyncState.pendingRequests 的作用：
   * - 追蹤正在進行的請求數量
   * - 主流程可以等待所有請求完成
   * - finally 區塊確保無論成功或失敗都會遞減計數
   *
   * 錯誤處理：
   * - 缺少 detailUrl：跳過，不中斷流程
   * - 請求失敗：設定物流資訊為"獲取失敗"，不拋出錯誤
   * - 解析失敗：記錄警告，繼續處理其他訂單
   *
   * 技術要點：
   * - 正則表達式：匹配 HTML 中的 JavaScript 變數
   * - JSON.parse()：兩次解析（淘寶格式需要先解碼字串轉義）
   * - 異步狀態管理：pendingRequests 追蹤
   * - 防抖（Anti-bot）：隨機延遲
   */
  async function fetchOrderDetail(order) {
    //x use random delay between 100ms to 500ms
    //o set minimum delay to 100ms (10 QPS max)
    await new Promise((res) => setTimeout(res, 100));

    // 從訂單物件中獲取詳情頁 URL
    const detailUrl = order.detailUrl;
    if (!detailUrl || detailUrl === "N/A") {
      console.warn(
        `訂單 ${order.mainOrderId} 缺少詳情頁 URL，無法獲取物流資訊。`
      );
      return; // 直接返回，不中斷流程
    }

    asyncState.pendingRequests++;
    try {
      const response = await gmXhrRequest({
        method: "GET",
        url: detailUrl, // URL 已包含 https 協議
      });

      const responseText = response.responseText;
      let detailData = null;

      // 嘗試匹配淘寶格式: var data = JSON.parse('...');
      const taobaoMatch = responseText.match(
        /var data = JSON\.parse\('(.+)'\);/
      );

      if (taobaoMatch && taobaoMatch[1]) {
        let firstParse = JSON.parse(`"${taobaoMatch[1]}"`);
        console.log(`[訂單 ${order.mainOrderId}] 淘寶格式解析成功`, firstParse);
        detailData = JSON.parse(firstParse);
      } else {
        // 嘗試匹配天貓格式: var detailData = {...};
        const tmallMatch = responseText.match(/var detailData = (\{.*\});/);
        if (tmallMatch && tmallMatch[1]) {
          detailData = JSON.parse(tmallMatch[1]);
          console.log(
            `[訂單 ${order.mainOrderId}] 天貓格式解析成功`,
            detailData
          );
        }
      }

      if (detailData && detailData.deliveryInfo) {
        // 淘寶格式：deliveryInfo.logisticsName/logisticsNum
        order.logisticsCompany = detailData.deliveryInfo.logisticsName || "N/A";
        order.trackingNumber = detailData.deliveryInfo.logisticsNum || "N/A";
        console.log(
          `成功獲取訂單 ${order.mainOrderId} 的物流資訊（淘寶格式）。`
        );
      } else if (
        detailData &&
        detailData.orders &&
        detailData.orders.list &&
        detailData.orders.list.length > 0
      ) {
        // 天貓格式：orders.list[].logistic.content[].companyName/mailNo
        let found = false;
        for (const orderItem of detailData.orders.list) {
          if (
            orderItem.logistic &&
            orderItem.logistic.content &&
            orderItem.logistic.content.length > 0
          ) {
            const logisticInfo = orderItem.logistic.content[0]; // 取第一個物流記錄
            order.logisticsCompany = logisticInfo.companyName || "N/A";
            order.trackingNumber = logisticInfo.mailNo || "N/A";
            console.log(
              `成功獲取訂單 ${order.mainOrderId} 的物流資訊（天貓格式）。`
            );
            found = true;
            break;
          }
        }
        if (!found) {
          console.warn(
            `在訂單 ${order.mainOrderId} 的詳情頁（天貓格式）中未找到物流資料。`
          );
          // 記錄錯誤
          errorTracker.logisticsFailed++;
          errorTracker.failedOrders.push(order.mainOrderId);
          errorTracker.errorDetails.push({
            orderId: order.mainOrderId,
            type: "logisticsNotFound",
            error: "天貓格式詳情頁中無物流資料",
          });
          order.logisticsCompany = "N/A";
          order.trackingNumber = "N/A";
        }
      } else {
        console.warn(`在訂單 ${order.mainOrderId} 的詳情頁中未找到物流資料。`);
        // 記錄錯誤
        errorTracker.logisticsFailed++;
        errorTracker.failedOrders.push(order.mainOrderId);
        errorTracker.errorDetails.push({
          orderId: order.mainOrderId,
          type: "logisticsNotFound",
          error: "詳情頁資料結構異常或無物流資訊",
        });
        order.logisticsCompany = "N/A";
        order.trackingNumber = "N/A";
      }
    } catch (error) {
      console.error(`解析訂單 ${order.mainOrderId} 詳情頁時發生錯誤:`, error);
      // 記錄錯誤
      errorTracker.logisticsFailed++;
      errorTracker.failedOrders.push(order.mainOrderId);
      errorTracker.errorDetails.push({
        orderId: order.mainOrderId,
        type: "logisticsFetchError",
        error: error.message || String(error),
      });
      // 不拋出錯誤，允許繼續處理其他訂單
      order.logisticsCompany = "獲取失敗";
      order.trackingNumber = "獲取失敗";
    } finally {
      asyncState.pendingRequests--;
    }
  }

  // ═════════════════════════════════════════════════════════════════════════
  //                            主要執行邏輯
  // ═════════════════════════════════════════════════════════════════════════

  /**
   * 【更新進度顯示】
   * 用途：更新 UI 中的狀態文字
   *
   * @param {string} text - 要顯示的狀態文字
   *
   * 使用範例：
   * updateProgress("正在抓取第 2 頁...");
   * updateProgress("抓取完成！");
   */
  function updateProgress(text) {
    const progressLabel = document.getElementById("kilo-progress-label");
    if (progressLabel) {
      progressLabel.textContent = text;
    }
  }

  /**
   * 【更新訂單數量顯示】
   * 用途：更新 UI 中的已儲存訂單數量
   *
   * 顯示格式："已儲存訂單: 123 筆"
   */
  function updateOrderCount() {
    const countLabel = document.getElementById("kilo-order-count-label");
    if (countLabel) {
      countLabel.textContent = `已儲存訂單: ${allOrders.length} 筆`;
    }
  }

  /**
   * 【更新錯誤顯示】
   * 用途：在 UI 上實時顯示錯誤統計資訊
   *
   * 顯示格式：
   * "⚠️ 錯誤: 物流失敗 3 | 解析失敗 0 | API失敗 1"
   *
   * 工作流程：
   * 1. 計算總錯誤數（三種錯誤類型的總和）
   * 2. 如果有錯誤，顯示錯誤標籤並更新文字
   * 3. 如果沒有錯誤，隱藏錯誤標籤
   * 4. 將失敗訂單 ID 列表輸出到 Console
   *
   * 呼叫時機：
   * - 每次發生錯誤後立即呼叫（實時更新）
   * - fetchOrderDetail 解析失敗時
   * - parseOrdersFromData 格式錯誤時
   * - fetchOrdersByPage API 請求失敗時
   *
   * 除錯資訊：
   * - UI 顯示：簡潔的錯誤統計
   * - Console 輸出：失敗訂單 ID 列表（便於手動處理）
   */
  function updateErrorDisplay() {
    const errorLabel = document.getElementById("kilo-error-label");
    if (!errorLabel) return;

    const totalErrors =
      errorTracker.logisticsFailed +
      errorTracker.parseErrors +
      errorTracker.apiFailed;

    if (totalErrors > 0) {
      errorLabel.style.display = "block";
      errorLabel.textContent =
        `⚠️ 錯誤: 物流失敗 ${errorTracker.logisticsFailed} | ` +
        `解析失敗 ${errorTracker.parseErrors} | ` +
        `API失敗 ${errorTracker.apiFailed}`;

      // 輸出失敗訂單 ID 到 Console，便於除錯
      if (errorTracker.failedOrders.length > 0) {
        console.error("失敗的訂單 ID 列表:", errorTracker.failedOrders);
        console.error("詳細錯誤資訊:", errorTracker.errorDetails);
      }
    } else {
      errorLabel.style.display = "none";
    }
  }

  /**
   * 【清空錯誤追踪器】
   * 用途：重置所有錯誤計數器和記錄
   *
   * 清空內容：
   * - logisticsFailed：物流失敗計數歸零
   * - parseErrors：解析錯誤計數歸零
   * - apiFailed：API 失敗計數歸零
   * - failedOrders：失敗訂單 ID 列表清空
   * - errorDetails：詳細錯誤資訊清空
   *
   * 呼叫時機：
   * 1. startFetchingProcess 開始新的抓取流程時
   * 2. clearAllOrders 清空所有訂單資料時
   *
   * 副作用：
   * - 呼叫 updateErrorDisplay() 隱藏錯誤標籤
   */
  function clearErrorTracker() {
    errorTracker.logisticsFailed = 0;
    errorTracker.parseErrors = 0;
    errorTracker.apiFailed = 0;
    errorTracker.failedOrders = [];
    errorTracker.errorDetails = [];
    updateErrorDisplay(); // 更新 UI，隱藏錯誤標籤
  }

  /**
   * 【開始抓取流程】
   * 用途：主流程函數，協調所有抓取步驟
   *
   * 工作流程：
   * 步驟 1：驗證輸入（頁碼範圍）
   * 步驟 2：抓取訂單列表
   *   - 第一頁：從 window.data 讀取
   *   - 第二頁起：從 API 獲取
   * 步驟 3：抓取物流資訊
   *   - 遍歷每個訂單，呼叫 fetchOrderDetail
   *   - 僅抓取未獲取過物流資訊的訂單
   * 步驟 4：合併與去重
   *   - 使用 StorageManager.mergeOrders 合併到 allOrders
   *   - Set-based 去重算法（O(n) 時間複雜度）
   * 步驟 5：持久化儲存
   *   - 保存到 localStorage
   *   - 更新 UI 顯示
   *
   * 狀態管理：
   * - asyncState.isFetching：防止重複執行（鎖機制）
   * - 禁用按鈕：抓取期間禁用"抓取資料"和"下載 CSV"按鈕
   * - 錯誤恢復：finally 區塊確保按鈕狀態恢復
   *
   * 資料流向：
   * 1. tempOrders（臨時陣列）← 新抓取的訂單
   * 2. allOrders ← mergeOrders(allOrders, tempOrders)
   * 3. localStorage ← JSON.stringify(allOrders)
   *
   * 為什麼使用臨時陣列？
   * - 避免直接修改 allOrders
   * - 方便統計新增/重複數量
   * - 出錯時可以回滾（不影響已有資料）
   *
   * 錯誤處理：
   * - 輸入驗證：頁碼範圍、數字格式
   * - 重複執行檢查：isFetching 鎖
   * - 請求失敗：catch 區塊捕獲，顯示錯誤訊息
   * - finally 區塊：確保狀態恢復（按鈕啟用、isFetching 重置）
   *
   * 技術要點：
   * - async/await：異步流程控制
   * - for...of：循序遍歷（await 在迴圈中有效）
   * - try-catch-finally：完整的錯誤處理結構
   * - 鎖機制：isFetching 防止並發執行
   */
  async function startFetchingProcess() {
    if (asyncState.isFetching) {
      alert("正在抓取中，請稍候...");
      return;
    }

    const startPage = parseInt(
      document.getElementById("kilo-start-page").value,
      10
    );
    const endPage = parseInt(
      document.getElementById("kilo-end-page").value,
      10
    );

    if (
      isNaN(startPage) ||
      isNaN(endPage) ||
      startPage <= 0 ||
      endPage < startPage
    ) {
      alert("請輸入有效的頁碼範圍！");
      return;
    }

    asyncState.isFetching = true;
    document.getElementById("kilo-fetch-btn").disabled = true;
    document.getElementById("kilo-download-btn").disabled = true;

    // 清空上次的錯誤記錄（開始新的抓取流程）
    clearErrorTracker();

    // 使用臨時陣列儲存本次抓取的訂單（不清空 allOrders）
    const tempOrders = [];
    updateProgress("開始抓取流程...");

    try {
      // 步驟 1: 抓取第一頁 (如果適用)
      if (startPage === 1) {
        updateProgress("正在抓取第 1 頁 (當前頁面)...");
        getFirstPageOrders(tempOrders); // 推入臨時陣列
        updateProgress(`第 1 頁抓取成功，獲得 ${tempOrders.length} 筆訂單。`);
      }

      // 步驟 2: 循序抓取後續頁面
      const startFetchPage = startPage === 1 ? 2 : startPage;
      for (let i = startFetchPage; i <= endPage; i++) {
        await fetchOrdersByPage(i, tempOrders); // 推入臨時陣列
      }

      updateProgress(
        `訂單列表抓取完成，本次獲得 ${tempOrders.length} 筆。準備獲取物流資訊...`
      );

      // 步驟 3: 循序抓取所有訂單的物流資訊
      for (const order of tempOrders) {
        // 只為沒有物流資訊的訂單抓取詳情
        if (!order.logisticsCompany && !order.trackingNumber) {
          updateProgress(`正在獲取訂單 ${order.mainOrderId} 的物流資訊...`);
          await fetchOrderDetail(order);
        }
      }

      // 步驟 4: 合併到 allOrders（自動去重）
      const mergeResult = StorageManager.mergeOrders(allOrders, tempOrders);
      allOrders = mergeResult.mergedOrders;

      // 步驟 5: 保存到 localStorage
      if (StorageManager.saveOrders(allOrders)) {
        updateProgress(
          `抓取完成！新增 ${mergeResult.addedCount} 筆，跳過重複 ${mergeResult.duplicateCount} 筆。` +
            `當前共 ${allOrders.length} 筆訂單。`
        );
        updateOrderCount(); // 更新 UI 顯示訂單數量
      } else {
        updateProgress("抓取完成，但保存失敗！");
      }

      document.getElementById("kilo-download-btn").disabled = false;
    } catch (error) {
      console.error("抓取過程中發生嚴重錯誤:", error);
      updateProgress("抓取失敗，請查看控制台錯誤訊息。");
    } finally {
      asyncState.isFetching = false;
      document.getElementById("kilo-fetch-btn").disabled = false;
    }
  }

  /**
   * 【清空所有訂單資料】
   * 用途：刪除內存和 localStorage 中的所有訂單資料
   *
   * 工作流程：
   * 1. 顯示確認對話框（包含訂單數量）
   * 2. 用戶確認後，清空 allOrders 陣列
   * 3. 呼叫 StorageManager.clearOrders() 刪除 localStorage 資料
   * 4. 更新 UI（進度、訂單數量、按鈕狀態）
   *
   * 安全措施：
   * - 二次確認對話框：防止誤操作
   * - 顯示訂單數量：讓用戶清楚知道將刪除多少資料
   * - 提示不可復原：強調操作的嚴重性
   *
   * 為什麼需要清空功能？
   * - 重新開始抓取（避免舊資料干擾）
   * - localStorage 容量限制（5-10MB）
   * - 資料過期或錯誤（需要重置）
   *
   * 技術要點：
   * - confirm() 對話框：返回 boolean（確認 true，取消 false）
   * - 內存清理：allOrders = []
   * - 持久化清理：localStorage.removeItem()
   * - UI 同步：更新所有相關顯示元素
   */
  function clearAllOrders() {
    // 二次確認，防止誤操作
    if (
      !confirm(
        `確定要清空所有已儲存的訂單資料嗎？\n\n當前共有 ${allOrders.length} 筆訂單\n此操作無法復原！`
      )
    ) {
      return; // 用戶取消
    }

    // 清空內存中的訂單
    allOrders = [];

    // 清空 localStorage
    StorageManager.clearOrders();

    // 清空錯誤追踪記錄
    clearErrorTracker();

    // 更新 UI
    updateProgress("資料已清空。");
    updateOrderCount(); // 更新訂單數量顯示
    document.getElementById("kilo-download-btn").disabled = true;

    console.log("訂單資料已清空（包含 localStorage）。");
  }

  /**
   * 【下載 CSV 檔案】
   * 用途：將 allOrders 陣列轉換為 Excel 相容的 CSV 檔案並觸發瀏覽器下載
   *
   * CSV 格式規範：
   * - 編碼：UTF-8 with BOM（Byte Order Mark）
   * - 分隔符：逗號（,）
   * - 換行符：\n（Unix 格式）
   * - BOM：\ufeff（讓 Excel 正確識別 UTF-8 編碼）
   *
   * 為什麼需要 BOM？
   * - Excel 預設使用本地編碼（Windows 中文版使用 GBK）
   * - 沒有 BOM 的 UTF-8 檔案在 Excel 中會顯示亂碼
   * - BOM 是一個特殊的位元組序列，告訴 Excel 這是 UTF-8 檔案
   *
   * 工作流程：
   * 1. 檢查 allOrders 是否為空
   * 2. 遍歷每個訂單，提取欄位並轉換為 CSV 行
   * 3. 使用 escapeCSV() 清理特殊字符（emoji、逗號、引號等）
   * 4. 組合標頭和資料行
   * 5. 建立 Blob 物件（加入 BOM）
   * 6. 產生下載連結並觸發點擊
   * 7. 清理 DOM（移除臨時連結）
   *
   * 檔案命名：
   * - 格式：taobao-orders-YYYY-MM-DDTHH-MM-SS.csv
   * - 範例：taobao-orders-2023-12-25T14-30-45.csv
   * - ISO 8601 時間格式（冒號替換為連字號，避免檔案名稱問題）
   *
   * 技術要點：
   * - Blob：二進位大型物件，用於建立檔案
   * - URL.createObjectURL()：建立臨時 URL
   * - <a download>：觸發瀏覽器下載
   * - document.body.appendChild/removeChild：臨時注入連結
   * - toISOString()：ISO 8601 時間格式
   * - slice(0, 19)：截取到秒級（移除毫秒和時區）
   * - replace(/:/g, "-")：替換冒號為連字號（檔案名稱安全）
   */
  function downloadCSV() {
    if (allOrders.length === 0) {
      alert("沒有可供下載的訂單資料！");
      return;
    }

    // 步驟 1: 資料整合與處理
    const rows = allOrders.map((order) => {
      /**
       * 【CSV 特殊字符處理】
       * 用途：清理可能導致 CSV 格式錯誤或 Excel 顯示異常的字符
       *
       * @param {any} value - 要處理的值
       * @returns {string} 清理後的字串
       *
       * 處理項目：
       * 1. Emoji 表情符號
       *    - 問題：Excel 不支援某些 emoji，會顯示為方框或亂碼
       *    - 範圍：[\u{1F600}-\u{1F64F}] 表情符號、[\u{1F300}-\u{1F5FF}] 符號、等
       *    - 正則：/gu 標誌（u = Unicode 完整支援，g = 全局匹配）
       *
       * 2. 零寬字符和不可見字符
       *    - 零寬空格（\u200B）：寬度為零的空格，不可見但會影響文字比對
       *    - 零寬連接符（\u200C, \u200D）：用於某些語言的排版
       *    - BOM（\uFEFF）：位元組順序標記，可能誤嵌入文字中
       *
       * 3. 控制字符
       *    - ASCII 控制字符（0x00-0x1F, 0x7F-0x9F）
       *    - 保留：\n（換行）、\t（製表符）、\r（回車）
       *    - 移除其他控制字符（如 NULL、DEL 等）
       *
       * 4. 英文逗號 → 中文逗號
       *    - 原因：逗號是 CSV 的分隔符
       *    - 如果資料中包含逗號，會導致欄位錯位
       *    - 解決：替換為中文全角逗號（，）
       *
       * 5. 雙引號 → 全角雙引號
       *    - 原因：CSV 使用雙引號包裹含特殊字符的欄位
       *    - 資料中的雙引號會破壞 CSV 結構
       *    - 解決：替換為中文全角引號（"）
       *    - 使用 Unicode 編碼（\u201C）避免 JavaScript 語法錯誤
       *
       * 6. 換行符
       *    - 問題：CSV 使用換行符分隔行，資料中的換行符會導致錯位
       *    - 解決：\n 替換為空格，\r 直接移除
       *
       * 參考專案：BuyerOrdersExport（GitHub）
       */
      const escapeCSV = (value) => {
        if (value === undefined || value === null) return "N/A";
        let str = String(value);

        // 1. 移除 emoji 表情符號（會在 Excel 中顯示為亂碼）
        str = str.replace(
          /[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu,
          ""
        );

        // 2. 移除零寬字符和不可見字符
        str = str.replace(/[\u200B-\u200D\uFEFF]/g, "");

        // 3. 移除控制字符（保留換行符、製表符、回車符）
        str = str.replace(/[\x00-\x08\x0B-\x0C\x0E-\x1F\x7F-\x9F]/g, "");

        // 4. 將英文逗號替換為中文逗號（參考原專案，避免 CSV 列錯位）
        str = str.replace(/,/g, "，");

        // 5. 將雙引號替換為全角雙引號（避免 CSV 解析問題）
        str = str.replace(/"/g, "\u201C"); // 使用 Unicode 编码避免语法错误

        // 6. 移除換行符（避免 CSV 行錯位）
        str = str.replace(/\n/g, " ");
        str = str.replace(/\r/g, "");

        return str;
      };

      return [
        order.mainOrderId, // 主訂單號碼
        order.subOrderId, // 子訂單號碼
        escapeCSV(order.productName), // 商品名稱
        order.purchaseDate, // 購買日期
        escapeCSV(order.orderStatus), // 訂單狀態
        order.orderTotalPrice, // 訂單總價
        order.actualFee, // 實付金額
        escapeCSV(order.logisticsCompany), // 物流公司
        order.trackingNumber, // 物流號碼
        order.productId, // 商品ID
        escapeCSV(order.productSku), // 商品規格
        order.quantity, // 商品數量
        order.unitPrice, // 商品單價
        order.totalPrice, // 商品總價
        escapeCSV(order.sellerName), // 商家名稱
        order.sellerId, // 商家ID
        order.picUrl, // 商品圖片URL
        order.detailUrl, // 訂單詳情URL
      ];
    });

    // 步驟 2: CSV 生成
    let csvContent = CSV_HEADERS.join(",") + "\n";
    csvContent += rows.map((row) => row.join(",")).join("\n");

    // 步驟 3: 觸發下載
    const blob = new Blob([`\ufeff${csvContent}`], {
      type: "text/csv;charset=utf-8;",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    const timestamp = new Date().toISOString().slice(0, 19).replace(/:/g, "-");
    link.setAttribute("href", url);
    link.setAttribute("download", `taobao-orders-${timestamp}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    updateProgress(`已成功下載 ${allOrders.length} 筆訂單資料。`);
  }

  /**
   * 【測試天貓跨域請求】
   * 用途：驗證 GM_xmlhttpRequest 是否能正常繞過 CORS 限制存取天貓訂單
   *
   * 測試目標：
   * - URL: https://trade.tmall.com/detail/orderDetail.htm
   * - 跨域：從 taobao.com 存取 tmall.com
   * - 方法：GM_xmlhttpRequest
   *
   * 為什麼需要測試？
   * - 天貓（tmall.com）和淘寶（taobao.com）是不同域名
   * - 瀏覽器的同源政策會阻擋跨域請求
   * - GM_xmlhttpRequest 應該能繞過 CORS，但需要驗證
   * - 確保 @connect 設定正確（userscript 標頭）
   *
   * 測試結果：
   * - ✅ 成功：狀態碼 200，回應長度 > 0
   * - ⚠️ 異常：狀態碼 200 但回應為空
   * - ❌ 失敗：請求錯誤或網絡問題
   *
   * 除錯資訊：
   * - Console 輸出：狀態碼、回應長度、回應前 500 字元
   * - Alert 對話框：測試結果摘要
   * - 進度顯示：實時狀態更新
   *
   * 注意：這是開發/除錯功能，正式使用時可以移除
   */
  async function testTmallCORS() {
    const testUrl =
      "https://trade.tmall.com/detail/orderDetail.htm?bizOrderId=4864583305858004803&route_to=tm1";

    updateProgress("正在測試天貓跨域請求...");
    console.log(`[測試] 準備請求天貓訂單詳情頁: ${testUrl}`);

    try {
      const response = await gmXhrRequest({
        method: "GET",
        url: testUrl,
      });

      console.log(`[測試] 請求成功！狀態碼: ${response.status}`);
      console.log(`[測試] 回應長度: ${response.responseText.length} 字元`);
      console.log(
        `[測試] 回應前 500 字元:`,
        response.responseText.substring(0, 500)
      );

      if (response.status === 200 && response.responseText.length > 0) {
        updateProgress(
          `✅ 天貓跨域測試成功！回應長度: ${response.responseText.length} 字元`
        );
        alert(
          `✅ 天貓跨域請求成功！\n\n狀態碼: ${response.status}\n回應長度: ${response.responseText.length} 字元\n\n詳細內容請查看控制台 (F12)`
        );
      } else {
        updateProgress(
          `⚠️ 天貓跨域測試異常：狀態碼 ${response.status}，回應為空`
        );
        alert(
          `⚠️ 請求成功但回應異常\n\n狀態碼: ${response.status}\n回應長度: ${response.responseText.length}`
        );
      }
    } catch (error) {
      console.error(`[測試] 天貓跨域請求失敗:`, error);
      updateProgress(`❌ 天貓跨域測試失敗: ${error.message}`);
      alert(
        `❌ 天貓跨域請求失敗！\n\n錯誤訊息: ${error.message}\n\n請查看控制台獲取詳細資訊`
      );
    }
  }

  /**
   * 【自訂功能占位符】
   * 用途：預留的自訂功能按鈕，可以綁定任何需要的功能
   *
   * 使用建議：
   * - 快速測試新功能
   * - 臨時除錯代碼
   * - 個人化功能擴展
   *
   * 範例用途：
   * 1. 測試新的 API 請求
   * 2. 驗證資料處理邏輯
   * 3. 檢查 localStorage 狀態
   * 4. 匯出特定格式（JSON, Excel 等）
   * 5. 批量修改訂單資料
   *
   * 修改方式：
   * - 直接在此函數中編寫代碼
   * - 或呼叫其他自訂函數
   */
  function customFunction() {
    updateProgress("執行自訂功能...");
    console.log("[自訂功能] 這是一個占位符函數，你可以在這裡添加任何功能！");
    alert(
      "這是自訂功能按鈕！\n\n你可以在 customFunction() 中添加任何你需要的功能。"
    );
  }

  /**
   * 【綁定事件監聽器】
   * 用途：將按鈕點擊事件與對應的處理函數連接
   *
   * 事件綁定：
   * - kilo-fetch-btn → startFetchingProcess（抓取資料）
   * - kilo-clear-btn → clearAllOrders（清除資料）
   * - kilo-download-btn → downloadCSV（下載 CSV）
   * - kilo-test-tmall-btn → testTmallCORS（測試跨域）
   * - kilo-custom-btn → customFunction（自訂功能）
   *
   * 技術要點：
   * - addEventListener：DOM 標準事件綁定方法
   * - getElementById：透過 ID 獲取 DOM 元素
   * - click 事件：用戶點擊按鈕時觸發
   *
   * 執行時機：
   * - main() 函數中呼叫
   * - 在 createUI() 之後執行（確保元素已存在）
   */
  function bindEventListeners() {
    document
      .getElementById("kilo-fetch-btn")
      .addEventListener("click", startFetchingProcess);
    document
      .getElementById("kilo-clear-btn")
      .addEventListener("click", clearAllOrders);
    document
      .getElementById("kilo-download-btn")
      .addEventListener("click", downloadCSV);
    document
      .getElementById("kilo-test-tmall-btn")
      .addEventListener("click", testTmallCORS);
    document
      .getElementById("kilo-custom-btn")
      .addEventListener("click", customFunction);
  }

  /**
   * 【Userscript 主函式】
   * 用途：初始化整個工具，在頁面載入完成後執行
   *
   * 初始化流程：
   * 1. 建立 UI 介面（createUI）
   * 2. 綁定事件監聽器（bindEventListeners）
   * 3. 從 localStorage 載入已保存的訂單
   * 4. 更新 UI 顯示訂單數量
   * 5. 如果有訂單資料，啟用下載按鈕
   *
   * 執行時機：
   * - window.addEventListener("load", main)
   * - 頁面完全載入後執行（包括圖片、樣式等）
   *
   * 為什麼使用 load 事件？
   * - 確保淘寶頁面的 DOM 已完全建立
   * - 避免找不到注入目標容器（J_bought_main）
   * - 確保淘寶的 window.data 變數已定義
   *
   * 技術要點：
   * - IIFE（Immediately Invoked Function Expression）：立即執行函數表達式
   * - 整個 userscript 包裹在 (function() { ... })() 中
   * - 避免污染全局命名空間
   * - "use strict"：嚴格模式，避免常見錯誤
   *
   * Userscript 生命週期：
   * 1. 瀏覽器載入淘寶訂單頁面
   * 2. Violentmonkey 注入此 userscript
   * 3. IIFE 立即執行，註冊 load 事件監聽器
   * 4. 頁面載入完成，觸發 load 事件
   * 5. 執行 main() 函數
   * 6. 工具初始化完成，等待用戶操作
   */
  function main() {
    console.log("淘寶訂單匯出工具已啟動！");
    createUI();
    bindEventListeners();

    // 從 localStorage 載入已保存的訂單
    allOrders = StorageManager.loadOrders();
    updateOrderCount(); // 更新 UI 顯示訂單數量

    // 如果有已保存的訂單，啟用下載按鈕
    if (allOrders.length > 0) {
      document.getElementById("kilo-download-btn").disabled = false;
      updateProgress(`已從緩存載入 ${allOrders.length} 筆訂單`);
    }
  }

  // 當頁面完全載入後，執行主函式
  window.addEventListener("load", main);
})();
