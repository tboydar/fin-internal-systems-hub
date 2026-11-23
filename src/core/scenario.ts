import { at, TODAY } from './date';
import { L } from './i18n';
import { addRun, logAs, moveIncident, person, resendDlq, resolveDiffs } from './mutations';
import { store } from './store';
import type { AppState, DlqItem, L10n, ScenarioId } from './types';

// 劇本：一串會改資料的步驟。每一步都只是改同一份狀態，
// 所以所有頁面與 3D 場景不需要知道「現在在演哪一齣」，照常讀狀態就會同步變化。

export interface StepDef {
  title: L10n;
  /** 這一步發生後，Demo 的時鐘推到今天的幾點幾分。 */
  time: string;
  /** 發生之後，去哪一頁看結果。 */
  look: { path: string; query?: Record<string, string>; label: L10n };
  /** 這一步等同於頁面上的哪個動作（例如按下「重送 37 筆」）。在頁面上做了這個動作，劇本也會往前走。 */
  action?: string;
  apply(draft: AppState): void;
}

export interface ScenarioDef {
  id: ScenarioId;
  name: L10n;
  brief: L10n;
  steps: StepDef[];
}

// ── 劇本 A：月結前一天，人事→ERP 員工主檔同步失敗

const A_INCIDENT = 'INC-2607';
const A_TICKET_TITLE = L('員工主檔寫入 API 在整點逾時（HTTP 504）', 'Employee master write API times out on the hour (HTTP 504)');
const COST_CENTERS = ['1120', '2140', '2310', '3120', '3310', '4120', '4210', '5110', '6230'];

/** 37 筆沒同步過去的資料：14 位新進、23 位異動。只有員工編號，沒有姓名。 */
function failedRecords(runId: string): DlqItem[] {
  const items: DlqItem[] = [];
  for (let i = 0; i < 37; i++) {
    const joiner = i < 14;
    const to = COST_CENTERS[(i * 4 + 2) % COST_CENTERS.length];
    const from = COST_CENTERS[(i * 7 + 5) % COST_CENTERS.length];
    items.push({
      id: `DLQ-${String(4101 + i)}`,
      ifaceId: 'INT-014',
      runId,
      key: joiner ? `E26-${String(871 + i).padStart(4, '0')}` : `E${17 + (i % 8)}-${String(1043 + i * 37).padStart(4, '0')}`,
      kind: joiner ? L('新進', 'New hire') : L('異動', 'Transfer'),
      detail: joiner
        ? L(`成本中心 ${to}，12/1 生效`, `Cost centre ${to}, effective 12/1`)
        : L(`成本中心 ${from === to ? '1120' : from} → ${to}，12/1 生效`, `Cost centre ${from === to ? '1120' : from} → ${to}, effective 12/1`),
      status: 'queued',
    });
  }
  return items;
}

