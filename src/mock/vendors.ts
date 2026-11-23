import { addDays, ago, at, DEMO_NOW, hourOf, isWorkday, shift, TODAY } from '../core/date';
import { L } from '../core/i18n';
import type { ChangeRequest, Deliverable, L10n, Milestone, Party, Priority, RaciRow, SystemId, Ticket, Vendor, VendorId } from '../core/types';
import type { Rng } from './rng';

// 廠商管理的資料：工單、交付項、合約里程碑、責任邊界、變更請求。
// SLA 達成率、交付準時率、驗收退件率都不存在這裡，是從這些資料列算出來的（core/sla.ts）。

/** 每家廠商過去 90 天的工單數，以及回應、解決超過 SLA 的機率。表現好的與普通的差在這裡。 */
const PROFILE: Record<VendorId, { count: number; lateRespond: number; lateResolve: number }> = {
  'v-erp': { count: 22, lateRespond: 0.03, lateResolve: 0.04 },
  'v-crm': { count: 24, lateRespond: 0.16, lateResolve: 0.22 },
  'v-hr': { count: 16, lateRespond: 0.06, lateResolve: 0.08 },
  'v-wf': { count: 12, lateRespond: 0.1, lateResolve: 0.16 },
};

const TITLES: Record<VendorId, [systemId: SystemId, title: L10n][]> = {
  'v-erp': [
    ['erp-gl', L('傳票查詢畫面在月初變慢', 'Voucher inquiry is slow at the start of the month')],
    ['erp-gl', L('科目餘額表匯出的小數位數不對', 'Account balance export has the wrong decimal places')],
    ['erp-ap', L('付款申請單的幣別欄位帶不出來', 'Currency is not filled in on payment requests')],
    ['erp-ap', L('應付帳齡表少算當天立帳的憑單', 'Aging report misses vouchers raised the same day')],
    ['erp-po', L('驗收單退回後狀態沒有還原', 'Goods receipt status is not restored after a return')],
    ['erp-po', L('請購單附件超過 10 MB 無法上傳', 'Requisition attachments over 10 MB cannot be uploaded')],
    ['erp-gl', L('新增成本中心後分攤規則沒有帶到', 'Allocation rules are missing for new cost centres')],
    ['erp-ap', L('供應商主檔的統一編號檢核誤擋', 'Supplier tax ID validation rejects valid numbers')],
  ],
  'v-crm': [
    ['crm', L('據點歸屬畫面查詢逾時', 'Branch assignment screen times out')],
    ['crm', L('客戶往來紀錄的附件打不開', 'Attachments on customer interactions do not open')],
    ['crm', L('業務人員調動後客戶名單沒有跟著移', 'Customer lists do not follow a salesperson who moved')],
    ['crm', L('手續費日結檔的檔名日期錯一天', 'Daily fee file name carries the wrong date')],
    ['crm', L('優惠申請送審後狀態停在處理中', 'Discount requests stay “in progress” after submission')],
    ['crm', L('匯出客戶名單時遮罩規則沒有套用', 'Masking rules are not applied to customer list exports')],
    ['crm', L('版本更新後自訂報表的欄位消失', 'Custom report columns disappeared after the release')],
  ],
  'v-hr': [
    ['hr', L('留停復職同仁的年資計算錯誤', 'Seniority is miscalculated after a leave of absence')],
    ['hr', L('加退保申報檔少一筆眷屬資料', 'Insurance enrolment file misses one dependant')],
    ['hr', L('調薪生效日在月中時薪資沒有按比例', 'Mid-month pay rises are not prorated')],
    ['hr', L('組織異動後主管欄位沒有更新', 'Manager field is not updated after a reorganisation')],
    ['hr', L('薪資單的加班費項目名稱顯示代碼', 'Overtime shows as a code on the payslip')],
  ],
  'v-wf': [
    ['wf', L('會簽人員出差時代理人設定沒有生效', 'Delegate settings are ignored when a countersigner is away')],
    ['wf', L('簽呈附件預覽出現亂碼', 'Attachment previews show garbled text')],
    ['wf', L('退回的簽呈無法重新送出', 'Returned approvals cannot be resubmitted')],
    ['wf', L('核決權限表更新後舊案件走錯路線', 'Old cases take the wrong route after the authority table changed')],
    ['wf', L('夜間排程卡住，隔天簽核清單是空的', 'Nightly job hangs; the approval list is empty the next day')],
  ],
};

