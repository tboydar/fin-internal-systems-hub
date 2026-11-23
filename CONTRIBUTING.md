# 怎麼改這個 repo

## 開始之前

```bash
bun install
bun run dev
```

送出之前跑一次：

```bash
bun run check                          # 型別檢查、lint、單元測試
bun run build && bun run check:bundle  # 首屏大小
bun run test:e2e                       # 瀏覽器冒煙測試
```

CI 跑的是同一組。任何一步沒過就不會部署。

## 分支

- `main` 永遠是能部署的狀態。推上去就會上線。
- 其他工作開短分支，名稱用 `<類型>/<內容>`，例如 `feat/vendor-penalty`、`fix/freeze-holiday`。
- 分支活不過三天。做不完就拆小。

## Commit

- 一個 commit 做一件事。訊息第一行寫「類型：做了什麼」，中文。
- 類型：`feat`、`fix`、`test`、`docs`、`refactor`、`ci`、`chore`。
- 第二段寫為什麼，或這次改動帶來的限制。不要只重複第一行。
- 每個 commit 各自 push。版號是「台灣日期＋當天第幾次 CI」，所以每個 commit 版號加一。

## 改資料

- 假資料只改 `src/mock/`。畫面上的數字不要直接寫，去改背後的事實（見 `docs/adr/0003-mock-data-consistency.md`）。
- 資料結構有不相容的變更，把 `src/mock/index.ts` 的 `STATE_VERSION` 加一。
- 新增或改了機構、廠商、人名：先跑 `bun run check:names`，確認沒有同名，再更新 `tests/unit/provenance.test.ts` 裡的清單。
- 不要用真實的公司、產品或人名。

## 寫畫面

- 文字用 `T('中文', 'English')` 成對寫，兩邊都要。
- 按鈕寫動作（「重送 37 筆」），提示寫後果。空狀態要寫為什麼是空的。
- 需要權限的按鈕用 `actionBtn({ perm })`：沒有權限時顯示成上鎖並說明原因，不要藏起來。
- 狀態一律是形狀＋顏色＋文字（`mark()`），不要只靠顏色。
- 新的頁面在 `src/ui/shell.ts` 的 `PAGES` 加一行，並配一個 `page.*` 權限。
- 流程圖與 3D 只能用動態 `import()` 載入。`check:bundle` 會擋下把它們帶進首屏的改動。

## 設計決定寫在哪

`docs/adr/`。改了其中任何一個決定，新增一份 ADR 說明為什麼，不要直接改舊的。