const SCENARIO_A: ScenarioDef = {
  id: 'A',
  name: L('月結前一天，員工主檔同步失敗', 'Employee master sync fails the day before month-end'),
  brief: L(
    '人事→ERP 的員工主檔同步在薪資分錄拋轉前一小時失敗。看同一件事在工程師、財務、人資眼中各是什麼，以及怎麼收尾。',
    'The HR → ERP employee master sync fails an hour before payroll posting. See how the same event reads to an engineer, to Finance and to HR, and how it is closed out.',
  ),
  steps: [
    {
      title: L('13:00 的同步失敗：HTTP 504，重試 3/3，37 筆進 DLQ', 'The 13:00 sync fails: HTTP 504, retries 3/3, 37 records in the DLQ'),
      time: '13:05',
      look: { path: '/integration', query: { iface: 'INT-014' }, label: L('整合架構：INT-014', 'Integration: INT-014') },
      apply(draft) {
        addRun(draft, { ifaceId: 'INT-014', at: at(TODAY, '11:00'), status: 'ok', records: 9, failed: 0, attempts: 1, seconds: 4 });
        addRun(draft, {
          ifaceId: 'INT-014',
          at: at(TODAY, '12:00'),
          status: 'retried',
          records: 6,
          failed: 0,
          attempts: 2,
          seconds: 41,
          http: 504,
          note: L('第一次逾時，重試後成功', 'First attempt timed out; succeeded on retry'),
        });
        const run = addRun(draft, {
          ifaceId: 'INT-014',
          at: at(TODAY, '13:00'),
          status: 'fail',
          records: 37,
          failed: 37,
          attempts: 4,
          seconds: 132,
          http: 504,
          note: L('重試 3 次都逾時，37 筆進 DLQ', 'All 3 retries timed out; 37 records went to the DLQ'),
        });
        draft.dlq.push(...failedRecords(run.id));
        draft.incidents.unshift({
          id: A_INCIDENT,
          title: L('員工主檔同步失敗，37 筆進 DLQ（月結前一天）', 'Employee master sync failed; 37 records in the DLQ (day before month-end)'),
          severity: 'S2',
          systemId: 'esb',
          ifaceId: 'INT-014',
          stage: 'triggered',
          ownerId: null,
          startedAt: at(TODAY, '13:00'),
          impact: L(
            '37 位新進與異動同仁的成本中心沒有更新到 ERP；今天 14:00 的薪資分錄拋轉要用到這些成本中心',
            'Cost centres of 37 new and transferred staff did not reach ERP; today’s 14:00 payroll posting depends on them',
          ),
          rootCause: L('調查中', 'Under investigation'),
          fix: L('還沒有', 'None yet'),
          actions: [],
          timeline: [{ stage: 'triggered', at: at(TODAY, '13:00'), by: 'system' }],
        });
        logAs(
          draft,
          'system',
          L('介面告警', 'Interface alert'),
          'INT-014',
          L('HTTP 504，重試 3/3，37 筆進 DLQ；開立事件 INC-2607', 'HTTP 504, retries 3/3, 37 records in the DLQ; incident INC-2607 opened'),
        );
      },
    },
    {
      title: L('14:00 的薪資分錄被保留，沒有入帳', 'The 14:00 payroll posting is held, not posted'),
      time: '14:02',
      look: { path: '/integration', query: { iface: 'INT-015' }, label: L('整合架構：INT-015', 'Integration: INT-015') },
      apply(draft) {
        moveIncident(draft, A_INCIDENT, 'assigned', 'e1', at(TODAY, '13:08'));
        const incident = draft.incidents.find((i) => i.id === A_INCIDENT);
        if (incident) incident.ownerId = 'e1';
        moveIncident(draft, A_INCIDENT, 'mitigating', 'e1', at(TODAY, '13:20'));
        addRun(draft, {
          ifaceId: 'INT-015',
          at: at(TODAY, '14:00'),
          status: 'held',
          records: 0,
          failed: 0,
          attempts: 0,
          seconds: 0,
          note: L('上游 INT-014 還有 37 筆沒同步，薪資分錄先保留', 'Upstream INT-014 still has 37 unsynced records; payroll posting is held'),
        });
        logAs(
          draft,
          'system',
          L('保留執行', 'Held run'),
          'INT-015',
          L('相依的 INT-014 還沒成功，11 月薪資分錄先不拋轉', 'Dependency INT-014 has not succeeded; November payroll posting is held'),
        );
      },
    },
    {
      title: L('對帳規則 RC-03 出現 37 筆差異', 'Reconciliation rule RC-03 shows 37 differences'),
      time: '14:06',
      look: { path: '/consistency', query: { rule: 'RC-03' }, label: L('資料一致性：RC-03', 'Data consistency: RC-03') },
      apply(draft) {
        const rule = draft.reconRules.find((r) => r.id === 'RC-03');
        if (rule) rule.lastRunAt = at(TODAY, '14:05');
        for (const item of draft.dlq.filter((d) => d.ifaceId === 'INT-014' && d.status === 'queued')) {
          draft.reconDiffs.push({
            id: `DF-3${item.id.slice(-3)}`,
            ruleId: 'RC-03',
            key: item.key,
            left: item.detail,
            right: item.kind.zh === '新進' ? L('ERP 沒有這位員工', 'Not found in ERP') : L('ERP 還是舊的成本中心', 'ERP still has the old cost centre'),
            amount: 0,
            reason: L('INT-014 同步失敗，資料還在 DLQ', 'INT-014 sync failed; the record is still in the DLQ'),
            status: 'open',
            foundAt: at(TODAY, '14:05'),
          });
        }
      },
    },
    {
      title: L('開 P1 工單給 ERP 廠商，SLA 開始計時', 'A P1 ticket is opened with the ERP vendor; the SLA clock starts'),
      time: '14:10',
      look: { path: '/vendors', query: { vendor: 'v-erp', tab: 'tickets' }, label: L('廠商管理：嶼衡資訊的工單', 'Vendors: Birchlight tickets') },
      apply(draft) {
        const id = `TK-${2101 + draft.tickets.length}`;
        draft.tickets.push({
          id,
          vendorId: 'v-erp',
          systemId: 'erp-gl',
          title: A_TICKET_TITLE,
          priority: 'P1',
          openedAt: at(TODAY, '14:10'),
          ifaceId: 'INT-014',
          incidentId: A_INCIDENT,
        });
        logAs(
          draft,
          person(draft, 'e1'),
          L('開立工單', 'Opened ticket'),
          id,
          L(
            'P1：員工主檔寫入 API 在整點逾時。回應時限 30 分鐘，解決時限 4 小時',
            'P1: employee master write API times out on the hour. Respond within 30 minutes, resolve within 4 hours',
          ),
        );
      },
    },
    {
      title: L('各角色看到各自的說法', 'Each role sees its own account of it'),
      time: '14:40',
      look: { path: '/overview', label: L('總覽：切換上方的登入身分', 'Overview: switch identity above') },
      apply(draft) {
        const ticket = draft.tickets.find((t) => t.incidentId === A_INCIDENT);
        if (ticket) ticket.respondedAt = at(TODAY, '14:28');
      },
    },
    {
      title: L('廠商停掉整點的排程後，重送 37 筆', 'After the vendor pauses the hourly job, the 37 records are resent'),
      time: '16:30',
      look: { path: '/integration', query: { iface: 'INT-014' }, label: L('整合架構：INT-014', 'Integration: INT-014') },
      action: 'resend:INT-014',
      apply(draft) {
        const ticket = draft.tickets.find((t) => t.incidentId === A_INCIDENT);
        if (ticket) ticket.resolvedAt = at(TODAY, '16:20');
        resendDlq(draft, 'INT-014', person(draft, 'e1'));
        // 上游補齊了，被保留的薪資分錄跟著拋轉；對帳規則重跑後差異歸零
        draft.clock = at(TODAY, '16:40');
        addRun(draft, {
          ifaceId: 'INT-015',
          at: at(TODAY, '16:40'),
          status: 'ok',
          records: 2140,
          failed: 0,
          attempts: 1,
          seconds: 58,
          note: L('上游補齊後拋轉，比原定晚 2 小時 40 分', 'Posted after the upstream caught up, 2 h 40 min later than scheduled'),
        });
        const rule = draft.reconRules.find((r) => r.id === 'RC-03');
        if (rule) rule.lastRunAt = at(TODAY, '16:42');
        resolveDiffs(draft, 'RC-03', 'e1');
        moveIncident(draft, A_INCIDENT, 'recovered', 'e1', at(TODAY, '16:40'));
        const incident = draft.incidents.find((i) => i.id === A_INCIDENT);
        if (incident) {
          incident.rootCause = L(
            'ERP 每小時整點重建成本中心階層，期間員工主檔寫入 API 的回應超過整合層的 30 秒逾時。月底異動多，重建變慢，這次三次重試都落在重建期間',
            'ERP rebuilds the cost-centre hierarchy on the hour; during the rebuild the employee master API exceeds the integration layer’s 30 s timeout. Month-end changes made the rebuild slower, so all three retries fell inside it',
          );
          incident.fix = L(
            '廠商暫停整點的重建排程，重送 DLQ 裡的 37 筆，薪資分錄在 16:40 入帳',
            'The vendor paused the hourly rebuild; the 37 DLQ records were resent and payroll was posted at 16:40',
          );
        }
        draft.clock = at(TODAY, '16:45');
      },
    },
    {
      title: L('事後檢討：原因、時間軸、三項改善', 'Post-incident review: cause, timeline, three actions'),
      time: '17:30',
      look: { path: '/incidents', query: { inc: A_INCIDENT }, label: L('事件與變更：INC-2607', 'Incidents: INC-2607') },
      apply(draft) {
        moveIncident(draft, A_INCIDENT, 'review', 'tl');
        const incident = draft.incidents.find((i) => i.id === A_INCIDENT);
        if (incident) {
          incident.actions = [
            {
              text: L(
                'ERP 的成本中心階層重建改到每小時 20 分，避開整點的同步',
                'Move the ERP cost-centre rebuild to 20 past the hour, away from the on-the-hour sync',
              ),
              ownerId: 'v1',
              due: '2026-12-11',
              done: false,
            },
            {
              text: L(
                '薪資分錄拋轉日，14:00 前一小時暫停重建排程；寫進月結 Runbook',
                'On payroll posting day, pause the rebuild for the hour before 14:00; add it to the month-end runbook',
              ),
              ownerId: 'e3',
              due: '2026-12-22',
              done: false,
            },
            {
              text: L(
                '員工主檔同步改成事件驅動，接收端冪等，不再靠整點批次',
                'Make the employee master sync event-driven with an idempotent receiver, no longer an hourly batch',
              ),
              ownerId: 'e1',
              due: '2027-03-31',
              done: false,
            },
          ];
        }
        logAs(
          draft,
          person(draft, 'tl'),
          L('完成事後檢討', 'Completed post-incident review'),
          A_INCIDENT,
          L('原因已確認，三項改善都有負責人與期限', 'Cause confirmed; three actions with owners and due dates'),
        );
      },
    },
    {
      title: L('留下 ADR-009 與路徑圖項目 RM-13，事件結案', 'ADR-009 and roadmap item RM-13 are recorded; the incident is closed'),
      time: '17:45',
      look: { path: '/incidents', query: { inc: A_INCIDENT }, label: L('事件與變更：INC-2607', 'Incidents: INC-2607') },
      apply(draft) {
        draft.adrs.push({
          id: 'ADR-009',
          title: L('員工主檔同步改成事件驅動，接收端冪等', 'Employee master sync becomes event-driven with an idempotent receiver'),
          status: 'proposed',
          date: TODAY,
          authorId: 'e1',
          reviewed: TODAY,
          context: L(
            'INT-014 每小時整點批次同步，今年第三次因為 ERP 整點變慢而逾時（INC-2603、INC-2605、INC-2607）。這次發生在薪資分錄拋轉前一小時，分錄晚了 2 小時 40 分。',
            'INT-014 syncs in an hourly batch and timed out for the third time this year because ERP slows down on the hour (INC-2603, INC-2605, INC-2607). This time it was an hour before payroll posting, which slipped by 2 h 40 min.',
          ),
          decision: L(
            '人事系統在員工資料異動時發出事件，整合層逐筆送到 ERP；ERP 以「員工編號＋生效日」判斷重複。整點批次保留三個月當備援，之後移除。',
            'HR emits an event when employee data changes and the integration layer delivers each one to ERP; ERP detects duplicates by employee number plus effective date. The hourly batch stays for three months as a fallback, then goes.',
          ),
          consequences: L(
            '不再有「一批 37 筆一起失敗」；單筆失敗只影響那一位同仁。人事系統要提供事件，需要櫟安軟體配合，列入 2027 Q1。',
            'No more “37 records fail together”; a single failure affects one person. HR must emit events, which needs Oakrest Software; scheduled for Q1 2027.',
          ),
          incidentId: A_INCIDENT,
        });
        draft.roadmap.push({
          id: 'RM-13',
          title: L('員工主檔同步改成事件驅動', 'Event-driven employee master sync'),
          plain: L(
            '同仁到職與異動的資料，不再因為系統忙碌而晚到帳務系統',
            'New-hire and transfer data no longer reaches the ledger late because a system is busy',
          ),
          start: '2027-02',
          end: '2027-03',
          dependsOn: ['RM-02'],
          budget: 380_000,
          internalPm: 2,
          vendorPm: 1,
          risk: 'med',
          riskNote: L('要人事與 ERP 兩家廠商同時配合', 'Needs both the HR and the ERP vendor at the same time'),
          systemIds: ['hr', 'esb', 'erp-gl'],
          value: L(
            '人力資源部、會計部。薪資分錄不會再被同步問題拖延。',
            'Human Resources and Accounting. Payroll posting is no longer delayed by sync problems.',
          ),
          tech: L(
            'INT-014 從每小時批次改成事件；API-ERP-EMP 已經是冪等的，不用改。見 ADR-009。',
            'INT-014 moves from an hourly batch to events; API-ERP-EMP is already idempotent and needs no change. See ADR-009.',
          ),
          status: 'proposed',
          sourceId: A_INCIDENT,
        });
        const incident = draft.incidents.find((i) => i.id === A_INCIDENT);
        if (incident) {
          incident.adrId = 'ADR-009';
          incident.roadmapId = 'RM-13';
        }
        moveIncident(draft, A_INCIDENT, 'closed', 'tl');
        logAs(
          draft,
          person(draft, 'tl'),
          L('事件結案', 'Closed incident'),
          A_INCIDENT,
          L('產生 ADR-009 與路徑圖項目 RM-13', 'Produced ADR-009 and roadmap item RM-13'),
        );
      },
    },
  ],
};

