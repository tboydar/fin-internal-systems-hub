import { beforeEach, describe, expect, test } from 'bun:test';
import { freezeOn, openDiffs, pendingFor, ruleTotals } from '../../src/core/derive';
import { queued } from '../../src/core/mutations';
import { sayAbout, sideBySide, statementsFor } from '../../src/core/narrative';
import { advanceIf, endScenario, nextStep, SCENARIOS, scenarioStatus, startScenario } from '../../src/core/scenario';
import { ifaceStatus, ifacesByHealth, impactOf } from '../../src/core/selectors';
import { penaltyOf, ticketSla, vendorMetrics } from '../../src/core/sla';
import { store } from '../../src/core/store';
import { buildInitialState } from '../../src/mock';

// 劇本 A 從頭走到尾，以及「同一件事，不同說法」。

const iface = (id: string) => store.state.ifaces.find((i) => i.id === id)!;
const steps = (n: number) => {
  for (let i = 0; i < n; i++) nextStep();
};

beforeEach(() => {
  store.reset();
  store.setPrefs({ role: 'techlead', lang: 'zh' });
});

describe('還沒啟動劇本時', () => {
  test('各種讀者看到的句子來自同一批介面', () => {
    const s = store.state;
    expect(statementsFor(s, 'engineer').map((x) => x.ifaceId)).toEqual(['INT-055', 'INT-014', 'INT-031', 'INT-052']);
    expect(sayAbout(s, iface('INT-014'), 'engineer')?.zh).toBe('INT-014 人事→ERP 員工主檔同步，HTTP 504，重試 1/3 後成功');
    // 重試後成功，對人資與財務沒有影響，不用說
    expect(sayAbout(s, iface('INT-014'), 'hr')).toBeNull();
    expect(sayAbout(s, iface('INT-014'), 'finance')).toBeNull();
    expect(statementsFor(s, 'finance').map((x) => x.text.zh)).toEqual(['「各據點當天的手續費收入入帳」比平常晚 47 分鐘完成']);
    expect(statementsFor(s, 'business').map((x) => x.text.zh)).toEqual(['新進或調動的業務人員，系統權限可能晚 15 分鐘生效']);
    expect(statementsFor(s, 'hr')).toEqual([]);
  });

  test('財務、人資、業務的句子裡沒有介面編號與技術名詞', () => {
    const s = store.state;
    for (const audience of ['finance', 'hr', 'business'] as const) {
      for (const line of statementsFor(s, audience)) expect(line.text.zh).not.toMatch(/INT-|DLQ|HTTP|API|SFTP|JDBC/);
    }
  });

  test('委外廠商 PM 只看得到自家的工單', () => {
    const s = store.state;
    const crm = statementsFor(s, 'vendor', 'v-crm');
    expect(crm.length).toBeGreaterThan(0);
    for (const line of crm) {
      const ticket = s.tickets.find((t) => t.id === line.ticketId);
      if (ticket) expect(ticket.vendorId).toBe('v-crm');
    }
    expect(crm.some((x) => x.text.zh.includes('已逾時'))).toBe(true);
    expect(crm.some((x) => x.text.zh.includes('DL-415'))).toBe(true);
    expect(statementsFor(s, 'vendor', 'v-hr')).toEqual([]);
  });
});

