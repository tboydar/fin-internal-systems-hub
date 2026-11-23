import { describe, expect, test } from 'bun:test';
import {
  addDays,
  addWorkdays,
  CLOSE_DAY,
  dayOf,
  hoursBetween,
  isWorkday,
  lastWorkdayOfMonth,
  MONTH_END,
  nthWorkdayOfMonth,
  shift,
  TODAY,
  timeOf,
  weekday,
  workdaysBetween,
} from '../../src/core/date';

// 日期一律用台北時間，而且要避開國定假日。

describe('日期', () => {
  test('時刻換成台北的日期與時間，不看執行環境的時區', () => {
    expect(dayOf('2026-11-26T16:00:00Z')).toBe('2026-11-27');
    expect(timeOf('2026-11-26T16:00:00Z')).toBe('00:00');
    expect(dayOf('2026-11-27T23:59:00+08:00')).toBe('2026-11-27');
    expect(timeOf('2026-11-27T10:30:00+08:00')).toBe('10:30');
  });

  test('Demo 的今天是月結前一個工作日', () => {
    expect(TODAY).toBe('2026-11-27');
    expect(weekday(TODAY)).toBe(5);
    expect(MONTH_END).toBe('2026-11-30');
    expect(workdaysBetween(TODAY, MONTH_END)).toBe(1);
  });

  test('關帳日是次月第 4 個工作日', () => {
    expect(CLOSE_DAY).toBe('2026-12-04');
    expect(isWorkday(CLOSE_DAY)).toBe(true);
    expect(workdaysBetween(TODAY, CLOSE_DAY)).toBe(5);
  });

  test('週末與國定假日不是工作日', () => {
    expect(isWorkday('2026-11-28')).toBe(false); // 六
    expect(isWorkday('2026-11-29')).toBe(false); // 日
    expect(isWorkday('2026-12-25')).toBe(false); // 行憲紀念日
    expect(isWorkday('2027-01-01')).toBe(false);
    expect(isWorkday('2026-12-31')).toBe(true);
  });

  test('數工作日會跳過假日', () => {
    expect(addWorkdays('2026-12-24', 1)).toBe('2026-12-28');
    expect(addWorkdays('2026-11-30', -1)).toBe('2026-11-27');
    expect(lastWorkdayOfMonth('2027-12')).toBe('2027-12-30'); // 12/31 補假
    expect(nthWorkdayOfMonth('2027-01', 1)).toBe('2027-01-04'); // 1/1 放假，1/2、1/3 週末
  });

  test('時刻的加減', () => {
    expect(shift('2026-11-27T10:30:00+08:00', -12)).toBe('2026-11-26T22:30:00+08:00');
    expect(shift('2026-11-27T23:30:00+08:00', 1.5)).toBe('2026-11-28T01:00:00+08:00');
    expect(hoursBetween('2026-11-27T08:00:00+08:00', '2026-11-27T10:30:00+08:00')).toBe(2.5);
    expect(addDays('2026-11-30', 1)).toBe('2026-12-01');
  });
});
