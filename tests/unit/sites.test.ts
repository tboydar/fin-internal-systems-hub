import { beforeEach, describe, expect, test } from 'bun:test';
import { toggleFault } from '../../src/core/actions';
import { MONTH_END, weekday } from '../../src/core/date';
import { drillAt, drillSteps } from '../../src/core/drill';
import { impactOf, systemHealth, worse } from '../../src/core/selectors';
import { businessDay, isOpen, localClock, OPEN_HOURS, siteSystems, sitesModel, tzOffsetMin } from '../../src/core/sites';
import { store } from '../../src/core/store';
import { twinModel } from '../../src/core/twin';
import type { Health } from '../../src/core/types';

// 多據點、多機房、多時區：3D 的「全台」與「海外」要畫的東西，每一項都由狀態算出來。

beforeEach(() => {
  store.reset();
  store.setPrefs({ role: 'techlead', lang: 'zh' });
});

const monthEnd = (time: string) => `${MONTH_END}T${time}:00+08:00`;

describe('時差由時區資料庫算，不寫死', () => {
  test('月結日（11 月底，各地都是標準時間）各據點比 UTC 快幾分鐘', () => {
    const offsets = Object.fromEntries(store.state.overseas.map((o) => [o.id, tzOffsetMin(o.tz, monthEnd('12:00'))]));
    expect(offsets).toEqual({ 'os-tyo': 540, 'os-hkg': 480, 'os-sgn': 420, 'os-lon': 0, 'os-nyc': -300, 'os-lax': -480 });
    expect(tzOffsetMin('Asia/Taipei', monthEnd('12:00'))).toBe(480);
  });

  test('夏天有日光節約的地方會差一小時：這就是不能寫死的原因', () => {
    const july = '2026-07-01T12:00:00+08:00';
    expect(tzOffsetMin('America/New_York', july)).toBe(-240);
    expect(tzOffsetMin('Europe/London', july)).toBe(60);
    expect(tzOffsetMin('Asia/Tokyo', july)).toBe(540);
  });

  test('月結日是星期一；台北晚上 11 點，紐約是同一天的上午 10 點；台北凌晨 2 點，紐約還在星期日', () => {
    expect(weekday(MONTH_END)).toBe(1);
    const late = localClock('America/New_York', monthEnd('23:00'));
    expect([late.weekday, late.hour, late.dayDelta]).toEqual([1, 10, 0]);
    expect(isOpen(late)).toBe(true);
    const early = localClock('America/New_York', monthEnd('02:00'));
    expect([early.weekday, early.hour, early.dayDelta]).toEqual([0, 13, -1]);
    expect(isOpen(early)).toBe(false);
  });
});