describe('劇本 A', () => {
  test('啟動時資料回到初始狀態，但保留權限矩陣', () => {
    store.update((s) => {
      s.rbac.finance.push('sql.view');
      s.faults.push('crm');
    });
    startScenario('A');
    expect(store.state.faults).toEqual([]);
    expect(store.state.rbac.finance).toContain('sql.view');
    expect(scenarioStatus(store.state)?.step).toBe(0);
    expect(scenarioStatus(store.state)?.total).toBe(8);
  });

  test('第 1 步：三種讀者各自的說法，數字來自同一批 37 筆', () => {
    startScenario('A');
    steps(1);
    const s = store.state;
    expect(queued(s, 'INT-014')).toHaveLength(37);
    expect(ifaceStatus(s, iface('INT-014')).health).toBe('crit');
    expect(sayAbout(s, iface('INT-014'), 'engineer')?.zh).toBe('INT-014 人事→ERP 員工主檔同步，HTTP 504，重試 3/3，37 筆進 DLQ');
    expect(sayAbout(s, iface('INT-014'), 'hr')?.zh).toBe('37 位新進與異動同仁的成本中心還沒更新');
    expect(sayAbout(s, iface('INT-014'), 'finance')?.zh).toBe('今天 14:00 的 11 月薪資分錄可能會晚入帳，資訊處正在處理');
    // DLQ 少一筆，兩邊的數字一起變
    store.update((draft) => {
      draft.dlq[0].status = 'resent';
    });
    expect(sayAbout(store.state, iface('INT-014'), 'engineer')?.zh).toContain('36 筆進 DLQ');
    expect(sayAbout(store.state, iface('INT-014'), 'hr')?.zh).toContain('36 位');
  });

  test('第 2 步：薪資分錄被保留，財務看到的是會晚半天、不影響關帳', () => {
    startScenario('A');
    steps(2);
    const s = store.state;
    expect(ifaceStatus(s, iface('INT-015')).health).toBe('warn');
    expect(sayAbout(s, iface('INT-015'), 'finance')?.zh).toBe('11 月薪資分錄會晚半天入帳，不影響 12/4 關帳');
    expect(sayAbout(s, iface('INT-015'), 'engineer')?.zh).toBe('INT-015 人事→ERP 薪資分錄拋轉，上游 INT-014 還沒成功，先保留不執行');
    expect(sayAbout(s, iface('INT-015'), 'finance')?.en).toBe(
      'Payroll journals for month 11 will be posted half a day late; the 12/4 book closing is not affected',
    );
  });

  test('第 3、4 步：對帳出現 37 筆差異；廠商工單開始計時', () => {
    startScenario('A');
    steps(3);
    expect(openDiffs(store.state, 'RC-03')).toHaveLength(37);
    expect(new Set(openDiffs(store.state, 'RC-03').map((d) => d.key))).toEqual(new Set(queued(store.state, 'INT-014').map((d) => d.key)));
    steps(1);
    const s = store.state;
    const ticket = s.tickets.find((t) => t.incidentId === 'INC-2607')!;
    const vendor = s.vendors.find((v) => v.id === 'v-erp')!;
    expect(ticket.priority).toBe('P1');
    expect(ticketSla(ticket, vendor, s.clock).state).toBe('running');
    expect(ticketSla(ticket, vendor, s.clock).remainingHr).toBe(4);
    expect(vendorMetrics(s, 'v-erp').open.map((t) => t.id)).toContain(ticket.id);
    const line = statementsFor(s, 'vendor', 'v-erp').find((x) => x.ticketId === ticket.id);
    expect(line?.text.zh).toBe(`P1 工單 ${ticket.id}：員工主檔寫入 API 在整點逾時（HTTP 504）。解決時限 11/27 18:10，還剩 4 小時`);
    // 別家廠商的 PM 看不到這張工單
    expect(statementsFor(s, 'vendor', 'v-crm').some((x) => x.ticketId === ticket.id)).toBe(false);
  });

  test('第 5 步：說法對照表把六種讀者並排', () => {
    startScenario('A');
    steps(5);
    const rows = sideBySide(store.state, iface('INT-014'));
    const text = (audience: string) => rows.find((r) => r.audience === audience)?.text?.zh;
    expect(text('engineer')).toBe('INT-014 人事→ERP 員工主檔同步，HTTP 504，重試 3/3，37 筆進 DLQ');
    expect(text('finance')).toBe('11 月薪資分錄會晚半天入帳，不影響 12/4 關帳');
    expect(text('hr')).toBe('37 位新進與異動同仁的成本中心還沒更新');
    expect(text('business')).toBeUndefined();
    expect(text('vendor')).toContain('還剩 3 小時 30 分');
    expect(text('audit')).toBe('INT-014 有 37 筆資料在 DLQ，還沒重送');
  });

  test('第 6 步：重送之後全部回到正常，而且留下紀錄', () => {
    startScenario('A');
    steps(5);
    // 在頁面上按「重送」，劇本也會往前走
    expect(advanceIf('resend:INT-014')).toBe(true);
    const s = store.state;
    expect(scenarioStatus(s)?.step).toBe(6);
    expect(queued(s, 'INT-014')).toHaveLength(0);
    expect(ifaceStatus(s, iface('INT-014')).health).toBe('ok');
    expect(ifaceStatus(s, iface('INT-015')).health).toBe('ok');
    expect(openDiffs(s, 'RC-03')).toHaveLength(0);
    expect(sayAbout(s, iface('INT-015'), 'finance')?.zh).toBe('11 月薪資分錄已在 16:40 入帳，比原定晚 2 小時 40 分；不影響 12/4 關帳');
    expect(sayAbout(s, iface('INT-014'), 'hr')?.zh).toBe('37 位同仁的成本中心已在 16:30 更新');
    expect(s.audit.some((a) => a.target === 'INT-014' && a.action.zh === '重送 DLQ')).toBe(true);
    const ticket = s.tickets.find((t) => t.incidentId === 'INC-2607')!;
    expect(ticketSla(ticket, s.vendors.find((v) => v.id === 'v-erp')!, s.clock).state).toBe('met');
    expect(s.incidents.find((i) => i.id === 'INC-2607')?.stage).toBe('recovered');
    // 不是劇本的下一步時，advanceIf 不會動
    expect(advanceIf('resend:INT-014')).toBe(false);
  });

  test('走完 8 步：事件結案，多一份 ADR 與一個路徑圖項目', () => {
    startScenario('A');
    const before = { adrs: store.state.adrs.length, roadmap: store.state.roadmap.length, incidents: store.state.incidents.length };
    steps(8);
    const s = store.state;
    expect(scenarioStatus(s)?.done).toBe(true);
    expect(nextStep()).toBeNull();
    const incident = s.incidents.find((i) => i.id === 'INC-2607')!;
    expect(incident.stage).toBe('closed');
    expect(incident.timeline.map((e) => e.stage)).toEqual(['triggered', 'assigned', 'mitigating', 'recovered', 'review', 'closed']);
    expect(incident.actions).toHaveLength(3);
    expect([s.adrs.length, s.roadmap.length, s.incidents.length]).toEqual([before.adrs + 1, before.roadmap + 1, before.incidents + 1]);
    expect(s.adrs.find((a) => a.id === incident.adrId)?.incidentId).toBe('INC-2607');
    expect(s.roadmap.find((r) => r.id === incident.roadmapId)?.sourceId).toBe('INC-2607');
    // 時間只會往後走
    const times = incident.timeline.map((e) => e.at);
    expect([...times].sort()).toEqual(times);
    // 介面健康回到跟劇本開始前一樣
    const baseline = ifacesByHealth(buildInitialState());
    expect(ifacesByHealth(s).crit.map((i) => i.id)).toEqual(baseline.crit.map((i) => i.id));
  });

  test('每一步都指向一個看結果的頁面；結束劇本後變化留著', () => {
    for (const step of Object.values(SCENARIOS).flatMap((def) => def.steps)) {
      expect(step.look.path).toMatch(/^\/[a-z]+$/);
      expect(step.time).toMatch(/^\d\d:\d\d$/);
    }
    startScenario('A');
    steps(3);
    endScenario();
    expect(store.state.scenario).toBeNull();
    expect(openDiffs(store.state, 'RC-03')).toHaveLength(37);
  });

  test('劇本的時鐘會推進，倒數與待辦跟著同一份狀態', () => {
    startScenario('A');
    expect(store.state.clock).toBe('2026-11-27T10:30:00+08:00');
    steps(4);
    expect(store.state.clock).toBe('2026-11-27T14:10:00+08:00');
    expect(pendingFor(store.state, 'tl').total).toBe(10);
  });
});

