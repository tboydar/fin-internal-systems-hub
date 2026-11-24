// 全站共用的資料型別。所有內容皆為虛構（mock data）。

export type Lang = 'zh' | 'en';
/** 雙語文字：mock data 與使用者輸入都用同一種形狀，畫面依目前語言取值。 */
export interface L10n {
  zh: string;
  en: string;
}

export type RoleId = 'techlead' | 'engineer' | 'vendorpm' | 'finance' | 'hr' | 'business' | 'auditor' | 'admin';
/** 三種狀態。畫面上一律「顏色＋形狀＋文字」一起出現，不只靠顏色。 */
export type Health = 'ok' | 'warn' | 'crit';
/** 領域，同時是 3D 總行的樓層。 */
export type Domain = 'sales' | 'finance' | 'hr' | 'procurement' | 'it';
export type SystemId = 'erp-gl' | 'erp-ap' | 'erp-po' | 'crm' | 'hr' | 'wf' | 'esb' | 'dw' | 'iam';
export type VendorId = 'v-erp' | 'v-crm' | 'v-hr' | 'v-wf';
export type Priority = 'P1' | 'P2' | 'P3';
export type Risk = 'low' | 'med' | 'high';
/** 機房：總行的自建機房、異地備援中心、廠商代管的機房。 */
export type DcId = 'dc-hq' | 'dc-dr' | 'dc-vendor';
export type RegionId = 'north' | 'central' | 'south' | 'overseas';
/**
 * 異地備援的做法。
 * replica：資料即時複寫，備援環境一直開著；standby：定時複寫，要人工切換；
 * backup：沒有備援環境，只有每天的備份，出事要從備份重建。
 */
export type DrMode = 'replica' | 'standby' | 'backup';
export interface DrPlan {
  mode: DrMode;
  /** 復原時間目標：停擺之後多久要回來（小時）。 */
  rtoHr: number;
  /** 復原點目標：最多可以掉多久的資料（分鐘）。 */
  rpoMin: number;
}

// ── 系統、廠商、人

export interface System {
  id: SystemId;
  code: string;
  name: L10n;
  /** 給財務、人資、業務看的稱呼，不帶技術名詞。 */
  plain: L10n;
  domain: Domain;
  /** 哪些單位每天在用。這個系統停了，這些樓層會受影響。 */
  usedBy: Domain[];
  vendorId: VendorId | null;
  ownerId: string;
  version: string;
  hosting: L10n;
  /** 正式環境放在哪一個機房。 */
  dcId: DcId;
  /** 異地備援的等級。廠商代管的系統，這裡寫的是合約上廠商承諾的等級。 */
  dr: DrPlan;
  since: number;
  note: L10n;
}

export interface SlaTarget {
  respondMin: number;
  resolveHr: number;
}

export interface Vendor {
  id: VendorId;
  name: L10n;
  product: L10n;
  pmId: string;
  contractNo: string;
  contractStart: string;
  contractEnd: string;
  monthlyFee: number;
  sla: Record<Priority, SlaTarget>;
  note: L10n;
}

export type SkillKey = 'erpFin' | 'erpPo' | 'crm' | 'hr' | 'wf' | 'esb' | 'sql' | 'iam';
export type PersonKind = 'internal' | 'vendor' | 'business';

export interface OneOnOne {
  id: string;
  date: string;
  topic: L10n;
  notes: L10n;
  actions: L10n;
}

export interface Person {
  id: string;
  name: L10n;
  title: L10n;
  kind: PersonKind;
  dept: L10n;
  vendorId?: VendorId;
  scope: L10n;
  /** 兩週內可以排工作的天數。業務單位窗口不排工程任務，所以是 0。 */
  capacityDays: number;
  /** 0 不會、1 看得懂、2 能獨立處理、3 能教人。 */
  skills: Partial<Record<SkillKey, number>>;
  active: boolean;
  oneOnOnes: OneOnOne[];
}

