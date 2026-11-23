import { addDays, at, MONTH_END, TODAY } from '../core/date';
import { L } from '../core/i18n';
import type { L10n, QueryPlan, ReconDiff, ReconRule, SystemId } from '../core/types';

// 10 條對帳規則與目前還沒結掉的差異。
// SQL 是 PostgreSQL 的寫法（資料倉儲的方言）。表名與欄位是為這個 Demo 編的，跟 ifaces.ts 的欄位對應一致。

const YESTERDAY = addDays(TODAY, -1);

const SQL: Record<string, string> = {
  'RC-01': `-- 昨天入帳的傳票：總帳有幾行、倉儲有幾行、倉儲少了幾行
SELECT g.posting_date,
       count(*)                       AS gl_rows,
       count(d.voucher_no)            AS dw_rows,
       count(*) - count(d.voucher_no) AS missing_in_dw
FROM   erp_gl.voucher_line g
LEFT   JOIN dw.fact_voucher d
       ON  d.voucher_no = g.voucher_no
       AND d.line_no    = g.line_no
WHERE  g.posting_date = current_date - 1
GROUP  BY g.posting_date;`,
  'RC-02': `-- 每個科目把各期的期末餘額串起來做雜湊，兩邊逐科目比
WITH gl AS (
  SELECT account_code,
         md5(string_agg(period || ':' || closing_balance::text, '|' ORDER BY period)) AS h
  FROM   erp_gl.account_balance
  WHERE  fiscal_year = 2026
  GROUP  BY account_code
), dw AS (
  SELECT a.account_code,
         md5(string_agg(b.period || ':' || b.closing_balance::text, '|' ORDER BY b.period)) AS h
  FROM   dw.fact_balance b
  JOIN   dw.dim_account a USING (account_key)
  WHERE  b.fiscal_year = 2026
  GROUP  BY a.account_code
)
SELECT coalesce(gl.account_code, dw.account_code) AS account_code
FROM   gl
FULL   JOIN dw USING (account_code)
WHERE  gl.h IS DISTINCT FROM dw.h;`,
  'RC-03': `-- 在職員工：人事有、ERP 沒有，或成本中心不一樣
SELECT h.emp_no,
       h.cost_center      AS hr_cost_center,
       e.cost_center_code AS erp_cost_center
FROM   hr.employee h
LEFT   JOIN erp_gl.employee e
       ON  e.employee_id = h.emp_no
       AND e.valid_from  = h.effective_date
WHERE  h.emp_status = 'A'
AND    (e.employee_id IS NULL OR e.cost_center_code <> h.cost_center);`,
  'RC-04': `-- 當月薪資：人事的計薪結果與總帳的薪資分錄，依成本中心比金額
WITH hr AS (
  SELECT cost_center, sum(amount) AS amount
  FROM   hr.payroll_result
  WHERE  pay_period = :period
  AND    pay_item_type = 'EXPENSE'
  GROUP  BY cost_center
), gl AS (
  SELECT cost_center_code AS cost_center,
         sum(debit_amount - credit_amount) AS amount
  FROM   erp_gl.voucher_line
  WHERE  period = :period
  AND    source_system = 'HRP'
  GROUP  BY cost_center_code
)
SELECT coalesce(hr.cost_center, gl.cost_center)        AS cost_center,
       coalesce(hr.amount, 0)                          AS hr_amount,
       coalesce(gl.amount, 0)                          AS gl_amount,
       coalesce(hr.amount, 0) - coalesce(gl.amount, 0) AS diff
FROM   hr
FULL   JOIN gl USING (cost_center)
WHERE  coalesce(hr.amount, 0) <> coalesce(gl.amount, 0);`,
  'RC-05': `-- 本月的應付憑單：應付系統的金額，與總帳「應付帳款」科目的貸方金額
SELECT a.ap_voucher_no,
       a.payable_amount,
       coalesce(sum(g.credit_amount), 0) AS gl_amount
FROM   erp_ap.voucher a
LEFT   JOIN erp_gl.voucher_line g
       ON  g.source_ref   = a.ap_voucher_no
       AND g.account_code = '2171'
WHERE  a.posting_date >= date_trunc('month', current_date)
GROUP  BY a.ap_voucher_no, a.payable_amount
HAVING a.payable_amount <> coalesce(sum(g.credit_amount), 0);`,
  'RC-06': `-- 驗收超過 3 天還沒有應付憑單
SELECT r.gr_no, r.vendor_id, r.gr_date, r.gr_amount
FROM   erp_po.goods_receipt r
WHERE  r.status  = 'ACCEPTED'
AND    r.gr_date < current_date - 3
AND    NOT EXISTS (
         SELECT 1
         FROM   erp_ap.voucher a
         WHERE  a.source_doc_no = r.gr_no
       );`,
  'RC-07': `-- 昨天的手續費：CRM 日結檔與總帳收入科目，依據點比金額
WITH crm AS (
  SELECT branch_id, sum(round(fee_amount)) AS amount
  FROM   staging.crm_fee_daily
  WHERE  txn_date = current_date - 1
  GROUP  BY branch_id
), gl AS (
  SELECT m.branch_id, sum(v.credit_amount - v.debit_amount) AS amount
  FROM   erp_gl.voucher_line v
  JOIN   dw.map_branch_cost_center m ON m.cost_center_code = v.cost_center_code
  WHERE  v.posting_date = current_date - 1
  AND    v.account_code LIKE '41%'
  AND    v.source_system = 'CRM'
  GROUP  BY m.branch_id
)
SELECT coalesce(crm.branch_id, gl.branch_id)             AS branch_id,
       coalesce(crm.amount, 0)                           AS crm_amount,
       coalesce(gl.amount, 0)                            AS gl_amount,
       coalesce(crm.amount, 0) - coalesce(gl.amount, 0)  AS diff
FROM   crm
FULL   JOIN gl USING (branch_id)
WHERE  coalesce(crm.amount, 0) <> coalesce(gl.amount, 0);`,
  'RC-08': `-- 客戶主檔切成 64 個區塊，每塊做雜湊，兩邊逐塊比
WITH src AS (
  SELECT customer_id % 64 AS bucket,
         md5(string_agg(customer_id || ':' || branch_id || ':' || status, '|' ORDER BY customer_id)) AS h
  FROM   crm.customer
  GROUP  BY 1
), dst AS (
  SELECT c.customer_id % 64 AS bucket,
         md5(string_agg(c.customer_id || ':' || b.branch_id || ':' || c.status, '|' ORDER BY c.customer_id)) AS h
  FROM   dw.dim_customer c
  JOIN   dw.dim_branch b USING (branch_key)
  WHERE  c.is_current
  GROUP  BY 1
)
SELECT bucket
FROM   src
FULL   JOIN dst USING (bucket)
WHERE  src.h IS DISTINCT FROM dst.h;`,
  'RC-09': `-- 簽呈已經核准超過 1 天，ERP 的請購單還不是「已核准」
SELECT w.form_no, w.final_sign_time, p.approval_status
FROM   wf.form w
LEFT   JOIN erp_po.requisition p ON p.pr_number = w.form_ref
WHERE  w.form_type = 'PR'
AND    w.result = 'A'
AND    w.final_sign_time < now() - interval '1 day'
AND    coalesce(p.approval_status, '') <> 'A';`,
  'RC-10': `-- 已離職但帳號還啟用，或在職但沒有帳號
SELECT h.emp_no, h.emp_status, h.leave_date, a.enabled
FROM   hr.employee h
LEFT   JOIN iam.account a ON a.employee_number = h.emp_no
WHERE  (h.emp_status = 'L' AND a.enabled)
OR     (h.emp_status = 'A' AND a.employee_number IS NULL);`,
};