describe('如果它停了', () => {
  test('人事薪資停了：經手的介面全斷，被擋住的下游也算', () => {
    const impact = impactOf(store.state, 'hr');
    const ids = impact.ifaces.map((i) => i.id).sort();
    expect(ids).toEqual(['INT-011', 'INT-012', 'INT-013', 'INT-014', 'INT-015', 'INT-016', 'INT-061']);
    expect(impact.domains.sort()).toEqual(['finance', 'hr', 'it', 'procurement', 'sales']);
  });

  test('整合層停了：所有經整合層的介面都受影響，直連的不受影響', () => {
    const ids = impactOf(store.state, 'esb').ifaces.map((i) => i.id);
    expect(ids).toContain('INT-014');
    expect(ids).toContain('INT-021');
    expect(ids).not.toContain('INT-032');
    expect(ids).not.toContain('INT-051');
  });
});

describe('劇本 B：CRM 廠商交付延遲又被驗收退件', () => {
  test('交付 → 退件 → 違約 → 責任爭議 → 變更請求 → 決策紀錄', () => {
    startScenario('B');
    const before = { decisions: store.state.decisions.length, raci: store.state.raci.length };
    expect(vendorMetrics(store.state, 'v-crm').lateOpen.map((d) => d.id)).toEqual(['DL-415']);

    steps(1);
    let dl = store.state.deliverables.find((d) => d.id === 'DL-415')!;
    expect([dl.deliveredAt, dl.acceptance]).toEqual(['2026-11-27', 'pending']);
    expect(pendingFor(store.state, 'tl').acceptances.map((d) => d.id)).toEqual(['DL-415']);
    // 交付了但是遲交：準時率的分母多一個，分子不變
    expect(vendorMetrics(store.state, 'v-crm').onTimeRate).toBe(2 / 5);

    // 在頁面上按「退件」，劇本也會往前走
    expect(advanceIf('reject:DL-415')).toBe(true);
    dl = store.state.deliverables.find((d) => d.id === 'DL-415')!;
    expect([dl.acceptance, dl.rejects]).toEqual(['rejected', 1]);
    expect(vendorMetrics(store.state, 'v-crm').rejectRate).toBe(3 / 5);

    steps(2);
    expect(store.state.raci.find((r) => r.id === 'v-crm:data')?.disputed).toBeDefined();
    steps(1);
    expect(store.state.changeRequests.find((c) => c.id === 'CR-035')?.stage).toBe('assessed');
    expect(pendingFor(store.state, 'tl').crs.map((c) => c.id)).toContain('CR-035');

    expect(advanceIf('decide:CR-035')).toBe(true);
    const s = store.state;
    expect(scenarioStatus(s)?.done).toBe(true);
    expect(s.changeRequests.find((c) => c.id === 'CR-035')?.decisionId).toBe('DEC-110');
    expect(s.decisions).toHaveLength(before.decisions + 1);
    expect(s.decisions.find((d) => d.id === 'DEC-110')?.why.zh.length).toBeGreaterThan(20);
    // 爭議解掉了，而且責任邊界多一列
    expect(s.raci.find((r) => r.id === 'v-crm:data')?.disputed).toBeUndefined();
    expect(s.raci).toHaveLength(before.raci + 1);
    // 新的上線日不在凍結期裡，所以現在可以核准了
    const release = s.changes.find((c) => c.id === 'CHG-243')!;
    expect(freezeOn(release.date)).toBeUndefined();
    // 別家廠商的數字沒有被動到
    expect(penaltyOf(s, 'v-erp').rows).toEqual(penaltyOf(buildInitialState(), 'v-erp').rows);
  });
});

