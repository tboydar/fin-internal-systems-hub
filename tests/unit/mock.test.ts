import { describe, expect, test } from 'bun:test';
import { DEMO_NOW } from '../../src/core/date';
import { ifaceStatus, ifacesByHealth, runsOf } from '../../src/core/selectors';
import { buildInitialState } from '../../src/mock';

// 假資料的規則。這些測試守的是「資料像不像真的、跨頁對不對得起來」。

describe('假資料', () => {
  const state = buildInitialState();

  test('固定 seed：每次產生的資料完全相同', () => {
    expect(JSON.stringify(buildInitialState())).toBe(JSON.stringify(state));
  });

  test('換一個 seed，亂數產生的執行紀錄就不同', () => {
    expect(JSON.stringify(buildInitialState(1).runs)).not.toBe(JSON.stringify(state.runs));
  });

  test('規模：系統 9、介面 24、廠商 4、具名人物 15', () => {
    expect(state.systems).toHaveLength(9);
    expect(state.ifaces).toHaveLength(24);
    expect(state.vendors).toHaveLength(4);
    expect(state.people).toHaveLength(15);
    expect(state.people.filter((p) => p.kind === 'internal')).toHaveLength(5); // Tech Lead ＋ 4 位工程師
    expect(state.people.filter((p) => p.kind === 'vendor')).toHaveLength(5);
    expect(state.people.filter((p) => p.kind === 'business')).toHaveLength(5);
  });

  test('編號不重複', () => {
    for (const list of [state.systems, state.ifaces, state.vendors, state.people, state.runs, state.apis, state.branches]) {
      const ids = list.map((x) => x.id);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  test('介面的廠商與所屬系統的廠商一致', () => {
    const vendorOf = new Map(state.systems.map((s) => [s.id, s.vendorId]));
    for (const iface of state.ifaces) {
      expect([iface.id, iface.vendorId]).toEqual([iface.id, vendorOf.get(iface.systemId) ?? null]);
    }
  });

  test('資料之間的參照都對得上', () => {
    const systems = new Set(state.systems.map((s) => s.id));
    const people = new Set(state.people.map((p) => p.id));
    const vendors = new Set(state.vendors.map((v) => v.id));
    const ifaces = new Set(state.ifaces.map((i) => i.id));
    const apis = new Set(state.apis.map((a) => a.id));
    for (const s of state.systems) {
      expect(people.has(s.ownerId)).toBe(true);
      if (s.vendorId) expect(vendors.has(s.vendorId)).toBe(true);
    }
    for (const v of state.vendors) expect(people.has(v.pmId)).toBe(true);
    for (const i of state.ifaces) {
      expect(systems.has(i.source)).toBe(true);
      expect(systems.has(i.target)).toBe(true);
      expect(systems.has(i.systemId)).toBe(true);
      expect(people.has(i.ownerId)).toBe(true);
      for (const dep of i.dependsOn) expect(ifaces.has(dep)).toBe(true);
      if (i.apiId) expect(apis.has(i.apiId)).toBe(true);
    }
    for (const r of state.runs) expect(ifaces.has(r.ifaceId)).toBe(true);
    for (const p of state.people) if (p.vendorId) expect(vendors.has(p.vendorId)).toBe(true);
  });

  test('介面的內部負責人都是內部成員；廠商 PM 屬於那家廠商', () => {
    const byId = new Map(state.people.map((p) => [p.id, p]));
    for (const i of state.ifaces) expect(byId.get(i.ownerId)?.kind).toBe('internal');
    for (const v of state.vendors) expect(byId.get(v.pmId)?.vendorId).toBe(v.id);
  });

  test('每條介面都有執行紀錄，而且都發生在 Demo 的「現在」之前', () => {
    for (const iface of state.ifaces) {
      const runs = runsOf(state, iface.id);
      expect(runs.length).toBeGreaterThanOrEqual(6);
      for (const run of runs) expect(run.at <= DEMO_NOW).toBe(true);
    }
  });

  test('月底批次集中在夜間', () => {
    const night = state.ifaces.filter((i) => i.schedule.kind === 'daily' && i.domain === 'finance').map((i) => Number(i.schedule.at?.slice(0, 2)));
    expect(night.length).toBeGreaterThan(3);
    for (const hour of night) expect(hour >= 21 || hour <= 7).toBe(true);
  });

  test('不全綠也不全紅：有正常、有注意、有中斷，而且有一條介面長期不穩', () => {
    const by = ifacesByHealth(state);
    expect(by.ok.length).toBeGreaterThan(by.warn.length + by.crit.length);
    expect(by.warn.length).toBeGreaterThan(0);
    expect(by.crit.length).toBeGreaterThan(0);
    const flaky = state.ifaces.filter((i) => i.flaky);
    expect(flaky.map((i) => i.id)).toEqual(['INT-014']);
    const retried = runsOf(state, 'INT-014').filter((r) => r.status !== 'ok').length;
    expect(retried).toBeGreaterThanOrEqual(2);
    expect(ifaceStatus(state, flaky[0]).health).toBe('warn');
  });

  test('每筆雙語文字都有中文與英文，英文裡沒有中文字', () => {
    const walk = (v: unknown, path: string): void => {
      if (!v || typeof v !== 'object') return;
      const o = v as Record<string, unknown>;
      if (typeof o.zh === 'string' && typeof o.en === 'string') {
        expect([path, o.zh.length > 0]).toEqual([path, true]);
        expect([path, /[一-鿿]/.test(o.en)]).toEqual([path, false]);
        return;
      }
      for (const [key, value] of Object.entries(o)) walk(value, `${path}.${key}`);
    };
    walk(state, 'state');
  });

  test('假資料裡沒有 email、電話或身分證字號樣式', () => {
    const text = JSON.stringify(state);
    expect(text).not.toMatch(/[\w.+-]+@[\w-]+\.[a-z]{2,}/i);
    expect(text).not.toMatch(/09\d{2}[- ]?\d{3}[- ]?\d{3}/);
    expect(text).not.toMatch(/\b[A-Z][12]\d{8}\b/);
  });
});
