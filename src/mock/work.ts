import { addDays, ago, TODAY } from '../core/date';
import { L } from '../core/i18n';
import type { Review, SystemId, Task, TaskStatus } from '../core/types';

// 任務與 Code Review 佇列。每個人的負載是從沒做完的任務加總算出來的，不是另外填的數字。

type TaskRow = [
  id: string,
  zh: string,
  en: string,
  assigneeId: string | null,
  systemId: SystemId,
  effortDays: number,
  status: TaskStatus,
  dueInDays: number,
  ifaceId?: string,
];

const TASKS: TaskRow[] = [
  ['T-501', '整理 INT-014 三個月的逾時紀錄', 'Compile three months of INT-014 timeouts', 'e1', 'esb', 2, 'doing', 3, 'INT-014'],
  ['T-502', '整合層的重試參數寫成文件', 'Document the integration-layer retry settings', 'e1', 'esb', 1, 'todo', 7],
  ['T-503', 'CRM 6.3 上線前的 INT-013 回歸測試案例', 'INT-013 regression cases before CRM 6.3', 'e1', 'crm', 2, 'todo', 10, 'INT-013'],
  ['T-504', '簽呈汰換：介面清單與設計草稿', 'Approval replacement: interface inventory and design draft', 'e1', 'wf', 3, 'doing', 14],
  ['T-511', 'RC-05 索引上線後追蹤一週', 'Watch RC-05 for a week after the index release', 'e2', 'dw', 1, 'doing', 1],
  ['T-512', '10 條對帳規則補上「怎麼判讀」', 'Add “how to read it” notes to the 10 reconciliation rules', 'e2', 'dw', 3, 'doing', 12],
  ['T-513', 'INT-055 改讀修正後的檢視表', 'Point INT-055 at the fixed view', 'e2', 'wf', 1, 'todo', 3, 'INT-055'],
  ['T-514', '月結報表提速的做法評估', 'Assess options for faster month-end reports', 'e2', 'dw', 2, 'todo', 20],
  ['T-521', '年結檢核清單與廠商逐項對表', 'Walk through the year-end checklist with the vendor', 'e3', 'erp-gl', 2, 'doing', 10],
  ['T-522', '月結前應付批次試跑結果確認', 'Confirm the pre-month-end AP batch dry run', 'e3', 'erp-ap', 1, 'review', 0, 'INT-023'],
  ['T-523', '接手 RC-05、RC-06 的第二負責人', 'Take over as second owner of RC-05 and RC-06', 'e3', 'erp-ap', 2, 'todo', 14],
  ['T-531', 'AD 憑證更新演練', 'Rehearse the AD certificate renewal', 'e4', 'iam', 2, 'doing', 1],
  ['T-532', 'CRM 6.3 據點歸屬的驗收測試', 'Acceptance tests for CRM 6.3 branch assignment', 'e4', 'crm', 3, 'todo', 5],
  ['T-533', '舊簽呈的處理步驟寫成 Runbook', 'Turn legacy approval procedures into a runbook', 'e4', 'wf', 3, 'doing', 24],
  ['T-534', '追查 INT-052 被 CRM 限流的原因', 'Find out why CRM rate-limits INT-052', 'e4', 'iam', 2, 'todo', 6, 'INT-052'],
  ['T-535', '簽呈匯出工具的需求確認', 'Confirm requirements for the approval export tool', 'e4', 'wf', 1, 'todo', 4],
  ['T-541', '2027 路徑圖的預算與財務處對表', 'Reconcile the 2027 roadmap budget with Finance', 'tl', 'esb', 2, 'doing', 5],
  ['T-542', '釐清 CRM 6.3 延遲的責任歸屬', 'Clarify who is responsible for the CRM 6.3 delay', 'tl', 'crm', 1, 'todo', 2],
  ['T-551', '月結三天的駐點支援', 'On-site support for the three month-end days', 'v2', 'erp-gl', 3, 'doing', 3],
  ['T-552', '更新年結檢核清單', 'Update the year-end checklist', 'v2', 'erp-gl', 2, 'todo', 10],
  ['T-561', '修正簽核時效檢視表', 'Fix the approval lead-time view', 'v5', 'wf', 1, 'doing', 1, 'INT-055'],
  ['T-562', '歷史簽呈匯出工具', 'Historical approval export tool', 'v5', 'wf', 4, 'doing', 15],
  ['T-571', 'INT-061 分攤尾差的規則寫成文件', 'Document the INT-061 rounding remainder rule', null, 'dw', 1, 'todo', 21, 'INT-061'],
];

export function buildTasks(): Task[] {
  return TASKS.map(([id, zh, en, assigneeId, systemId, effortDays, status, dueInDays, ifaceId]) => ({
    id,
    title: L(zh, en),
    assigneeId,
    systemId,
    ifaceId,
    effortDays,
    status,
    due: addDays(TODAY, dueInDays),
  }));
}

export function buildReviews(): Review[] {
  const r = (
    id: string,
    zh: string,
    en: string,
    authorId: string,
    reviewerId: string,
    systemId: SystemId,
    lines: number,
    hoursAgo: number,
    status: Review['status'] = 'open',
  ): Review => ({
    id,
    title: L(zh, en),
    authorId,
    reviewerId,
    systemId,
    lines,
    openedAt: ago(hoursAgo),
    status,
  });
  return [
    r('RV-81', 'INT-014 的逾時從 30 秒改成 45 秒', 'Raise the INT-014 timeout from 30 s to 45 s', 'e1', 'tl', 'esb', 86, 20),
    r('RV-82', 'RC-06 排除驗收後 3 天內的單', 'RC-06: exclude receipts from the last 3 days', 'e2', 'e3', 'dw', 40, 6),
    r('RV-83', '應付批次加上冪等鍵', 'Add an idempotency key to the AP batch', 'v2', 'e3', 'erp-ap', 312, 52),
    r('RV-84', '據點成本中心對照加快取', 'Cache the branch cost-centre mapping', 'e4', 'e1', 'crm', 128, 30),
    r('RV-85', '簽核時效檢視表的修正 SQL', 'SQL fix for the approval lead-time view', 'v5', 'e2', 'wf', 24, 4),
    r('RV-86', '傳票分區的維護腳本', 'Maintenance script for voucher partitions', 'e2', 'e1', 'dw', 210, 70, 'approved'),
  ];
}
