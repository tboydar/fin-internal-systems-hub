import { at, shift } from '../core/date';
import { L } from '../core/i18n';
import type { Change, GateItem, Incident, IncidentStage, L10n, SystemId } from '../core/types';

// 歷史事件 6 筆（都已結案）與變更行事曆。

const STAGES: IncidentStage[] = ['triggered', 'assigned', 'mitigating', 'recovered', 'review', 'closed'];

interface IncidentSpec {
  id: string;
  title: L10n;
  severity: Incident['severity'];
  systemId: SystemId;
  ifaceId?: string;
  ownerId: string;
  day: string;
  time: string;
  /** 從觸發到恢復花了幾小時。 */
  hours: number;
  impact: L10n;
  rootCause: L10n;
  fix: L10n;
  actions: [text: L10n, ownerId: string, due: string, done: boolean][];
  adrId?: string;
}

const INCIDENTS: IncidentSpec[] = [
  {
    id: 'INC-2601',
    title: L('應付傳票重複拋轉到總帳', 'Payable vouchers posted to GL twice'),
    severity: 'S2',
    systemId: 'erp-ap',
    ifaceId: 'INT-023',
    ownerId: 'e3',
    day: '2026-02-26',
    time: '21:40',
    hours: 3.5,
    impact: L(
      '2/26 的 418 張應付傳票重複入帳，隔天早上會計部對帳時發現',
      '418 payable vouchers of 2/26 were posted twice; Accounting found it during reconciliation the next morning',
    ),
    rootCause: L(
      '批次第一次逾時後被手動重跑，當時總帳端沒有檢查批號',
      'The batch was rerun by hand after a timeout, and GL did not check the batch number then',
    ),
    fix: L('整批沖回後重拋；總帳端加上「同一批號只入一次」', 'Reversed and reposted the batch; GL now posts each batch number once'),
    actions: [
      [L('應付批次加上冪等鍵', 'Add an idempotency key to the AP batch'), 'e3', '2026-03-20', true],
      [L('手動重跑要先查上一次的結果，寫進 Runbook', 'Runbook: check the previous result before any manual rerun'), 'e3', '2026-03-06', true],
    ],
    adrId: 'ADR-003',
  },
  {
    id: 'INC-2602',
    title: L('AD 憑證到期，CRM 無法單一登入', 'AD certificate expired; CRM single sign-on failed'),
    severity: 'S1',
    systemId: 'iam',
    ifaceId: 'INT-052',
    ownerId: 'e4',
    day: '2026-04-14',
    time: '08:05',
    hours: 2.2,
    impact: L('全部據點的業務人員有兩個多小時登不進 CRM', 'Sales staff at every branch could not sign in to CRM for over two hours'),
    rootCause: L('簽章憑證一年到期，到期日只記在一位同仁的行事曆上', 'The signing certificate expires yearly; the date lived in one person’s calendar'),
    fix: L('換發憑證並同步到 CRM', 'Renewed the certificate and synced it to CRM'),
    actions: [
      [L('憑證到期日放進監控，30 天前告警', 'Monitor certificate expiry; alert 30 days ahead'), 'e4', '2026-04-30', true],
      [L('憑證更新寫成 Runbook，每年演練一次', 'Write a runbook for certificate renewal; rehearse yearly'), 'e4', '2026-05-15', true],
    ],
  },
  {
    id: 'INC-2603',
    title: L('員工主檔同步逾時，12 筆異動晚一天生效', 'Employee master sync timed out; 12 changes took effect a day late'),
    severity: 'S3',
    systemId: 'esb',
    ifaceId: 'INT-014',
    ownerId: 'e1',
    day: '2026-06-16',
    time: '14:00',
    hours: 5,
    impact: L('12 位異動同仁的成本中心晚一天更新，沒有影響到薪資', 'Cost centres of 12 transferred staff were updated a day late; payroll was not affected'),
    rootCause: L(
      'ERP 的員工主檔寫入 API 在整點回應變慢，超過整合層的 30 秒逾時',
      'The ERP employee master API slows down on the hour and exceeds the integration layer’s 30 s timeout',
    ),
    fix: L('手動重送 DLQ 裡的 12 筆', 'Manually resent the 12 records in the DLQ'),
    actions: [[L('請廠商查整點變慢的原因', 'Ask the vendor why the API slows down on the hour'), 'e1', '2026-07-10', false]],
  },
  {
    id: 'INC-2604',
    title: L('CRM 6.1 更新後據點歸屬錯置', 'Branch assignment scrambled after the CRM 6.1 release'),
    severity: 'S2',
    systemId: 'crm',
    ifaceId: 'INT-013',
    ownerId: 'e4',
    day: '2026-08-11',
    time: '09:20',
    hours: 6.5,
    impact: L('台中與嘉義有 340 位客戶被歸到錯的業務人員名下', '340 customers in Taichung and Chiayi were assigned to the wrong salesperson'),
    rootCause: L('版本更新改了據點代碼的長度，我們的對照表沒有跟著改', 'The release changed the branch code length and our mapping table was not updated'),
    fix: L('還原對照表後重跑 INT-013', 'Restored the mapping table and reran INT-013'),
    actions: [
      [L('CRM 每季更新前，介面要跑回歸測試', 'Run interface regression tests before every quarterly CRM release'), 'e4', '2026-09-01', true],
      [L('契約版本變更要提前 30 天通知，寫進合約附件', 'Contract annex: 30 days’ notice for any data-contract change'), 'tl', '2026-09-30', true],
    ],
    adrId: 'ADR-002',
  },
  {
    id: 'INC-2605',
    title: L('員工主檔同步再次逾時，21 筆進 DLQ', 'Employee master sync timed out again; 21 records in the DLQ'),
    severity: 'S3',
    systemId: 'esb',
    ifaceId: 'INT-014',
    ownerId: 'e1',
    day: '2026-09-29',
    time: '10:00',
    hours: 3,
    impact: L(
      '21 位新進與異動同仁的成本中心晚半天更新；當天是薪資分錄拋轉日，分錄延到傍晚',
      'Cost centres of 21 new and transferred staff were updated half a day late; payroll posting that day slipped to the evening',
    ),
    rootCause: L('與 6 月同一個原因，廠商還沒有找到整點變慢的來源', 'Same cause as in June; the vendor has not found the source of the hourly slowdown'),
    fix: L('手動重送 21 筆', 'Manually resent the 21 records'),
    actions: [
      [L('整理三個月的逾時紀錄給廠商', 'Compile three months of timeouts for the vendor'), 'e1', '2026-11-30', false],
      [L('評估把同步改成事件驅動', 'Assess moving the sync to an event-driven design'), 'e1', '2026-12-15', false],
    ],
  },
  {
    id: 'INC-2606',
    title: L('舊簽呈資料庫空間不足，簽核停擺', 'Legacy approval database ran out of space; approvals stopped'),
    severity: 'S1',
    systemId: 'wf',
    ownerId: 'e4',
    day: '2026-10-20',
    time: '13:30',
    hours: 3.2,
    impact: L(
      '全公司三個多小時無法送簽與核准，當天有 2 筆付款延到隔天',
      'Nobody could submit or approve for over three hours; 2 payments slipped to the next day',
    ),
    rootCause: L(
      '附件存在資料庫裡，沒有清理機制；監控只看主機磁碟，沒看資料庫檔案上限',
      'Attachments are stored in the database with no clean-up; monitoring watched the host disk, not the database file limit',
    ),
    fix: L('擴充資料庫檔案上限，搬走 2019 年以前的附件', 'Raised the database file limit and moved pre-2019 attachments out'),
    actions: [
      [L('資料庫檔案用量放進監控', 'Monitor database file usage'), 'e4', '2026-10-30', true],
      [L('汰換計畫提前，第一階段排進 2027 Q1', 'Bring the replacement forward; phase 1 in Q1 2027'), 'tl', '2026-11-15', true],
    ],
    adrId: 'ADR-008',
  },
];

