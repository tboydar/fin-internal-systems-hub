import { CLOSE_DAY, dayOf, hoursBetween, TODAY, timeOf, workdaysBetween } from './date';
import { L } from './i18n';
import { queued } from './mutations';
import { type IfaceStatus, ifaceStatus, lastRun, runsOf } from './selectors';
import { ticketSla, vendorMetrics } from './sla';
import type { AppState, Domain, Health, Iface, L10n, RoleId, Ticket, VendorId } from './types';

// 同一件事，不同說法。
// 每一句話都是「規則」從同一批資料列組出來的，不是語言模型寫的，也不是每個角色各存一句字串：
// 工程師看到的「37 筆進 DLQ」與人資看到的「37 位同仁」，讀的是 DLQ 裡同一批資料的筆數。

export type Audience = 'engineer' | 'finance' | 'hr' | 'business' | 'vendor' | 'audit';

export const AUDIENCE_OF: Record<RoleId, Audience> = {
  techlead: 'engineer',
  engineer: 'engineer',
  vendorpm: 'vendor',
  finance: 'finance',
  hr: 'hr',
  business: 'business',
  auditor: 'audit',
  admin: 'audit',
};

export const AUDIENCE_NAME: Record<Audience, L10n> = {
  engineer: L('工程師', 'Engineer'),
  finance: L('財務主管', 'Finance manager'),
  hr: L('人資主管', 'HR manager'),
  business: L('業務單位主管', 'Business unit manager'),
  vendor: L('委外廠商 PM', 'Vendor PM'),
  audit: L('稽核', 'Auditor'),
};

/** 每種讀者關心哪些領域的資料交換。 */
const DOMAINS: Partial<Record<Audience, Domain[]>> = {
  finance: ['finance', 'procurement'],
  hr: ['hr'],
  business: ['sales'],
};

export interface Statement {
  id: string;
  health: Health;
  text: L10n;
  /** 這句話是從哪條介面的資料來的。 */
  ifaceId?: string;
  ticketId?: string;
}

const month = () => Number(TODAY.slice(5, 7));
const md = (day: string) => `${Number(day.slice(5, 7))}/${Number(day.slice(8, 10))}`;
const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

/** 已經用掉幾次重試。 */
function retries(iface: Iface, attempts: number): string {
  return `${Math.min(Math.max(attempts - 1, 0), iface.retry.max)}/${iface.retry.max}`;
}

/** 今天稍早被保留過、現在已經補做完的介面：回傳原定時間與實際完成時間。 */
function caughtUp(state: AppState, iface: Iface): { scheduled: string; done: string } | null {
  const today = runsOf(state, iface.id).filter((r) => dayOf(r.at) === TODAY);
  const held = today.find((r) => r.status === 'held');
  const done = today.find((r) => r.status === 'ok');
  return held && done && done.at > held.at ? { scheduled: held.at, done: done.at } : null;
}

/** 這條介面的上游裡，哪一條現在是中斷的。 */
function brokenUpstream(state: AppState, iface: Iface): Iface | undefined {
  return iface.dependsOn.map((id) => state.ifaces.find((i) => i.id === id)).find((up) => up && ifaceStatus(state, up).health === 'crit');
}

/** 被保留的介面預計什麼時候能補做：有開給廠商的工單就看它的解決時限，否則抓今天下班前。 */
function eta(state: AppState, iface: Iface): string {
  const ticket = state.tickets.find((t) => !t.resolvedAt && t.ifaceId && iface.dependsOn.includes(t.ifaceId));
  const vendor = ticket && state.vendors.find((v) => v.id === ticket.vendorId);
  return ticket && vendor ? ticketSla(ticket, vendor, state.clock).resolveDue : `${TODAY}T18:00:00+08:00`;
}

function reportsOf(state: AppState, iface: Iface): L10n | null {
  const rules = state.reconRules.filter((r) => r.ifaceIds.includes(iface.id));
  return rules.length ? L(rules.map((r) => r.report.zh).join('、'), rules.map((r) => r.report.en).join(', ')) : null;
}

// ── 給工程師：編號、錯誤、重試、DLQ

