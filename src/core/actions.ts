import { audit, persona } from './auth';
import { L } from './i18n';
import { queued, resendDlq } from './mutations';
import { advanceIf } from './scenario';
import { store } from './store';
import type { SystemId } from './types';

// 頁面上的按鈕呼叫這裡。每個動作都改 store，並留一筆稽核軌跡。
// 如果劇本的下一步剛好就是這個動作，就交給劇本去做（多做的事也一起發生），兩邊結果一致。

/** 重送某條介面 DLQ 裡的資料。回傳重送了幾筆。 */
export function resend(ifaceId: string): number {
  const count = queued(store.state, ifaceId).length;
  if (!count) return 0;
  if (advanceIf(`resend:${ifaceId}`)) return count;
  const who = persona();
  store.update((s) => {
    resendDlq(s, ifaceId, { name: who.name, role: who.role });
  });
  return count;
}

/** 對某個系統注入或解除故障（影響模擬）。回傳現在是不是故障中。 */
export function toggleFault(systemId: SystemId): boolean {
  const on = !store.state.faults.includes(systemId);
  store.update((s) => {
    s.faults = on ? [...s.faults, systemId] : s.faults.filter((id) => id !== systemId);
    const name = s.systems.find((x) => x.id === systemId)?.name;
    audit(
      s,
      on ? L('注入故障（模擬）', 'Injected fault (simulation)') : L('解除故障（模擬）', 'Cleared fault (simulation)'),
      systemId,
      L(`${name?.zh ?? systemId}：${on ? '模擬停止服務' : '恢復'}`, `${name?.en ?? systemId}: ${on ? 'simulated outage' : 'restored'}`),
    );
  });
  return on;
}

/** 把一筆對帳差異標成已處理。 */
export function resolveDiff(diffId: string): void {
  const who = persona();
  store.update((s) => {
    const diff = s.reconDiffs.find((d) => d.id === diffId);
    if (diff?.status !== 'open') return;
    diff.status = 'resolved';
    diff.resolvedBy = who.person?.id ?? who.role;
    audit(s, L('結掉對帳差異', 'Closed reconciliation difference'), diff.id, L(`${diff.ruleId}：${diff.key}`, `${diff.ruleId}: ${diff.key}`));
  });
}
