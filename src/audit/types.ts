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
  comments: string;
  visitDate: Date | null;
  week: number | null;
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
  quantity: number | null;
  rate: number;
  allocation: number;
  amount: number;
}

export interface RosterEntry {
  name: string;
  associateId: string;
}

export interface OtApprovalRow {
  rowNum: number;
  associateName: string;
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
