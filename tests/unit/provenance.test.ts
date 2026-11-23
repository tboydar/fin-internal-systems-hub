import { describe, expect, test } from 'bun:test';
import { Glob } from 'bun';
import { collectNames } from '../../scripts/mock-names';

// 驗收：全站找不到真實機構、真實廠商、真實人名；網站不對外連線。
// 站上的每一筆資料都寫在 src/mock/ 裡，這裡確認它沒有別的來源，也送不出去。

const SRC = new URL('../../src/', import.meta.url).pathname;

async function sourceFiles(): Promise<{ path: string; text: string }[]> {
  const files: { path: string; text: string }[] = [];
  for await (const path of new Glob('**/*.{ts,tsx,css}').scan({ cwd: SRC })) files.push({ path, text: await Bun.file(SRC + path).text() });
  return files;
}

// 最後一次用 `bun run check:names` 查核過的名稱。
// 假資料新增或改了名稱，這個測試就會失敗：先跑 check:names，確認沒有同名，再更新這份清單。
const CHECKED_NAMES = {
  orgsZh: ['稜川金融', '嶼衡資訊', '槿川科技', '櫟安軟體', '泓嶼系統'],
  orgsEn: ['Northmere Financial', 'Birchlight Systems', 'Elmhaven Technologies', 'Oakrest Software', 'Tidefield Systems'],
  peopleZh: [
    '褚以衡',
    '鄔承叡',
    '滕語菲',
    '蒲宥廷',
    '甘書妍',
    '晏柏諺',
    '麥芷瑄',
    '闕定寰',
    '桑以柔',
    '殷仲凱',
    '鄺文琦',
    '池婉寧',
    '卓承鈞',
    '鈕昱辰',
    '聶家瑜',
  ],
  peopleEn: [
    'Yi-Heng Chu',
    'Cheng-Jui Wu',
    'Yu-Fei Teng',
    'Yu-Ting Pu',
    'Shu-Yen Kan',
    'Po-Yen Yen',
    'Chih-Hsuan Mai',
    'Ting-Huan Chueh',
    'Yi-Jou Sang',
    'Chung-Kai Yin',
    'Wen-Chi Kuang',
    'Wan-Ning Chih',
    'Cheng-Chun Cho',
    'Yu-Chen Niu',
    'Chia-Yu Nieh',
  ],
};

// 站上唯一允許出現的網址：關於頁的作者與原始碼連結。
const ALLOWED_URLS = ['https://github.com/tboydar', 'https://github.com/tboydar/fin-internal-systems-hub'];

describe('資料來源', () => {
  test('假資料裡的組織名與人名，就是查核過的那一批', () => {
    expect(collectNames()).toEqual(CHECKED_NAMES);
  });

  test('網站的程式除了作者連結以外沒有任何網址', async () => {
    const files = await sourceFiles();
    expect(files.length).toBeGreaterThan(15);
    const found = files.flatMap((f) => (f.text.match(/https?:\/\/[^\s'"`)]+/g) ?? []).map((url) => `${f.path} ${url}`));
    expect(found.filter((entry) => !ALLOWED_URLS.includes(entry.split(' ')[1]))).toEqual([]);
  });

  test('網站的程式不使用連線、Cookie 或定位的 API', async () => {
    const banned = /\bfetch\s*\(|XMLHttpRequest|WebSocket|EventSource|sendBeacon|document\.cookie|indexedDB|navigator\.geolocation/;
    expect((await sourceFiles()).filter((f) => banned.test(f.text)).map((f) => f.path)).toEqual([]);
  });
});
