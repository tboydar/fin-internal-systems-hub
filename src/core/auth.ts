import { PERSONA } from '../mock/org';
import { DEMO_NOW } from './date';
import { L, tx } from './i18n';
import { type Perm, ROLE_NAME } from './rbac';
import { store } from './store';
import type { AppState, L10n, Person, RoleId, VendorId } from './types';

// 權限判斷與目前登入的身分。畫面上所有「能不能看、能不能按」都問這裡，矩陣改了就立即生效。

export function can(perm: Perm): boolean {
  return store.state.rbac[store.prefs.role]?.includes(perm) ?? false;
}

export interface Persona {
  role: RoleId;
  name: L10n;
  title: L10n;
  /** 對應到哪一位成員；職務帳號沒有。 */
  person?: Person;
  /** 委外廠商 PM 代表的廠商。 */
  vendorId?: VendorId;
}

export function personaOf(state: AppState, role: RoleId, vendorId: VendorId): Persona {
  if (role === 'vendorpm') {
    const vendor = state.vendors.find((v) => v.id === vendorId) ?? state.vendors[0];
    const person = state.people.find((p) => p.id === vendor.pmId);
    return {
      role,
      name: person?.name ?? ROLE_NAME.vendorpm,
      title: L(`${vendor.name.zh} ${person?.title.zh ?? ''}`.trim(), `${person?.title.en ?? 'PM'}, ${vendor.name.en}`),
      person,
      vendorId: vendor.id,
    };
  }
  const def = PERSONA[role];
  const person = def.personId ? state.people.find((p) => p.id === def.personId) : undefined;
  return { role, name: person?.name ?? def.name ?? ROLE_NAME[role], title: person?.title ?? def.title ?? ROLE_NAME[role], person };
}

export function persona(): Persona {
  return personaOf(store.state, store.prefs.role, store.prefs.vendorId);
}

/** 委外廠商 PM 只看得到自家的資料。回傳目前應該套用的廠商範圍；看得到全部時回 null。 */
export function vendorScope(): VendorId | null {
  return can('vendor.viewAll') ? null : (persona().vendorId ?? null);
}

/** 把一個動作寫進稽核軌跡。要在 store.update() 的回呼裡呼叫，才會跟著那次變更一起存下來。 */
export function audit(draft: AppState, action: L10n, target: string, detail: L10n): void {
  const who = persona();
  const n = (draft.counters.audit ?? 0) + 1;
  draft.counters.audit = n;
  draft.audit.unshift({ id: `AU-${String(n).padStart(4, '0')}`, at: DEMO_NOW, actor: who.name, role: who.role, action, target, detail });
}

/** 目前登入者的顯示名稱。 */
export function actorName(): string {
  return tx(persona().name);
}
