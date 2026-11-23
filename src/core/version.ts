// 版號與 commit 在建置時寫入（見 vite.config.ts）。
// 單元測試不經過 Vite，沒有這兩個常數，所以先用 typeof 檢查。

/** 例如 v20261123.3：台灣日期，加上當天第幾次 CI。 */
export const APP_VERSION: string = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : 'dev';

/** 這一版對應的 commit（前 7 碼）。 */
export const APP_COMMIT: string = typeof __APP_COMMIT__ === 'string' ? __APP_COMMIT__ : '';