function forEngineer(state: AppState, iface: Iface, st: IfaceStatus): L10n {
  const zh = [`${iface.id} ${iface.name.zh}`];
  const en = [`${iface.id} ${iface.name.en}`];
  const run = st.run;
  if (st.faultOf || !run) {
    zh.push(st.reason.zh);
    en.push(st.reason.en);
  } else if (run.status === 'fail') {
    const dlq = queued(state, iface.id).length;
    if (run.http) {
      zh.push(`HTTP ${run.http}`);
      en.push(`HTTP ${run.http}`);
    }
    zh.push(`重試 ${retries(iface, run.attempts)}`);
    en.push(`retries ${retries(iface, run.attempts)}`);
    if (dlq) {
      zh.push(`${dlq} 筆進 DLQ`);
      en.push(`${dlq} ${plural(dlq, 'record', 'records')} in the DLQ`);
    } else {
      zh.push(`整批 ${run.failed} 筆失敗${run.note ? `：${run.note.zh}` : ''}`);
      en.push(`all ${run.failed} records failed${run.note ? `: ${run.note.en}` : ''}`);
    }
  } else if (run.status === 'held') {
    const up = brokenUpstream(state, iface);
    zh.push(`上游 ${up?.id ?? iface.dependsOn.join('、')} 還沒成功，先保留不執行`);
    en.push(`held until upstream ${up?.id ?? iface.dependsOn.join(', ')} succeeds`);
  } else if (run.status === 'retried') {
    zh.push(`${run.http ? `HTTP ${run.http}，` : ''}重試 ${retries(iface, run.attempts)} 後成功`);
    en.push(`${run.http ? `HTTP ${run.http}, ` : ''}succeeded after retries ${retries(iface, run.attempts)}`);
  } else if (run.status === 'late') {
    zh.push(`比排定時間晚 ${run.lateMin ?? 0} 分鐘完成`);
    en.push(`finished ${run.lateMin ?? 0} min later than scheduled`);
  } else {
    zh.push(st.reason.zh);
    en.push(st.reason.en);
  }
  return L(zh.join('，'), en.join(', '));
}

// ── 給業務單位：哪件事會晚、會不會影響到他們在意的日子

function payrollPosting(state: AppState, iface: Iface, st: IfaceStatus): L10n | null {
  const close = md(CLOSE_DAY);
  const done = caughtUp(state, iface);
  if (done) {
    const late = fmtHoursText(hoursBetween(done.scheduled, done.done));
    return L(
      `${month()} 月薪資分錄已在 ${timeOf(done.done)} 入帳，比原定晚 ${late.zh}；不影響 ${close} 關帳`,
      `Payroll journals for month ${month()} were posted at ${timeOf(done.done)}, ${late.en} later than scheduled; the ${close} book closing is not affected`,
    );
  }
  if (st.run?.status !== 'held') return null;
  const when = dayOf(eta(state, iface));
  const sameDay = when === TODAY;
  const days = workdaysBetween(TODAY, when);
  const hit = when > CLOSE_DAY;
  return L(
    `${month()} 月薪資分錄會晚${sameDay ? '半天' : ` ${days} 個工作日`}入帳，${hit ? '會' : '不'}影響 ${close} 關帳`,
    `Payroll journals for month ${month()} will be posted ${sameDay ? 'half a day' : `${days} working ${plural(days, 'day', 'days')}`} late; the ${close} book closing is ${hit ? '' : 'not '}affected`,
  );
}

/** 把小時數寫成「2 小時 40 分」。 */
export function fmtHoursText(hours: number): L10n {
  const h = Math.floor(hours);
  const m = Math.round((hours - h) * 60);
  return L(`${h ? `${h} 小時` : ''}${m ? ` ${m} 分` : ''}`.trim(), `${h ? `${h} h` : ''}${m ? ` ${m} min` : ''}`.trim());
}

function generic(state: AppState, iface: Iface, st: IfaceStatus): L10n | null {
  const run = st.run;
  if (st.health === 'crit') {
    const reports = reportsOf(state, iface);
    return L(
      `「${iface.plain.zh}」停了${reports ? `。受影響的報表：${reports.zh}` : ''}`,
      `“${iface.plain.en}” has stopped${reports ? `. Affected reports: ${reports.en}` : ''}`,
    );
  }
  if (run?.status === 'held')
    return L(`「${iface.plain.zh}」還沒做，要等前一步完成`, `“${iface.plain.en}” has not run yet; it is waiting for the step before it`);
  if (run?.status === 'late')
    return L(`「${iface.plain.zh}」比平常晚 ${run.lateMin ?? 0} 分鐘完成`, `“${iface.plain.en}” finished ${run.lateMin ?? 0} min later than usual`);
  // 重試後成功：資料已經到了，對業務單位沒有影響，不用說
  return null;
}

