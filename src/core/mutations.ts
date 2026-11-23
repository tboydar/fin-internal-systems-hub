import { L } from './i18n';
import { ROLE_NAME } from './rbac';
import type { AppState, AuditEntry, IncidentStage, L10n, Person, RoleId, Run } from './types';

// 直接改 draft 的小函式。頁面上的按鈕與劇本的步驟都呼叫這裡，
// 所以「在頁面上按重送」和「劇本走到重送那一步」做的是同一件事。
// 這些函式不碰 store，要在 store.update() 的回呼裡用。

export const SYSTEM_ACTOR = L('系統', 'System');

/** 寫一筆稽核軌跡，指明是誰做的（劇本裡的動作不一定是目前登入的人做的）。 */
export function logAs(draft: AppState, who: Person | 'system' | { name: L10n; role: RoleId }, action: L10n, target: string, detail: L10n): void {
  const n = (draft.counters.audit ?? 0) + 1;
  draft.counters.audit = n;
  let actor: L10n;
  let role: AuditEntry['role'];
  if (who === 'system') {
    actor = SYSTEM_ACTOR;
    role = 'system';
  } else if ('kind' in who) {
    actor = who.name;
    role = who.id === 'tl' ? 'techlead' : who.kind === 'internal' ? 'engineer' : who.kind === 'vendor' ? 'vendorpm' : 'business';
  } else {
    actor = who.name;
    role = who.role;
  }
  draft.audit.unshift({ id: `AU-${String(n).padStart(4, '0')}`, at: draft.clock, actor, role, action, target, detail });
}

export function person(draft: AppState, id: string): Person {
  const found = draft.people.find((p) => p.id === id);
  if (!found) throw new Error(`沒有這個人：${id}`);
  return found;
}

export function roleActor(role: RoleId, name: L10n = ROLE_NAME[role]): { name: L10n; role: RoleId } {
  return { name, role };
}

/** 加一筆執行紀錄。 */
export function addRun(draft: AppState, run: Omit<Run, 'id'>): Run {
  const full: Run = { id: `${run.ifaceId}-${run.at.slice(0, 16).replace(/[-T:]/g, '')}`, ...run };
  draft.runs = draft.runs.filter((r) => r.id !== full.id);
  draft.runs.push(full);
  return full;
}

/** 還在 DLQ 裡等重送的資料。 */
export function queued(state: AppState, ifaceId: string) {
  return state.dlq.filter((d) => d.ifaceId === ifaceId && d.status === 'queued');
}

/**
 * 重送某條介面 DLQ 裡的資料：標成已重送，補一筆成功的執行紀錄。
 * 回傳重送了幾筆。接收端是冪等的（ADR-003），所以重送不會造成重複。
 */
export function resendDlq(draft: AppState, ifaceId: string, who: Parameters<typeof logAs>[1]): number {
  const items = queued(draft, ifaceId);
  if (!items.length) return 0;
  for (const item of items) item.status = 'resent';
  addRun(draft, {
    ifaceId,
    at: draft.clock,
    status: 'ok',
    records: items.length,
    failed: 0,
    attempts: 1,
    seconds: Math.max(3, Math.round(items.length / 4)),
    note: L(`從 DLQ 重送 ${items.length} 筆`, `Resent ${items.length} ${items.length === 1 ? 'record' : 'records'} from the DLQ`),
  });
  logAs(
    draft,
    who,
    L('重送 DLQ', 'Resent from DLQ'),
    ifaceId,
    L(`${items.length} 筆，全部成功`, `${items.length} ${items.length === 1 ? 'record' : 'records'}, all succeeded`),
  );
  return items.length;
}

/** 把一條規則還沒結的差異全部標成已處理。 */
export function resolveDiffs(draft: AppState, ruleId: string, by: string): number {
  let n = 0;
  for (const d of draft.reconDiffs) {
    if (d.ruleId === ruleId && d.status === 'open') {
      d.status = 'resolved';
      d.resolvedBy = by;
      n++;
    }
  }
  return n;
}

/** 事件往前推一個階段，並記在時間軸上。 */
export function moveIncident(draft: AppState, incidentId: string, stage: IncidentStage, by: string, when: string = draft.clock): void {
  const incident = draft.incidents.find((i) => i.id === incidentId);
  if (!incident) throw new Error(`沒有這個事件：${incidentId}`);
  incident.stage = stage;
  incident.timeline.push({ stage, at: when, by });
  if (stage === 'recovered') incident.recoveredAt = when;
}
