import { getLang, L } from './i18n';
import type { L10n } from './types';

// 日期與時間一律用台北時間（UTC+8，沒有日光節約），不看瀏覽器所在的時區。
// 「日」用 YYYY-MM-DD 字串表示，「時刻」用帶 +08:00 的 ISO 字串表示。

/** Demo 的「現在」。固定在月結前一個工作日的上午，所有假資料的時間都從這裡推算。 */
export const DEMO_NOW = '2026-11-27T10:30:00+08:00';

const OFFSET_MS = 8 * 3600_000;
const DAY_MS = 86_400_000;

/**
 * 平日放假的日子，2026 與 2027 兩年。
 * 來源：行政院人事行政總處 115 年與 116 年「政府行政機關辦公日曆表」（查詢日 2026-11-23，出處寫在 README）。
 * 這兩年都沒有補行上班日。2026 年的補假，官方資料只寫「補假」，所以這裡也不寫是補哪一天。
 */
const SUBSTITUTE = L('補假', 'Substitute holiday');
const HOLIDAYS: Record<string, L10n> = {
  '2026-01-01': L('開國紀念日', "New Year's Day"),
  '2026-02-16': L('農曆除夕', "Lunar New Year's Eve"),
  '2026-02-17': L('春節', 'Lunar New Year'),
  '2026-02-18': L('春節', 'Lunar New Year'),
  '2026-02-19': L('春節', 'Lunar New Year'),
  '2026-02-20': SUBSTITUTE,
  '2026-02-27': SUBSTITUTE,
  '2026-04-03': SUBSTITUTE,
  '2026-04-06': SUBSTITUTE,
  '2026-05-01': L('勞動節', 'Labor Day'),
  '2026-06-19': L('端午節', 'Dragon Boat Festival'),
  '2026-09-25': L('中秋節', 'Mid-Autumn Festival'),
  '2026-09-28': L('教師節', "Teachers' Day"),
  '2026-10-09': SUBSTITUTE,
  '2026-10-26': SUBSTITUTE,
  '2026-12-25': L('行憲紀念日', 'Constitution Day'),
  '2027-01-01': L('開國紀念日', "New Year's Day"),
  '2027-02-04': L('小年夜', 'Lunar New Year holiday'),
  '2027-02-05': L('農曆除夕', "Lunar New Year's Eve"),
  '2027-02-08': L('春節', 'Lunar New Year'),
  '2027-02-09': L('春節補假', 'Lunar New Year (observed)'),
  '2027-02-10': L('春節補假', 'Lunar New Year (observed)'),
  '2027-03-01': L('和平紀念日補假', 'Peace Memorial Day (observed)'),
  '2027-04-05': L('清明節', 'Tomb Sweeping Day'),
  '2027-04-06': L('兒童節補假', "Children's Day (observed)"),
  '2027-04-30': L('勞動節補假', 'Labor Day (observed)'),
  '2027-06-09': L('端午節', 'Dragon Boat Festival'),
  '2027-09-15': L('中秋節', 'Mid-Autumn Festival'),
  '2027-09-28': L('教師節', "Teachers' Day"),
  '2027-10-11': L('國慶日補假', 'National Day (observed)'),
  '2027-10-25': L('臺灣光復節', 'Retrocession Day'),
  '2027-12-24': L('行憲紀念日補假', 'Constitution Day (observed)'),
  '2027-12-31': L('開國紀念日補假', "New Year's Day (observed)"),
};

const two = (n: number) => String(n).padStart(2, '0');

/** 把一個時刻換成台北時間的各個欄位。 */
function taipei(iso: string): Date {
  return new Date(new Date(iso).getTime() + OFFSET_MS);
}

/** 某個時刻在台北是哪一天。 */
export function dayOf(iso: string): string {
  return taipei(iso).toISOString().slice(0, 10);
}

/** 某個時刻在台北是幾點幾分（HH:mm）。 */
export function timeOf(iso: string): string {
  return taipei(iso).toISOString().slice(11, 16);
}

/** 某個時刻在台北是幾點（0–23）。 */
export function hourOf(iso: string): number {
  return taipei(iso).getUTCHours();
}

