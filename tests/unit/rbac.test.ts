import { beforeEach, describe, expect, test } from 'bun:test';
import { can, persona, vendorScope } from '../../src/core/auth';
import { DEFAULT_MATRIX, isLocked, PERM_GROUPS, PERM_NAME, PERMS, ROLE_DESC, ROLE_NAME, ROLES, sodConflicts } from '../../src/core/rbac';
import { store } from '../../src/core/store';

beforeEach(() => {
  store.reset();
  store.setPrefs({ role: 'techlead', lang: 'zh', vendorId: 'v-crm' });
});

describe('角色與權限', () => {
  test('八個角色，每個都有名稱與說明', () => {
    expect(ROLES).toHaveLength(8);
    for (const role of ROLES) {
      expect(ROLE_NAME[role].zh.length).toBeGreaterThan(0);
      expect(ROLE_DESC[role].en.length).toBeGreaterThan(0);
      expect(DEFAULT_MATRIX[role].length).toBeGreaterThan(0);
    }
  });

  test('每項權限都有名稱，而且剛好屬於一個分組', () => {
    const grouped = PERM_GROUPS.flatMap((g) => g.perms);
    expect([...grouped].sort()).toEqual([...PERMS].sort());
    for (const perm of PERMS) expect(PERM_NAME[perm].zh.length).toBeGreaterThan(0);
  });

  test('預設矩陣只用定義過的權限', () => {
    for (const role of ROLES) for (const perm of DEFAULT_MATRIX[role]) expect(PERMS).toContain(perm);
  });

  test('每個角色都看得到總覽與關於；這兩格不能取消', () => {
    for (const role of ROLES) {
      expect(DEFAULT_MATRIX[role]).toContain('page.overview');
      expect(DEFAULT_MATRIX[role]).toContain('page.about');
      expect(isLocked(role, 'page.overview')).toBe(true);
    }
    expect(isLocked('admin', 'rbac.edit')).toBe(true);
    expect(isLocked('techlead', 'rbac.edit')).toBe(false);
  });

  test('八個角色的權限組合各不相同', () => {
    const shapes = ROLES.map((role) => [...DEFAULT_MATRIX[role]].sort().join(','));
    // 人資主管與業務單位主管的權限相同（看到的內容不同，是因為領域不同），其餘都不一樣
    expect(new Set(shapes).size).toBe(7);
    expect(shapes[ROLES.indexOf('hr')]).toBe(shapes[ROLES.indexOf('business')]);
  });

  test('稽核全部唯讀；只有系統管理員能改矩陣；1:1 只有 Tech Lead 看得到', () => {
    expect(DEFAULT_MATRIX.auditor.filter((p) => !p.startsWith('page.') && !p.endsWith('.view'))).toEqual([]);
    expect(ROLES.filter((r) => DEFAULT_MATRIX[r].includes('rbac.edit'))).toEqual(['admin']);
    expect(ROLES.filter((r) => DEFAULT_MATRIX[r].includes('oneonone.manage'))).toEqual(['techlead']);
    expect(ROLES.filter((r) => DEFAULT_MATRIX[r].includes('release.approve'))).toEqual(['techlead']);
  });

  test('can() 看的是 store 裡的矩陣，改了立刻生效', () => {
    store.setPrefs({ role: 'finance' });
    expect(can('demand.create')).toBe(true);
    expect(can('sql.view')).toBe(false);
    store.update((s) => {
      s.rbac.finance.push('sql.view');
    });
    expect(can('sql.view')).toBe(true);
  });
});

describe('職責分離', () => {
  test('預設矩陣沒有衝突', () => {
    expect(sodConflicts(DEFAULT_MATRIX)).toEqual([]);
  });

  test('提出變更的人拿到核准權，就是衝突', () => {
    const matrix = structuredClone(DEFAULT_MATRIX) as Record<string, string[]>;
    matrix.engineer.push('release.approve');
    const found = sodConflicts(matrix);
    expect(found.map((c) => [c.role, c.ruleId])).toEqual([['engineer', 'SOD-1']]);
  });

  test('廠商拿到驗收權、稽核拿到寫入權，都會被抓到', () => {
    const matrix = structuredClone(DEFAULT_MATRIX) as Record<string, string[]>;
    matrix.vendorpm.push('vendor.accept');
    matrix.auditor.push('recon.resolve');
    expect(
      sodConflicts(matrix)
        .map((c) => `${c.role}:${c.ruleId}`)
        .sort(),
    ).toEqual(['auditor:SOD-6', 'vendorpm:SOD-3']);
  });
});

describe('登入身分', () => {
  test('每個角色對應一個身分；稽核與系統管理員是職務帳號', () => {
    store.setPrefs({ role: 'techlead' });
    expect(persona().person?.id).toBe('tl');
    store.setPrefs({ role: 'finance' });
    expect(persona().person?.kind).toBe('business');
    store.setPrefs({ role: 'auditor' });
    expect(persona().person).toBeUndefined();
    expect(persona().name.zh).toBe('稽核室帳號');
  });

  test('委外廠商 PM 跟著選的廠商換人，而且只看得到自家', () => {
    store.setPrefs({ role: 'vendorpm', vendorId: 'v-crm' });
    expect(persona().person?.vendorId).toBe('v-crm');
    expect(vendorScope()).toBe('v-crm');
    store.setPrefs({ vendorId: 'v-erp' });
    expect(persona().person?.vendorId).toBe('v-erp');
    expect(vendorScope()).toBe('v-erp');
    store.setPrefs({ role: 'techlead' });
    expect(vendorScope()).toBeNull();
  });
});
