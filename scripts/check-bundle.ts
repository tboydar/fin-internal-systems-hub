// 建置後的大小檢查。執行：bun run build && bun run check:bundle
//
// 兩件事：
//   1. 首屏會下載的檔案（index.html 直接引用的 JS、CSS 與它們靜態 import 的 chunk）不能超過預算。
//   2. 首屏的檔案裡不能出現 3D 或流程圖的程式。它們只能在進到那一頁之後才下載。

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';

const DIST = 'dist';
/** gzip 之後的上限，單位是位元組。 */
// 首屏的 JS 包含整份假資料（24 條介面、10 條對帳規則的 SQL、文件與路徑圖的雙語文字），
// 因為它是這個 Demo 的「資料庫」，而且所有頁面讀同一份。扣掉資料，程式本身大約 25 kB。
const BUDGET = { initialJs: 90_000, initialCss: 12_000, anyChunk: 400_000 };
/** 只會出現在 three、xyflow、react-dom 裡的字串。 */
const HEAVY: [name: string, marker: RegExp][] = [
  ['three', /WebGLRenderer|THREE\.WebGL/],
  ['xyflow', /react-flow__|xyflow/],
  ['react-dom', /react-dom|__reactFiber/],
];

const read = (file: string) => readFileSync(join(DIST, file));
const gz = (file: string) => gzipSync(read(file)).length;
const kb = (bytes: number) => `${(bytes / 1000).toFixed(1)} kB`;

const index = read('index.html').toString();
const referenced = [...index.matchAll(/(?:src|href)="\.\/(assets\/[^"]+\.(?:js|css))"/g)].map((m) => m[1]);

// 從進入點沿著靜態 import 往下找（動態 import() 不算，那些是點到才下載的）
const initial = new Set<string>(referenced);
const queue = referenced.filter((f) => f.endsWith('.js'));
for (let file = queue.pop(); file; file = queue.pop()) {
  const code = read(file).toString();
  for (const match of code.matchAll(/(?:import|from)\s*"\.\/([^"]+\.js)"/g)) {
    const dep = `assets/${match[1]}`;
    if (!initial.has(dep)) {
      initial.add(dep);
      queue.push(dep);
    }
  }
}

const problems: string[] = [];
let js = 0;
let css = 0;
console.log('首屏會下載的檔案（gzip）');
for (const file of [...initial].sort()) {
  const size = gz(file);
  if (file.endsWith('.js')) js += size;
  else css += size;
  console.log(`  ${kb(size).padStart(9)}  ${file}`);
  if (file.endsWith('.js')) {
    const code = read(file).toString();
    for (const [name, marker] of HEAVY) if (marker.test(code)) problems.push(`首屏的 ${file} 裡有 ${name} 的程式；它應該延遲載入`);
  }
}
console.log(`  JS 合計 ${kb(js)}（上限 ${kb(BUDGET.initialJs)}）、CSS 合計 ${kb(css)}（上限 ${kb(BUDGET.initialCss)}）`);
if (js > BUDGET.initialJs) problems.push(`首屏 JS ${kb(js)} 超過上限 ${kb(BUDGET.initialJs)}`);
if (css > BUDGET.initialCss) problems.push(`首屏 CSS ${kb(css)} 超過上限 ${kb(BUDGET.initialCss)}`);

console.log('\n其餘 chunk（點到才下載，gzip）');
for (const name of readdirSync(join(DIST, 'assets')).sort()) {
  const file = `assets/${name}`;
  if (initial.has(file) || !/\.(js|css)$/.test(name)) continue;
  const size = gz(file);
  console.log(`  ${kb(size).padStart(9)}  ${file}`);
  if (size > BUDGET.anyChunk) problems.push(`${file} ${kb(size)} 超過單一 chunk 上限 ${kb(BUDGET.anyChunk)}`);
}

if (problems.length) {
  console.error(`\n大小檢查沒過：\n  ${problems.join('\n  ')}`);
  process.exit(1);
}
console.log('\n大小檢查通過');