export type TaskStatus = 'todo' | 'doing' | 'review' | 'done';
export interface Task {
  id: string;
  title: L10n;
  assigneeId: string | null;
  systemId: SystemId;
  ifaceId?: string;
  effortDays: number;
  status: TaskStatus;
  due: string;
}

export interface Review {
  id: string;
  title: L10n;
  authorId: string;
  reviewerId: string;
  systemId: SystemId;
  lines: number;
  openedAt: string;
  status: 'open' | 'approved' | 'changes';
}

// ── 介面

export type Protocol = 'REST' | 'SOAP' | 'SFTP' | 'JDBC' | 'MQ' | 'LDAP' | 'SAML';
export type Via = 'esb' | 'file' | 'direct';

export interface FieldMap {
  from: string;
  to: string;
  rule: L10n;
}

export interface Schedule {
  kind: 'realtime' | 'interval' | 'daily' | 'monthly';
  everyMin?: number;
  /** HH:mm，台北時間。 */
  at?: string;
  /** 一天裡哪幾個小時有資料在跑（0–23）。3D 的時間軸與批次表都讀這個。 */
  hours: number[];
}

export interface Iface {
  id: string;
  name: L10n;
  /** 給非技術角色看的說法。 */
  plain: L10n;
  source: SystemId;
  target: SystemId;
  /** 所屬系統：由這個系統的團隊（或廠商）負責實作與維護。 */
  systemId: SystemId;
  /** 負責的廠商；內部自己維護的是 null。必須等於所屬系統的廠商（有測試守著）。 */
  vendorId: VendorId | null;
  ownerId: string;
  domain: Domain;
  via: Via;
  protocol: Protocol;
  schedule: Schedule;
  /** 資料契約版本。 */
  contract: string;
  /** 平常一次跑幾筆。 */
  volume: number;
  fields: FieldMap[];
  retry: { max: number; backoff: L10n };
  dlq: boolean;
  compensation: L10n;
  reconIds: string[];
  /** 這條介面要等哪些介面先成功。 */
  dependsOn: string[];
  apiId?: string;
  runbookId?: string;
  flaky?: boolean;
}

export type RunStatus = 'ok' | 'retried' | 'late' | 'fail' | 'held';
export interface Run {
  id: string;
  ifaceId: string;
  at: string;
  status: RunStatus;
  records: number;
  failed: number;
  attempts: number;
  seconds: number;
  http?: number;
  /** 比排定時間晚了幾分鐘（status 是 late 時才有）。 */
  lateMin?: number;
  note?: L10n;
}

export interface DlqItem {
  id: string;
  ifaceId: string;
  runId: string;
  key: string;
  kind: L10n;
  detail: L10n;
  status: 'queued' | 'resent';
}

export interface ApiEntry {
  id: string;
  name: L10n;
  systemId: SystemId;
  style: 'REST' | 'SOAP';
  version: string;
  status: 'active' | 'deprecated' | 'sunset';
  sunset?: string;
  successor?: string;
  note: L10n;
}

// ── 對帳

export interface QueryPlan {
  before: string;
  after: string;
  ddl: string;
  note: L10n;
}

export interface ReconRule {
  id: string;
  name: L10n;
  plain: L10n;
  kind: 'count' | 'amount' | 'checksum';
  left: SystemId;
  right: SystemId;
  ifaceIds: string[];
  schedule: L10n;
  ownerId: string;
  /** 受影響的報表，用財務看得懂的名稱。 */
  report: L10n;
  sql: string;
  /** 左側的總數（筆數、金額或區塊數）。右側由左側扣掉未結差異算出，不另外存。 */
  baseLeft: number;
  tolerance: L10n;
  lastRunAt: string;
  plan?: QueryPlan;
  /** 兩邊不是既有的九個系統時（例如新舊系統並行），另外給名稱。 */
  sideNames?: [L10n, L10n];
}

export interface ReconDiff {
  id: string;
  ruleId: string;
  key: string;
  left: L10n;
  right: L10n;
  /** 金額差（左減右）。筆數與 checksum 規則填 0。 */
  amount: number;
  reason: L10n;
  status: 'open' | 'resolved';
  foundAt: string;
  resolvedBy?: string;
}

