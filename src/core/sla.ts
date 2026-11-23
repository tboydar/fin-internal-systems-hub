import { DEMO_NOW, dayOf, hoursBetween, shift, TODAY } from './date';
import type { AppState, Deliverable, Priority, Ticket, Vendor, VendorId } from './types';

// 廠商的數字全部從資料列算出來：SLA 達成率來自工單，交付準時率與驗收退件率來自交付項。
// 這裡沒有任何一個寫死的百分比。

export type SlaState = 'met' | 'breached' | 'overdue' | 'running';

export interface TicketSla {
  respondDue: string;
  resolveDue: string;
  /** 回應是否在時限內。還沒回應、時限也還沒到的是 null。 */
  respondMet: boolean | null;
  /** met 準時解決、breached 逾時才解決、overdue 還沒解決而且已經逾時、running 還在時限內。 */
  state: SlaState;
  /** 逾時了幾小時（準時就是 0）。 */
  lateHr: number;
  /** 還沒解決的工單，離時限還有幾小時；已解決的是 null。 */
  remainingHr: number | null;
  /** 這張工單的 SLA 計時已經用掉多少（0–1 以上）。 */
  used: number;
}

export function ticketSla(ticket: Ticket, vendor: Vendor, now: string = DEMO_NOW): TicketSla {
  const target = vendor.sla[ticket.priority];
  const respondDue = shift(ticket.openedAt, target.respondMin / 60);
  const resolveDue = shift(ticket.openedAt, target.resolveHr);
  const respondMet = ticket.respondedAt ? ticket.respondedAt <= respondDue : now > respondDue ? false : null;
  const end = ticket.resolvedAt ?? now;
  const lateHr = Math.max(0, hoursBetween(resolveDue, end));
  const state: SlaState = ticket.resolvedAt ? (lateHr > 0 ? 'breached' : 'met') : lateHr > 0 ? 'overdue' : 'running';
  return {
    respondDue,
    resolveDue,
    respondMet,
    state,
    lateHr,
    remainingHr: ticket.resolvedAt ? null : hoursBetween(now, resolveDue),
    used: hoursBetween(ticket.openedAt, end) / target.resolveHr,
  };
}

