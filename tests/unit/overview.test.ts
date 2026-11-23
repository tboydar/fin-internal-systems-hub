import { beforeEach, describe, expect, test } from 'bun:test';
import { attentionIfaces, openDiffs, pendingFor, slaRisk } from '../../src/core/derive';
import { AUDIENCE_OF } from '../../src/core/narrative';
import { ROLES, sodConflicts } from '../../src/core/rbac';
import { nextStep, startScenario } from '../../src/core/scenario';
import { vendorMetrics } from '../../src/core/sla';
import { store } from '../../src/core/store';
import type { RoleId } from '../../src/core/types';
import { statsFor } from '../../src/pages/overview';

// 總覽上面那排數字：每一個都等於來源資料的列數，而且點得進去。

function stats(role: RoleId) {
  store.setPrefs({ role, vendorId: 'v-crm' });
  const tech = store.state.rbac[role].includes('iface.detail');
  return new Map(statsFor(store.state, AUDIENCE_OF[role], tech, role === 'vendorpm' ? 'v-crm' : null).map((s) => [s.id, s]));
}

beforeEach(() => {
  store.reset();
  store.setPrefs({ role: 'techlead', lang: 'zh' });
});

describe('總覽的數字', () => {
  test('Tech Lead：介面健康、SLA 風險、等我決定的事，都等於來源的列數', () => {
    const s = stats('techlead');
    expect(s.get('health')?.count).toBe(attentionIfaces(store.state).length);
    expect(s.get('sla')?.count).toBe(slaRisk(store.state).total);
    expect(s.get('pending')?.count).toBe(pendingFor(store.state, 'tl').total);
    expect(s.get('month-end')?.count).toBe(1);
  });

  test('財務主管：對帳差異等於還沒結的差異筆數', () => {
    const s = stats('finance');
    expect(s.get('diffs')?.count).toBe(openDiffs(store.state).length);
    expect(s.get('close')?.count).toBe(5);
    expect(s.get('exchange')?.count).toBe(1);
  });

  test('委外廠商 PM：只算自家的工單與交付項', () => {
    const s = stats('vendorpm');
    const m = vendorMetrics(store.state, 'v-crm');
    expect(s.get('open')?.count).toBe(m.open.length);
    expect(s.get('late')?.count).toBe(m.lateOpen.length);
    expect(s.get('sla')?.count).toBe(m.counted.length);
  });

  test('稽核：職責分離衝突與稽核軌跡', () => {
    const s = stats('auditor');
    expect(s.get('sod')?.count).toBe(sodConflicts(store.state.rbac).length);
    expect(s.get('trail')?.count).toBe(store.state.audit.length);
    expect(s.get('leavers')?.count).toBe(openDiffs(store.state, 'RC-10').length);
  });

  test('八個角色各有四個數字；除了稽核的一格，每一格都有地方可以點', () => {
    for (const role of ROLES) {
      const list = [...stats(role).values()];
      expect([role, list.length]).toEqual([role, 4]);
      for (const stat of list)
        if (!(role === 'auditor' || role === 'admin') || stat.id !== 'leavers') expect([role, stat.id, typeof stat.to]).toEqual([role, stat.id, 'string']);
    }
  });

  test('劇本走一步，數字就跟著變', () => {
    const before = stats('techlead').get('health')?.count ?? 0;
    startScenario('A');
    nextStep();
    nextStep();
    expect(stats('techlead').get('health')?.count).toBe(before + 1);
    nextStep();
    expect(stats('finance').get('diffs')?.count).toBe(47);
  });
});
