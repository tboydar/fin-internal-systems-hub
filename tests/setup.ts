import { GlobalRegistrator } from '@happy-dom/global-registrator';

// 單元測試在 bun 裡執行，沒有瀏覽器。store 會讀寫 localStorage、i18n 會設定 <html lang>，
// 所以先用 happy-dom 註冊一組瀏覽器全域物件。
GlobalRegistrator.register({ url: 'http://localhost/' });