describe('多據點的模型', () => {
  test('8 處國內據點、6 處海外據點、3 個機房；區域小計等於據點加總', () => {
    const s = store.state;
    const sites = sitesModel(s, twinModel(s));
    expect(sites.sites.filter((x) => x.kind === 'branch')).toHaveLength(8);
    expect(sites.sites.filter((x) => x.kind === 'overseas')).toHaveLength(6);
    expect(sites.dcs.map((d) => d.id)).toEqual(['dc-hq', 'dc-dr', 'dc-vendor']);
    for (const region of sites.regions) {
      const inside = sites.sites.filter((x) => x.regionId === region.id);
      expect(region.sites).toEqual(inside.map((x) => x.id));
      expect(region.staff).toBe(inside.reduce((sum, x) => sum + x.staff, 0));
      expect(region.pendingApprovals).toBe(inside.reduce((sum, x) => sum + x.pendingApprovals, 0));
    }
    expect(sites.regions.reduce((sum, r) => sum + r.sites.length, 0)).toBe(14);
  });

  test('每個系統都放在某一個機房；九個系統平常都在跑', () => {
    const s = store.state;
    const sites = sitesModel(s, twinModel(s));
    expect(sites.dcs.flatMap((d) => d.running).sort()).toEqual(s.systems.map((x) => x.id).sort());
    expect(sites.dcs.find((d) => d.id === 'dc-vendor')?.running).toEqual(['crm']);
    // 備援中心平常沒有系統在跑，只有待命的環境；只有備份的系統不在待命名單裡
    const dr = sites.dcs.find((d) => d.id === 'dc-dr');
    expect(dr?.running).toEqual([]);
    expect(dr?.standby.sort()).toEqual(
      s.systems
        .filter((x) => x.dcId === 'dc-hq' && x.dr.mode !== 'backup')
        .map((x) => x.id)
        .sort(),
    );
  });

  test('據點連線的狀態：在用的系統停了才是中斷，只是有介面出狀況是注意', () => {
    const s = store.state;
    const used = siteSystems(s);
    expect(used.sort()).toEqual(['crm', 'dw', 'iam', 'wf']);
    const worst = used.map((id) => systemHealth(s, s.systems.find((x) => x.id === id)!)).reduce(worse, 'ok' as Health);
    const expected: Health = worst === 'ok' ? 'ok' : 'warn';
    for (const site of sitesModel(s, twinModel(s)).sites) expect([site.id, site.health, site.blockedBy]).toEqual([site.id, expected, []]);
    toggleFault('crm');
    const after = sitesModel(store.state, twinModel(store.state));
    for (const site of after.sites) expect([site.id, site.health, site.blockedBy]).toEqual([site.id, 'crit', ['crm']]);
    expect(after.dcs.find((d) => d.id === 'dc-vendor')?.health).toBe('crit');
    expect(after.regions.every((r) => r.health === 'crit')).toBe(true);
  });

  test('Demo 的現在（星期五 10:30）：國內與亞洲在上班，歐美在睡覺', () => {
    const s = store.state;
    const sites = sitesModel(s, twinModel(s));
    const open = sites.sites.filter((x) => x.open).map((x) => x.id);
    expect(open).toEqual(['br-hq', 'br-bq', 'br-ty', 'br-hc', 'br-tc', 'br-cy', 'br-tn', 'br-kh', 'os-tyo', 'os-hkg', 'os-sgn']);
    expect(sites.supportOn).toBe(true);
    expect(sites.sites.some((x) => x.uncovered)).toBe(false);
  });

  test('重播月結日 23 點：國內下班了，紐約與倫敦在上班，撞到正在跑的夜間批次，而且台北只剩值班', () => {
    const s = store.state;
    const model = twinModel(s, 23);
    const sites = sitesModel(s, model);
    const by = Object.fromEntries(sites.sites.map((x) => [x.id, x]));
    expect(by['br-hq'].open).toBe(false);
    expect(by['br-hq'].overlaps).toEqual([]);
    expect([by['os-nyc'].open, by['os-nyc'].clock.hour, by['os-nyc'].uncovered]).toEqual([true, 10, true]);
    expect([by['os-lon'].open, by['os-lon'].clock.hour]).toEqual([true, 15]);
    // 洛杉磯這時是星期一早上 7 點，還沒上班
    expect([by['os-lax'].open, by['os-lax'].clock.hour, by['os-lax'].clock.weekday]).toEqual([false, 7, 1]);
    // 23 點在跑的批次裡，動到據點在用的系統（CRM、簽呈、資料倉儲、AD）的那幾條
    const used = siteSystems(s);
    const expected = s.ifaces
      .filter((i) => (i.schedule.kind === 'daily' || i.schedule.kind === 'monthly') && model.flows.find((f) => f.id === i.id)?.active)
      .filter((i) => used.includes(i.source) || used.includes(i.target))
      .map((i) => i.id);
    expect(expected).toContain('INT-061');
    expect(by['os-nyc'].overlaps).toEqual(expected);
    expect(sites.supportOn).toBe(false);
  });

  test('時區桌：24 格，台北那一格的時間就是模型的時間，正午那一格是太陽的位置', () => {
    const s = store.state;
    const sites = sitesModel(s, twinModel(s, 14));
    expect(sites.strips).toHaveLength(24);
    expect(sites.strips.find((x) => x.offset === 8)?.hour).toBe(14);
    expect(sites.strips.find((x) => x.offset === -5)?.hour).toBe(1);
    expect(sites.noonOffset).toBe(6);
    for (const strip of sites.strips) expect(strip.working).toBe(strip.hour >= OPEN_HOURS.from && strip.hour < OPEN_HOURS.to);
  });
});

