import { L } from './i18n';
import type { L10n, RoleId } from './types';

// 角色、權限、預設矩陣與職責分離規則。
// 這個檔案只放「定義」；判斷在 auth.ts，矩陣本身存在 store 裡（系統管理員可以改）。

export const ROLES: RoleId[] = ['techlead', 'engineer', 'vendorpm', 'finance', 'hr', 'business', 'auditor', 'admin'];

export const ROLE_NAME: Record<RoleId, L10n> = {
  techlead: L('Tech Lead', 'Tech Lead'),
  engineer: L('內部工程師', 'Internal engineer'),
  vendorpm: L('委外廠商 PM', 'Vendor PM'),
  finance: L('財務主管', 'Finance manager'),
  hr: L('人資主管', 'HR manager'),
  business: L('業務單位主管', 'Business unit manager'),
  auditor: L('稽核', 'Auditor'),
  admin: L('系統管理員', 'System administrator'),
};

export const ROLE_DESC: Record<RoleId, L10n> = {
  techlead: L('看全部；指派、核准發版、寫 1:1、做決策紀錄', 'Sees everything; assigns work, approves releases, writes 1:1 notes and decision records'),
  engineer: L('自己的任務、介面細節、Runbook、Code Review 佇列', 'Own tasks, interface details, runbooks, code review queue'),
  vendorpm: L('只看自家系統的工單、SLA 與交付項', "Only their own system's tickets, SLA and deliverables"),
  finance: L('月結倒數、對帳差異、受影響的報表', 'Month-end countdown, reconciliation differences, affected reports'),
  hr: L('到職、異動、薪資相關資料的狀態', 'Status of onboarding, transfer and payroll data'),
  business: L('CRM 需求進度與各據點狀態', 'CRM request progress and branch status'),
  auditor: L('權限矩陣、稽核軌跡、變更紀錄；全部唯讀', 'Permission matrix, audit trail, change records; read-only'),
  admin: L('管理成員與權限矩陣', 'Manages members and the permission matrix'),
};

export const PERMS = [
  'page.overview',
  'page.integration',
  'page.consistency',
  'page.vendors',
  'page.team',
  'page.roadmap',
  'page.demands',
  'page.incidents',
  'page.rbac',
  'page.about',
  'iface.detail',
  'iface.resend',
  'fault.inject',
  'sql.view',
  'recon.resolve',
  'vendor.viewAll',
  'vendor.accept',
  'cr.raise',
  'cr.decide',
  'task.assign',
  'task.updateOwn',
  'oneonone.manage',
  'doc.review',
  'member.manage',
  'demand.create',
  'demand.assess',
  'decision.write',
  'adr.write',
  'roadmap.edit',
  'incident.manage',
  'change.raise',
  'release.approve',
  'gate.check',
  'audit.view',
  'rbac.edit',
] as const;
export type Perm = (typeof PERMS)[number];

export const PERM_NAME: Record<Perm, L10n> = {
  'page.overview': L('看「總覽」', 'View Overview'),
  'page.integration': L('看「整合架構」', 'View Integration'),
  'page.consistency': L('看「資料一致性」', 'View Data consistency'),
  'page.vendors': L('看「廠商管理」', 'View Vendors'),
  'page.team': L('看「團隊與規範」', 'View Team & standards'),
  'page.roadmap': L('看「技術路徑圖」', 'View Roadmap'),
  'page.demands': L('看「需求與決策」', 'View Requests & decisions'),
  'page.incidents': L('看「事件與變更」', 'View Incidents & changes'),
  'page.rbac': L('看「權限矩陣」', 'View Permissions'),
  'page.about': L('看「關於這個 Demo」', 'View About'),
  'iface.detail': L('看介面的技術細節', 'See interface technical details'),
  'iface.resend': L('重送失敗的資料', 'Resend failed records'),
  'fault.inject': L('注入故障做影響模擬', 'Inject a fault to simulate impact'),
  'sql.view': L('看對帳規則的 SQL 與執行計畫', 'See reconciliation SQL and query plans'),
  'recon.resolve': L('把對帳差異標成已處理', 'Mark reconciliation differences as resolved'),
  'vendor.viewAll': L('看所有廠商的評分', 'See every vendor’s scores'),
  'vendor.accept': L('驗收廠商交付項', 'Accept or reject vendor deliverables'),
  'cr.raise': L('提出變更請求', 'Raise a change request'),
  'cr.decide': L('核定變更請求', 'Decide a change request'),
  'task.assign': L('指派任務', 'Assign tasks'),
  'task.updateOwn': L('更新自己的任務', 'Update own tasks'),
  'oneonone.manage': L('看與寫 1:1 紀錄', 'Read and write 1:1 notes'),
  'doc.review': L('把文件標成已檢視', 'Mark documents as reviewed'),
  'member.manage': L('管理成員', 'Manage members'),
  'demand.create': L('提出需求', 'Submit a request'),
  'demand.assess': L('評估需求', 'Assess a request'),
  'decision.write': L('寫決策紀錄', 'Write decision records'),
  'adr.write': L('寫 ADR', 'Write ADRs'),
  'roadmap.edit': L('調整路徑圖', 'Edit the roadmap'),
  'incident.manage': L('處理事件', 'Handle incidents'),
  'change.raise': L('提出變更', 'Raise a change'),
  'release.approve': L('核准發版與變更', 'Approve releases and changes'),
  'gate.check': L('勾選把關項目', 'Check gate items'),
  'audit.view': L('看稽核軌跡', 'View the audit trail'),
  'rbac.edit': L('修改權限矩陣', 'Edit the permission matrix'),
};

