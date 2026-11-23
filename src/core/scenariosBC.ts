import { at, TODAY } from './date';
import { L } from './i18n';
import { logAs, person, resolveDiffs } from './mutations';
import type { ScenarioDef } from './scenario';
import type { L10n } from './types';

// 劇本 B 與劇本 C 的步驟。寫法跟劇本 A 一樣：每一步只是改同一份狀態。

// ── 劇本 B：CRM 廠商交付延遲又被驗收退件

const B_DELIVERABLE = 'DL-415';
const B_CR = 'CR-035';

export const SCENARIO_B: ScenarioDef = {
  id: 'B',
  name: L('CRM 廠商交付延遲，又被驗收退件', 'The CRM vendor delivers late and fails acceptance'),
  brief: L(
    'CRM 6.3 過了期限五個工作日才交，驗收又沒過。看違約怎麼算、責任邊界的爭議怎麼收，以及最後留下什麼紀錄。',
    'CRM 6.3 arrives five working days late and then fails acceptance. See how the breach is calculated, how the responsibility dispute is settled and what record is left.',
  ),
  steps: [
    {
      title: L('槿川科技交付 CRM 6.3，比期限晚 5 個工作日', 'Elmhaven delivers CRM 6.3, 5 working days late'),
      time: '11:00',
      look: { path: '/vendors', query: { vendor: 'v-crm', tab: 'deliverables' }, label: L('廠商管理：交付項', 'Vendors: deliverables') },
      apply(draft) {
        const d = draft.deliverables.find((x) => x.id === B_DELIVERABLE);
        if (d) d.deliveredAt = TODAY;
        logAs(
          draft,
          person(draft, 'v3'),
          L('交付', 'Delivered'),
          B_DELIVERABLE,
          L('CRM 6.3 據點歸屬整併，期限 11/20', 'CRM 6.3 branch assignment consolidation, due 11/20'),
        );
      },
    },
    {
      title: L('驗收退件：312 位客戶被歸到已裁撤的據點代碼', 'Acceptance rejected: 312 customers assigned to a retired branch code'),
      time: '15:30',
      look: { path: '/vendors', query: { vendor: 'v-crm', tab: 'deliverables' }, label: L('廠商管理：交付項', 'Vendors: deliverables') },
      action: `reject:${B_DELIVERABLE}`,
      apply(draft) {
        const d = draft.deliverables.find((x) => x.id === B_DELIVERABLE);
        if (d) {
          d.acceptance = 'rejected';
          d.rejects += 1;
          d.rejectReason = L(
            '在測試環境跑資料轉換後，312 位客戶被歸到已裁撤的據點代碼。重現方式：用 11/26 的資料快照跑轉換，再執行對帳規則 RC-08',
            'After running the data conversion in the test environment, 312 customers were assigned to a retired branch code. To reproduce: run the conversion on the 11/26 snapshot, then run reconciliation rule RC-08',
          );
        }
        logAs(
          draft,
          person(draft, 'tl'),
          L('驗收退件', 'Rejected deliverable'),
          B_DELIVERABLE,
          L('資料轉換後 312 位客戶歸屬錯誤', '312 customers misassigned after the data conversion'),
        );
      },
    },
    {
      title: L('發出逾期通知：交付違約，開始試算計罰', 'Late-delivery notice issued: the breach is on record and the penalty is estimated'),
      time: '15:45',
      look: { path: '/vendors', query: { vendor: 'v-crm', tab: 'penalty' }, label: L('廠商管理：違約與計罰試算', 'Vendors: breaches and penalty estimate') },
      apply(draft) {
        logAs(
          draft,
          person(draft, 'tl'),
          L('發出逾期通知', 'Issued late-delivery notice'),
          B_DELIVERABLE,
          L('逾期 5 個工作日，依合約每日罰里程碑款項的 0.5%', '5 working days late; the contract sets 0.5% of the milestone payment per day'),
        );
      },
    },
    {
      title: L(
        '責任邊界有爭議：廠商說據點對照表是內部沒給最新版',
        'Responsibility is disputed: the vendor says the branch mapping it received was out of date',
      ),
      time: '16:10',
      look: { path: '/vendors', query: { vendor: 'v-crm', tab: 'raci' }, label: L('廠商管理：責任邊界', 'Vendors: responsibility') },
      apply(draft) {
        const row = draft.raci.find((r) => r.id === 'v-crm:data');
        if (row) {
          row.disputed = L(
            '槿川科技：轉換用的據點對照表是內部提供的，裡面還有已裁撤的據點。內部：合約寫的是廠商負責轉換與驗證（R），對照表有問題應該在轉換前提出',
            'Elmhaven: the branch mapping used for the conversion came from the internal team and still listed retired branches. Internal: the contract makes the vendor responsible for conversion and validation (R); a faulty mapping should have been raised before converting',
          );
        }
        logAs(
          draft,
          person(draft, 'v3'),
          L('提出責任歸屬異議', 'Disputed responsibility'),
          B_DELIVERABLE,
          L('主張據點對照表由內部負責', 'Claims the branch mapping is the internal team’s responsibility'),
        );
      },
    },
    {
      title: L('廠商提出變更請求 CR-035：對照表由內部提供，交付日延到 12/11', 'The vendor raises CR-035: mapping supplied internally, delivery moved to 12/11'),
      time: '16:40',
      look: { path: '/vendors', query: { vendor: 'v-crm', tab: 'cr', cr: B_CR }, label: L('廠商管理：變更請求', 'Vendors: change requests') },
      apply(draft) {
        draft.changeRequests.push({
          id: B_CR,
          vendorId: 'v-crm',
          title: L(
            '據點對照表改由內部提供並簽認，CRM 6.3 交付日延到 12/11',
            'Branch mapping to be supplied and signed off internally; CRM 6.3 delivery moved to 12/11',
          ),
          reason: L(
            '對照表的來源沒有寫在責任邊界裡，這次才會各說各話',
            'The source of the mapping is not covered by the responsibility boundary, which is why both sides disagree',
          ),
          raisedBy: 'v3',
          raisedAt: TODAY,
          cost: 0,
          days: 10,
          stage: 'assessed',
        });
        logAs(draft, person(draft, 'v3'), L('提出變更請求', 'Raised change request'), B_CR, L('不加價，時程多 10 個工作日', 'No charge, 10 more working days'));
      },
    },
    {
      title: L(
        '核定：對照表歸內部、轉換仍歸廠商；計罰算到今天為止',
        'Decision: mapping is internal, conversion stays with the vendor; the penalty stops at today',
      ),
      time: '17:20',
      look: { path: '/demands', query: { tab: 'decisions' }, label: L('需求與決策：決策紀錄', 'Requests & decisions: decision records') },
      action: `decide:${B_CR}`,
      apply(draft) {
        const cr = draft.changeRequests.find((c) => c.id === B_CR);
        if (cr) {
          cr.stage = 'approved';
          cr.decisionId = 'DEC-110';
        }
        draft.decisions.push({
          id: 'DEC-110',
          title: L('CRM 6.3 延遲的責任歸屬與新的交付日', 'Responsibility for the CRM 6.3 delay and the new delivery date'),
          date: TODAY,
          decidedBy: 'tl',
          chosen: L(
            '核准 CR-035：據點對照表由內部提供並簽認；資料轉換與驗證仍由廠商負責；逾期計罰算到 11/27 為止',
            'CR-035 approved: the branch mapping is supplied and signed off internally; conversion and validation stay with the vendor; the late penalty stops at 11/27',
          ),
          why: L(
            '兩邊都有責任。對照表確實是我們給的，而且沒有人簽認；但廠商轉換後沒有驗證就交付，合約寫的是他們要驗。把對照表補進責任邊界，下次不會再各說各話。新的交付日避開月結凍結期。',
            'Both sides share the fault. We did supply the mapping and nobody signed it off; but the vendor delivered without validating the conversion, which the contract requires of them. Adding the mapping to the responsibility boundary prevents a repeat. The new date avoids the month-end freeze.',
          ),
          crId: B_CR,
        });
        const row = draft.raci.find((r) => r.id === 'v-crm:data');
        if (row) row.disputed = undefined;
        draft.raci.push({
          id: 'v-crm:mapping',
          vendorId: 'v-crm',
          activity: L('據點代碼對照表的提供與簽認', 'Supplying and signing off the branch code mapping'),
          cells: { internal: 'A/R', vendor: 'I', business: 'C', audit: '' },
        });
        const d = draft.deliverables.find((x) => x.id === B_DELIVERABLE);
        if (d) {
          d.acceptance = 'pending';
          d.deliveredAt = undefined;
          d.due = '2026-12-11';
        }
        const release = draft.changes.find((c) => c.id === 'CHG-243');
        if (release) release.date = '2026-12-12';
        logAs(
          draft,
          person(draft, 'tl'),
          L('核定變更請求', 'Decided change request'),
          B_CR,
          L('核准；決策紀錄 DEC-110；CRM 6.3 上線改到 12/12', 'Approved; decision DEC-110; CRM 6.3 release moved to 12/12'),
        );
      },
    },
  ],
};

