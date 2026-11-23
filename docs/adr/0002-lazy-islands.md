# ADR 0002：流程圖與 3D 做成延遲載入的「島」

- 狀態：已採用
- 日期：2026-11-24

## 背景

需要兩個大的函式庫：`@xyflow/react`（連同 React，gzip 約 156 kB）與 `three`（約 143 kB）。
大部分的頁面是表格，用不到它們。不懂技術的主管用公司的舊筆電開，首屏要快。

## 決定

- 介面本身是原生 TypeScript：一個會自動跳脫的 `html` 樣板（`src/ui/dom.ts`），資料變了就重畫那一塊。沒有前端框架。
- 流程圖是一座 React 島（`src/flow/FlowIsland.tsx`）。頁面交給它節點與連線的純資料，拿回 `{ update, destroy }`，不需要知道 React 存在。
- 3D 場景是另一座島（`src/three/twin.ts`），介面一樣是 `{ update, dispose }`。
- 兩座島都用動態 `import()` 載入，各自一個 chunk；每一頁也各自一個 chunk。

## 代價

- 島裡的狀態（節點被拖到哪、鏡頭轉到哪）跟外面是兩個世界，要靠 `update()` 把資料送進去、靠 callback 把點擊送出來。
- 第一次進到有流程圖或 3D 的頁面會多等一下，所以有「載入中」的文字，載入失敗也有說明。

## 怎麼守住

`scripts/check-bundle.ts` 在每次建置後檢查：首屏會下載的檔案裡不能出現 three、xyflow、react-dom 的程式，
而且首屏的 JS 不能超過 90 kB（gzip）。這個上限包含整份假資料；扣掉資料，程式本身大約 25 kB。
