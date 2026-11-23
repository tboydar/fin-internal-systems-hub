# 稜川金融 內部系統整合治理中心

應徵金融機構內部系統 Tech Lead 用的作品集 Demo，純前端。
它做成一套內部工具的樣子：ERP、CRM、人事薪資與簽呈系統之間的介面、對帳、廠商與變更，用同一份資料呈現給八種角色看。

線上版：https://tboydar.github.io/fin-internal-systems-hub/

**機構、廠商、產品、人名、工單、金額與事件全部虛構。** 沒有後端，沒有 API 金鑰，沒有追蹤碼，不呼叫任何外部服務。

![Tech Lead 看到的總覽](docs/screenshots/01-overview-techlead.png)

## 目前做到哪裡

| 里程碑 | 內容                                                       | 狀態   |
| ------ | ---------------------------------------------------------- | ------ |
| M1     | 骨架、資料模型、8 個角色、權限矩陣與職責分離檢查、自動部署 | 已上線 |
| M2     | 整合架構（拓撲圖）、資料一致性、劇本 A                     | 還沒做 |
| M3     | 3D 微縮總行，與架構圖共用同一份狀態                        | 還沒做 |
| M4     | 廠商管理、團隊與規範、技術路徑圖、需求與決策               | 還沒做 |
| M5     | 稽核、英文版校對、無障礙、效能、職缺要求對照表             | 還沒做 |

## 怎麼跑

需要 [bun](https://bun.sh)。

```bash
bun install
bun run dev        # 開發伺服器，http://localhost:5173
bun run build      # 型別檢查 ＋ 正式建置，輸出到 dist/
bun run preview    # 預覽建置結果
```

## 怎麼測

```bash
bun run check                        # 型別檢查 ＋ lint ＋ 單元測試
bun run build && bun run check:bundle   # 首屏大小與「3D、流程圖不進首屏」
bun run build && bun run test:e2e    # 瀏覽器冒煙測試（會自己啟動預覽伺服器）
bun run check:names                  # 查假名稱有沒有跟真實公司或人物同名，約 5 分鐘
```

- **單元測試**（`tests/unit/`，`bun test`）守資料規則：固定種子的決定性、介面的廠商與所屬系統的廠商一致、參照對得上、不全綠也不全紅、日期避開國定假日、權限矩陣與職責分離。
- **冒煙測試**（`tests/e2e/`，Playwright）：八個角色登入後選單上每一頁都開得起來、重新整理不會 404、英文介面沒有殘留中文、瀏覽器只向網站本身拿靜態檔案。
- 本機的冒煙測試直接用已安裝的 Chrome。沒有的話先 `bunx playwright install chromium`，再用 `CI=1 bun run test:e2e`。

## 角色

頁面最上面那一條是 **Demo 控制**，不屬於那套工具：可以切換登入身分、語言，或還原資料。
操作都存在瀏覽器的 `localStorage`，重新整理後還在。

| 角色         | 登入的人       | 看得到什麼                                      |
| ------------ | -------------- | ----------------------------------------------- |
| Tech Lead    | 褚以衡         | 全部；指派、核准發版、寫 1:1、做決策紀錄        |
| 內部工程師   | 鄔承叡         | 自己的任務、介面細節、Runbook、Code Review 佇列 |
| 委外廠商 PM  | 依選的廠商而定 | 只有自家系統的工單、SLA 與交付項                |
| 財務主管     | 鄺文琦         | 月結倒數、對帳差異、受影響的報表；沒有技術名詞  |
| 人資主管     | 池婉寧         | 到職、異動、薪資相關資料的狀態                  |
| 業務單位主管 | 卓承鈞         | CRM 需求進度與各據點狀態                        |
| 稽核         | 稽核室帳號     | 權限矩陣、稽核軌跡、變更紀錄；全部唯讀          |
| 系統管理員   | 系統管理員帳號 | 管理成員與權限矩陣                              |

## 怎麼加一條介面

1. 在 `src/mock/ifaces.ts` 的 `SPECS` 加一筆：編號、來源與目的系統、所屬系統與廠商、協定、排程、欄位對應、補償做法。
2. `own` 的廠商必須等於所屬系統的廠商，否則 `tests/unit/mock.test.ts` 會失敗。
3. 把 `src/mock/index.ts` 的 `STATE_VERSION` 加一，舊的 `localStorage` 會自動重建。
4. 跑 `bun run check`。執行紀錄會依排程與固定種子自動產生，不用手寫。

## 資料夾

```
├── .github/workflows/deploy.yml   型別檢查、lint、測試、建置、大小檢查、冒煙測試、部署
├── scripts/                       版號、名稱查核、大小檢查、截圖
├── tests/unit/                    資料規則（bun test）
├── tests/e2e/                     瀏覽器冒煙測試（Playwright）
└── src/
    ├── core/                      型別、store、權限、雙語、日期（台北時區與國定假日）、路由、推導資料
    ├── mock/                      假資料：系統、廠商、人、介面、執行紀錄；固定種子
    ├── ui/                        外殼、樣板與事件工具、圖示、共用元件
    ├── pages/                     各頁面，每頁一個 chunk
    └── styles/main.css            設計代碼與樣式
```

## 版號

每次建置帶一個版號 `v<台灣日期>.<當天第幾次 CI>`，例如 `v20261124.2`。
每個 commit 各自 push、各跑一次 CI，所以每個 commit 版號加一；失敗或被取消的那幾次也佔一個號碼，隔天從 1 開始。
顯示在每一頁的側欄底部與「關於這個 Demo」頁，也寫在 `index.html` 的 `<meta name="app-version">`：

```bash
curl -s https://tboydar.github.io/fin-internal-systems-hub/ | grep app-version
```

本機建置的版號是 `v<今天>.dev`。算法在 `scripts/app-version.ts`。

## 部署

推到 `main` 就會跑 `.github/workflows/deploy.yml`，任何一步失敗就不部署。
`vite.config.ts` 的 `base` 是相對路徑 `./`，路由用 hash（`#/overview`），所以 repo 改名或換子路徑都開得起來，重新整理也不會 404。

## 資料出處

- 國定假日：行政院人事行政總處 115 年與 116 年「政府行政機關辦公日曆表」（data.gov.tw 資料集 14718，2026-11-23 查詢）。寫在 `src/core/date.ts`。
- 其餘內容都是為這個 Demo 編的。名稱的查核範圍與限制寫在 `scripts/check-names.ts` 開頭。
