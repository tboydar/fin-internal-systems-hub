// 查核站上的假名稱有沒有剛好和真實的公司或知名人物同名。
// 執行：bun run check:names（會連到下列公開資料來源，約需 5 分鐘）
//
// 來源：
//   1. 經濟部商工登記公示資料，公司登記：查「名稱包含這兩個字」，官方代碼表的 33 種登記狀態全查
//   2. 經濟部商工登記公示資料，分公司登記（存活、非存活）
//   3. g0v 台灣公司資料：含公司登記與商業登記（行號），不分狀態
//   4. GLEIF 全球法人機構識別碼：英文組織名
//   5. Wikidata：所有名稱，查標籤或別名完全相同的項目
//   6. 中文維基百科：中文名稱，查內文出現這個詞的條目
//
// 沒查到的範圍：信用合作社與農漁會信用部不在公司登記裡；商標與國外的公司登記（GLEIF 以外）也沒查。
// 送出去的只有站上的虛構名稱。這套查核找的是「剛好同名」；站上的資料本來就全部是編的。

import { collectNames, coreOf, firstWord } from './mock-names';

const UA = { 'User-Agent': 'name-check/1.0 (portfolio demo verification)' };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function getJson(url: string, tries = 5): Promise<unknown | null> {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, { headers: UA, signal: AbortSignal.timeout(15000) });
      if (res.ok) {
        const text = (await res.text()).trim();
        return text === '' ? [] : JSON.parse(text);
      }
    } catch {
      // 逾時或暫時性錯誤：等一下再試
    }
    await sleep(2000 * (i + 1));
  }
  return null;
}

async function registry(keyword: string, status: string): Promise<string[] | null> {
  const filter = encodeURIComponent(`Company_Name like ${keyword} and Company_Status eq ${status}`);
  const rows = await getJson(`https://data.gcis.nat.gov.tw/od/data/api/6BBA2268-1367-4B42-9CCA-BC17499EBE8C?$format=json&$filter=${filter}&$skip=0&$top=50`, 3);
  if (!Array.isArray(rows)) return null;
  return (rows as { Company_Name: string; Company_Status_Desc: string }[]).map((c) => `${c.Company_Name}（${c.Company_Status_Desc}）`);
}

async function branchRegistry(keyword: string, status: '00' | '99'): Promise<string[] | null> {
  const filter = encodeURIComponent(`Branch_Office_Name like ${keyword} and Status_Type_Code eq ${status}`);
  const rows = await getJson(`https://data.gcis.nat.gov.tw/od/data/api/20B4A6C1-1C0C-4E80-91BA-6DF97D2D9FC9?$format=json&$filter=${filter}&$skip=0&$top=50`, 3);
  if (!Array.isArray(rows)) return null;
  return (rows as { Branch_Office_Name: string; Branch_Office_Status_Desc: string }[]).map((c) => `${c.Branch_Office_Name}（${c.Branch_Office_Status_Desc}）`);
}