export const SCENARIOS: Partial<Record<ScenarioId, ScenarioDef>> = { A: SCENARIO_A };

export interface ScenarioStatus {
  def: ScenarioDef;
  /** 已經走完幾步。 */
  step: number;
  total: number;
  done: boolean;
  /** 剛發生的那一步。還沒開始走是 undefined。 */
  last?: StepDef;
  next?: StepDef;
}

export function scenarioStatus(state: AppState): ScenarioStatus | null {
  const running = state.scenario;
  const def = running ? SCENARIOS[running.id] : undefined;
  if (!running || !def) return null;
  return {
    def,
    step: running.step,
    total: def.steps.length,
    done: running.step >= def.steps.length,
    last: def.steps[running.step - 1],
    next: def.steps[running.step],
  };
}

/** 啟動劇本。資料會先回到初始狀態（權限矩陣保留），劇本才有固定的起點。 */
export function startScenario(id: ScenarioId): void {
  if (!SCENARIOS[id]) return;
  const rbac = structuredClone(store.state.rbac);
  store.reset();
  store.update((s) => {
    s.rbac = rbac;
    s.scenario = { id, step: 0 };
  });
}

/** 走下一步。回傳剛走的那一步；已經走完就回 null。 */
export function nextStep(): StepDef | null {
  const status = scenarioStatus(store.state);
  if (!status?.next) return null;
  const step = status.next;
  store.update((s) => {
    s.clock = at(TODAY, step.time);
    step.apply(s);
    if (s.scenario) s.scenario.step += 1;
  });
  return step;
}

/** 如果劇本的下一步就是這個動作，就讓劇本往前走，回傳 true；否則回 false，由呼叫的人自己做。 */
export function advanceIf(action: string): boolean {
  const status = scenarioStatus(store.state);
  if (status?.next?.action !== action) return false;
  nextStep();
  return true;
}

/** 結束劇本。已經發生的變化會留著，要回到最初請按「還原 Demo 資料」。 */
export function endScenario(): void {
  store.update((s) => {
    s.scenario = null;
  });
}