/** RC-05 的查詢優化前後。格式是 PostgreSQL 的 EXPLAIN (ANALYZE)；數字是為這個 Demo 編的。 */
const PLAN_RC05: QueryPlan = {
  before: `HashAggregate  (cost=98412.55..98631.80 rows=5847 width=47) (actual time=18412.118..18419.905 rows=0 loops=1)
  Group Key: a.ap_voucher_no, a.payable_amount
  Filter: (a.payable_amount <> COALESCE(sum(g.credit_amount), '0'::numeric))
  Rows Removed by Filter: 8312
  ->  Hash Right Join  (cost=4127.90..98212.10 rows=26727 width=27) (actual time=412.331..18377.652 rows=8312 loops=1)
        Hash Cond: ((g.source_ref)::text = (a.ap_voucher_no)::text)
        ->  Seq Scan on voucher_line g  (cost=0.00..91250.40 rows=318420 width=24) (actual time=0.041..17811.207 rows=311904 loops=1)
              Filter: (account_code = '2171'::bpchar)
              Rows Removed by Filter: 2104388
        ->  Hash  (cost=4022.61..4022.61 rows=8423 width=19) (actual time=411.870..411.871 rows=8312 loops=1)
              Buckets: 16384  Batches: 1  Memory Usage: 551kB
              ->  Seq Scan on voucher a  (cost=0.00..4022.61 rows=8423 width=19) (actual time=0.019..405.112 rows=8312 loops=1)
                    Filter: (posting_date >= date_trunc('month', CURRENT_DATE))
                    Rows Removed by Filter: 187455
Planning Time: 0.412 ms
Execution Time: 18421.336 ms`,
  after: `HashAggregate  (cost=31313.94..31533.19 rows=5847 width=47) (actual time=140.902..141.774 rows=0 loops=1)
  Group Key: a.ap_voucher_no, a.payable_amount
  Filter: (a.payable_amount <> COALESCE(sum(g.credit_amount), '0'::numeric))
  Rows Removed by Filter: 8312
  ->  Nested Loop Left Join  (cost=0.85..31113.49 rows=26727 width=27) (actual time=0.062..128.440 rows=8312 loops=1)
        ->  Index Scan using idx_ap_voucher_posting on voucher a  (cost=0.42..512.80 rows=8423 width=19) (actual time=0.031..9.204 rows=8312 loops=1)
              Index Cond: (posting_date >= date_trunc('month', CURRENT_DATE))
        ->  Index Scan using idx_voucher_line_ap_ref on voucher_line g  (cost=0.43..3.60 rows=3 width=24) (actual time=0.012..0.013 rows=1 loops=8312)
              Index Cond: ((source_ref)::text = (a.ap_voucher_no)::text)
Planning Time: 0.538 ms
Execution Time: 142.019 ms`,
  ddl: `-- 只索引「應付帳款」科目的那些行，索引小、寫入成本也低
CREATE INDEX CONCURRENTLY idx_voucher_line_ap_ref
  ON erp_gl.voucher_line (source_ref)
  WHERE account_code = '2171';

CREATE INDEX CONCURRENTLY idx_ap_voucher_posting
  ON erp_ap.voucher (posting_date);`,
  note: L(
    '原本每次都把 240 萬行的傳票明細整張掃過，月底批次同時在跑的時候要 18 秒。加上兩個索引後，改成先用入帳日找出本月的 8,312 張憑單，再逐張用索引找對應的那一行，142 毫秒。變更單 CHG-240，11/21 上線。',
    'The query used to scan all 2.4 million voucher lines every time, taking 18 s while month-end batches were running. With two indexes it first finds this month’s 8,312 vouchers by posting date, then looks up each matching line by index: 142 ms. Change CHG-240, released 11/21.',
  ),
};

