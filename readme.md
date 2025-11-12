# Taobao Order Exporter Userscript

<div align="center">

[**English**](./readme.md) | [**繁體中文**](./README_zh-Hant.md)

</div>

<p align="center">
  <img src="https://img.shields.io/badge/Version-1.0-blue.svg" alt="Version">
  <img src="https://img.shields.io/badge/License-MIT-green.svg" alt="License">
  <img src="https://img.shields.io/badge/Tampermonkey-✅-brightgreen.svg" alt="Tampermonkey Compatible">
  <img src="https://img.shields.io/badge/Violentmonkey-✅-brightgreen.svg" alt="Violentmonkey Compatible">
  <img src="https://img.shields.io/badge/code%20style-prettier-ff69b4.svg" alt="Code Style: Prettier">
</p>

A powerful userscript designed for bulk exporting order data from Taobao/Tmall's "My Orders" page. It can scrape detailed information including product names, prices, quantities, SKUs, seller details, and even **tracking numbers**, then export it all into an Excel-compatible CSV file.

This script is specially optimized for Taobao's complex front-end environment, tackling common technical challenges like **CORS**, **GBK encoding issues**, and **API anti-scraping mechanisms**.

---

### ✨ Key Features

-   **One-Click Scraping**: Injects a control panel directly onto the "My Orders" page for easy operation.
-   **Batch Processing**: Supports custom page ranges for automated multi-page scraping.
-   **Tracking Info Retrieval**: Automatically visits each order's detail page to fetch the logistics company and tracking number.
-   **Persistent Storage**: Scraped data is saved in the browser's `localStorage`, so you won't lose progress even if you close the page.
-   **Smart Deduplication**: Automatically merges data and removes duplicate entries when run multiple times.
-   **Excel-Friendly**: The exported CSV includes a BOM header, ensuring Chinese characters display correctly in Excel without garbling.
-   **High Compatibility**: Supports both Taobao and Tmall order formats.

### 🚀 Installation & Usage

#### Step 1: Install a Userscript Manager

You need a userscript manager extension in your browser. We recommend one of the following:

-   [**Tampermonkey**](https://www.tampermonkey.net/) (Supports Chrome, Firefox, Edge, Safari)
-   [**Violentmonkey**](https://violentmonkey.github.io/) (Supports Chrome, Firefox, Edge)

#### Step 2: Install This Script

1.  Click here to install: [**taobaoOrderExporter.user.js**](https://github.com/DF-wu/taobaoOrderExporter/raw/main/taobaoOrderExporter.user.js)
2.  Your userscript manager will open an installation page.
3.  Click the "Install" button.

#### Step 3: Get Started

1.  After installation, open the Taobao website and log in.
2.  Navigate to the "**My Orders**" page (`https://buyertrade.taobao.com/trade/itemlist/list_bought_items.htm`).
3.  You will see a new control panel injected by this script **directly above** your order list.

    *(A GIF demonstrating the script in action. You need to upload a `demo.gif` to the `assets` folder in your repository for this to work.)*
    ![Script Demo GIF](https://github.com/DF-wu/taobaoOrderExporter/blob/main/assets/demo.gif?raw=true)

4.  **How to use**:
    -   Set the desired page range in the "Start Page" and "End Page" input fields.
    -   Click the "**Start Fetching Orders**" button.
    -   The script will start running automatically. You can monitor the real-time progress in the "Status" area.
    -   Once finished, click the "**Download CSV**" button to save all scraped orders as a `.csv` file.

### 🛠️ Technical Highlights

This script overcomes several major obstacles in web scraping on Taobao:

1.  **Bypassing Anti-Scraping**: By injecting `fetch` requests into the page's own context (`unsafeWindow`), the requests carry the correct cookies and session tokens, mimicking normal user behavior and significantly reducing the risk of being blocked.
2.  **Solving CORS Issues**: Uses the privileged `GM_xmlhttpRequest` API provided by Tampermonkey to successfully request order detail pages from `tmall.com` while on the `taobao.com` domain.
3.  **Handling GBK Encoding**: Retrieves the raw `ArrayBuffer` from the `fetch` response and then decodes it using `TextDecoder('gbk')` to correctly handle Chinese characters.

### ⚠️ Disclaimer

-   This script is intended for personal educational and research purposes only.
-   Please use this script in compliance with Taobao's user agreement.
-   Excessive use may trigger Taobao's security mechanisms. It is recommended to scrape a reasonable number of pages at a time and to leave intervals between scraping sessions.
-   The author is not responsible for any direct or indirect consequences resulting from the use of this script.

### 📄 License

This project is licensed under the [MIT License](https://github.com/DF-wu/taobaoOrderExporter/blob/main/LICENSE).