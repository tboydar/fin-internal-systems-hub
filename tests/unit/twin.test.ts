import { beforeEach, describe, expect, test } from 'bun:test';
import { toggleFault } from '../../src/core/actions';
import { nextStep, startScenario } from '../../src/core/scenario';
import { ifaceStatus, impactOf, systemHealth } from '../../src/core/selectors';
import { store } from '../../src/core/store';
import { dayProfile, FLOORS, RACKS, recordsAt, twinModel } from '../../src/core/twin';

// 3D 與 2D 讀同一份狀態：3D 要畫的模型，每一項都等於 2D 頁面用的那些函式的結果。

beforeEach(() => {
  store.reset();
  store.setPrefs({ role: 'techlead', lang: 'zh' });
});

describe('微縮總行的模型', () => {
  test('九個機櫃就是九個系統，狀態跟架構圖的節點一樣', () => {
    const s = store.state;
    const model = twinModel(s);
    expect(model.systems.map((x) => x.id).sort()).toEqual(s.systems.map((x) => x.id).sort());
    expect(RACKS).toHaveLength(9);
    for (const rack of model.systems) expect([rack.id, rack.health]).toEqual([rack.id, systemHealth(s, s.systems.find((x) => x.id === rack.id)!)]);
  });

  test('24 條介面都在模型裡，狀態跟介面清單一樣', () => {
    const s = store.state;
    const model = twinModel(s);
    expect(model.flows).toHaveLength(24);
    for (const flow of model.flows) expect([flow.id, flow.health]).toEqual([flow.id, ifaceStatus(s, s.ifaces.find((i) => i.id === flow.id)!).health]);
  });

  test('五層樓對應五個單位', () => {
    expect(FLOORS.map((f) => f.domain)).toEqual(['sales', 'finance', 'hr', 'procurement', 'it']);
    expect(twinModel(store.state).floors.map((f) => f.affected)).toEqual([false, false, false, false, false]);
  });

  test('注入故障：受影響的樓層與介面，跟「如果它停了」算出來的一樣', () => {
    toggleFault('crm');
    const s = store.state;
    const model = twinModel(s);
    const impact = impactOf(s, 'crm');
    expect(model.down).toEqual(['crm']);
    expect(model.affected?.ifaceIds.sort()).toEqual(impact.ifaces.map((i) => i.id).sort());
    expect(
      model.floors
        .filter((f) => f.affected)
        .map((f) => f.domain)
        .sort(),
    ).toEqual([...impact.domains].sort());
    expect(model.systems.find((x) => x.id === 'crm')?.faulty).toBe(true);
    // 被注入故障的系統經手的介面，在模型裡都是中斷
    for (const id of model.affected?.ifaceIds ?? [])
      if (impact.ifaces.find((i) => i.id === id && (i.source === 'crm' || i.target === 'crm')))
        expect(model.flows.find((f) => f.id === id)?.health).toBe('crit');
    toggleFault('crm');
    expect(twinModel(store.state).affected).toBeNull();
  });

  test('只是看影響範圍（沒有注入故障）不會改變任何介面的狀態', () => {
    const before = twinModel(store.state).flows.map((f) => f.health);
    const probing = twinModel(store.state, null, 'esb');
    expect(probing.flows.map((f) => f.health)).toEqual(before);
    expect(probing.affected?.domains.length).toBe(5);
    expect(store.state.faults).toEqual([]);
  });

  test('劇本 A 走一步，3D 的模型也跟著變', () => {
    startScenario('A');
    nextStep();
    const model = twinModel(store.state);
    expect(model.flows.find((f) => f.id === 'INT-014')?.health).toBe('crit');
    expect(model.systems.find((x) => x.id === 'hr')?.health).toBe('crit');
    expect(model.floors.find((f) => f.domain === 'hr')?.health).toBe('crit');
    expect(model.hour).toBe(13);
  });
});

describe('月結日的 24 小時', () => {
  test('夜間批次集中在 21 點到凌晨 3 點；上班時間是即時與短間隔的介面', () => {
    const profile = dayProfile(store.state);
    expect(profile).toHaveLength(24);
    const batch = (hour: number) =>
      store.state.ifaces.filter((i) => (i.schedule.kind === 'daily' || i.schedule.kind === 'monthly') && recordsAt(i, hour) > 0).length;
    const night = [21, 22, 23, 0, 1, 2, 3].reduce((sum, h) => sum + batch(h), 0);
    const day = [9, 10, 11, 12, 13, 15, 16, 17].reduce((sum, h) => sum + batch(h), 0);
    expect(night).toBeGreaterThanOrEqual(8);
    expect(day).toBe(0);
    expect(profile[23].records).toBeGreaterThan(profile[10].records);
  });

  test('重播 23 點：費用分攤回寫（每月一次）在跑；看「現在」時它不跑', () => {
    const at23 = twinModel(store.state, 23);
    expect(at23.replay).toBe(true);
    expect(at23.flows.find((f) => f.id === 'INT-061')?.active).toBe(true);
    expect(at23.flows.find((f) => f.id === 'INT-041')?.active).toBe(true);
    const now = twinModel(store.state);
    expect(now.replay).toBe(false);
    expect(now.hour).toBe(10);
    expect(now.flows.find((f) => f.id === 'INT-061')?.active).toBe(false);
    expect(now.flows.find((f) => f.id === 'INT-014')?.active).toBe(true);
  });
});