interface Spec {
  id: string;
  name: L10n;
  plain: L10n;
  kind: ReconRule['kind'];
  sides: [left: SystemId, right: SystemId];
  ifaceIds: string[];
  schedule: L10n;
  ownerId: string;
  report: L10n;
  baseLeft: number;
  tolerance: L10n;
  lastRunAt: string;
}

const DAILY = L('每天 06:00', 'Daily at 06:00');
const ZERO = L('不容許差異', 'No difference allowed');

const SPECS: Spec[] = [
  {
    id: 'RC-01',
    name: L('傳票筆數：總帳與資料倉儲', 'Voucher row count: GL vs warehouse'),
    plain: L('昨天入帳的傳票，報表資料庫有沒有少', 'Whether any of yesterday’s vouchers are missing from the reporting database'),
    kind: 'count',
    sides: ['erp-gl', 'dw'],
    ifaceIds: ['INT-041'],
    schedule: DAILY,
    ownerId: 'e2',
    report: L('試算表、損益表', 'Trial balance, income statement'),
    baseLeft: 12_412,
    tolerance: ZERO,
    lastRunAt: at(TODAY, '06:00'),
  },
  {
    id: 'RC-02',
    name: L('科目餘額 checksum：總帳與資料倉儲', 'Account balance checksum: GL vs warehouse'),
    plain: L('每個會計科目的餘額，兩邊是不是一樣', 'Whether each account’s balance matches on both sides'),
    kind: 'checksum',
    sides: ['erp-gl', 'dw'],
    ifaceIds: ['INT-041'],
    schedule: DAILY,
    ownerId: 'e2',
    report: L('試算表、資產負債表', 'Trial balance, balance sheet'),
    baseLeft: 1_284,
    tolerance: ZERO,
    lastRunAt: at(TODAY, '06:00'),
  },
  {
    id: 'RC-03',
    name: L('員工主檔與成本中心：人事與 ERP', 'Employee master and cost centre: HR vs ERP'),
    plain: L('每位在職同仁的成本中心，帳務系統跟人事系統是不是一樣', 'Whether each active employee’s cost centre matches between the ledger and HR systems'),
    kind: 'count',
    sides: ['hr', 'erp-gl'],
    ifaceIds: ['INT-014'],
    schedule: L('每小時', 'Hourly'),
    ownerId: 'e2',
    report: L('薪資費用分攤表、部門費用表', 'Payroll cost allocation, departmental expense report'),
    baseLeft: 1_850,
    tolerance: ZERO,
    lastRunAt: at(TODAY, '10:05'),
  },
  {
    id: 'RC-04',
    name: L('薪資費用總額：人事薪資與總帳分錄', 'Payroll expense: HR payroll vs GL journals'),
    plain: L('當月薪資，人事算出來的金額跟入帳的金額是不是一樣', 'Whether the payroll amount calculated by HR equals the amount posted to the ledger'),
    kind: 'amount',
    sides: ['hr', 'erp-gl'],
    ifaceIds: ['INT-015'],
    schedule: L('薪資分錄拋轉後、月結日再一次', 'After payroll posting, and again on month-end'),
    ownerId: 'e2',
    report: L('薪資費用分攤表、損益表', 'Payroll cost allocation, income statement'),
    baseLeft: 143_870_400,
    tolerance: ZERO,
    lastRunAt: at('2026-10-30', '23:40'),
  },
  {
    id: 'RC-05',
    name: L('應付憑單金額：應付與總帳應付科目', 'Payable amount: AP vs GL payable account'),
    plain: L('本月每張應付憑單，入總帳的金額對不對', 'Whether each payable voucher this month was posted to the ledger at the right amount'),
    kind: 'amount',
    sides: ['erp-ap', 'erp-gl'],
    ifaceIds: ['INT-023'],
    schedule: DAILY,
    ownerId: 'e2',
    report: L('應付帳款明細表、資產負債表', 'Payables ledger, balance sheet'),
    baseLeft: 412_683_150,
    tolerance: ZERO,
    lastRunAt: at(TODAY, '06:00'),
  },
  {
    id: 'RC-06',
    name: L('驗收未立帳：採購驗收與應付憑單', 'Received not invoiced: goods receipts vs payable vouchers'),
    plain: L('已經驗收但還沒立應付帳款的採購', 'Purchases that were received but have no payable yet'),
    kind: 'count',
    sides: ['erp-po', 'erp-ap'],
    ifaceIds: ['INT-022'],
    schedule: DAILY,
    ownerId: 'e3',
    report: L('應付帳款帳齡表、暫估應付', 'Payables aging, accrued payables'),
    baseLeft: 1_146,
    tolerance: L('驗收後 3 天內不算差異', 'Not a difference within 3 days of receipt'),
    lastRunAt: at(TODAY, '06:00'),
  },
  {
    id: 'RC-07',
    name: L('手續費收入：CRM 日結檔與總帳', 'Fee income: CRM daily file vs GL'),
    plain: L('各據點昨天的手續費，入帳金額對不對', 'Whether yesterday’s fee income per branch was posted at the right amount'),
    kind: 'amount',
    sides: ['crm', 'erp-gl'],
    ifaceIds: ['INT-031'],
    schedule: DAILY,
    ownerId: 'e2',
    report: L('手續費收入明細表、損益表', 'Fee income ledger, income statement'),
    baseLeft: 3_187_420,
    tolerance: ZERO,
    lastRunAt: at(TODAY, '06:00'),
  },
  {
    id: 'RC-08',
    name: L('客戶主檔 checksum：CRM 與資料倉儲', 'Customer master checksum: CRM vs warehouse'),
    plain: L('客戶資料，報表資料庫跟業務系統是不是一樣', 'Whether customer data in the reporting database matches the sales system'),
    kind: 'checksum',
    sides: ['crm', 'dw'],
    ifaceIds: ['INT-032'],
    schedule: DAILY,
    ownerId: 'e2',
    report: L('客戶數與往來報表', 'Customer count and activity reports'),
    baseLeft: 64,
    tolerance: ZERO,
    lastRunAt: at(TODAY, '06:00'),
  },
  {
    id: 'RC-09',
    name: L('請購核准：簽呈與 ERP 採購', 'Requisition approval: e-Approval vs ERP Procurement'),
    plain: L('簽呈已經核准，但採購那邊還看不到的請購單', 'Requisitions approved in the approval system that purchasing cannot see yet'),
    kind: 'count',
    sides: ['wf', 'erp-po'],
    ifaceIds: ['INT-021'],
    schedule: DAILY,
    ownerId: 'e3',
    report: L('請購進度表', 'Requisition progress report'),
    baseLeft: 212,
    tolerance: L('核准後 1 天內不算差異', 'Not a difference within 1 day of approval'),
    lastRunAt: at(TODAY, '06:00'),
  },
  {
    id: 'RC-10',
    name: L('在職人數與啟用帳號：人事與 AD', 'Headcount vs enabled accounts: HR vs AD'),
    plain: L('已經離職但帳號還能登入的人，或在職卻沒有帳號的人', 'People who left but can still sign in, or who are active but have no account'),
    kind: 'count',
    sides: ['hr', 'iam'],
    ifaceIds: ['INT-011'],
    schedule: DAILY,
    ownerId: 'e2',
    report: L('帳號清查報告（給稽核）', 'Account review report (for audit)'),
    baseLeft: 1_850,
    tolerance: ZERO,
    lastRunAt: at(TODAY, '06:00'),
  },
];