function utc(day: string): number {
  const [y, m, d] = day.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

/** 0 是星期日。 */
export function weekday(day: string): number {
  return new Date(utc(day)).getUTCDay();
}

export function addDays(day: string, n: number): string {
  return new Date(utc(day) + n * DAY_MS).toISOString().slice(0, 10);
}

export function daysBetween(from: string, to: string): number {
  return Math.round((utc(to) - utc(from)) / DAY_MS);
}

export function holidayName(day: string): L10n | undefined {
  return HOLIDAYS[day];
}

export function isWorkday(day: string): boolean {
  const wd = weekday(day);
  return wd !== 0 && wd !== 6 && !HOLIDAYS[day];
}

/** from 之後、到 to（含）為止有幾個工作日。to 比 from 早就回 0。 */
export function workdaysBetween(from: string, to: string): number {
  let n = 0;
  for (let d = addDays(from, 1); d <= to; d = addDays(d, 1)) if (isWorkday(d)) n++;
  return n;
}

/** 往後（或往前）數 n 個工作日。 */
export function addWorkdays(day: string, n: number): string {
  let d = day;
  for (let left = Math.abs(n); left > 0; ) {
    d = addDays(d, n > 0 ? 1 : -1);
    if (isWorkday(d)) left--;
  }
  return d;
}

/** 某個月（YYYY-MM）的最後一個工作日。 */
export function lastWorkdayOfMonth(month: string): string {
  const [y, m] = month.split('-').map(Number);
  let d = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
  while (!isWorkday(d)) d = addDays(d, -1);
  return d;
}

/** 某個月（YYYY-MM）的第 n 個工作日。 */
export function nthWorkdayOfMonth(month: string, n: number): string {
  let d = `${month}-01`;
  if (!isWorkday(d)) d = addWorkdays(d, 1);
  return n > 1 ? addWorkdays(d, n - 1) : d;
}

/** 把「日」加上時間，變成時刻。 */
export function at(day: string, time: string): string {
  return `${day}T${time}:00+08:00`;
}

/** 把一個時刻往後（或往前）推幾個小時，可以是小數。 */
export function shift(iso: string, hours: number): string {
  const t = new Date(new Date(iso).getTime() + Math.round(hours * 3600_000) + OFFSET_MS).toISOString();
  return `${t.slice(0, 19)}+08:00`;
}

export function hoursBetween(from: string, to: string): number {
  return (new Date(to).getTime() - new Date(from).getTime()) / 3600_000;
}

const WEEKDAYS: Record<'zh' | 'en', string[]> = {
  zh: ['日', '一', '二', '三', '四', '五', '六'],
  en: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
};

/** 11/27（五）／Fri 11/27 */
export function fmtDay(day: string): string {
  const [, m, d] = day.split('-').map(Number);
  const name = WEEKDAYS[getLang()][weekday(day)];
  return getLang() === 'zh' ? `${m}/${d}（${name}）` : `${name} ${m}/${d}`;
}

/** 2026-11-27（五）／Fri 2026-11-27 */
export function fmtDate(day: string): string {
  const name = WEEKDAYS[getLang()][weekday(day)];
  return getLang() === 'zh' ? `${day}（${name}）` : `${name} ${day}`;
}

/** 11/27 10:30 */
export function fmtStamp(iso: string): string {
  const day = dayOf(iso);
  const [, m, d] = day.split('-').map(Number);
  return `${m}/${d} ${timeOf(iso)}`;
}

/** 把小時數寫成人看得懂的長度：45 分、3.5 小時、2.1 天。 */
export function fmtHours(hours: number): string {
  const zh = getLang() === 'zh';
  const abs = Math.abs(hours);
  if (abs < 1) return zh ? `${Math.round(abs * 60)} 分` : `${Math.round(abs * 60)} min`;
  if (abs < 48) return zh ? `${trim(abs)} 小時` : `${trim(abs)} h`;
  return zh ? `${trim(abs / 24)} 天` : `${trim(abs / 24)} d`;
}

const trim = (n: number) => (Math.round(n * 10) / 10).toString();

// ── 這份 Demo 的幾個固定日子，全部由日曆算出來

/** Demo 的今天。 */
export const TODAY = dayOf(DEMO_NOW);
/** 這個月的月結日：當月最後一個工作日。夜間批次在這天晚上跑。 */
export const MONTH_END = lastWorkdayOfMonth(TODAY.slice(0, 7));
/** 關帳日：次月第 4 個工作日。 */
export const CLOSE_DAY = nthWorkdayOfMonth(addDays(`${TODAY.slice(0, 7)}-28`, 7).slice(0, 7), 4);

/** 距離今天幾小時之前的時刻。假資料用它把時間釘在 Demo 的「現在」附近。 */
export function ago(hours: number): string {
  return shift(DEMO_NOW, -hours);
}

export { two };