/** 手寫的工單：目前還開著的，以及劇本會用到的。編號接在亂數產生的後面。 */
function openTickets(): Omit<Ticket, 'id'>[] {
  return [
    {
      vendorId: 'v-wf',
      systemId: 'wf',
      title: L('簽核時效檢視表少了 STEP_OUT_TIME 欄位', 'Approval lead-time view is missing STEP_OUT_TIME'),
      priority: 'P2',
      openedAt: at(TODAY, '03:20'),
      respondedAt: at(TODAY, '04:40'),
      ifaceId: 'INT-055',
    },
    {
      vendorId: 'v-crm',
      systemId: 'crm',
      title: L('據點歸屬畫面查詢逾時', 'Branch assignment screen times out'),
      priority: 'P2',
      openedAt: at(addDays(TODAY, -1), '15:00'),
      respondedAt: at(addDays(TODAY, -1), '16:35'),
    },
    {
      vendorId: 'v-crm',
      systemId: 'crm',
      title: L('手續費日結檔連續三天晚到', 'Daily fee file late three days in a row'),
      priority: 'P3',
      openedAt: at(addDays(TODAY, -2), '09:10'),
      respondedAt: at(addDays(TODAY, -2), '11:20'),
      ifaceId: 'INT-031',
    },
    {
      vendorId: 'v-erp',
      systemId: 'erp-ap',
      title: L('月結前應付批次試跑結果確認', 'Confirm the pre-month-end AP batch dry run'),
      priority: 'P3',
      openedAt: at(addDays(TODAY, -1), '10:00'),
      respondedAt: at(addDays(TODAY, -1), '10:40'),
    },
  ];
}

export function buildTickets(rng: Rng, vendors: Vendor[]): Ticket[] {
  const drafts: Omit<Ticket, 'id'>[] = [];
  for (const vendor of vendors) {
    const profile = PROFILE[vendor.id];
    for (let i = 0; i < profile.count; i++) {
      // 開單時間：過去 4 到 88 天之間的某個上班日、上班時間
      let opened = ago(rng.float(4 * 24, 88 * 24));
      while (!isWorkday(opened.slice(0, 10))) opened = shift(opened, -24);
      const hour = hourOf(opened);
      if (hour < 9 || hour > 17) opened = at(opened.slice(0, 10), `${String(rng.int(9, 17)).padStart(2, '0')}:${String(rng.int(0, 5) * 10).padStart(2, '0')}`);
      const roll = rng.next();
      const priority: Priority = roll < 0.1 ? 'P1' : roll < 0.45 ? 'P2' : 'P3';
      const target = vendor.sla[priority];
      const respondMin = target.respondMin * (rng.next() < profile.lateRespond ? rng.float(1.15, 2.4) : rng.float(0.15, 0.9));
      const resolveHr = target.resolveHr * (rng.next() < profile.lateResolve ? rng.float(1.1, 2.1) : rng.float(0.2, 0.92));
      const [systemId, title] = rng.pick(TITLES[vendor.id]);
      drafts.push({
        vendorId: vendor.id,
        systemId,
        title,
        priority,
        openedAt: opened,
        respondedAt: shift(opened, respondMin / 60),
        resolvedAt: shift(opened, Math.max(resolveHr, respondMin / 60 + 0.2)),
      });
    }
  }
  drafts.sort((a, b) => (a.openedAt < b.openedAt ? -1 : 1));
  return [...drafts, ...openTickets()].map((t, i) => ({ id: `TK-${2101 + i}`, ...t }));
}

const d = (
  id: string,
  vendorId: VendorId,
  zh: string,
  en: string,
  due: string,
  deliveredAt: string | undefined,
  acceptance: Deliverable['acceptance'],
  rejects = 0,
  rejectReason?: L10n,
): Deliverable => ({ id, vendorId, title: L(zh, en), due, deliveredAt, acceptance, rejects, rejectReason });