export function buildReconRules(): ReconRule[] {
  return SPECS.map((s) => ({
    id: s.id,
    name: s.name,
    plain: s.plain,
    kind: s.kind,
    left: s.sides[0],
    right: s.sides[1],
    ifaceIds: s.ifaceIds,
    schedule: s.schedule,
    ownerId: s.ownerId,
    report: s.report,
    sql: SQL[s.id],
    baseLeft: s.baseLeft,
    tolerance: s.tolerance,
    lastRunAt: s.lastRunAt,
    plan: s.id === 'RC-05' ? PLAN_RC05 : undefined,
  }));
}

const diff = (id: string, ruleId: string, key: string, left: L10n, right: L10n, amount: number, reason: L10n, foundAt: string): ReconDiff => ({
  id,
  ruleId,
  key,
  left,
  right,
  amount,
  reason,
  status: 'open',
  foundAt,
});

/** 目前還沒結掉的差異：4 條規則、10 筆。其餘 6 條規則是平的。 */
export function buildReconDiffs(): ReconDiff[] {
  const found = at(TODAY, '06:00');
  const none = L('沒有應付憑單', 'No payable voucher');
  return [
    diff(
      'DF-6001',
      'RC-06',
      'GR-2611-0398',
      L('11/19 驗收，NT$ 186,000', 'Received 11/19, NT$ 186,000'),
      none,
      0,
      L('供應商發票還沒到', 'Supplier invoice not received yet'),
      at(addDays(TODAY, -2), '06:00'),
    ),
    diff(
      'DF-6002',
      'RC-06',
      'GR-2611-0412',
      L('11/20 驗收，NT$ 42,500', 'Received 11/20, NT$ 42,500'),
      none,
      0,
      L('供應商發票還沒到', 'Supplier invoice not received yet'),
      at(YESTERDAY, '06:00'),
    ),
    diff(
      'DF-6003',
      'RC-06',
      'GR-2611-0431',
      L('11/23 驗收，NT$ 1,320,000', 'Received 11/23, NT$ 1,320,000'),
      none,
      0,
      L('發票金額與驗收金額不符，採購科確認中', 'Invoice and receipt amounts differ; Procurement is checking'),
      found,
    ),
    diff(
      'DF-6004',
      'RC-06',
      'GR-2611-0437',
      L('11/23 驗收，NT$ 68,250', 'Received 11/23, NT$ 68,250'),
      none,
      0,
      L('驗收入帳的排程在 11/23 漏跑一輪', 'The receipt-to-payable job missed one cycle on 11/23'),
      found,
    ),
    diff(
      'DF-7001',
      'RC-07',
      'br-tc',
      L('NT$ 412,860', 'NT$ 412,860'),
      L('NT$ 411,660', 'NT$ 411,660'),
      1_200,
      L('一筆退費的沖正隔天才入帳', 'A refund reversal was posted a day later'),
      found,
    ),
    diff(
      'DF-7002',
      'RC-07',
      'br-kh',
      L('NT$ 388,140', 'NT$ 388,140'),
      L('NT$ 388,490', 'NT$ 388,490'),
      -350,
      L('日結檔晚到，有一筆被算進前一天', 'The daily file was late and one row was counted on the previous day'),
      found,
    ),
    diff(
      'DF-7003',
      'RC-07',
      'br-bq',
      L('NT$ 296,505', 'NT$ 296,505'),
      L('NT$ 296,425', 'NT$ 296,425'),
      80,
      L('兩邊四捨五入的時機不同', 'The two sides round at different points'),
      found,
    ),
    diff(
      'DF-9001',
      'RC-09',
      'PR-2611-0733',
      L('11/25 15:42 核准', 'Approved 11/25 15:42'),
      L('ERP 狀態：送審中', 'ERP status: in approval'),
      0,
      L('核准結果進了 DLQ，等重送', 'The approval result is in the DLQ awaiting resend'),
      found,
    ),
    diff(
      'DF-9002',
      'RC-09',
      'PR-2611-0741',
      L('11/25 17:10 核准', 'Approved 11/25 17:10'),
      L('ERP 查不到這張請購單', 'Requisition not found in ERP'),
      0,
      L('請購單在 ERP 被撤回，簽呈沒有同步', 'The requisition was withdrawn in ERP but the approval system was not told'),
      found,
    ),
    diff(
      'DF-1001',
      'RC-10',
      'E19-0452',
      L('11/20 離職', 'Left on 11/20'),
      L('帳號仍啟用', 'Account still enabled'),
      0,
      L('離職單補登日期晚於離職日，停用排程沒有抓到', 'The leaver form was entered after the leave date, so the disable job missed it'),
      found,
    ),
  ];
}

/** 月結日。對帳規則的排程說明會用到。 */
export const RECON_MONTH_END = MONTH_END;
