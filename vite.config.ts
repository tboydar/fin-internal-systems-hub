import { defineConfig } from 'vite';
import { formatVersion, resolveCommit, resolveVersion } from './scripts/app-version.ts';

// GitHub Pages 把網站放在 https://<user>.github.io/<repo>/ 這個子路徑。
// base 用相對路徑 './'，路由用 hash（#/overview），所以 repo 改名或換子路徑都開得起來，重新整理也不會 404。
//
// 版號（v<台灣日期>.<當天第幾次 CI>）與 commit 在建置時寫進程式，也寫進 index.html 的 <meta>：
//   curl -s <網址> | grep app-version
export default defineConfig(async ({ command }) => {
  // 只有建置時才去問 CI 這是當天第幾次；開發伺服器與預覽都用本機的版號
  const version = command === 'build' ? await resolveVersion() : formatVersion(new Date(), 'dev');
  const commit = resolveCommit();
  return {
    base: process.env.VITE_BASE || './',
    define: {
      __APP_VERSION__: JSON.stringify(version),
      __APP_COMMIT__: JSON.stringify(commit),
    },
    plugins: [
      {
        name: 'app-version-meta',
        transformIndexHtml: () => [
          { tag: 'meta', attrs: { name: 'app-version', content: version }, injectTo: 'head' as const },
          { tag: 'meta', attrs: { name: 'app-commit', content: commit }, injectTo: 'head' as const },
        ],
      },
    ],
    build: {
      target: 'es2022',
      chunkSizeWarningLimit: 900,
    },
  };
});