describe('演練：總行機房停擺', () => {
  test('時間點由各系統的復原時間目標排出來；一開始總行的系統全停，CRM 在廠商那邊不受影響', () => {
    const s = store.state;
    const steps = drillSteps(s);
    expect(steps[0]).toBe(0);
    expect(steps).toEqual([...steps].sort((a, b) => a - b));
    const start = drillAt(s, 0);
    expect(start.down.sort()).toEqual(
      s.systems
        .filter((x) => x.dcId === 'dc-hq')
        .map((x) => x.id)
        .sort(),
    );
    expect(start.untouched).toEqual(['crm']);
    expect(start.recovered).toEqual([]);
    expect(start.allBackHr).toBe(Math.max(...s.systems.filter((x) => x.dcId === 'dc-hq').map((x) => x.dr.rtoHr)));
  });

  test('越往後回來的系統越多，最後一個時間點全部回來', () => {
    const s = store.state;
    const steps = drillSteps(s);
    let before = Infinity;
    for (let i = 0; i < steps.length; i++) {
      const drill = drillAt(s, i);
      expect(drill.down.length).toBeLessThanOrEqual(before);
      expect(drill.down.length + drill.recovered.length + drill.untouched.length).toBe(9);
      for (const id of drill.recovered) expect(s.systems.find((x) => x.id === id)!.dr.rtoHr).toBeLessThanOrEqual(drill.elapsedHr);
      before = drill.down.length;
    }
    const end = drillAt(s, steps.length - 1);
    expect(end.down).toEqual([]);
    expect(end.nextHr).toBeNull();
    expect(drillAt(s, 99).step).toBe(steps.length - 1);
  });

  test('演練不改資料；3D 的模型用同一份：停著的系統、受影響的樓層、被擋住的介面', () => {
    const s = store.state;
    const before = JSON.stringify(s);
    const model = twinModel(s, null, null, 0);
    expect(JSON.stringify(store.state)).toBe(before);
    expect(model.drill?.down.sort()).toEqual([...model.down].sort());
    expect(model.floors.every((f) => f.affected)).toBe(true);
    const hit = new Set(model.down.flatMap((id) => impactOf(s, id).ifaces.map((i) => i.id)));
    expect(
      model.flows
        .filter((f) => f.stalled)
        .map((f) => f.id)
        .sort(),
    ).toEqual([...hit].sort());
    // 沒有在演練時，沒有任何介面是 stalled
    expect(twinModel(s).flows.some((f) => f.stalled)).toBe(false);
  });

  test('最慢的那個決定一切：ERP 四小時就回來，但簽呈要三天，這三天每層樓都還受影響', () => {
    const s = store.state;
    const steps = drillSteps(s);
    const at4 = twinModel(s, null, null, steps.indexOf(4));
    expect(at4.systems.find((x) => x.id === 'erp-gl')?.place).toBe('dc-dr');
    expect(at4.down).toContain('wf');
    expect(at4.floors.every((f) => f.affected)).toBe(true);
    const sites = sitesModel(s, at4);
    expect(sites.sites.every((x) => x.health === 'crit' && x.home === 'dc-dr')).toBe(true);
    expect(sites.dcs.find((d) => d.id === 'dc-dr')?.running).toContain('erp-gl');
    expect(sites.dcs.find((d) => d.id === 'dc-hq')?.running).toEqual([]);
    const done = twinModel(s, null, null, steps.length - 1);
    expect(done.affected).toBeNull();
    expect(sitesModel(s, done).trunks.find((t) => t.id === 'replica')?.active).toBe(false);
  });
});

describe('月結日這個營業日，在各地是什麼時候', () => {
  test('從東京開門到洛杉磯關門要 26 小時；洛杉磯的月結日，台北已經是隔天', () => {
    const day = businessDay(store.state);
    expect(day.day).toBe(MONTH_END);
    const by = Object.fromEntries(day.rows.map((r) => [r.id, r]));
    expect([by['os-tyo'].openAt, by['os-tyo'].closeAt]).toEqual([8, 17]);
    expect([by.tw.openAt, by.tw.closeAt]).toEqual([9, 18]);
    expect([by['os-nyc'].openAt, by['os-nyc'].closeAt]).toEqual([22, 31]);
    expect([by['os-lax'].openAt, by['os-lax'].closeAt]).toEqual([25, 34]);
    expect(day.span).toEqual({ from: 8, to: 34, hours: 26 });
    expect(day.rows.map((r) => r.openAt)).toEqual([...day.rows.map((r) => r.openAt)].sort((a, b) => a - b));
  });

  test('國內與亞洲的上班時間遇不到夜間批次；紐約的上班時間裡，台北的一般支援完全不在', () => {
    const day = businessDay(store.state);
    const by = Object.fromEntries(day.rows.map((r) => [r.id, r]));
    expect(by.tw.overlaps).toEqual([]);
    expect(by.tw.uncoveredHr).toBe(0);
    expect(by['os-tyo'].uncoveredHr).toBe(0);
    expect(by['os-nyc'].uncoveredHr).toBe(9);
    expect(by['os-lon'].uncoveredHr).toBe(6);
    expect(by['os-nyc'].overlaps.length).toBeGreaterThan(by['os-lon'].overlaps.length - 1);
    expect(by['os-nyc'].overlaps.length).toBeGreaterThanOrEqual(5);
    // 每一筆重疊都真的落在那個據點的上班時段裡，而且是有動到據點系統的批次
    for (const row of day.rows)
      for (const hit of row.overlaps) {
        expect(hit.at).toBeGreaterThanOrEqual(row.openAt);
        expect(hit.at).toBeLessThan(row.closeAt);
        expect(day.batches.find((b) => b.ifaceId === hit.ifaceId && b.at === hit.at)?.touches).toBe(true);
      }
  });
});