export const PERM_GROUPS: { name: L10n; perms: Perm[] }[] = [
  {
    name: L('頁面', 'Pages'),
    perms: [
      'page.overview',
      'page.integration',
      'page.consistency',
      'page.vendors',
      'page.team',
      'page.roadmap',
      'page.demands',
      'page.incidents',
      'page.rbac',
      'page.about',
    ],
  },
  { name: L('介面與對帳', 'Interfaces and reconciliation'), perms: ['iface.detail', 'iface.resend', 'fault.inject', 'sql.view', 'recon.resolve'] },
  { name: L('廠商', 'Vendors'), perms: ['vendor.viewAll', 'vendor.accept', 'cr.raise', 'cr.decide'] },
  { name: L('團隊', 'Team'), perms: ['task.assign', 'task.updateOwn', 'oneonone.manage', 'doc.review', 'member.manage'] },
  { name: L('需求與決策', 'Requests and decisions'), perms: ['demand.create', 'demand.assess', 'decision.write', 'adr.write', 'roadmap.edit'] },
  { name: L('事件與變更', 'Incidents and changes'), perms: ['incident.manage', 'change.raise', 'release.approve', 'gate.check'] },
  { name: L('稽核與權限', 'Audit and permissions'), perms: ['audit.view', 'rbac.edit'] },
];

export const DEFAULT_MATRIX: Record<RoleId, Perm[]> = {
  techlead: [
    'page.overview',
    'page.integration',
    'page.consistency',
    'page.vendors',
    'page.team',
    'page.roadmap',
    'page.demands',
    'page.incidents',
    'page.rbac',
    'page.about',
    'iface.detail',
    'iface.resend',
    'fault.inject',
    'sql.view',
    'recon.resolve',
    'vendor.viewAll',
    'vendor.accept',
    'cr.decide',
    'task.assign',
    'oneonone.manage',
    'doc.review',
    'demand.create',
    'demand.assess',
    'decision.write',
    'adr.write',
    'roadmap.edit',
    'incident.manage',
    'release.approve',
    'gate.check',
    'audit.view',
  ],
  engineer: [
    'page.overview',
    'page.integration',
    'page.consistency',
    'page.team',
    'page.roadmap',
    'page.incidents',
    'page.about',
    'iface.detail',
    'iface.resend',
    'fault.inject',
    'sql.view',
    'recon.resolve',
    'task.updateOwn',
    'doc.review',
    'demand.assess',
    'adr.write',
    'incident.manage',
    'change.raise',
    'gate.check',
  ],
  vendorpm: ['page.overview', 'page.vendors', 'page.about', 'cr.raise'],
  finance: ['page.overview', 'page.consistency', 'page.roadmap', 'page.demands', 'page.about', 'demand.create'],
  hr: ['page.overview', 'page.roadmap', 'page.demands', 'page.about', 'demand.create'],
  business: ['page.overview', 'page.roadmap', 'page.demands', 'page.about', 'demand.create'],
  auditor: ['page.overview', 'page.incidents', 'page.rbac', 'page.about', 'audit.view'],
  admin: ['page.overview', 'page.team', 'page.rbac', 'page.about', 'member.manage', 'audit.view', 'rbac.edit'],
};

/** 不能被取消的格子：避免把自己鎖在門外，或讓任何角色連「總覽／關於」都看不到。 */
export function isLocked(role: RoleId, perm: Perm): boolean {
  if (perm === 'page.overview' || perm === 'page.about') return true;
  return role === 'admin' && (perm === 'page.rbac' || perm === 'rbac.edit');
}

// ── 職責分離（Segregation of Duties）

export interface SodRule {
  id: string;
  a: Perm;
  b: Perm;
  why: L10n;
}

/** 同一個角色不該同時握有的兩個權限。 */
export const SOD_RULES: SodRule[] = [
  { id: 'SOD-1', a: 'change.raise', b: 'release.approve', why: L('提出變更的人不能自己核准', 'Whoever raises a change cannot approve it') },
  { id: 'SOD-2', a: 'cr.raise', b: 'cr.decide', why: L('提出變更請求的人不能自己核定', 'Whoever raises a change request cannot decide it') },
  { id: 'SOD-3', a: 'cr.raise', b: 'vendor.accept', why: L('廠商不能驗收自己的交付項', 'A vendor cannot accept its own deliverables') },
  { id: 'SOD-4', a: 'rbac.edit', b: 'release.approve', why: L('管權限的人不能核准變更', 'Whoever manages permissions cannot approve changes') },
  {
    id: 'SOD-5',
    a: 'rbac.edit',
    b: 'recon.resolve',
    why: L('管權限的人不能結掉對帳差異', 'Whoever manages permissions cannot close reconciliation differences'),
  },
];

export interface SodConflict {
  role: RoleId;
  ruleId: string;
  perms: Perm[];
  why: L10n;
}

const READ_ONLY = (perm: string) => perm.startsWith('page.') || perm.endsWith('.view') || perm.endsWith('.viewAll') || perm.endsWith('.detail');

/** 檢查一份矩陣有哪些職責分離衝突。稽核另外有一條：只能有唯讀權限。 */
export function sodConflicts(matrix: Record<RoleId, string[]>): SodConflict[] {
  const out: SodConflict[] = [];
  for (const role of ROLES) {
    const held = new Set(matrix[role] ?? []);
    for (const rule of SOD_RULES) {
      if (held.has(rule.a) && held.has(rule.b)) out.push({ role, ruleId: rule.id, perms: [rule.a, rule.b], why: rule.why });
    }
  }
  const writes = (matrix.auditor ?? []).filter((p) => !READ_ONLY(p)) as Perm[];
  if (writes.length)
    out.push({ role: 'auditor', ruleId: 'SOD-6', perms: writes, why: L('稽核只能有唯讀權限', 'Auditors may hold read-only permissions only') });
  return out;
}