const median = (values: number[]): number => {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

export interface VendorMetrics {
  vendor: Vendor;
  /** 統計期間內開的工單。 */
  tickets: Ticket[];
  /** 已經有結果的工單：準時、逾時解決、或還開著但已逾時。 */
  counted: Ticket[];
  met: Ticket[];
  breaches: Ticket[];
  open: Ticket[];
  /** 還沒逾時，但時限已經用掉四分之三以上。 */
  atRisk: Ticket[];
  slaRate: number;
  respondRate: number;
  medianRespondMin: number;
  medianResolveHr: number;
  deliverables: Deliverable[];
  delivered: Deliverable[];
  onTime: Deliverable[];
  /** 過了期限還沒交的。 */
  lateOpen: Deliverable[];
  onTimeRate: number;
  inspected: Deliverable[];
  rejected: Deliverable[];
  rejectRate: number;
}

export const SLA_WINDOW_DAYS = 90;

export function vendorMetrics(state: AppState, vendorId: VendorId, now: string = DEMO_NOW): VendorMetrics {
  const vendor = state.vendors.find((v) => v.id === vendorId);
  if (!vendor) throw new Error(`沒有這家廠商：${vendorId}`);
  const since = shift(now, -SLA_WINDOW_DAYS * 24);
  const tickets = state.tickets.filter((t) => t.vendorId === vendorId && t.openedAt >= since);
  const sla = new Map(tickets.map((t) => [t.id, ticketSla(t, vendor, now)]));
  const stateOf = (t: Ticket) => sla.get(t.id)?.state;
  const met = tickets.filter((t) => stateOf(t) === 'met');
  const breaches = tickets.filter((t) => stateOf(t) === 'breached' || stateOf(t) === 'overdue');
  const counted = [...met, ...breaches];
  const open = tickets.filter((t) => !t.resolvedAt);
  const atRisk = open.filter((t) => stateOf(t) === 'running' && (sla.get(t.id)?.used ?? 0) >= 0.75);
  const responded = tickets.filter((t) => sla.get(t.id)?.respondMet !== null);

  const deliverables = state.deliverables.filter((d) => d.vendorId === vendorId);
  const today = dayOf(now);
  const delivered = deliverables.filter((d) => d.deliveredAt);
  const onTime = delivered.filter((d) => (d.deliveredAt ?? '') <= d.due);
  const lateOpen = deliverables.filter((d) => !d.deliveredAt && d.due < today);
  const inspected = deliverables.filter((d) => d.acceptance !== 'pending' || d.rejects > 0);
  const rejected = inspected.filter((d) => d.rejects > 0);
  const due = delivered.length + lateOpen.length;

  return {
    vendor,
    tickets,
    counted,
    met,
    breaches,
    open,
    atRisk,
    slaRate: counted.length ? met.length / counted.length : 1,
    respondRate: responded.length ? responded.filter((t) => sla.get(t.id)?.respondMet).length / responded.length : 1,
    medianRespondMin: median(tickets.filter((t) => t.respondedAt).map((t) => hoursBetween(t.openedAt, t.respondedAt ?? t.openedAt) * 60)),
    medianResolveHr: median(tickets.filter((t) => t.resolvedAt).map((t) => hoursBetween(t.openedAt, t.resolvedAt ?? t.openedAt))),
    deliverables,
    delivered,
    onTime,
    lateOpen,
    onTimeRate: due ? onTime.length / due : 1,
    inspected,
    rejected,
    rejectRate: inspected.length ? rejected.length / inspected.length : 0,
  };
}

// ── 計罰試算

/** 合約的計罰條款（四家廠商相同）：每逾時一個單位，罰月服務費的一個比例；單月上限是月服務費的 10%。 */
export const PENALTY: Record<Priority, { unitHr: number; rate: number }> = {
  P1: { unitHr: 1, rate: 0.005 },
  P2: { unitHr: 4, rate: 0.0025 },
  P3: { unitHr: 24, rate: 0.001 },
};
export const PENALTY_CAP = 0.1;

export interface PenaltyRow {
  ticket: Ticket;
  sla: TicketSla;
  units: number;
  amount: number;
}

export interface PenaltyCalc {
  month: string;
  rows: PenaltyRow[];
  subtotal: number;
  cap: number;
  total: number;
}

/** 某家廠商某個月（YYYY-MM，依 SLA 到期日歸月）的計罰試算。還沒解決的逾時工單算到「現在」為止。 */
export function penaltyOf(state: AppState, vendorId: VendorId, month: string = TODAY.slice(0, 7), now: string = DEMO_NOW): PenaltyCalc {
  const vendor = state.vendors.find((v) => v.id === vendorId);
  if (!vendor) throw new Error(`沒有這家廠商：${vendorId}`);
  const rows: PenaltyRow[] = [];
  for (const ticket of state.tickets) {
    if (ticket.vendorId !== vendorId) continue;
    const sla = ticketSla(ticket, vendor, now);
    if (sla.lateHr <= 0 || dayOf(sla.resolveDue).slice(0, 7) !== month) continue;
    const rule = PENALTY[ticket.priority];
    const units = Math.ceil(sla.lateHr / rule.unitHr);
    rows.push({ ticket, sla, units, amount: Math.round(vendor.monthlyFee * rule.rate * units) });
  }
  rows.sort((a, b) => (a.sla.resolveDue < b.sla.resolveDue ? -1 : 1));
  const subtotal = rows.reduce((sum, r) => sum + r.amount, 0);
  const cap = Math.round(vendor.monthlyFee * PENALTY_CAP);
  return { month, rows, subtotal, cap, total: Math.min(subtotal, cap) };
}
