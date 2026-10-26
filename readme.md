# Taobao Order Exporter v3

[繁體中文](README_zh-Hant.md) · [Install / update userscript](https://github.com/DF-wu/taobaoOrderExporter/raw/main/taobaoOrderExporter.user.js)

Export Taobao purchase history and tracking information into one **XLSX** or structured **JSON** file. The script reads the current order APIs directly instead of automating the official export dialog. It has no built-in ten-page limit and retrieves tracking for orders awaiting receipt.

## Usage

1. Install Tampermonkey or Violentmonkey in your browser, then install or update the linked userscript.
2. Sign in and open [Purchased orders](https://buyertrade.taobao.com/trade/itemlist/list_bought_items.htm).
3. Use the panel at the bottom right. Select an order category and starting page. Leave the ending page blank to continue until the final page. Requests default to a **5-second** interval, adjustable from 2 to 120 seconds.
4. Start collection. Download XLSX or JSON when ready; downloads also work during collection.
5. Review unresolved logistics in the panel and the exported `Errors` sheet / array.

The script uses the list's package data, the API behind **View logistics**, and the order detail API. It follows every package tab when the logistics page returns multiple packages. Company names, tracking numbers, available item relationships and provenance are preserved separately.

Enable the optional tracking history checkbox to query events for orders whose numbers are already available. Tracking numbers and companies are included by default.

## Resuming and refreshing

- Stop preserves orders and the checkpoint in IndexedDB. Resume continues from the unfinished page after reloading or reopening the page.
- Orders are deduplicated by their string IDs. New runs merge into existing records; they do not remove orders outside the selected range.
- Retry logistics revisits orders with unresolved logistics (pending, partial, failed or with an error) **and orders that had not shipped yet** when collected. It rereads each order's source page for the latest status. If the order is no longer there (new purchases shifted the pages, or it left the filtered tab after shipping), it queries logistics directly by order ID instead of asking you to rerun the range. If the source page shows a new status (for example `交易关闭`), the order is handled like a fresh collection. Failures never erase known tracking numbers. A failed direct lookup never downgrades the record (`not_shipped` stays `not_shipped`, complete tracking stays complete) and records the reason in Errors. Network or format errors while rereading a page stop the retry instead of trying every order.
- Login, verification and rate-limit responses pause collection. The panel provides an official verification link when available. Resolve it on Taobao, then resume or retry logistics.
- Clear local data removes this tool's records for the current account after confirmation. Download a backup first.

When repeating a collection, complete tracking is reused without new requests for orders whose status is still `交易成功` or `交易关闭` (finished trades), except that tracking history is reread when its checkbox is enabled. Other statuses reuse results for up to one hour. Unshipped and failed results are refreshed. When the list returns incomplete packages, previously known tracking numbers are merged in first: a failed refresh marks the order `partial` with the error, and a stopped one leaves it `pending` until you resume or retry. Neither clears known tracking numbers. Starting a new range asks before replacing an unfinished checkpoint. A browser lock prevents simultaneous collection or deletion by another tab for the same account.

### Which button after logistics updates?

| Situation | Action |
| --- | --- |
| The order had not shipped or had no logistics last time; tracking is available now | **Retry logistics**. It only touches unfinished orders and still works after pagination shifts. |
| Tracking numbers are known; you want fresh in-transit events | Check the tracking-history box, choose the 待收貨 tab, then **Start**. |
| You also want updated trade status, items or new orders | **Start** the same range again; complete logistics of finished trades is reused. |
| Collection stopped or needed verification | **Resume**. |

The logistics API has no trade status, so a direct lookup by order ID keeps the order status text from the last list read. Rerun the range when you need the current status.

List, logistics, detail and network retry requests share the selected interval and run sequentially. The setting is saved with the checkpoint and can be changed before resuming. Rate-limit and verification responses pause immediately without automatic retries. Taobao's limits may still vary by account and time; increase the interval before continuing if needed.

## Files and privacy

XLSX contains `Orders`, `Items`, `Packages`, `Errors`, and `Metadata`. IDs and cells are stored as text to preserve leading zeroes and long numbers and prevent product titles from becoming Excel formulas. Convert monetary and quantity columns to numbers when doing calculations. JSON keeps the nested structure without Excel's cell limits. See the [data format](docs/data-format.md).

No CDN or runtime dependencies are required. The script keeps data in account-specific local IndexedDB databases and downloads; it does not upload records to third parties or export authentication cookies or recipient addresses. Tracking descriptions may contain carrier contact information.

Keep the page open and the account signed in. Browser sleep or tab freezing pauses execution. Pagination reflects the order list at the time of collection, so new purchases can move records between pages. Available history still depends on what Taobao serves to your account.

## Development

```sh
node --check taobaoOrderExporter.user.js
node --test tests/exporter.test.cjs
```

Tests require Node 24 and Python 3, with no npm dependencies. Synthetic fixtures cover multi-package orders, exact IDs, collection beyond ten pages, checkpoint recovery, logistics refresh after shipping or pagination shifts, validation failures, storage errors, JSON, and independent ZIP/XML verification of XLSX output.

Current API baseline: October 15, 2026. The script uses the page's own MTOP SDK and reports unexpected response formats rather than silently exporting missing logistics.