// ── 劇本 C：汰換舊簽呈系統

const C_CHANGE = 'CHG-250';
const C_RULE = 'RC-11';

export const SCENARIO_C: ScenarioDef = {
  id: 'C',
  name: L('汰換舊簽呈系統：第一階段怎麼切', 'Replacing the legacy approval system: how phase 1 cuts over'),
  brief: L(
    '舊簽呈系統 2027 年要下線。看第一階段怎麼分範圍、新舊並行時怎麼對帳、切換日與回滾條件怎麼訂，最後寫進路徑圖。',
    'The legacy approval system retires in 2027. See how phase 1 is scoped, how the two systems are reconciled while running in parallel, how the cut-over date and rollback conditions are set, and how it lands on the roadmap.',
  ),
  steps: [
    {
      title: L('訂出第一階段的範圍與切換變更：只切請假與一般簽呈', 'Phase 1 is scoped and a cut-over change is raised: leave and general approvals only'),
      time: '10:45',
      look: { path: '/incidents', query: { chg: C_CHANGE }, label: L('事件與變更：CHG-250', 'Changes: CHG-250') },
      apply(draft) {
        draft.changes.push({
          id: C_CHANGE,
          title: L('簽呈第一階段切換：請假與一般簽呈改用新系統', 'Approval phase 1 cut-over: leave and general approvals move to the new system'),
          systemId: 'wf',
          date: '2027-03-13',
          window: '09:00–15:00',
          kind: 'normal',
          irreversible: false,
          status: 'requested',
          requesterId: 'e1',
          gates: [],
          rollback: L(
            '舊系統保留唯讀 30 天。切換後 5 個工作日內可以整批切回，新系統這段期間的簽呈由介面回寫',
            'The legacy system stays read-only for 30 days. Within 5 working days of cut-over everything can switch back; approvals made in the new system meanwhile are written back through the interface',
          ),
        });
        logAs(
          draft,
          person(draft, 'e1'),
          L('提出變更', 'Raised change'),
          C_CHANGE,
          L(
            '不牽涉付款的兩類簽呈先切；資訊處與人力資源部 120 人先試行 4 週',
            'The two approval types without payments go first; 120 people in IT and HR pilot for 4 weeks',
          ),
        );
      },
    },
    {
      title: L('新舊並行對帳：加一條規則 RC-11，試行第一週有 3 筆差異', 'Parallel-run reconciliation: rule RC-11 is added and finds 3 differences in week one'),
      time: '11:20',
      look: { path: '/consistency', query: { rule: C_RULE }, label: L('資料一致性：RC-11', 'Data consistency: RC-11') },
      apply(draft) {
        draft.reconRules.push({
          id: C_RULE,
          name: L('簽核結果：舊簽呈與新簽呈（並行期間）', 'Approval results: legacy vs new system (parallel run)'),
          plain: L('同一張簽呈，新舊兩套系統的核准結果是不是一樣', 'Whether the same approval ends with the same result in both systems'),
          kind: 'count',
          left: 'wf',
          right: 'wf',
          sideNames: [L('舊簽呈', 'Legacy system'), L('新簽呈（試行）', 'New system (pilot)')],
          ifaceIds: ['INT-012', 'INT-053'],
          schedule: L('並行期間每天 06:00', 'Daily at 06:00 during the parallel run'),
          ownerId: 'e2',
          report: L('簽核時效報表', 'Approval lead-time report'),
          sql: `-- 並行期間：同一張簽呈在新舊兩套系統的最後結果與最後一關
SELECT o.form_no,
       o.result       AS old_result,
       n.result       AS new_result,
       o.final_signer AS old_signer,
       n.final_signer AS new_signer
FROM   wf.form o
JOIN   wf2.form n ON n.legacy_form_no = o.form_no
WHERE  o.form_type IN ('LEAVE', 'GENERAL')
AND    o.final_sign_time >= current_date - 1
AND    (o.result <> n.result OR o.final_signer <> n.final_signer);`,
          baseLeft: 486,
          tolerance: L('不容許差異；連續 10 個工作日為 0 才能切換', 'No difference allowed; 10 consecutive working days at zero before cut-over'),
          lastRunAt: at(TODAY, '06:00'),
        });
        const found = at(TODAY, '06:00');
        const diff = (id: string, key: string, left: L10n, right: L10n, reason: L10n) => {
          draft.reconDiffs.push({ id, ruleId: C_RULE, key, left, right, amount: 0, reason, status: 'open', foundAt: found });
        };
        const delegate = L('代理人設定沒有帶到新系統', 'Delegate settings were not carried over to the new system');
        diff(
          'DF-1101',
          'LV-2611-0312',
          L('核准，代理人簽', 'Approved, signed by delegate'),
          L('停在主管，沒有人簽', 'Stuck at the manager, unsigned'),
          delegate,
        );
        diff(
          'DF-1102',
          'LV-2611-0327',
          L('核准，代理人簽', 'Approved, signed by delegate'),
          L('停在主管，沒有人簽', 'Stuck at the manager, unsigned'),
          delegate,
        );
        diff(
          'DF-1103',
          'GN-2611-0094',
          L('核准，最後一關是協理', 'Approved, final signer is the VP'),
          L('核准，最後一關是經理', 'Approved, final signer is the manager'),
          L('新系統的核決金額門檻設成舊的版本', 'The new system uses an outdated signing-limit threshold'),
        );
      },
    },
    {
      title: L('訂切換日與回滾條件：3/13（六），五項把關', 'Cut-over date and rollback conditions are set: Sat 3/13, five gates'),
      time: '14:00',
      look: { path: '/incidents', query: { chg: C_CHANGE }, label: L('事件與變更：CHG-250', 'Changes: CHG-250') },
      apply(draft) {
        const change = draft.changes.find((c) => c.id === C_CHANGE);
        if (change) {
          change.gates = [
            { id: 'parallel', text: L('並行對帳（RC-11）連續 10 個工作日差異為 0', 'Parallel reconciliation (RC-11) at zero for 10 consecutive working days') },
            { id: 'training', text: L('第一階段的使用單位都完成教育訓練', 'Every unit in phase 1 has completed training') },
            {
              id: 'readonly',
              text: L('舊系統切成唯讀的步驟演練過，而且可以切回', 'Switching the legacy system to read-only has been rehearsed and can be reversed'),
            },
            {
              id: 'rollback',
              text: L(
                '回滾條件寫明：5 個工作日內核准結果有差異，或登入失敗率超過 2%，就切回',
                'Rollback conditions are written down: any result difference within 5 working days, or a sign-in failure rate above 2%, triggers a switch back',
              ),
            },
            {
              id: 'calendar',
              text: L(
                '切換日不在月結或年結凍結期，也不是國定假日前後',
                'The date is outside month-end and year-end freezes and not next to a national holiday',
              ),
              checkedBy: 'tl',
            },
          ];
        }
        logAs(
          draft,
          person(draft, 'tl'),
          L('訂定把關清單', 'Set gate checklist'),
          C_CHANGE,
          L('切換日 2027-03-13（六）09:00–15:00；五項把關', 'Cut-over Sat 2027-03-13 09:00–15:00; five gates'),
        );
      },
    },
    {
      title: L('補上代理人設定與核決門檻，並行對帳的差異歸零', 'Delegate settings and signing limits are fixed; the parallel-run differences go to zero'),
      time: '16:30',
      look: { path: '/consistency', query: { rule: C_RULE }, label: L('資料一致性：RC-11', 'Data consistency: RC-11') },
      apply(draft) {
        resolveDiffs(draft, C_RULE, 'e4');
        const rule = draft.reconRules.find((r) => r.id === C_RULE);
        if (rule) rule.lastRunAt = at(TODAY, '16:20');
        logAs(
          draft,
          person(draft, 'e4'),
          L('結掉對帳差異', 'Closed reconciliation differences'),
          C_RULE,
          L('3 筆：代理人設定 2 筆、核決門檻 1 筆', '3: delegate settings 2, signing limit 1'),
        );
      },
    },
    {
      title: L(
        '寫進路徑圖：RM-01 標上切換日、回滾條件與對帳規則',
        'It goes on the roadmap: RM-01 now carries the cut-over date, rollback conditions and the reconciliation rule',
      ),
      time: '17:10',
      look: { path: '/roadmap', query: { item: 'RM-01', view: 'eng' }, label: L('技術路徑圖：RM-01', 'Roadmap: RM-01') },
      apply(draft) {
        const item = draft.roadmap.find((r) => r.id === 'RM-01');
        if (item) {
          item.tech = L(
            `${item.tech.zh} 切換日 2027-03-13（變更 CHG-250，五項把關）；並行期間每天跑 RC-11，連續 10 個工作日為 0 才切；切換後 5 個工作日內可以切回。`,
            `${item.tech.en} Cut-over on 2027-03-13 (change CHG-250, five gates); RC-11 runs daily during the parallel run and must be at zero for 10 consecutive working days; a switch back is possible within 5 working days of cut-over.`,
          );
          item.riskNote = L(
            '同仁要同時用兩套系統三個月；回滾條件已經訂好',
            'Staff use two systems side by side for three months; rollback conditions are defined',
          );
          item.sourceId = C_CHANGE;
        }
        draft.decisions.push({
          id: 'DEC-111',
          title: L('簽呈汰換第一階段的切換日與回滾條件', 'Cut-over date and rollback conditions for approval replacement phase 1'),
          date: TODAY,
          decidedBy: 'tl',
          chosen: L(
            '2027-03-13（六）切換；並行對帳連續 10 個工作日為 0 才切；5 個工作日內可切回',
            'Cut over on Sat 2027-03-13; only after 10 consecutive working days of zero differences; switch back possible within 5 working days',
          ),
          why: L(
            '3 月沒有國定假日，13 日離月結凍結期前後都超過一週。先切不牽涉付款的兩類簽呈，出問題影響最小。',
            'March has no national holidays and the 13th is more than a week away from either month-end freeze. Starting with the two approval types that involve no payments keeps the impact of any problem small.',
          ),
        });
        logAs(
          draft,
          person(draft, 'tl'),
          L('更新路徑圖', 'Updated roadmap'),
          'RM-01',
          L('標上切換日與回滾條件；決策紀錄 DEC-111', 'Cut-over date and rollback conditions added; decision DEC-111'),
        );
      },
    },
  ],
};