describe('劇本 C：汰換舊簽呈系統', () => {
  test('分階段切換 → 並行對帳 → 切換日與回滾條件 → 寫進路徑圖', () => {
    startScenario('C');
    steps(1);
    const change = () => store.state.changes.find((c) => c.id === 'CHG-250')!;
    expect(change().status).toBe('requested');
    expect(freezeOn(change().date)).toBeUndefined();

    steps(1);
    const rule = () => store.state.reconRules.find((r) => r.id === 'RC-11')!;
    expect(openDiffs(store.state, 'RC-11')).toHaveLength(3);
    expect(ruleTotals(store.state, rule()).right).toBe(rule().baseLeft - 3);
    expect(rule().sql).toContain('wf2.form');

    steps(1);
    expect(change().gates).toHaveLength(5);
    expect(change().gates.filter((g) => !g.checkedBy)).toHaveLength(4);
    expect(change().rollback.zh).toContain('切回');

    steps(1);
    expect(openDiffs(store.state, 'RC-11')).toHaveLength(0);

    steps(1);
    const s = store.state;
    expect(scenarioStatus(s)?.done).toBe(true);
    const item = s.roadmap.find((r) => r.id === 'RM-01')!;
    expect(item.tech.zh).toContain('2027-03-13');
    expect(item.tech.zh).toContain('RC-11');
    expect(item.sourceId).toBe('CHG-250');
    expect(s.decisions.find((d) => d.id === 'DEC-111')?.decidedBy).toBe('tl');
    expect(s.roadmap).toHaveLength(12);
  });
});