export function buildDeliverables(): Deliverable[] {
  return [
    d('DL-401', 'v-erp', '稅務法規修補 11.4.2', 'Tax regulation patch 11.4.2', '2026-10-30', '2026-10-29', 'accepted'),
    d('DL-402', 'v-erp', '應付批次重複拋轉的修正', 'Fix for duplicate AP batch posting', '2026-09-18', '2026-09-17', 'accepted'),
    d('DL-403', 'v-erp', '員工主檔寫入 API v2 文件', 'Employee master write API v2 documentation', '2026-10-09', '2026-10-08', 'accepted'),
    d('DL-404', 'v-erp', '月結效能調校報告', 'Month-end performance tuning report', '2026-11-13', '2026-11-13', 'accepted'),
    d('DL-405', 'v-erp', '年結檢核清單更新', 'Updated year-end checklist', '2026-12-11', undefined, 'pending'),
    d(
      'DL-411',
      'v-crm',
      'CRM 6.2 季度版本',
      'CRM 6.2 quarterly release',
      '2026-09-15',
      '2026-09-22',
      'accepted',
      1,
      L('自訂報表欄位在測試環境消失，退回修正', 'Custom report columns vanished in the test environment; returned for a fix'),
    ),
    d('DL-412', 'v-crm', '手續費日結檔格式 v2.2', 'Daily fee file format v2.2', '2026-10-16', '2026-10-15', 'accepted'),
    d(
      'DL-413',
      'v-crm',
      '客戶資料匯出效能改善',
      'Customer export performance improvement',
      '2026-10-30',
      '2026-11-06',
      'accepted',
      1,
      L('匯出 5 萬筆仍需 14 分鐘，沒有達到約定的 5 分鐘', 'Exporting 50,000 rows still took 14 minutes, not the agreed 5'),
    ),
    d('DL-414', 'v-crm', 'SSO 群組對應調整', 'SSO group mapping change', '2026-11-06', '2026-11-06', 'accepted'),
    d('DL-415', 'v-crm', 'CRM 6.3 據點歸屬整併', 'CRM 6.3 branch assignment consolidation', '2026-11-20', undefined, 'pending'),
    d('DL-421', 'v-hr', '勞健保費率更新', 'Labour and health insurance rate update', '2026-09-25', '2026-09-24', 'accepted'),
    d('DL-422', 'v-hr', '所得稅扣繳級距更新', 'Income tax withholding bracket update', '2026-10-23', '2026-10-22', 'accepted'),
    d(
      'DL-423',
      'v-hr',
      '加退保申報檔增加部門欄位',
      'Department field added to the insurance enrolment file',
      '2026-11-06',
      '2026-11-05',
      'accepted',
      1,
      L('部門代碼用了舊的四碼格式，退回修正', 'Department codes used the old four-digit format; returned for a fix'),
    ),
    d('DL-424', 'v-hr', '年終獎金試算功能', 'Year-end bonus simulation', '2026-12-15', undefined, 'pending'),
    d('DL-431', 'v-wf', '季度弱點修補', 'Quarterly vulnerability patch', '2026-10-16', '2026-10-27', 'accepted'),
    d('DL-432', 'v-wf', '簽核時效檢視表修正', 'Fix for the approval lead-time view', '2026-11-30', undefined, 'pending'),
    d('DL-433', 'v-wf', '歷史簽呈匯出工具（汰換用）', 'Historical approval export tool (for the replacement)', '2026-12-18', undefined, 'pending'),
  ];
}

export function buildMilestones(): Milestone[] {
  const m = (id: string, vendorId: VendorId, zh: string, en: string, date: string, amount: number, status: Milestone['status']): Milestone => ({
    id,
    vendorId,
    title: L(zh, en),
    date,
    amount,
    status,
  });
  return [
    m('MS-101', 'v-erp', '2026 下半年維護費', 'Maintenance fee, H2 2026', '2026-07-01', 4_080_000, 'paid'),
    m('MS-102', 'v-erp', '稅務法規修補驗收款', 'Tax patch acceptance payment', '2026-11-10', 620_000, 'paid'),
    m('MS-103', 'v-erp', '2027 上半年維護費', 'Maintenance fee, H1 2027', '2027-01-04', 4_080_000, 'planned'),
    m('MS-104', 'v-erp', '合約到期；續約評估要在三個月前完成', 'Contract ends; renewal review due three months earlier', '2027-06-30', 0, 'planned'),
    m('MS-111', 'v-crm', 'CRM 6.2 版本驗收款', 'CRM 6.2 acceptance payment', '2026-09-30', 780_000, 'paid'),
    m('MS-112', 'v-crm', 'CRM 6.3 版本驗收款', 'CRM 6.3 acceptance payment', '2026-11-27', 780_000, 'late'),
    m('MS-113', 'v-crm', '2027 年度代管費', 'Hosting fee, 2027', '2027-01-04', 5_040_000, 'planned'),
    m('MS-121', 'v-hr', '2026 下半年維護費', 'Maintenance fee, H2 2026', '2026-07-01', 2_100_000, 'paid'),
    m('MS-122', 'v-hr', '年終獎金試算功能驗收款', 'Year-end bonus simulation acceptance payment', '2026-12-22', 360_000, 'planned'),
    m('MS-123', 'v-hr', '合約到期；續約評估要在三個月前完成', 'Contract ends; renewal review due three months earlier', '2027-09-30', 0, 'planned'),
    m('MS-131', 'v-wf', '2026 年度維護費', 'Maintenance fee, 2026', '2026-04-01', 1_920_000, 'paid'),
    m('MS-132', 'v-wf', '匯出工具驗收款', 'Export tool acceptance payment', '2026-12-25', 240_000, 'planned'),
    m('MS-133', 'v-wf', '系統下線與合約終止', 'Decommission and contract end', '2027-09-30', 0, 'planned'),
  ];
}