function forFinance(state: AppState, iface: Iface, st: IfaceStatus): L10n | null {
  if (iface.id === 'INT-015') return payrollPosting(state, iface, st);
  // 薪資分錄還沒到排定時間，但它的上游已經中斷：先講可能會晚
  if (iface.id === 'INT-014' && st.health === 'crit') {
    const posting = state.ifaces.find((i) => i.id === 'INT-015');
    const ranToday = posting && dayOf(lastRun(state, posting.id)?.at ?? '') === TODAY;
    if (posting && !ranToday) {
      const at = posting.schedule.at ?? '';
      return L(
        `今天 ${at} 的 ${month()} 月薪資分錄可能會晚入帳，資訊處正在處理`,
        `Today’s ${at} payroll posting for month ${month()} may be late; IT is working on it`,
      );
    }
    return null;
  }
  if (iface.id === 'INT-014') return null;
  return generic(state, iface, st);
}

function forHr(state: AppState, iface: Iface, st: IfaceStatus): L10n | null {
  if (iface.id === 'INT-014') {
    const waiting = queued(state, iface.id).length;
    if (waiting)
      return L(
        `${waiting} 位新進與異動同仁的成本中心還沒更新`,
        `Cost centres of ${waiting} new and transferred ${plural(waiting, 'employee', 'employees')} have not been updated yet`,
      );
    const resent = state.dlq.filter((d) => d.ifaceId === iface.id && d.status === 'resent').length;
    const run = st.run;
    if (resent && run && dayOf(run.at) === TODAY)
      return L(
        `${resent} 位同仁的成本中心已在 ${timeOf(run.at)} 更新`,
        `Cost centres of ${resent} ${plural(resent, 'employee', 'employees')} were updated at ${timeOf(run.at)}`,
      );
    return st.health === 'crit' ? generic(state, iface, st) : null;
  }
  if (iface.id === 'INT-015') return null; // 入帳是會計的事；人資關心的是成本中心有沒有更新
  return generic(state, iface, st);
}

function forBusiness(state: AppState, iface: Iface, st: IfaceStatus): L10n | null {
  if (iface.id === 'INT-052' && st.health !== 'ok') {
    const every = iface.schedule.everyMin ?? 15;
    return L(
      `新進或調動的業務人員，系統權限可能晚 ${every} 分鐘生效`,
      `System access for new or transferred sales staff may take ${every} min longer to apply`,
    );
  }
  return generic(state, iface, st);
}

/** 某條介面現在的狀況，對某種讀者該怎麼說。跟這種讀者無關，或沒有值得說的，就回 null。 */
export function sayAbout(state: AppState, iface: Iface, audience: Audience): L10n | null {
  const st = ifaceStatus(state, iface);
  if (audience === 'engineer') return st.health === 'ok' && !caughtUp(state, iface) ? null : forEngineer(state, iface, st);
  const special = (audience === 'finance' && (iface.id === 'INT-014' || iface.id === 'INT-015')) || (audience === 'business' && iface.id === 'INT-052');
  if (!special && !DOMAINS[audience]?.includes(iface.domain)) return null;
  if (audience === 'finance') return forFinance(state, iface, st);
  if (audience === 'hr') return forHr(state, iface, st);
  if (audience === 'business') return forBusiness(state, iface, st);
  return null;
}

function ticketLine(state: AppState, ticket: Ticket): Statement {
  const vendor = state.vendors.find((v) => v.id === ticket.vendorId);
  if (!vendor) throw new Error(`沒有這家廠商：${ticket.vendorId}`);
  const sla = ticketSla(ticket, vendor, state.clock);
  const overdue = sla.state === 'overdue';
  const left = fmtHoursFixed(Math.abs(sla.remainingHr ?? 0));
  return {
    id: `ticket:${ticket.id}`,
    health: overdue ? 'crit' : sla.used >= 0.75 || ticket.priority === 'P1' ? 'warn' : 'ok',
    ticketId: ticket.id,
    ifaceId: ticket.ifaceId,
    text: L(
      `${ticket.priority} 工單 ${ticket.id}：${ticket.title.zh}。解決時限 ${md(dayOf(sla.resolveDue))} ${timeOf(sla.resolveDue)}，${overdue ? `已逾時 ${left.zh}` : `還剩 ${left.zh}`}`,
      `${ticket.priority} ticket ${ticket.id}: ${ticket.title.en}. Resolve by ${md(dayOf(sla.resolveDue))} ${timeOf(sla.resolveDue)}; ${overdue ? `${left.en} overdue` : `${left.en} left`}`,
    ),
  };
}

