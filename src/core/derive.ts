import { addDays, addWorkdays, lastWorkdayOfMonth, nthWorkdayOfMonth, TODAY } from './date';
import { L } from './i18n';
import { ifaceStatus, ifacesByHealth } from './selectors';
import { ticketSla, vendorMetrics } from './sla';
import type {
  AppState,
  Change,
  ChangeRequest,
  Deliverable,
  Demand,
  Doc,
  Iface,
  L10n,
  Person,
  ReconDiff,
  ReconRule,
  Review,
  SkillKey,
  Task,
  Ticket,
  VendorId,
} from './types';

// 團隊、文件、對帳、凍結期，以及「等我決定的事」。跟 selectors.ts 一樣，全部由狀態推導。

// ── 團隊

export const SKILLS: { key: SkillKey; name: L10n }[] = [
  { key: 'erpFin', name: L('ERP 總帳與應付', 'ERP GL and AP') },
  { key: 'erpPo', name: L('ERP 採購', 'ERP Procurement') },
  { key: 'crm', name: L('CRM', 'CRM') },
  { key: 'hr', name: L('人事薪資', 'HR & Payroll') },
  { key: 'wf', name: L('簽呈', 'e-Approval') },
  { key: 'esb', name: L('整合層', 'Integration layer') },
  { key: 'sql', name: L('SQL 與資料倉儲', 'SQL and warehouse') },
  { key: 'iam', name: L('AD／單一登入', 'AD / SSO') },
];

export function openTasksOf(state: AppState, personId: string): Task[] {
  return state.tasks.filter((t) => t.assigneeId === personId && t.status !== 'done');
}

/** 負載＝還沒做完的任務天數 ÷ 兩週內可排的天數。沒有排工程任務的人（業務窗口）回 null。 */
export function loadOf(state: AppState, person: Person): { days: number; ratio: number } | null {
  if (!person.capacityDays) return null;
  const days = openTasksOf(state, person.id).reduce((sum, t) => sum + t.effortDays, 0);
  return { days, ratio: days / person.capacityDays };
}

export interface BusFactor {
  skill: SkillKey;
  name: L10n;
  /** 能獨立處理（2 以上）的內部成員。 */
  internal: Person[];
  /** 能獨立處理的委外成員。廠商的人會換，所以不算進 bus factor。 */
  vendor: Person[];
}

export function busFactors(state: AppState): BusFactor[] {
  const able = (p: Person, key: SkillKey) => p.active && (p.skills[key] ?? 0) >= 2;
  return SKILLS.map(({ key, name }) => ({
    skill: key,
    name,
    internal: state.people.filter((p) => p.kind === 'internal' && able(p, key)),
    vendor: state.people.filter((p) => p.kind === 'vendor' && able(p, key)),
  }));
}

// ── 文件

/** 這份文件下一次該檢視的日期。 */
export function docDue(doc: Pick<Doc, 'reviewed' | 'cycleDays'>): string {
  return addDays(doc.reviewed, doc.cycleDays);
}

export function isStale(doc: Pick<Doc, 'reviewed' | 'cycleDays'>, today: string = TODAY): boolean {
  return docDue(doc) < today;
}

// ── 對帳

export function openDiffs(state: AppState, ruleId?: string): ReconDiff[] {
  return state.reconDiffs.filter((d) => d.status === 'open' && (!ruleId || d.ruleId === ruleId));
}

export interface RuleTotals {
  left: number;
  right: number;
  diffs: ReconDiff[];
  /** 金額規則的差額合計（左減右）。 */
  amount: number;
}

/** 一條規則兩邊的總數。右邊不另外存：筆數與 checksum 是左邊扣掉差異筆數，金額是左邊扣掉差額。 */
export function ruleTotals(state: AppState, rule: ReconRule): RuleTotals {
  const diffs = openDiffs(state, rule.id);
  const amount = diffs.reduce((sum, d) => sum + d.amount, 0);
  const right = rule.kind === 'amount' ? rule.baseLeft - amount : rule.baseLeft - diffs.length;
  return { left: rule.baseLeft, right, diffs, amount };
}

// ── 凍結期

export interface Freeze {
  kind: 'monthEnd' | 'yearEnd';
  name: L10n;
  start: string;
  end: string;
}