async function g0vCompanies(keyword: string): Promise<string[] | null> {
  const j = (await getJson(`https://company.g0v.ronny.tw/api/search?q=${encodeURIComponent(keyword)}`)) as {
    data?: Record<string, unknown>[];
    found?: number;
  } | null;
  if (!j || !Array.isArray(j.data)) return null;
  const clean = (value: unknown) =>
    String(value ?? '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 24);
  const rows = j.data.map((d) => `${clean(d.公司名稱 ?? d.商業名稱)}（${clean(d.公司狀況 ?? d.登記現況)}）`);
  if ((j.found ?? rows.length) > rows.length) rows.push(`另有 ${(j.found ?? 0) - rows.length} 筆`);
  return rows;
}

async function gleif(name: string): Promise<string[] | null> {
  const j = (await getJson(`https://api.gleif.org/api/v1/lei-records?filter[entity.legalName]=${encodeURIComponent(name)}&page[size]=5`)) as {
    data?: { attributes: { entity: { legalName: { name: string } } } }[];
  } | null;
  return j?.data ? j.data.map((d) => d.attributes.entity.legalName.name) : null;
}

async function wikidata(name: string, lang: 'zh' | 'en'): Promise<string[] | null> {
  const j = (await getJson(
    `https://www.wikidata.org/w/api.php?action=wbsearchentities&format=json&limit=10&type=item&language=${lang}&uselang=${lang}&search=${encodeURIComponent(name)}`,
  )) as { search?: { id: string; label?: string; description?: string; match?: { text?: string } }[] } | null;
  if (!j?.search) return null;
  const same = (text?: string) => (text ?? '').toLowerCase() === name.toLowerCase();
  return j.search.filter((s) => same(s.label) || same(s.match?.text)).map((s) => `${s.id} ${s.label ?? ''}：${s.description ?? '無描述'}`);
}

async function zhWikipedia(name: string): Promise<string[] | null> {
  const j = (await getJson(
    `https://zh.wikipedia.org/w/api.php?action=query&format=json&list=search&srlimit=5&srsearch=${encodeURIComponent(`"${name}"`)}`,
  )) as {
    query?: { search: { title: string }[] };
  } | null;
  return j?.query ? j.query.search.map((s) => s.title) : null;
}

const { orgsZh, orgsEn, peopleZh, peopleEn } = collectNames();

// ── 對照組：用一般名詞查，每個來源都應該查得到東西。
// 查不到代表查詢本身壞了（例如被限流），後面的「0 筆」就不能當證據。刻意不用任何真實公司的名稱當關鍵字。
console.log('對照組（確認每個來源真的查得到東西）');
const controls: [string, string[] | null][] = [
  ['公司登記「金融」／核准設立', await registry('金融', '01')],
  ['公司登記「資訊」／解散', await registry('資訊', '04')],
  ['分公司登記「台北」／存活', await branchRegistry('台北', '00')],
  ['g0v 公司資料「資訊」', await g0vCompanies('資訊')],
  ['GLEIF「Financial Holding」', await gleif('Financial Holding')],
  ['Wikidata「銀行」', await wikidata('銀行', 'zh')],
  ['中文維基百科「金融控股公司」', await zhWikipedia('金融控股公司')],
];
for (const [label, rows] of controls) console.log(`  ${rows?.length ? '通過' : '失敗'}　${label}（${rows ? rows.length : '查詢失敗'} 筆）`);
if (controls.some(([, rows]) => !rows || rows.length === 0)) {
  console.error('\n對照組沒有全部通過，無法驗證。請稍後再試。');
  process.exit(2);
}

const hits: string[] = [];
type Query = () => Promise<string[] | null>;
let failed: { label: string; query: Query }[] = [];
async function check(source: string, name: string, query: Query): Promise<string[] | null> {
  const rows = await query();
  if (rows === null) failed.push({ label: `${source}／${name}`, query });
  else for (const row of rows) hits.push(`${source}／${name} → ${row}`);
  return rows;
}
const STATUSES = Array.from({ length: 33 }, (_, i) => String(i + 1).padStart(2, '0'));

console.log(`\n中文組織名（${orgsZh.length} 個）：以自創的兩個字查公司登記 33 種狀態、分公司登記、g0v；以全名查 Wikidata、中文維基百科`);
for (const name of orgsZh) {
  const core = coreOf(name);
  let found = 0;
  for (const status of STATUSES) {
    found += (await check(`公司登記[${status}]`, core, () => registry(core, status)))?.length ?? 0;
    await sleep(350);
  }
  let branches = 0;
  for (const status of ['00', '99'] as const) {
    branches += (await check(`分公司登記[${status}]`, core, () => branchRegistry(core, status)))?.length ?? 0;
    await sleep(350);
  }
  const g0v = await check('g0v 公司資料', core, () => g0vCompanies(core));
  const wd = await check('Wikidata', name, () => wikidata(name, 'zh'));
  const wdCore = await check('Wikidata', core, () => wikidata(core, 'zh'));
  const wp = await check('中文維基百科', name, () => zhWikipedia(name));
  console.log(
    `  ${name}（${core}）：公司登記 ${found} 筆、分公司 ${branches} 筆、g0v ${g0v?.length ?? '待重試'} 筆、Wikidata ${(wd?.length ?? 0) + (wdCore?.length ?? 0)} 筆、維基百科 ${wp?.length ?? '待重試'} 篇`,
  );
}

console.log(`\n英文組織名（${orgsEn.length} 個）：GLEIF、Wikidata（全名與第一個字都查）`);
for (const name of orgsEn) {
  const word = firstWord(name);
  const g = await check('GLEIF', name, () => gleif(name));
  const gw = await check('GLEIF', word, () => gleif(word));
  const wd = await check('Wikidata', name, () => wikidata(name, 'en'));
  console.log(`  ${name}：GLEIF ${(g?.length ?? 0) + (gw?.length ?? 0)} 筆、Wikidata ${wd?.length ?? '待重試'} 筆`);
  await sleep(800);
}

console.log(`\n中文人名（${peopleZh.length} 個）：Wikidata、中文維基百科`);
for (const name of peopleZh) {
  const wd = await check('Wikidata', name, () => wikidata(name, 'zh'));
  const wp = await check('中文維基百科', name, () => zhWikipedia(name));
  console.log(`  ${name}：Wikidata ${wd?.length ?? '待重試'} 筆、維基百科 ${wp?.length ?? '待重試'} 篇`);
  await sleep(800);
}

console.log(`\n英文人名（${peopleEn.length} 個）：Wikidata`);
for (const name of peopleEn) {
  const wd = await check('Wikidata', name, () => wikidata(name, 'en'));
  console.log(`  ${name}：Wikidata ${wd?.length ?? '待重試'} 筆`);
  await sleep(800);
}

for (let round = 1; round <= 3 && failed.length; round++) {
  console.log(`\n重試第 ${round} 輪：${failed.length} 個查詢`);
  await sleep(20000);
  const pending = failed;
  failed = [];
  for (const item of pending) {
    const rows = await item.query();
    if (rows === null) failed.push(item);
    else {
      for (const row of rows) hits.push(`${item.label} → ${row}`);
      console.log(`  ${item.label}：${rows.length} 筆`);
    }
    await sleep(1500);
  }
}

console.log('\n── 結果');
console.log(`名稱總數：${orgsZh.length + orgsEn.length + peopleZh.length + peopleEn.length}`);
console.log(`查詢失敗：${failed.length}${failed.length ? `\n  ${failed.map((f) => f.label).join('\n  ')}` : ''}`);
console.log(`命中：${hits.length}${hits.length ? `\n  ${hits.join('\n  ')}` : ''}`);
process.exit(hits.length ? 1 : failed.length ? 2 : 0);
