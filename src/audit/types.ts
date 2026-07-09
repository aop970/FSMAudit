export type CheckStatus = 'pass' | 'fail' | 'warning' | 'na';

export interface CheckResult {
  checkId: number;
  checkName: string;
  status: CheckStatus;
  stats: string;
  flaggedCount: number;
  flaggedRows: Record<string, unknown>[];
  details?: Record<string, unknown>;
}

export interface LaborRow {
  sheet: string;
  rowNum: number;
  employeeName: string;
  associateId: string;
  associateType: string;
  timeHours: number;
  basePayRate: number;
  muValue: number;
  muFormula?: string;
  billValue: number;
  billFormula?: string;
  loadedRate: number;
  associateState: string;
  comments: string;
  visitDate: Date | null;
  week: number | null;
  clientStoreId: string;
}

export interface PunchRow {
  rowNum: number;
  employeeName: string;
  associateId: string;
  timeIn: number;
  timeOut: number;
  timeHours: number;
  comments: string;
  visitDate: Date | null;
  week: number | null;
}

export interface MgmtRow {
  rowNum: number;
  week: number;
  name: string;
  associateId: string;
  title: string;
  hours: number;
  hourlyRate: number;
  total: number;
  allocation: number;
  totalBill: number;
}

export interface CloudRow {
  rowNum: number;
  associateName: string;
  associateId: string;
  licenseType: string;
  quantity: number | null;
  rate: number;
  allocation: number;
  amount: number;
}

export interface RosterEntry {
  name: string;
  associateId: string;
  type: string;      // Col D "Type" — employment type (FT | PT)
  program: string;   // Col E "Type 3" — program/tab assignment (FSM I | FSM I-Merit | FSM II | FSM II-Merit)
  status: string;    // Col B "Status" — roster status (Active | Inactive)
}

export interface ShiftRow {
  rowNum: number;
  associateId: string;
  employeeName: string;
  actualMinutes: number;
}

export interface SesPunchRow {
  rowNum: number;
  employeeName: string;
  associateId: string;
  timeHours: number;
  payrollTag?: string;
  timeType?: string;
}

export interface OtApprovalRow {
  rowNum: number;
  /** Column B — the employee name match key */
  associateName: string;
  /** Column C — "Approved" | "Pending" | "Denied" | "" */
  status: string;
  /** Column J — "Overtime" | "CA Daily" | etc. */
  approvalType: string;
  /** Legacy field — kept for backward compat; no longer populated */
  seaDlStatus: string;
}

export interface TimeOffRow {
  rowNum: number;
  associateId: string;
  workerName: string;
  timeOffDate: Date;
  totalHours: number;
  timeOffType: string;
  status: string;
}

export interface CiActivityRow {
  rowNum: number;
  employeeName: string;
  associateId: string;
  jobTitle: string;
  visitDate: Date | null;
  timeIn: string;
  timeOut: string;
  timeHours: number;
  isOt: boolean;
}

export interface CiRosterRow {
  rowNum: number;
  associateId: string;
  employeeName: string;
  notes: string;          // e.g. "CI-B" — invoice letter assignment
  type: string;           // MGR / FT
  managerName: string;
  storeState: string;
  hourlyPayRate: number;
  startDate: Date | null;
  type3: string;          // e.g. "Invoice K"
}

export interface CiControlEntry {
  name: string;
  associateId: string;
  role: string;
  invoiceLetter: string;
  billFormat: 'Monthly' | 'Hourly';
  baseRate: number;
  state: string;
  status: 'active' | 'inactive';
}

export interface CiCoverMeta {
  invoiceNumber: string | null;
  tabName: string | null;
  activityDateStart: Date | null;
  activityDateEnd: Date | null;
  poNumber: string | null;
  invoiceDate: Date | null;
  dueDate: Date | null;
  totalDue: number | null;
  attn: string | null;
  billTo: string | null;
  remitTo: string | null;
}

export interface CiDetailRow {
  sheet: string;
  rowNum: number;
  employeeName: string;
  associateId: string;
  visitDate: Date | null;
  week: number | null;
  timeHours: number;
  otHours: number;
  basePayRate: number;
  preMarkUpTotal: number;
  muValue: number;
  muFormula?: string;
  salaryTotal: number;
  billValue: number;
  billFormula?: string;
  layoutType: 'Monthly' | 'Hourly';
  comments: string;
}

export interface CiParsedData {
  fileName: string;
  coverMeta: CiCoverMeta;
  detailRows: CiDetailRow[];
  cloudTotal: number;
  newHireFeeTotal: number;
  tieOutInvoiceTotal: number | null;
  weeksCovered: number[];
  tabNames: string[];
  crossTabNotes: string[];
  activityRows: CiActivityRow[];     // from BUP Activity files
  ciRosterRows: CiRosterRow[];       // from BUP Roster
  timeOffRows: TimeOffRow[];         // from BUP Time Off
}

export interface TermedPtoRow {
  rowNum: number;
  employeeId: string;
  worker: string;
  termDate: Date | null;
  program: string;
  name: string;
  hours: number;
}

export interface TieOutData {
  fsmITotal: number;
  fsmIITotal: number;
  fsmIMeritTotal: number;
  fsmIIMeritTotal: number;
  mgmtTotal: number;
  cloudTotal: number;
  invoiceTotal: number | null;
  extraLineItems: { label: string; amount: number }[];
}

export interface ControlTableEntry {
  name: string;
  associateId: string;
  title: string;
  hourlyRate: number;
  allocationPct: number;
}

export interface ParsedData {
  fileName: string;
  invoiceNumber: string | null;
  e17Value: string | null;
  punchFileName: string | null;
  fsmIRows: LaborRow[];
  fsmIIRows: LaborRow[];
  fsmIMeritRows: LaborRow[];
  fsmIIMeritRows: LaborRow[];
  punchRows: PunchRow[];
  mgmtRows: MgmtRow[];
  cloudRows: CloudRow[];
  rosterEntries: RosterEntry[];
  otApprovalRows: OtApprovalRow[];
  tieOutData: TieOutData | null;
  declaredPeriod: { start: Date; end: Date } | null;
  weeksCovered: number[];
  crossTabNotes: string[];
  tabNames: string[];
  timeOffRows: TimeOffRow[];
  timeOffFileNames: string[];
  termedPtoRows: TermedPtoRow[];
  shiftRows: ShiftRow[];
  sesPunchRows: SesPunchRow[];
}

export type AppState = 'idle' | 'parsing' | 'auditing' | 'done' | 'error';

export interface AuditPayload {
  invoiceFile: string;
  punchFile: string | null;
  generatedAt: string;
  weeksCovered: number[];
  declaredPeriod: { start: string; end: string } | null;
  summary: {
    totalLaborRows: number;
    totalFieldAssociates: number;
    fieldLaborTotal: number;
    managementTotal: number;
    cloudTotal: number;
    reconstructedTotal: number;
    invoiceTotal: number | null;
    variance: number | null;
  };
  results: CheckResult[];
  crossTabNotes: string[];
}
