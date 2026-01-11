// ==UserScript==
// @name         淘寶訂單批量導出工具 (官方功能自動化)
// @namespace    http://tampermonkey.net/
// @version      2.0
// @description  自動點擊淘寶官方的「批量導出」按鈕，並自動翻頁下載多頁訂單。
// @author       df
// @match        https://buyertrade.taobao.com/trade/itemlist/list_bought_items.htm*
// @grant        GM_download
// @license      MIT
// ==/UserScript==

(function () {
  "use strict";

  // ═════════════════════════════════════════════════════════════════════════
  //                           配置設定 (可在此修改)
  // ═════════════════════════════════════════════════════════════════════════

  const CONFIG = {
    // 下載按鈕等待超時 (毫秒)
    DOWNLOAD_BTN_TIMEOUT: 10000,
    // SPA 翻頁檢測間隔 (毫秒)
    SPA_CHECK_INTERVAL: 500,
    // SPA 翻頁檢測最大次數 (20次 * 500ms = 10秒)
    SPA_CHECK_MAX_ATTEMPTS: 20,
    // 翻頁後等待列表渲染的延遲 (毫秒)
    NEXT_PAGE_RENDER_DELAY: 2000,
    // 翻頁後繼續任務的延遲 (毫秒)
    NEXT_PAGE_TASK_DELAY: 3000,
    // 尋找下載按鈕的輪詢間隔 (毫秒) - 僅用於非 MutationObserver 的備用方案
    POLL_INTERVAL: 500,
    // 尋找下載按鈕的最大嘗試次數 - 僅用於非 MutationObserver 的備用方案
    MAX_POLL_ATTEMPTS: 60,
  };

  // ═════════════════════════════════════════════════════════════════════════
  //                           狀態管理
  // ═════════════════════════════════════════════════════════════════════════

  const AutoExportManager = {
    STATE_KEY: "kilo_auto_export_state",

    getState() {
      try {
        return JSON.parse(localStorage.getItem(this.STATE_KEY));
      } catch (e) {
        return null;
      }
    },

    setState(state) {
      localStorage.setItem(this.STATE_KEY, JSON.stringify(state));
    },

    clearState() {
      localStorage.removeItem(this.STATE_KEY);
    },
  };

  // ═════════════════════════════════════════════════════════════════════════
  //                               UI 生成
  // ═════════════════════════════════════════════════════════════════════════

  function createUI() {
    // 嘗試多個可能的容器選擇器
    const selectors = [
      "#J_bought_main",
      ".trade-main-content",
      ".trade-content-container",
      "#__ultron_rootContainer_node",
    ];

    let targetContainer = null;
    for (const selector of selectors) {
      targetContainer = document.querySelector(selector);
      if (targetContainer) {
        console.log(`找到 UI 注入容器: ${selector}`);
        break;
      }
    }

    if (!targetContainer) {
      console.error("找不到目標容器，將 UI 注入到 body 作為備用方案");
      targetContainer = document.body;
    }

    // 檢查是否已存在面板，避免重複注入
    if (document.getElementById("kilo-exporter-panel")) {
      return;
    }

    // 創建主面板
    const panel = document.createElement("div");
    panel.id = "kilo-exporter-panel";
    panel.style.padding = "15px";
    panel.style.backgroundColor = "#fff";
    panel.style.border = "2px solid #FF5000"; // 淘寶橙
    panel.style.borderRadius = "8px";
    panel.style.marginBottom = "20px";
    panel.style.fontFamily = "Arial, sans-serif";
    panel.style.zIndex = "99999";
    panel.style.position = "relative";
    panel.style.boxShadow = "0 4px 12px rgba(0,0,0,0.1)";
    panel.style.maxWidth = "800px";
    panel.style.margin = "20px auto";

    // 標題
    const title = document.createElement("h3");
    title.textContent = "📦 淘寶訂單批量導出 (官方功能自動化)";
    title.style.margin = "0 0 15px 0";
    title.style.fontSize = "18px";
    title.style.color = "#333";
    title.style.textAlign = "center";
    title.style.borderBottom = "1px solid #eee";
    title.style.paddingBottom = "10px";
    panel.appendChild(title);

    // 操作區塊
    const controlsContainer = document.createElement("div");
    controlsContainer.style.display = "flex";
    controlsContainer.style.justifyContent = "center";
    controlsContainer.style.alignItems = "center";
    controlsContainer.style.gap = "20px";
    controlsContainer.style.flexWrap = "wrap";
    panel.appendChild(controlsContainer);

    // 頁碼輸入
    const pageInputStyle =
      "width: 80px; height: 32px; padding: 5px; border: 1px solid #ddd; border-radius: 4px; text-align: center; font-size: 14px; color: #333; background-color: #fff; line-height: normal;";

    const startPageContainer = document.createElement("div");
    startPageContainer.style.display = "flex";
    startPageContainer.style.alignItems = "center";
    startPageContainer.innerHTML = `
      <label style="font-weight: bold; margin-right: 5px; color: #333;">起始頁:</label>
      <input type="number" id="kilo-start-page" min="1" value="1" style="${pageInputStyle}">
    `;

    const endPageContainer = document.createElement("div");
    endPageContainer.style.display = "flex";
    endPageContainer.style.alignItems = "center";
    endPageContainer.innerHTML = `
      <label style="font-weight: bold; margin-right: 5px; color: #333;">截止頁:</label>
      <input type="number" id="kilo-end-page" min="1" value="5" style="${pageInputStyle}">
    `;

    controlsContainer.appendChild(startPageContainer);
    controlsContainer.appendChild(endPageContainer);

    // 按鈕容器
    const btnContainer = document.createElement("div");
    btnContainer.style.display = "flex";
    btnContainer.style.gap = "10px";
    controlsContainer.appendChild(btnContainer);

    // 1. 下載本頁按鈕 (單頁)
    const currentBtn = document.createElement("button");
    currentBtn.textContent = "⬇️ 下載本頁";
    currentBtn.style.padding = "8px 15px";
    currentBtn.style.backgroundColor = "#1890ff"; // 藍色
    currentBtn.style.color = "white";
    currentBtn.style.border = "none";
    currentBtn.style.borderRadius = "20px";
    currentBtn.style.cursor = "pointer";
    currentBtn.style.fontSize = "14px";
    currentBtn.onclick = () => processOfficialExport(true); // true = 單頁模式
    btnContainer.appendChild(currentBtn);

    // 2. 批量導出按鈕 (多頁)
    const startButton = document.createElement("button");
    startButton.textContent = "🚀 批量自動導出";
    startButton.style.padding = "8px 20px";
    startButton.style.backgroundColor = "#FF5000";
    startButton.style.color = "white";
    startButton.style.border = "none";
    startButton.style.borderRadius = "20px";
    startButton.style.cursor = "pointer";
    startButton.style.fontSize = "16px";
    startButton.style.fontWeight = "bold";
    startButton.style.boxShadow = "0 2px 6px rgba(255, 80, 0, 0.3)";
    startButton.onclick = startOfficialAutomation;
    btnContainer.appendChild(startButton);

    // 3. 重置按鈕
    const resetButton = document.createElement("button");
    resetButton.textContent = "🛑 停止/重置";
    resetButton.style.padding = "8px 15px";
    resetButton.style.backgroundColor = "#666";
    resetButton.style.color = "white";
    resetButton.style.border = "none";
    resetButton.style.borderRadius = "20px";
    resetButton.style.cursor = "pointer";
    resetButton.style.fontSize = "14px";
    resetButton.onclick = () => {
      AutoExportManager.clearState();
      updateStatus("已強制停止任務，狀態已重置。");
      alert("✅ 狀態已清除，自動任務已停止。");
    };
    btnContainer.appendChild(resetButton);

    // 狀態顯示
    const statusDiv = document.createElement("div");
    statusDiv.id = "kilo-status";
    statusDiv.style.marginTop = "15px";
    statusDiv.style.padding = "10px";
    statusDiv.style.backgroundColor = "#f9f9f9";
    statusDiv.style.borderRadius = "4px";
    statusDiv.style.textAlign = "center";
    statusDiv.style.color = "#666";
    statusDiv.style.fontSize = "14px";
    statusDiv.textContent = "準備就緒，請輸入頁碼範圍並點擊開始。";
    panel.appendChild(statusDiv);

    // 注入面板
    if (targetContainer === document.body) {
      targetContainer.insertBefore(panel, targetContainer.firstChild);
    } else {
      targetContainer.prepend(panel);
    }
  }

  function updateStatus(text) {
    const statusDiv = document.getElementById("kilo-status");
    if (statusDiv) {
      statusDiv.textContent = text;
      statusDiv.style.color = "#FF5000";
      statusDiv.style.fontWeight = "bold";
    }
  }

  // ═════════════════════════════════════════════════════════════════════════
  //                            自動化邏輯
  // ═════════════════════════════════════════════════════════════════════════

  function startOfficialAutomation() {
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

    if (
      !confirm(
        `即將開始自動化操作：\n\n1. 自動點擊「導出訂單」\n2. 自動點擊「下載訂單」\n3. 自動翻頁\n\n範圍：第 ${startPage} 頁 至 第 ${endPage} 頁\n\n請確保您已位於第 ${startPage} 頁，或腳本將從當前頁面開始。`
      )
    ) {
      return;
    }

    // 初始化狀態
    AutoExportManager.setState({
      isActive: true,
      endPage: endPage,
      currentPage: startPage,
    });

    processOfficialExport();
  }

  async function processOfficialExport(isSinglePage = false) {
    // 如果是單頁模式，不需要讀取 state，直接執行
    let currentPage = 1;
    if (!isSinglePage) {
      const state = AutoExportManager.getState();
      if (!state || !state.isActive) return;
      currentPage = state.currentPage;
    }

    updateStatus(
      isSinglePage ? "正在下載本頁..." : `正在處理第 ${currentPage} 頁...`
    );

    // 1. 尋找並點擊「導出訂單」按鈕
    let exportBtn = Array.from(
      document.querySelectorAll(".trade-button, button, div[role='button']")
    ).find(
      (el) =>
        el.textContent.trim().includes("导出订单") && el.offsetParent !== null
    );

    if (!exportBtn) {
      exportBtn = Array.from(document.querySelectorAll("div, span, a")).find(
        (el) =>
          el.textContent.trim().includes("导出订单") && el.offsetParent !== null
      );
    }

    if (!exportBtn) {
      console.error("找不到「導出訂單」按鈕");
      updateStatus("錯誤：找不到「導出訂單」按鈕，請確認頁面是否加載完成。");
      alert("找不到「導出訂單」按鈕！");
      if (!isSinglePage) AutoExportManager.clearState();
      return;
    }

    exportBtn.click();
    console.log("已點擊「導出訂單」");
    updateStatus("已點擊導出，正在等待下載按鈕...");

    // 2. 使用 MutationObserver 監聽對話框出現，實現「秒點」
    const observer = new MutationObserver((mutations, obs) => {
      const downloadBtn = Array.from(
        document.querySelectorAll(
          ".ant-btn, button, a, div[role='button'], span"
        )
      ).find((el) => {
        const text = el.textContent.trim();
        return (
          (text === "下载订单" ||
            text === "确认下载" ||
            text.includes("下载Excel")) &&
          el.offsetParent !== null
        );
      });

      if (downloadBtn) {
        obs.disconnect(); // 停止監聽
        clearTimeout(timeoutId); // 清除超時計時器

        console.log("找到下載按鈕，立即點擊！");
        downloadBtn.click();
        updateStatus("✅ 已觸發下載！");

        if (!isSinglePage) {
          const delaySec = CONFIG.NEXT_PAGE_TASK_DELAY / 1000;
          updateStatus(
            `第 ${currentPage} 頁下載觸發成功，${delaySec}秒後翻頁...`
          );
          setTimeout(() => {
            const state = AutoExportManager.getState();
            if (state && state.isActive) {
              handlePagination(state);
            }
          }, CONFIG.NEXT_PAGE_TASK_DELAY);
        } else {
          updateStatus("✅ 本頁下載完成！");
        }
      }
    });

    // 開始監聽 body 變化
    observer.observe(document.body, { childList: true, subtree: true });

    // 設置超時保護 (10秒)
    const timeoutId = setTimeout(() => {
      observer.disconnect();
      console.error("等待下載按鈕超時");
      updateStatus("⚠️ 等待下載按鈕超時，請手動檢查。");
      if (!isSinglePage) {
        // 嘗試繼續翻頁
        const state = AutoExportManager.getState();
        if (state && state.isActive) handlePagination(state);
      }
    }, 10000);
  }

  function handlePagination(state) {
    if (state.currentPage >= state.endPage) {
      updateStatus("✅ 所有頁面導出完成！");
      alert("自動導出流程已完成！");
      AutoExportManager.clearState();
      return;
    }

    // 滾動到底部以確保分頁按鈕可見
    window.scrollTo(0, document.body.scrollHeight);

    setTimeout(() => {
      // 尋找「下一頁」按鈕
      // 優先使用 Ant Design 的 class 和 title 屬性
      // 修正：直接點擊 li 元素，不要點擊內部的 button，因為事件監聽器可能綁定在 li 上
      let nextBtn = document.querySelector(
        '.ant-pagination-next:not([aria-disabled="true"])'
      );

      // Fallback: 擴大搜尋範圍
      if (!nextBtn) {
        nextBtn = Array.from(
          document.querySelectorAll("button, a, li, span, div[role='button']")
        ).find((el) => {
          const text = el.textContent.trim();
          const ariaLabel = el.getAttribute("aria-label") || "";
          const title = el.getAttribute("title") || "";
          const className =
            typeof el.className === "string" ? el.className : "";

          // 排除已禁用的按鈕
          if (
            el.disabled ||
            el.classList.contains("disabled") ||
            el.getAttribute("aria-disabled") === "true"
          ) {
            return false;
          }

          return (
            (text.includes("下一页") ||
              text.includes("下一頁") ||
              text === "Next" ||
              text === ">" ||
              ariaLabel.includes("Next") ||
              ariaLabel.includes("下一页") ||
              title.includes("Next") ||
              title.includes("下一页") ||
              className.includes("next") ||
              className.includes("pagination-next")) &&
            el.offsetParent !== null
          );
        });
      }

      if (nextBtn) {
        updateStatus("正在翻到下一頁...");

        // 更新狀態
        state.currentPage++;
        AutoExportManager.setState(state);

        // 嘗試點擊
        nextBtn.click();

        // 雙重保險：如果是 li 且裡面有 button，也嘗試點擊 button (防止事件綁定在不同層級)
        if (nextBtn.tagName === "LI") {
          const innerBtn = nextBtn.querySelector("button");
          if (innerBtn) innerBtn.click();
        }

        console.log("已點擊「下一頁」");

        // SPA 翻頁檢測邏輯
        // 因為淘寶訂單頁面可能是 SPA (單頁應用)，點擊下一頁後不會重新加載頁面
        // 所以我們需要手動檢測頁面變化並繼續執行
        let checkAttempts = 0;
        const checkInterval = setInterval(() => {
          checkAttempts++;
          const activeItem = document.querySelector(
            ".ant-pagination-item-active"
          );
          const activePageNum = activeItem
            ? parseInt(activeItem.textContent.trim(), 10)
            : -1;

          // 如果當前激活的頁碼變成了我們預期的下一頁
          if (activePageNum === state.currentPage) {
            clearInterval(checkInterval);
            console.log("檢測到 SPA 翻頁成功，繼續執行導出...");
            updateStatus(`翻頁成功 (第 ${activePageNum} 頁)，準備導出...`);

            // 延遲一點時間讓列表渲染完成
            setTimeout(() => {
              processOfficialExport();
            }, CONFIG.NEXT_PAGE_RENDER_DELAY);
          } else if (checkAttempts > CONFIG.SPA_CHECK_MAX_ATTEMPTS) {
            // 超時
            clearInterval(checkInterval);
            console.warn("SPA 翻頁檢測超時，假設頁面已刷新或翻頁失敗");
            updateStatus("⚠️ SPA 翻頁檢測超時，請檢查是否已翻頁");
            // 如果超時，可能是因為頁面真的刷新了 (非 SPA)，那麼 main() 會接手
            // 或者翻頁失敗。這裡我們不做額外操作，避免重複執行。
          }
        }, CONFIG.SPA_CHECK_INTERVAL);
      } else {
        console.error("找不到「下一頁」按鈕");

        // Log 分頁容器內容以供調試
        const pagination = document.querySelector(
          ".pagination, .page-nav, .next-pagination, .ant-pagination"
        );
        if (pagination) {
          console.log("分頁容器內容:", pagination.innerHTML);
        } else {
          console.log("未找到標準分頁容器");
        }

        updateStatus("錯誤：找不到「下一頁」按鈕，請查看 Console");
        alert("找不到「下一頁」按鈕，自動化中止。");
        AutoExportManager.clearState();
      }
    }, 1000); // 延遲 1 秒等待滾動和渲染
  }

  // ═════════════════════════════════════════════════════════════════════════
  //                            主程式
  // ═════════════════════════════════════════════════════════════════════════

  function main() {
    console.log("淘寶訂單批量導出工具 v2.0 已啟動！");
    createUI();

    // 檢查是否處於自動匯出模式
    const autoState = AutoExportManager.getState();
    if (autoState && autoState.isActive) {
      console.log("檢測到自動匯出任務，繼續執行...");
      updateStatus(
        `檢測到自動任務，正在恢復第 ${autoState.currentPage} 頁的導出...`
      );
      // 延遲執行以確保頁面完全就緒
      setTimeout(processOfficialExport, CONFIG.NEXT_PAGE_TASK_DELAY);
    }
  }

  // 當頁面完全載入後，執行主函式
  if (
    document.readyState === "complete" ||
    document.readyState === "interactive"
  ) {
    setTimeout(main, 1000);
  } else {
    window.addEventListener("load", main);
  }
})();
