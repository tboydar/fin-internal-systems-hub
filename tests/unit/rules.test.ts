import { describe, expect, test } from 'bun:test';
import { DEMO_NOW, isWorkday, MONTH_END, TODAY } from '../../src/core/date';
import { busFactors, docDue, freezeOn, freezes, isStale, loadOf, openDiffs, pendingFor, ruleTotals, slaRisk } from '../../src/core/derive';
import { PENALTY, PENALTY_CAP, penaltyOf, ticketSla, vendorMetrics } from '../../src/core/sla';
import type { Ticket, Vendor } from '../../src/core/types';
import { buildInitialState } from '../../src/mock';

// 跨頁的規則：數字都是從資料列算出來的，而且對得起來。

const state = buildInitialState();

describe('規模', () => {
  test('需求 20、歷史事件 6、ADR 8、文件 15、對帳規則 10、路徑圖項目 12', () => {
    expect(state.demands).toHaveLength(20);
    expect(state.incidents).toHaveLength(6);
    expect(state.adrs).toHaveLength(8);
    expect(state.docs).toHaveLength(15);
    expect(state.reconRules).toHaveLength(10);
    expect(state.roadmap).toHaveLength(12);
  });

  test('編號不重複', () => {
    const lists = [
      state.tickets,
      state.deliverables,
      state.milestones,
      state.raci,
      state.changeRequests,
      state.demands,
      state.decisions,
      state.incidents,
      state.changes,
      state.adrs,
      state.docs,
      state.roadmap,
      state.reconRules,
      state.reconDiffs,
      state.tasks,
      state.reviews,
      state.audit,
    ];
    for (const list of lists) {
      const ids = list.map((x) => x.id);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  test('參照都對得上', () => {
    const has = (list: { id: string }[]) => new Set(list.map((x) => x.id));
    const people = has(state.people);
    const systems = has(state.systems);
    const vendors = has(state.vendors);
    const ifaces = has(state.ifaces);
    const rules = has(state.reconRules);
    const decisions = has(state.decisions);
    const roadmap = has(state.roadmap);
    const docs = has(state.docs);
    const incidents = has(state.incidents);
    const adrs = has(state.adrs);
    for (const t of state.tickets) {
      expect(vendors.has(t.vendorId)).toBe(true);
      expect(state.systems.find((s) => s.id === t.systemId)?.vendorId).toBe(t.vendorId);
      if (t.ifaceId) expect(ifaces.has(t.ifaceId)).toBe(true);
    }
    for (const d of state.reconDiffs) expect(rules.has(d.ruleId)).toBe(true);
    for (const r of state.reconRules) {
      expect(people.has(r.ownerId)).toBe(true);
      for (const id of r.ifaceIds) expect(ifaces.has(id)).toBe(true);
    }
    for (const i of state.ifaces) {
      for (const id of i.reconIds) expect(rules.has(id)).toBe(true);
      if (i.runbookId) expect(docs.has(i.runbookId)).toBe(true);
    }
    for (const d of state.demands) {
      expect(people.has(d.requesterId)).toBe(true);
      for (const s of d.systemIds) expect(systems.has(s)).toBe(true);
      if (d.decisionId) expect(decisions.has(d.decisionId)).toBe(true);
      if (d.roadmapId) expect(roadmap.has(d.roadmapId)).toBe(true);
    }
    for (const c of state.changeRequests) if (c.decisionId) expect(decisions.has(c.decisionId)).toBe(true);
    for (const r of state.roadmap) for (const dep of r.dependsOn) expect(roadmap.has(dep)).toBe(true);
    for (const a of state.adrs) if (a.incidentId) expect(incidents.has(a.incidentId)).toBe(true);
    for (const i of state.incidents) if (i.adrId) expect(adrs.has(i.adrId)).toBe(true);
    for (const t of state.tasks) if (t.assigneeId) expect(people.has(t.assigneeId)).toBe(true);
    for (const r of state.reviews) expect(people.has(r.authorId) && people.has(r.reviewerId)).toBe(true);
  });

  test('需求的階段與內容一致：有方案才會等決定，排了程就有決策紀錄', () => {
    for (const d of state.demands) {
      if (d.stage === 'options') expect(d.options.length).toBeGreaterThanOrEqual(2);
      if (d.stage === 'decided' || d.stage === 'scheduled' || d.stage === 'declined') expect(d.decisionId).toBeDefined();
      if (d.stage === 'submitted' || d.stage === 'assessing') expect(d.decisionId).toBeUndefined();
    }
  });
});

describe('SLA', () => {
  const vendor = { sla: { P1: { respondMin: 30, resolveHr: 4 }, P2: { respondMin: 60, resolveHr: 8 }, P3: { respondMin: 240, resolveHr: 72 } } } as Vendor;
  const ticket = (patch: Partial<Ticket>): Ticket => ({
    id: 'T',
    vendorId: 'v-erp',
    systemId: 'erp-gl',
    title: { zh: 'x', en: 'x' },
    priority: 'P1',
    openedAt: '2026-11-27T06:00:00+08:00',
    ...patch,
  });

  test('準時解決、逾時解決、還開著但已逾時、還在時限內', () => {
    expect(ticketSla(ticket({ resolvedAt: '2026-11-27T09:30:00+08:00' }), vendor, DEMO_NOW).state).toBe('met');
    const late = ticketSla(ticket({ resolvedAt: '2026-11-27T10:15:00+08:00' }), vendor, DEMO_NOW);
    expect([late.state, late.lateHr]).toEqual(['breached', 0.25]);
    const overdue = ticketSla(ticket({}), vendor, DEMO_NOW); // 06:00 開單，10:00 到期，現在 10:30
    expect([overdue.state, overdue.lateHr, overdue.remainingHr]).toEqual(['overdue', 0.5, -0.5]);
    const running = ticketSla(ticket({ openedAt: '2026-11-27T09:30:00+08:00' }), vendor, DEMO_NOW);
    expect([running.state, running.remainingHr, running.used]).toEqual(['running', 3, 0.25]);
  });

  test('回應時限', () => {
    expect(ticketSla(ticket({ respondedAt: '2026-11-27T06:20:00+08:00' }), vendor, DEMO_NOW).respondMet).toBe(true);
    expect(ticketSla(ticket({ respondedAt: '2026-11-27T06:45:00+08:00' }), vendor, DEMO_NOW).respondMet).toBe(false);
    expect(ticketSla(ticket({ openedAt: '2026-11-27T10:20:00+08:00' }), vendor, DEMO_NOW).respondMet).toBeNull();
  });

  test('達成率是從工單算出來的：重算一次，數字相同', () => {
    for (const v of state.vendors) {
      const m = vendorMetrics(state, v.id);
      const again = m.tickets.map((t) => ticketSla(t, v).state);
      const met = again.filter((s) => s === 'met').length;
      const bad = again.filter((s) => s === 'breached' || s === 'overdue').length;
      expect(m.met.length).toBe(met);
      expect(m.breaches.length).toBe(bad);
      expect(m.slaRate).toBe(met / (met + bad));
      expect(m.counted.length + m.open.length - m.breaches.filter((t) => !t.resolvedAt).length).toBe(m.tickets.length);
    }
  });

  test('改掉一張工單，達成率就跟著變', () => {
    const copy = buildInitialState();
    const before = vendorMetrics(copy, 'v-erp').slaRate;
    const victim = vendorMetrics(copy, 'v-erp').met[0];
    victim.resolvedAt = DEMO_NOW;
    expect(vendorMetrics(copy, 'v-erp').slaRate).toBeLessThan(before);
  });

  test('有一家表現好、一家普通', () => {
    const rate = (id: 'v-erp' | 'v-crm' | 'v-hr' | 'v-wf') => vendorMetrics(state, id).slaRate;
    expect(rate('v-erp')).toBeGreaterThan(0.93);
    expect(rate('v-crm')).toBeLessThan(0.88);
    expect(rate('v-crm')).toBeGreaterThan(0.6);
    expect(rate('v-erp')).toBeGreaterThan(rate('v-hr'));
    expect(vendorMetrics(state, 'v-erp').onTimeRate).toBe(1);
    expect(vendorMetrics(state, 'v-crm').onTimeRate).toBeLessThan(0.7);
    expect(vendorMetrics(state, 'v-crm').rejectRate).toBeGreaterThan(vendorMetrics(state, 'v-erp').rejectRate);
  });

  test('交付準時率與驗收退件率來自交付項', () => {
    const m = vendorMetrics(state, 'v-crm');
    // 5 個交付項：2 個準時、2 個遲交、1 個過期未交
    expect([m.delivered.length, m.onTime.length, m.lateOpen.length]).toEqual([4, 2, 1]);
    expect(m.onTimeRate).toBe(2 / 5);
    expect([m.inspected.length, m.rejected.length]).toEqual([4, 2]);
  });

  test('計罰＝月服務費 × 比例 × 逾時單位數，單月有上限', () => {
    for (const v of state.vendors) {
      const calc = penaltyOf(state, v.id);
      for (const row of calc.rows) {
        const rule = PENALTY[row.ticket.priority];
        expect(row.units).toBe(Math.ceil(row.sla.lateHr / rule.unitHr));
        expect(row.amount).toBe(Math.round(v.monthlyFee * rule.rate * row.units));
      }
      expect(calc.subtotal).toBe(calc.rows.reduce((sum, r) => sum + r.amount, 0));
      expect(calc.cap).toBe(v.monthlyFee * PENALTY_CAP);
      expect(calc.total).toBe(Math.min(calc.subtotal, calc.cap));
    }
    // CRM 廠商這個月至少有一張還開著的逾時工單
    expect(penaltyOf(state, 'v-crm').rows.some((r) => !r.ticket.resolvedAt)).toBe(true);
  });

  test('所有時間都不晚於 Demo 的現在', () => {
    for (const t of state.tickets) {
      expect(t.openedAt <= DEMO_NOW).toBe(true);
      if (t.respondedAt) expect(t.respondedAt >= t.openedAt).toBe(true);
      if (t.resolvedAt) expect(t.resolvedAt <= DEMO_NOW && t.resolvedAt >= t.openedAt).toBe(true);
    }
  });
});

describe('對帳', () => {
  test('右側總數由左側扣掉差異算出', () => {
    for (const rule of state.reconRules) {
      const totals = ruleTotals(state, rule);
      expect(totals.diffs).toEqual(openDiffs(state, rule.id));
      if (rule.kind === 'amount') expect(totals.left - totals.right).toBe(totals.diffs.reduce((sum, d) => sum + d.amount, 0));
      else expect(totals.left - totals.right).toBe(totals.diffs.length);
    }
  });

  test('只有金額規則的差異帶金額', () => {
    const kind = new Map(state.reconRules.map((r) => [r.id, r.kind]));
    for (const d of state.reconDiffs) {
      if (kind.get(d.ruleId) === 'amount') expect(d.amount).not.toBe(0);
      else expect(d.amount).toBe(0);
    }
  });

  test('每條規則都有 SQL；其中一條附執行計畫的前後對照', () => {
    for (const rule of state.reconRules) expect(rule.sql).toMatch(/SELECT[\s\S]+FROM/);
    const withPlan = state.reconRules.filter((r) => r.plan);
    expect(withPlan.map((r) => r.id)).toEqual(['RC-05']);
    expect(withPlan[0].plan?.before).toContain('Seq Scan');
    expect(withPlan[0].plan?.after).toContain('Index Scan');
  });

  test('不全平也不全亂：10 條裡有 4 條有差異', () => {
    const dirty = state.reconRules.filter((r) => openDiffs(state, r.id).length > 0);
    expect(dirty).toHaveLength(4);
    expect(openDiffs(state)).toHaveLength(10);
  });
});

describe('團隊與文件', () => {
  test('負載由任務算出：有人超過 100%，有人不到 70%', () => {
    const load = (id: string) => loadOf(state, state.people.find((p) => p.id === id)!)?.ratio ?? 0;
    expect(load('e4')).toBeGreaterThan(1.2);
    expect(load('e3')).toBeLessThan(0.7);
    expect(load('e1')).toBe(1);
    expect(loadOf(state, state.people.find((p) => p.id === 'b1')!)).toBeNull();
    const copy = buildInitialState();
    copy.tasks.find((t) => t.id === 'T-534')!.assigneeId = 'e3';
    expect(loadOf(copy, copy.people.find((p) => p.id === 'e4')!)?.ratio).toBe(9 / 8);
  });

  test('bus factor：簽呈與 AD 只有一位內部成員能獨立處理', () => {
    const bf = new Map(busFactors(state).map((b) => [b.skill, b.internal.map((p) => p.id)]));
    expect(bf.get('wf')).toEqual(['e4']);
    expect(bf.get('iam')).toEqual(['e4']);
    expect(bf.get('sql')?.length).toBeGreaterThanOrEqual(3);
  });

  test('有幾份文件過期，但不是全部', () => {
    const stale = state.docs.filter((d) => isStale(d));
    expect(stale.map((d) => d.id)).toEqual(['DOC-02', 'DOC-08', 'DOC-10', 'DOC-13', 'DOC-14']);
    expect(docDue({ reviewed: '2026-10-02', cycleDays: 90 })).toBe('2026-12-31');
  });
});

describe('凍結期與變更', () => {
  test('月結凍結：月結日前一個工作日到關帳日；年結凍結：12/21 到 1 月關帳日', () => {
    expect(freezeOn(TODAY)?.kind).toBe('monthEnd');
    expect(freezeOn(MONTH_END)?.kind).toBe('monthEnd');
    expect(freezeOn('2026-12-04')?.kind).toBe('monthEnd');
    expect(freezeOn('2026-12-07')).toBeUndefined();
    expect(freezeOn('2026-12-21')?.kind).toBe('yearEnd');
    expect(freezeOn('2027-01-07')?.kind).toBe('yearEnd');
    expect(freezeOn('2027-01-08')).toBeUndefined();
    expect(freezes('2026-11', '2027-01').map((f) => `${f.kind} ${f.start}~${f.end}`)).toEqual([
      'monthEnd 2026-11-27~2026-12-04',
      'monthEnd 2026-12-30~2027-01-07',
      'yearEnd 2026-12-21~2027-01-07',
      // 2027 年 2 月有春節連假，第 4 個工作日是 2/11
      'monthEnd 2027-01-28~2027-02-11',
    ]);
  });

  test('已核准的變更都不在凍結期，除非是標準變更；也不排在國定假日', () => {
    for (const c of state.changes) {
      expect([c.id, !!state.docs && c.date !== '2026-12-25' && c.date !== '2027-01-01']).toEqual([c.id, true]);
      if (c.status === 'approved' && c.kind !== 'standard') expect([c.id, freezeOn(c.date)?.kind]).toEqual([c.id, undefined]);
    }
    // 排在平日的一般變更都在晚上；白天的都排在週末
    for (const c of state.changes.filter((x) => x.kind === 'normal')) {
      const evening = Number(c.window.slice(0, 2)) >= 18;
      expect([c.id, evening || !isWorkday(c.date)]).toEqual([c.id, true]);
    }
  });

  test('有一張等核准的變更落在月結凍結期（CRM 6.3）', () => {
    const blocked = state.changes.filter((c) => c.status === 'requested' && freezeOn(c.date));
    expect(blocked.map((c) => c.id)).toEqual(['CHG-243']);
  });

  test('不可逆的變更一定有把關清單', () => {
    for (const c of state.changes) expect([c.id, c.gates.length > 0]).toEqual([c.id, c.irreversible]);
  });
});

describe('等我決定的事與 SLA 風險', () => {
  test('每一類的數字等於資料列數，合計也對', () => {
    const p = pendingFor(state, 'tl');
    expect([p.crs.length, p.demands.length, p.changes.length, p.acceptances.length, p.reviews.length]).toEqual([1, 3, 5, 0, 1]);
    expect(p.total).toBe(10);
    const risk = slaRisk(state);
    expect(risk.total).toBe(risk.overdue.length + risk.atRisk.length + risk.lateDeliverables.length);
    expect(risk.overdue.map((t) => t.vendorId)).toEqual(['v-crm']);
    expect(risk.lateDeliverables.map((d) => d.id)).toEqual(['DL-415']);
  });

  test('委外廠商 PM 的範圍只有自家', () => {
    expect(slaRisk(state, 'v-erp').overdue).toEqual([]);
    expect(slaRisk(state, 'v-crm').total).toBe(slaRisk(state).overdue.length + slaRisk(state, 'v-crm').atRisk.length + 1);
  });
});