// ── 廠商管理

export interface Ticket {
  id: string;
  vendorId: VendorId;
  systemId: SystemId;
  title: L10n;
  priority: Priority;
  openedAt: string;
  respondedAt?: string;
  resolvedAt?: string;
  ifaceId?: string;
  incidentId?: string;
}

export interface Deliverable {
  id: string;
  vendorId: VendorId;
  title: L10n;
  due: string;
  deliveredAt?: string;
  acceptance: 'pending' | 'accepted' | 'rejected';
  /** 被驗收退件的次數。 */
  rejects: number;
  rejectReason?: L10n;
}

export interface Milestone {
  id: string;
  vendorId: VendorId;
  title: L10n;
  date: string;
  amount: number;
  status: 'paid' | 'accepted' | 'due' | 'late' | 'planned';
}

export type Party = 'internal' | 'vendor' | 'business' | 'audit';
export interface RaciRow {
  id: string;
  vendorId: VendorId;
  activity: L10n;
  /** 每一方填 R、A、C、I 的組合，或空字串。 */
  cells: Record<Party, string>;
  disputed?: L10n;
}

export type CrStage = 'submitted' | 'assessed' | 'approved' | 'rejected' | 'done';
export interface ChangeRequest {
  id: string;
  vendorId: VendorId;
  title: L10n;
  reason: L10n;
  raisedBy: string;
  raisedAt: string;
  cost: number;
  days: number;
  stage: CrStage;
  decisionId?: string;
}

// ── 需求與決策

export type DemandStage = 'submitted' | 'assessing' | 'options' | 'decided' | 'scheduled' | 'declined';
export interface DemandOption {
  key: string;
  title: L10n;
  cost: number;
  weeks: number;
  risk: Risk;
  note: L10n;
}

export interface Demand {
  id: string;
  title: L10n;
  dept: Domain;
  requesterId: string;
  createdAt: string;
  stage: DemandStage;
  systemIds: SystemId[];
  summary: L10n;
  options: DemandOption[];
  decisionId?: string;
  roadmapId?: string;
  branchId?: string;
}

export interface Decision {
  id: string;
  title: L10n;
  date: string;
  decidedBy: string;
  chosen: L10n;
  why: L10n;
  demandId?: string;
  crId?: string;
  incidentId?: string;
}

// ── 事件與變更

export type IncidentStage = 'triggered' | 'assigned' | 'mitigating' | 'recovered' | 'review' | 'closed';
export interface IncidentAction {
  text: L10n;
  ownerId: string;
  due: string;
  done: boolean;
}

export interface Incident {
  id: string;
  title: L10n;
  severity: 'S1' | 'S2' | 'S3';
  systemId: SystemId;
  ifaceId?: string;
  stage: IncidentStage;
  ownerId: string | null;
  startedAt: string;
  recoveredAt?: string;
  impact: L10n;
  rootCause: L10n;
  fix: L10n;
  actions: IncidentAction[];
  timeline: { stage: IncidentStage; at: string; by: string }[];
  adrId?: string;
  roadmapId?: string;
}

export interface GateItem {
  id: string;
  text: L10n;
  checkedBy?: string;
}

export interface Change {
  id: string;
  title: L10n;
  systemId: SystemId;
  date: string;
  window: string;
  kind: 'standard' | 'normal' | 'emergency';
  /** 做了就退不回去（例如刪資料、改主鍵、停用舊系統）。要逐項人工把關才能核准。 */
  irreversible: boolean;
  status: 'requested' | 'approved' | 'done' | 'rejected';
  requesterId: string;
  approvedBy?: string;
  gates: GateItem[];
  rollback: L10n;
}

// ── 規範、文件、路徑圖

export interface Adr {
  id: string;
  title: L10n;
  status: 'proposed' | 'accepted' | 'superseded';
  date: string;
  authorId: string;
  context: L10n;
  decision: L10n;
  consequences: L10n;
  reviewed: string;
  incidentId?: string;
}