/** 某個月（YYYY-MM）的月結凍結期：月結日的前一個工作日，到次月的關帳日（第 4 個工作日）。 */
export function monthEndFreeze(month: string): Freeze {
  const monthEnd = lastWorkdayOfMonth(month);
  const next = addDays(`${month}-28`, 7).slice(0, 7);
  return { kind: 'monthEnd', name: L('月結凍結', 'Month-end freeze'), start: addWorkdays(monthEnd, -1), end: nthWorkdayOfMonth(next, 4) };
}

/** 年結凍結期：12/21 到次年 1 月的關帳日。 */
export function yearEndFreeze(year: number): Freeze {
  return { kind: 'yearEnd', name: L('年結凍結', 'Year-end freeze'), start: `${year}-12-21`, end: nthWorkdayOfMonth(`${year + 1}-01`, 4) };
}

/** 從某個月到某個月（含）之間的所有凍結期。 */
export function freezes(fromMonth: string, toMonth: string): Freeze[] {
  const out: Freeze[] = [];
  for (let month = fromMonth; month <= toMonth; month = addDays(`${month}-28`, 7).slice(0, 7)) {
    out.push(monthEndFreeze(month));
    if (month.endsWith('-12')) out.push(yearEndFreeze(Number(month.slice(0, 4))));
  }
  return out;
}

/** 某一天落在哪個凍結期裡；沒有就回 undefined。年結優先於月結。 */
export function freezeOn(day: string): Freeze | undefined {
  const month = day.slice(0, 7);
  const prev = addDays(`${month}-01`, -1).slice(0, 7);
  const year = Number(day.slice(0, 4));
  const candidates = [yearEndFreeze(year), yearEndFreeze(year - 1), monthEndFreeze(month), monthEndFreeze(prev)];
  return candidates.find((f) => day >= f.start && day <= f.end);
}

// ── 等我決定的事

export interface Pending {
  /** 核定變更請求。 */
  crs: ChangeRequest[];
  /** 需求已經有方案比較，等人選。 */
  demands: Demand[];
  /** 變更已提出，等核准。 */
  changes: Change[];
  /** 廠商已交付，等驗收。 */
  acceptances: Deliverable[];
  /** 指定給我的 Code Review。 */
  reviews: Review[];
  total: number;
}

/** Tech Lead 的待辦決定。每一類都回傳資料列，所以畫面上的數字一定等於點進去看到的列數。 */
export function pendingFor(state: AppState, personId: string): Pending {
  const crs = state.changeRequests.filter((c) => c.stage === 'assessed');
  const demands = state.demands.filter((d) => d.stage === 'options');
  const changes = state.changes.filter((c) => c.status === 'requested');
  const acceptances = state.deliverables.filter((d) => d.deliveredAt && d.acceptance === 'pending');
  const reviews = state.reviews.filter((r) => r.reviewerId === personId && r.status === 'open');
  return { crs, demands, changes, acceptances, reviews, total: crs.length + demands.length + changes.length + acceptances.length + reviews.length };
}

// ── SLA 風險

export interface SlaRisk {
  /** 還開著、已經逾時的工單。 */
  overdue: Ticket[];
  /** 還開著、時限用掉四分之三以上的工單。 */
  atRisk: Ticket[];
  /** 過了期限還沒交的交付項。 */
  lateDeliverables: Deliverable[];
  total: number;
}

export function slaRisk(state: AppState, vendorId?: VendorId | null): SlaRisk {
  const overdue: Ticket[] = [];
  const atRisk: Ticket[] = [];
  const lateDeliverables: Deliverable[] = [];
  for (const vendor of state.vendors) {
    if (vendorId && vendor.id !== vendorId) continue;
    const m = vendorMetrics(state, vendor.id);
    overdue.push(...m.open.filter((t) => ticketSla(t, vendor).state === 'overdue'));
    atRisk.push(...m.atRisk);
    lateDeliverables.push(...m.lateOpen);
  }
  return { overdue, atRisk, lateDeliverables, total: overdue.length + atRisk.length + lateDeliverables.length };
}

/** 需要注意的介面：中斷的排前面。 */
export function attentionIfaces(state: AppState): Iface[] {
  const by = ifacesByHealth(state);
  return [...by.crit, ...by.warn];
}

/** 某位內部成員負責、而且現在不是正常的介面。 */
export function myAttention(state: AppState, personId: string): Iface[] {
  return attentionIfaces(state).filter((i) => i.ownerId === personId && ifaceStatus(state, i).health !== 'ok');
}
