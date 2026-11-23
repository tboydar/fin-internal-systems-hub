import { addDays, addWorkdays, at, DEMO_NOW, dayOf, hourOf, isWorkday, lastWorkdayOfMonth, shift, TODAY, timeOf } from '../core/date';
import { L } from '../core/i18n';
import type { Iface, L10n, Run, RunStatus } from '../core/types';
import type { Rng } from './rng';

// 每條介面最近幾次的執行紀錄。時間由排程推回去，結果由固定種子的亂數決定，
// 只有「最近一次」是指定的：這樣畫面上的現況不會全綠，也不會每次重建都不一樣。

const HISTORY = 12;
const MONTHLY_HISTORY = 6;

/** 最近一次執行的結果。沒列在這裡的介面，最近一次都是成功。 */
const LATEST: Record<string, { status: RunStatus; attempts?: number; http?: number; failed?: number; lateMin?: number; note: L10n }> = {
  'INT-014': { status: 'retried', attempts: 2, http: 504, note: L('第一次逾時，重試後成功', 'First attempt timed out; succeeded on retry') },
  'INT-031': { status: 'late', lateMin: 47, note: L('檔案晚 47 分鐘到', 'File arrived 47 minutes late') },
  'INT-052': { status: 'retried', attempts: 3, http: 429, note: L('CRM 端限流，第三次才成功', 'Rate-limited by CRM; succeeded on the third attempt') },
  'INT-055': {
    status: 'fail',
    attempts: 2,
    failed: 2600,
    note: L('來源檢視表少了 STEP_OUT_TIME 欄位，整批失敗', 'Source view is missing STEP_OUT_TIME; the whole batch failed'),
  },
};

/** 往回推出這條介面最近幾次該執行的時刻，新的在前。 */
export function runTimes(iface: Iface, now: string = DEMO_NOW): string[] {
  const s = iface.schedule;
  const out: string[] = [];
  if (s.kind === 'monthly') {
    // 薪資分錄在月結日的前一個工作日下午拋轉；其餘月底批次在月結日晚上
    const beforeMonthEnd = iface.id === 'INT-015';
    let month = dayOf(now).slice(0, 7);
    while (out.length < MONTHLY_HISTORY) {
      const monthEnd = lastWorkdayOfMonth(month);
      const when = at(beforeMonthEnd ? addWorkdays(monthEnd, -1) : monthEnd, s.at ?? '23:00');
      if (when <= now) out.push(when);
      month = addDays(`${month}-01`, -1).slice(0, 7);
    }
    return out;
  }
  if (s.kind === 'daily') {
    let day = dayOf(now);
    while (out.length < HISTORY) {
      const when = at(day, s.at ?? '00:00');
      if (isWorkday(day) && when <= now) out.push(when);
      day = addDays(day, -1);
    }
    return out;
  }
  // 即時介面以每小時彙總一筆；固定間隔的介面每次執行一筆
  const stepMin = s.kind === 'interval' ? (s.everyMin ?? 60) : 60;
  const minutes = Number(timeOf(now).slice(0, 2)) * 60 + Number(timeOf(now).slice(3, 5));
  let cursor = shift(at(dayOf(now), '00:00'), (Math.floor(minutes / stepMin) * stepMin) / 60);
  if (s.kind === 'realtime') cursor = shift(cursor, -1); // 這個小時還沒過完，最近一筆彙總是上一個小時
  while (out.length < HISTORY) {
    if (isWorkday(dayOf(cursor)) && s.hours.includes(hourOf(cursor))) out.push(cursor);
    cursor = shift(cursor, -stepMin / 60);
  }
  return out;
}

export function buildRuns(rng: Rng, ifaces: Iface[]): Run[] {
  const runs: Run[] = [];
  for (const iface of ifaces) {
    runTimes(iface).forEach((when, i) => {
      const records = Math.max(1, Math.round(iface.volume * rng.float(0.82, 1.18)));
      let status: RunStatus = 'ok';
      let attempts = 1;
      let failed = 0;
      let http: number | undefined;
      let note: L10n | undefined;
      let lateMin: number | undefined;
      const forced = i === 0 ? LATEST[iface.id] : undefined;
      if (forced) {
        status = forced.status;
        attempts = forced.attempts ?? 1;
        failed = forced.failed ?? 0;
        http = forced.http;
        note = forced.note;
        lateMin = forced.lateMin;
      } else if (i > 0) {
        // 歷史紀錄：長期不穩的介面大約四次有一次要重試；其他介面偶爾一次
        const roll = rng.next();
        if (iface.flaky && roll < 0.27) {
          status = 'retried';
          attempts = rng.int(2, 3);
          http = 504;
        } else if (!iface.flaky && roll < 0.03) {
          status = 'retried';
          attempts = 2;
        } else if (iface.id === 'INT-031' && roll < 0.22) {
          status = 'late';
          lateMin = rng.int(12, 55);
        }
      }
      const base = iface.schedule.kind === 'realtime' ? 2 : Math.max(3, Math.round(records / 40));
      runs.push({
        id: `${iface.id}-${when.slice(0, 16).replace(/[-T:]/g, '')}`,
        ifaceId: iface.id,
        at: when,
        status,
        records: iface.id === 'INT-055' && forced ? 2600 : records,
        failed,
        attempts,
        seconds: Math.round(base * rng.float(0.8, 1.6) * attempts),
        http,
        lateMin,
        note,
      });
    });
  }
  return runs;
}

/** 這條介面下一次該執行的時刻。即時介面沒有「下一次」，回 null。 */
export function nextRun(iface: Iface, now: string = DEMO_NOW): string | null {
  const s = iface.schedule;
  if (s.kind === 'realtime') return null;
  if (s.kind === 'monthly') {
    const monthEnd = lastWorkdayOfMonth(TODAY.slice(0, 7));
    const when = at(iface.id === 'INT-015' ? addWorkdays(monthEnd, -1) : monthEnd, s.at ?? '23:00');
    return when > now ? when : null;
  }
  if (s.kind === 'daily') {
    let day = dayOf(now);
    for (let i = 0; i < 10; i++) {
      const when = at(day, s.at ?? '00:00');
      if (isWorkday(day) && when > now) return when;
      day = addDays(day, 1);
    }
    return null;
  }
  const last = runTimes(iface, now)[0];
  return shift(last, (s.everyMin ?? 60) / 60);
}