function fmtHoursFixed(hours: number): L10n {
  if (hours >= 48) return L(`${Math.round(hours / 24)} 天`, `${Math.round(hours / 24)} d`);
  return fmtHoursText(hours).zh ? fmtHoursText(hours) : L('不到 1 分鐘', 'under a minute');
}

const ORDER: Record<Health, number> = { crit: 0, warn: 1, ok: 2 };

/** 某種讀者現在該知道的事，最嚴重的排前面。 */
export function statementsFor(state: AppState, audience: Audience, vendorId?: VendorId | null): Statement[] {
  const out: Statement[] = [];
  if (audience === 'vendor') {
    for (const vendor of state.vendors) {
      if (vendorId && vendor.id !== vendorId) continue;
      const m = vendorMetrics(state, vendor.id);
      for (const ticket of m.open) out.push(ticketLine(state, ticket));
      for (const d of m.lateOpen) {
        const days = workdaysBetween(d.due, TODAY);
        out.push({
          id: `deliverable:${d.id}`,
          health: 'crit',
          text: L(
            `交付項 ${d.id}「${d.title.zh}」已過期限 ${days} 個工作日（期限 ${md(d.due)}）`,
            `Deliverable ${d.id} “${d.title.en}” is ${days} working ${plural(days, 'day', 'days')} past its due date (${md(d.due)})`,
          ),
        });
      }
    }
  } else if (audience === 'audit') {
    for (const iface of state.ifaces) {
      const waiting = queued(state, iface.id).length;
      const resent = state.dlq.filter((d) => d.ifaceId === iface.id && d.status === 'resent').length;
      if (waiting)
        out.push({
          id: `dlq:${iface.id}`,
          health: 'warn',
          ifaceId: iface.id,
          text: L(
            `${iface.id} 有 ${waiting} 筆資料在 DLQ，還沒重送`,
            `${iface.id} has ${waiting} ${plural(waiting, 'record', 'records')} in the DLQ, not yet resent`,
          ),
        });
      else if (resent)
        out.push({
          id: `dlq:${iface.id}`,
          health: 'ok',
          ifaceId: iface.id,
          text: L(
            `${iface.id} 的 ${resent} 筆資料已經重送，稽核軌跡有紀錄`,
            `${iface.id}: ${resent} ${plural(resent, 'record', 'records')} resent; recorded in the audit trail`,
          ),
        });
    }
    for (const fault of state.faults)
      out.push({
        id: `fault:${fault}`,
        health: 'warn',
        text: L(`有人對 ${fault} 注入故障做影響模擬（不是真的中斷）`, `Someone injected a fault on ${fault} to simulate impact (not a real outage)`),
      });
  } else {
    for (const iface of state.ifaces) {
      const text = sayAbout(state, iface, audience);
      if (text) out.push({ id: `iface:${iface.id}`, health: ifaceStatus(state, iface).health, ifaceId: iface.id, text });
    }
  }
  return out.sort((a, b) => ORDER[a.health] - ORDER[b.health]);
}

/** 「說法對照」：同一條介面的狀況，並排列出每種讀者會看到的句子。 */
export function sideBySide(state: AppState, iface: Iface): { audience: Audience; text: L10n | null }[] {
  const ticket = state.tickets.find((t) => t.ifaceId === iface.id && !t.resolvedAt);
  const waiting = queued(state, iface.id).length;
  const auditLine = statementsFor(state, 'audit').find((s) => s.ifaceId === iface.id)?.text ?? null;
  return [
    { audience: 'engineer', text: sayAbout(state, iface, 'engineer') },
    { audience: 'finance', text: sayAbout(state, iface, 'finance') ?? downstreamSay(state, iface, 'finance') },
    { audience: 'hr', text: sayAbout(state, iface, 'hr') },
    { audience: 'business', text: sayAbout(state, iface, 'business') },
    { audience: 'vendor', text: ticket ? ticketLine(state, ticket).text : null },
    { audience: 'audit', text: waiting || auditLine ? auditLine : null },
  ];
}

/** 這條介面本身對某種讀者沒話說，但被它擋住的下游有：用下游的說法。 */
function downstreamSay(state: AppState, iface: Iface, audience: Audience): L10n | null {
  for (const down of state.ifaces) {
    if (!down.dependsOn.includes(iface.id)) continue;
    const text = sayAbout(state, down, audience);
    if (text) return text;
  }
  return null;
}