export type DocKind = 'standard' | 'api' | 'errors' | 'runbook' | 'process' | 'onboarding';
export interface Doc {
  id: string;
  title: L10n;
  kind: DocKind;
  ownerId: string;
  reviewed: string;
  /** 多久要重新檢視一次。超過就算過期。 */
  cycleDays: number;
  systemId?: SystemId;
  outline: L10n[];
}

export interface RoadmapItem {
  id: string;
  title: L10n;
  /** 財務版的標題：講的是哪個作業會變怎樣。 */
  plain: L10n;
  /** YYYY-MM。 */
  start: string;
  end: string;
  dependsOn: string[];
  budget: number;
  internalPm: number;
  vendorPm: number;
  risk: Risk;
  riskNote: L10n;
  systemIds: SystemId[];
  /** 財務版的說明：對業務單位的影響。 */
  value: L10n;
  /** 工程版的說明：做法與相依。 */
  tech: L10n;
  status: 'committed' | 'planned' | 'proposed';
  /** 這個項目從哪裡來（事件、需求或決策的編號）。 */
  sourceId?: string;
}

export interface Branch {
  id: string;
  name: L10n;
  region: L10n;
  regionId: Exclude<RegionId, 'overseas'>;
  /** 所在城市的經緯度（概略值，只用來在 3D 的全台模型上擺位置）。 */
  lon: number;
  lat: number;
  staff: number;
  /** 這個據點在簽呈系統裡等待核准的件數。 */
  pendingApprovals: number;
}

export interface DataCentre {
  id: DcId;
  name: L10n;
  /** 這個機房扮演的環境：正式、備援、廠商代管。 */
  role: L10n;
  city: L10n;
  lon: number;
  lat: number;
  note: L10n;
}

/** 海外據點。用的是總行的系統，但上班時間照當地的時鐘。 */
export interface OverseasSite {
  id: string;
  name: L10n;
  city: L10n;
  /** IANA 時區名稱。跟台北差幾小時由瀏覽器的時區資料庫算，不寫死（日光節約會變）。 */
  tz: string;
  lon: number;
  lat: number;
  staff: number;
  pendingApprovals: number;
  since: number;
}

// ── 稽核

export interface AuditEntry {
  id: string;
  at: string;
  actor: L10n;
  role: RoleId | 'system';
  action: L10n;
  target: string;
  detail: L10n;
}

// ── 劇本與整體狀態

export type ScenarioId = 'A' | 'B' | 'C';
export interface ScenarioState {
  id: ScenarioId;
  /** 已經走完幾步。0 代表剛啟動、還沒發生任何事。 */
  step: number;
}

export interface AppState {
  version: number;
  seed: number;
  /** Demo 的「現在」。平常固定不動；劇本每走一步會往後推。所有倒數與 SLA 計時都看這個時刻。 */
  clock: string;
  systems: System[];
  vendors: Vendor[];
  people: Person[];
  tasks: Task[];
  reviews: Review[];
  ifaces: Iface[];
  runs: Run[];
  dlq: DlqItem[];
  apis: ApiEntry[];
  reconRules: ReconRule[];
  reconDiffs: ReconDiff[];
  tickets: Ticket[];
  deliverables: Deliverable[];
  milestones: Milestone[];
  raci: RaciRow[];
  changeRequests: ChangeRequest[];
  demands: Demand[];
  decisions: Decision[];
  incidents: Incident[];
  changes: Change[];
  adrs: Adr[];
  docs: Doc[];
  roadmap: RoadmapItem[];
  branches: Branch[];
  dataCentres: DataCentre[];
  overseas: OverseasSite[];
  audit: AuditEntry[];
  rbac: Record<RoleId, string[]>;
  scenario: ScenarioState | null;
  /** 在 3D 或架構圖上手動注入故障的系統。 */
  faults: SystemId[];
  counters: Record<string, number>;
}

export interface Prefs {
  role: RoleId;
  lang: Lang;
  lowFx: boolean;
  /** 用「委外廠商 PM」登入時，代表哪一家廠商。 */
  vendorId: VendorId;
}