const RACI_ROWS: [key: string, activity: L10n, cells: Record<Party, string>][] = [
  ['spec', L('需求確認與規格', 'Requirements and specification'), { internal: 'A/R', vendor: 'C', business: 'C', audit: '' }],
  ['build', L('開發與單元測試', 'Development and unit testing'), { internal: 'C', vendor: 'A/R', business: '', audit: '' }],
  ['sit', L('整合測試（跨系統介面）', 'Integration testing (cross-system interfaces)'), { internal: 'A/R', vendor: 'R', business: 'I', audit: '' }],
  ['data', L('資料轉換與轉換後的驗證', 'Data conversion and post-conversion validation'), { internal: 'A', vendor: 'R', business: 'C', audit: 'I' }],
  ['uat', L('使用者驗收', 'User acceptance'), { internal: 'R', vendor: 'C', business: 'A/R', audit: '' }],
  ['release', L('上線與回滾', 'Release and rollback'), { internal: 'A', vendor: 'R', business: 'I', audit: 'I' }],
  ['incident', L('上線後的事件處理', 'Incident handling after release'), { internal: 'A', vendor: 'R', business: 'I', audit: '' }],
  ['access', L('帳號權限與稽核軌跡', 'Access rights and audit trail'), { internal: 'R', vendor: 'C', business: '', audit: 'A' }],
];

export function buildRaci(vendors: Vendor[]): RaciRow[] {
  return vendors.flatMap((v) => RACI_ROWS.map(([key, activity, cells]) => ({ id: `${v.id}:${key}`, vendorId: v.id, activity, cells: { ...cells } })));
}

export function buildChangeRequests(): ChangeRequest[] {
  const cr = (
    id: string,
    vendorId: VendorId,
    zh: string,
    en: string,
    reasonZh: string,
    reasonEn: string,
    raisedBy: string,
    raisedAt: string,
    cost: number,
    days: number,
    stage: ChangeRequest['stage'],
    decisionId?: string,
  ): ChangeRequest => ({ id, vendorId, title: L(zh, en), reason: L(reasonZh, reasonEn), raisedBy, raisedAt, cost, days, stage, decisionId });
  return [
    cr(
      'CR-029',
      'v-crm',
      'CRM 6.2 版本延後一週上線',
      'Delay the CRM 6.2 release by one week',
      '自訂報表欄位的問題要多一週修正與回歸測試',
      'The custom report column issue needs another week of fixing and regression testing',
      'v3',
      '2026-09-10',
      0,
      7,
      'done',
      'DEC-104',
    ),
    cr(
      'CR-031',
      'v-erp',
      '月結期間駐點顧問延長到 21:00',
      'Extend on-site consultant hours to 21:00 during month-end',
      '月結三天的問題大多在 18:00 之後才出現，隔天才處理會壓到關帳',
      'Most month-end issues appear after 18:00; handling them the next day squeezes the close',
      'e3',
      '2026-11-06',
      45_000,
      0,
      'approved',
      'DEC-107',
    ),
    cr(
      'CR-032',
      'v-crm',
      '手續費日結檔改成 22:00 前送達',
      'Deliver the daily fee file by 22:00',
      '目前 22:30 才送，晚到就壓到 23:30 的傳票倉儲批次',
      'It is sent at 22:30 today; any delay collides with the 23:30 warehouse batch',
      'e4',
      '2026-11-25',
      120_000,
      10,
      'assessed',
    ),
    cr(
      'CR-033',
      'v-hr',
      '加退保申報檔增加部門欄位',
      'Add a department field to the insurance enrolment file',
      '人資要依部門核對申報結果',
      'HR needs to check filings by department',
      'b2',
      '2026-10-12',
      60_000,
      15,
      'done',
      'DEC-105',
    ),
    cr(
      'CR-034',
      'v-wf',
      '匯出工具要連附件一起匯出',
      'Export tool should include attachments',
      '稽核要求歷史簽呈的附件保存 7 年',
      'Audit requires approval attachments to be kept for 7 years',
      'e4',
      '2026-11-24',
      90_000,
      12,
      'submitted',
    ),
  ];
}

/** 這次建置的「現在」。廠商資料裡沒有任何時間晚於它。 */
export const VENDOR_DATA_NOW = DEMO_NOW;