export function buildIncidents(): Incident[] {
  return INCIDENTS.map((s) => {
    const start = at(s.day, s.time);
    const recovered = shift(start, s.hours);
    // 各階段的時間：指派在 10 分鐘內，開始處理在 30 分鐘內，檢討在三個工作天後，再一週結案
    const times = [start, shift(start, 0.15), shift(start, 0.5), recovered, shift(recovered, 72), shift(recovered, 240)];
    return {
      id: s.id,
      title: s.title,
      severity: s.severity,
      systemId: s.systemId,
      ifaceId: s.ifaceId,
      stage: 'closed',
      ownerId: s.ownerId,
      startedAt: start,
      recoveredAt: recovered,
      impact: s.impact,
      rootCause: s.rootCause,
      fix: s.fix,
      actions: s.actions.map(([text, ownerId, due, done]) => ({ text, ownerId, due, done })),
      timeline: STAGES.map((stage, i) => ({ stage, at: times[i], by: i === 0 ? 'system' : i >= 4 ? 'tl' : s.ownerId })),
      adrId: s.adrId,
    };
  });
}

/** 不可逆變更的把關項目。全部勾完才能核准。 */
export function gates(checked: Record<string, string> = {}): GateItem[] {
  const items: [id: string, text: L10n][] = [
    ['backup', L('備份已完成，而且實際還原驗證過', 'Backup taken and a restore actually verified')],
    ['rehearsal', L('在測試環境完整演練過一次，有紀錄', 'Fully rehearsed once in the test environment, with a record')],
    ['signoff', L('受影響的業務單位主管書面同意', 'Written consent from the affected business unit manager')],
    ['oncall', L('廠商與內部負責人在變更時段待命', 'Vendor and internal owner on call during the window')],
    ['abort', L('寫明「做到哪一步之前還能停」', 'States the last step at which the change can still be stopped')],
  ];
  return items.map(([id, text]) => ({ id, text, checkedBy: checked[id] }));
}

