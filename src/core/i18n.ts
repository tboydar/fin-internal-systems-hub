import type { L10n, Lang } from './types';

// 雙語的寫法：中文與英文就地寫成一對，T('重送 {n} 筆', 'Resend {n} {n|record|records}', { n })。
// 兩個參數都是必填，所以少翻一邊在編譯時就會報錯；文字就在用到它的地方，不必對照字典的 key。
// 取捨寫在 docs/adr/0005-inline-bilingual-text.md。

let lang: Lang = 'zh';

export function setLang(next: Lang): void {
  lang = next;
  document.documentElement.lang = next === 'zh' ? 'zh-Hant' : 'en';
}

export function getLang(): Lang {
  return lang;
}

export type Vars = Record<string, string | number>;

/**
 * 代入 {name} 形式的變數。
 * 英文的單複數寫成 {n|record|records}：n 是 1 用前者，否則用後者。
 */
function fill(text: string, vars?: Vars): string {
  if (!vars) return text;
  let out = text.replace(/\{(\w+)\|([^|}]*)\|([^}]*)\}/g, (_m, name: string, one: string, many: string) => (Number(vars[name]) === 1 ? one : many));
  for (const [key, value] of Object.entries(vars)) out = out.split(`{${key}}`).join(String(value));
  return out;
}

/** 介面文字：依目前語言回傳其中一邊。 */
export function T(zh: string, en: string, vars?: Vars): string {
  return fill(lang === 'zh' ? zh : en, vars);
}

/** 取 mock data 或使用者輸入的雙語文字。 */
export function tx(text: L10n | undefined | null, vars?: Vars): string {
  if (!text) return '';
  return fill(text[lang] ?? text.zh ?? '', vars);
}

/** 建立一段雙語文字。 */
export const L = (zh: string, en: string): L10n => ({ zh, en });

/** 使用者輸入的內容沒有翻譯，兩種語言放同一段文字。 */
export function plain(text: string): L10n {
  return { zh: text, en: text };
}