export function buildChanges(): Change[] {
  const c = (
    id: string,
    zh: string,
    en: string,
    systemId: SystemId,
    date: string,
    window: string,
    kind: Change['kind'],
    status: Change['status'],
    requesterId: string,
    rollbackZh: string,
    rollbackEn: string,
    extra: Partial<Change> = {},
  ): Change => ({
    id,
    title: L(zh, en),
    systemId,
    date,
    window,
    kind,
    irreversible: false,
    status,
    requesterId,
    gates: [],
    rollback: L(rollbackZh, rollbackEn),
    ...extra,
  });
  return [
    c(
      'CHG-238',
      'ERP 11.4.2 稅務法規修補上線',
      'Release ERP tax patch 11.4.2',
      'erp-gl',
      '2026-11-14',
      '20:00–23:00',
      'normal',
      'done',
      'v1',
      '還原成 11.4.1 的程式與設定',
      'Restore the 11.4.1 binaries and configuration',
      { approvedBy: 'tl' },
    ),
    c(
      'CHG-239',
      '整合層重試間隔調整',
      'Adjust integration-layer retry intervals',
      'esb',
      '2026-11-20',
      '19:00–19:30',
      'standard',
      'done',
      'e1',
      '改回原本的設定檔',
      'Revert the configuration file',
      { approvedBy: 'tl' },
    ),
    c(
      'CHG-240',
      '應付對帳查詢加兩個索引',
      'Add two indexes for the payables reconciliation query',
      'dw',
      '2026-11-21',
      '10:00–11:00',
      'standard',
      'done',
      'e2',
      'DROP INDEX；不影響資料',
      'DROP INDEX; no data impact',
      { approvedBy: 'tl' },
    ),
    c(
      'CHG-241',
      '月結前參數檢核（會計期間、匯率）',
      'Pre-month-end parameter check (period, exchange rates)',
      'erp-gl',
      '2026-11-27',
      '18:00–19:00',
      'standard',
      'approved',
      'e3',
      '只檢查，不改資料',
      'Read-only check; nothing to roll back',
      { approvedBy: 'tl' },
    ),
    c(
      'CHG-242',
      'AD 簽章憑證更新',
      'Renew the AD signing certificate',
      'iam',
      '2026-12-05',
      '10:00–12:00',
      'normal',
      'approved',
      'e4',
      '換回舊憑證（12/20 才到期）',
      'Switch back to the old certificate (valid until 12/20)',
      { approvedBy: 'tl' },
    ),
    c(
      'CHG-243',
      'CRM 6.3 上線',
      'Release CRM 6.3',
      'crm',
      '2026-12-01',
      '21:00–24:00',
      'normal',
      'requested',
      'v3',
      '還原成 6.2 的映像檔與資料庫快照',
      'Restore the 6.2 image and database snapshot',
    ),
    c(
      'CHG-244',
      'INT-014 逾時改成 45 秒',
      'Raise the INT-014 timeout to 45 s',
      'esb',
      '2026-12-08',
      '19:00–19:30',
      'standard',
      'requested',
      'e1',
      '改回 30 秒',
      'Revert to 30 s',
    ),
    c(
      'CHG-245',
      '刪除 ERP 2019 年以前的暫存傳票',
      'Delete pre-2019 draft vouchers from ERP',
      'erp-gl',
      '2026-12-12',
      '09:00–12:00',
      'normal',
      'requested',
      'e3',
      '刪除後無法還原，只能從備份整庫還原',
      'Cannot be undone after deletion except by restoring the whole database from backup',
      { irreversible: true, gates: gates({ backup: 'e3', oncall: 'e3' }) },
    ),
    c(
      'CHG-246',
      '人事薪資 8.0.6 年終法規更新',
      'HR & Payroll 8.0.6 year-end regulatory update',
      'hr',
      '2026-12-19',
      '09:00–13:00',
      'normal',
      'requested',
      'v4',
      '還原成 8.0.5',
      'Restore 8.0.5',
    ),
    c(
      'CHG-247',
      '舊簽呈資料庫搬移 2020 年的附件',
      'Move 2020 attachments out of the legacy approval database',
      'wf',
      '2027-01-16',
      '09:00–15:00',
      'normal',
      'requested',
      'e4',
      '附件先複製、驗證筆數後才刪原檔',
      'Attachments are copied and counted before the originals are removed',
    ),
  ];
}
