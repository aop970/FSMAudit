import { useState, useEffect, useRef } from 'react';
import { Play, Loader2, RotateCcw, Eye, EyeOff, Sparkles, Mail, X as XIcon } from 'lucide-react';
import Papa from 'papaparse';
import { Header } from './components/Header';
import { MultiDropZone } from './components/MultiDropZone';
import { ControlTableBadge } from './components/ControlTableBadge';
import { ControlTablePanel } from './components/ControlTablePanel';
import { CheckCard } from './components/CheckCard';
import { SummaryStrip } from './components/SummaryStrip';
import { AnalyzeAllButton } from './components/AnalyzeAllButton';
import { DownloadReport } from './components/DownloadReport';
import { AuditRulesPanel } from './components/AuditRulesPanel';
import {
  loadControlTable,
  saveControlTable,
  getControlTableTimestamp,
} from './audit/controlTable';
import { loadSesControlTable, saveSesControlTable } from './audit/sesControlTable';
import { parseInvoice, parseReferenceCSV, parseTimeOffFile, parseTermedPtoFile, parseSesInvoice } from './audit/parseWorkbook';
import { runAudit } from './audit/runAudit';
import { runSesAudit } from './audit/runSesAudit';
import { getAuditRules } from './audit/auditRules';
import type { AuditPayload, AppState, CheckStatus, ControlTableEntry, TermedPtoRow, TimeOffRow } from './audit/types';
import { analyzeAllFailures } from './ai/bragiClient';
import type { EmailEntry } from './ai/bragiClient';
import type { AnalyzeAllState } from './components/AnalyzeAllButton';

/** Parse an Outlook-style email CSV export into EmailEntry array */
function parseEmailCSV(file: File): Promise<EmailEntry[]> {
  return new Promise((resolve, reject) => {
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        try {
          const rows = results.data as Record<string, string>[];
          const entries: EmailEntry[] = rows.map((row) => {
            // Find subject/body columns case-insensitively
            const keys = Object.keys(row);
            const find = (target: string) =>
              keys.find((k) => k.toLowerCase() === target.toLowerCase()) ?? '';
            const subjectKey = find('subject');
            const bodyKey    = find('body');
            const dateKey    = find('date') || find('received') || find('sent');
            return {
              subject: row[subjectKey] ?? '',
              body:    row[bodyKey]    ?? '',
              date:    dateKey ? (row[dateKey] ?? '') : undefined,
            };
          }).filter((e) => e.subject || e.body);
          resolve(entries);
        } catch (err) {
          reject(err);
        }
      },
      error: reject,
    });
  });
}

function deriveOverallStatus(results: AuditPayload['results']): 'pass' | 'fail' | 'warning' | 'pending' {
  const statuses = results.map((r) => r.status);
  if (statuses.includes('fail')) return 'fail';
  if (statuses.includes('warning')) return 'warning';
  if (statuses.every((s: CheckStatus) => s === 'pass' || s === 'na')) return 'pass';
  return 'pending';
}

export default function App() {
  // Program selector
  const [program, setProgram] = useState<'fsm' | 'ses'>('fsm');

  // File state
  const [invoiceFile, setInvoiceFile]       = useState<File | null>(null);
  const [punchFile, setPunchFile]           = useState<File | null>(null);
  const [refFile, setRefFile]               = useState<File | null>(null);
  const [timeOffFile1, setTimeOffFile1]     = useState<File | null>(null);
  const [timeOffFile2, setTimeOffFile2]     = useState<File | null>(null);
  const [termedPtoFile, setTermedPtoFile]   = useState<File | null>(null);
  const [shiftFile1, setShiftFile1]         = useState<File | null>(null);
  const [shiftFile2, setShiftFile2]         = useState<File | null>(null);
  const [emailFile, setEmailFile]           = useState<File | null>(null);
  const [emailEntries, setEmailEntries]     = useState<EmailEntry[]>([]);
  const [emailParseError, setEmailParseError] = useState<string | null>(null);
  const emailInputRef = useRef<HTMLInputElement>(null);

  // App state
  const [appState, setAppState]       = useState<AppState>('idle');
  const [statusMsg, setStatusMsg]     = useState('');
  const [errorMsg, setErrorMsg]       = useState<string | null>(null);
  const [payload, setPayload]         = useState<AuditPayload | null>(null);

  // Control tables
  const [controlTable, setControlTable] = useState<ControlTableEntry[]>(() => loadControlTable());
  const [sesControlTable, setSesControlTable] = useState<ControlTableEntry[]>(() => loadSesControlTable());
  const [, setCtTimestamp]   = useState<string | null>(() => getControlTableTimestamp());

  // API key (never persisted)
  const [apiKey, setApiKey]           = useState('');
  const [showKey, setShowKey]         = useState(false);

  // Analyze All state (lifted so sidebar button can trigger it)
  const [aaState, setAaState]         = useState<AnalyzeAllState>('idle');
  const [aaOutput, setAaOutput]       = useState('');
  const [aaError, setAaError]         = useState('');

  async function runAnalyzeAll() {
    if (!payload || !apiKey.trim()) return;
    setAaState('loading');
    setAaError('');
    try {
      const { text } = await analyzeAllFailures(
        apiKey,
        payload.results,
        emailEntries.length > 0 ? emailEntries : undefined,
      );
      setAaOutput(text);
      setAaState('done');
    } catch (err) {
      setAaError(err instanceof Error ? err.message : String(err));
      setAaState('error');
    }
  }

  function clearAnalyzeAll() {
    setAaState('idle');
    setAaOutput('');
    setAaError('');
  }

  // Audit rules panel
  const [rulesOpen, setRulesOpen]     = useState(false);

  // Control table panel
  const [ctOpen, setCtOpen]           = useState(false);

  // Ref for reference file zone (for the ControlTableBadge scroll-to)
  const refZoneRef = useRef<HTMLDivElement>(null);

  // On mount, seed audit rules (no-op if already present) and control tables
  useEffect(() => {
    getAuditRules('fsm'); // seeds defaults into localStorage if not present
    getAuditRules('ses');
    const ct = loadControlTable();
    setControlTable(ct);
    setCtTimestamp(getControlTableTimestamp());
    const sesCt = loadSesControlTable();
    setSesControlTable(sesCt);
  }, []);

  // When a reference CSV is uploaded, parse and save control table override
  useEffect(() => {
    if (!refFile) return;
    (async () => {
      try {
        const rows = await parseReferenceCSV(refFile);
        if (rows.length === 0) return;
        // Map to ControlTableEntry shape
        const entries: ControlTableEntry[] = rows.map((r) => ({
          name: r['Name'] ?? r['name'] ?? '',
          associateId: r['Associate ID'] ?? r['associate id'] ?? r['AssociateID'] ?? '',
          title: r['Title'] ?? r['title'] ?? '',
          hourlyRate: parseFloat(r['Hourly Rate'] ?? r['hourly rate'] ?? '0') || 0,
          allocationPct: (() => {
            const v = r['Allocation %'] ?? r['allocation %'] ?? r['Allocation'] ?? r['allocation'] ?? '0';
            const n = parseFloat(v.replace('%', ''));
            return isNaN(n) ? 0 : n > 1 ? n / 100 : n;
          })(),
        })).filter((e) => e.name && e.associateId);

        if (entries.length > 0) {
          if (program === 'ses') {
            saveSesControlTable(entries);
            setSesControlTable(entries);
          } else {
            saveControlTable(entries);
            setControlTable(entries);
          }
          setCtTimestamp(getControlTableTimestamp());
        }
      } catch (e) {
        console.error('Failed to parse reference CSV:', e);
      }
    })();
  }, [refFile]);

  async function runAuditHandler() {
    if (!invoiceFile) {
      setErrorMsg('Please upload an invoice file (.xlsx or .xlsb).');
      return;
    }

    setErrorMsg(null);
    setPayload(null);
    setAppState('parsing');
    setStatusMsg('Reading invoice workbook…');

    try {
      if (program === 'ses') {
        const parsed = await parseSesInvoice(invoiceFile, punchFile, shiftFile1, shiftFile2);

        // Parse time off files and inject
        const timeOffFilesUploaded = [timeOffFile1, timeOffFile2].filter(Boolean) as File[];
        if (timeOffFilesUploaded.length > 0) {
          setStatusMsg('Parsing time off reports…');
          await new Promise((r) => setTimeout(r, 0));
          const allTimeOff: TimeOffRow[] = [];
          for (const f of timeOffFilesUploaded) {
            const rows = await parseTimeOffFile(f);
            allTimeOff.push(...rows);
          }
          parsed.timeOffRows = allTimeOff;
          parsed.timeOffFileNames = timeOffFilesUploaded.map((f) => f.name);
        }

        if (termedPtoFile) {
          setStatusMsg('Parsing Termed PTO file…');
          await new Promise((r) => setTimeout(r, 0));
          const termedRows: TermedPtoRow[] = await parseTermedPtoFile(termedPtoFile);
          parsed.termedPtoRows = termedRows;
        }

        setStatusMsg('Running 18 SES audit checks…');
        setAppState('auditing');
        await new Promise((r) => setTimeout(r, 0));

        const result = runSesAudit(parsed, sesControlTable);
        setPayload(result);
        setAppState('done');
        setStatusMsg('');
      } else {
        const parsed = await parseInvoice(invoiceFile, punchFile);

        // Parse time off files and inject into parsed data
        const timeOffFilesUploaded = [timeOffFile1, timeOffFile2].filter(Boolean) as File[];
        if (timeOffFilesUploaded.length > 0) {
          setStatusMsg('Parsing time off reports…');
          await new Promise((r) => setTimeout(r, 0));
          const allTimeOff: TimeOffRow[] = [];
          for (const f of timeOffFilesUploaded) {
            const rows = await parseTimeOffFile(f);
            allTimeOff.push(...rows);
          }
          parsed.timeOffRows = allTimeOff;
          parsed.timeOffFileNames = timeOffFilesUploaded.map((f) => f.name);
        }

        // Parse Termed PTO file and inject
        if (termedPtoFile) {
          setStatusMsg('Parsing Termed PTO file…');
          await new Promise((r) => setTimeout(r, 0));
          const termedRows: TermedPtoRow[] = await parseTermedPtoFile(termedPtoFile);
          parsed.termedPtoRows = termedRows;
        }

        setStatusMsg('Running 15 audit checks…');
        setAppState('auditing');

        // Yield to event loop so UI updates
        await new Promise((r) => setTimeout(r, 0));

        const result = runAudit(parsed, controlTable);
        setPayload(result);
        setAppState('done');
        setStatusMsg('');
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('Audit error:', err);
      setErrorMsg(`Audit failed: ${msg}`);
      setAppState('error');
      setStatusMsg('');
    }
  }

  function reset() {
    setInvoiceFile(null);
    setPunchFile(null);
    setRefFile(null);
    setTimeOffFile1(null);
    setTimeOffFile2(null);
    setTermedPtoFile(null);
    setShiftFile1(null);
    setShiftFile2(null);
    setEmailFile(null);
    setEmailEntries([]);
    setEmailParseError(null);
    setPayload(null);
    setAppState('idle');
    setErrorMsg(null);
    setStatusMsg('');
    clearAnalyzeAll();
  }

  const busy = appState === 'parsing' || appState === 'auditing';
  const overallStatus = payload ? deriveOverallStatus(payload.results) : null;

  return (
    <div className="min-h-screen bg-mc-bg">
      <Header
        program={program}
        fileName={payload?.invoiceFile}
        overallStatus={overallStatus ?? (appState === 'parsing' || appState === 'auditing' ? 'pending' : null)}
        rulesOpen={rulesOpen}
        onToggleRules={() => setRulesOpen((v) => !v)}
      />

      {/* Three-panel layout */}
      <div className="mx-auto flex max-w-screen-2xl gap-0 px-0" style={{ minHeight: 'calc(100vh - 53px)' }}>

        {/* ── LEFT PANEL: uploads + controls ── */}
        <aside
          className="w-72 shrink-0 flex flex-col gap-5 px-5 py-6 overflow-y-auto"
          style={{ borderRight: '1px solid var(--mc-card-border)', backgroundColor: 'var(--mc-bg2)' }}
        >
          <div>
            {/* Program Selector */}
            <div
              className="flex rounded-lg overflow-hidden mb-4"
              style={{ border: '1px solid var(--mc-card-border)' }}
            >
              {(['fsm', 'ses'] as const).map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => { if (program !== p) { setProgram(p); reset(); } }}
                  className="flex-1 py-1.5 text-xs font-bold uppercase tracking-wide transition"
                  style={{
                    backgroundColor: program === p ? 'var(--mc-blue)' : 'transparent',
                    color: program === p ? '#fff' : 'var(--mc-text-dim)',
                  }}
                >
                  {p === 'fsm' ? 'FSM' : 'SES'}
                </button>
              ))}
            </div>

            <h2 className="mb-3 text-xs font-bold uppercase tracking-widest text-mc-dim">Upload Files</h2>
            <div ref={refZoneRef}>
              <MultiDropZone
                program={program}
                invoiceFile={invoiceFile}
                punchFile={punchFile}
                timeOffFile1={timeOffFile1}
                timeOffFile2={timeOffFile2}
                termedPtoFile={termedPtoFile}
                refFile={refFile}
                shiftFile1={shiftFile1}
                shiftFile2={shiftFile2}
                onInvoice={setInvoiceFile}
                onPunch={setPunchFile}
                onTimeOff1={setTimeOffFile1}
                onTimeOff2={setTimeOffFile2}
                onTermedPto={setTermedPtoFile}
                onRef={setRefFile}
                onShift1={setShiftFile1}
                onShift2={setShiftFile2}
              />
            </div>

            {/* ── Email Context CSV (optional) ── */}
            <div className="mt-3">
              <div className="flex items-center gap-1.5 mb-1.5">
                <Mail className="h-3 w-3 text-mc-dim" />
                <span className="text-xs font-semibold text-mc-text">Email Context</span>
                <span className="ml-1 text-[10px] text-mc-dim font-normal">(optional)</span>
              </div>
              <p className="text-[10px] text-mc-dim mb-2 leading-relaxed">
                Export emails from your audit folder as CSV. Bragi will flag any one-off reminders.
              </p>
              {!emailFile ? (
                <button
                  type="button"
                  onClick={() => emailInputRef.current?.click()}
                  className="flex w-full items-center justify-center gap-1.5 rounded-md px-3 py-2 text-[10px] font-medium transition"
                  style={{
                    border: '1px dashed color-mix(in srgb, var(--mc-blue) 35%, transparent)',
                    backgroundColor: 'color-mix(in srgb, var(--mc-bg2) 60%, transparent)',
                    color: 'var(--mc-text-dim)',
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.borderColor = 'rgba(59,158,255,0.6)')}
                  onMouseLeave={(e) => (e.currentTarget.style.borderColor = 'rgba(59,158,255,0.35)')}
                >
                  <Mail className="h-3.5 w-3.5" />
                  Upload Email Export (.csv)
                </button>
              ) : (
                <div
                  className="flex items-center gap-2 rounded-md px-2.5 py-1.5"
                  style={{ backgroundColor: 'color-mix(in srgb, var(--mc-bg) 50%, transparent)', border: '1px solid var(--mc-card-border)' }}
                >
                  <Mail className="h-3.5 w-3.5 shrink-0 text-mc-blue" />
                  <div className="flex-1 min-w-0">
                    <p className="text-[10px] truncate text-mc-text leading-tight">{emailFile.name}</p>
                    <p className="text-[9px] text-mc-dim">
                      {emailParseError
                        ? <span className="text-rose-400">{emailParseError}</span>
                        : `${emailEntries.length} email${emailEntries.length !== 1 ? 's' : ''} loaded`}
                    </p>
                  </div>
                  <button
                    type="button"
                    className="shrink-0 text-mc-dim hover:text-rose-400 transition"
                    onClick={() => { setEmailFile(null); setEmailEntries([]); setEmailParseError(null); }}
                  >
                    <XIcon className="h-3 w-3" />
                  </button>
                </div>
              )}
              <input
                ref={emailInputRef}
                type="file"
                accept=".csv"
                className="sr-only"
                onChange={async (e) => {
                  const f = e.target.files?.[0] ?? null;
                  e.target.value = '';
                  if (!f) return;
                  setEmailFile(f);
                  setEmailParseError(null);
                  try {
                    const entries = await parseEmailCSV(f);
                    setEmailEntries(entries);
                  } catch {
                    setEmailParseError('Could not parse CSV. Check format.');
                    setEmailEntries([]);
                  }
                }}
              />
            </div>
          </div>

          {/* Control table status */}
          <ControlTableBadge
            rowCount={controlTable.length}
            onUploadRef={() => refZoneRef.current?.scrollIntoView({ behavior: 'smooth' })}
            onEdit={() => setCtOpen(true)}
          />

          {/* API key */}
          <div>
            <h2 className="mb-2 text-xs font-bold uppercase tracking-widest text-mc-dim">
              Bragi API Key
              <span className="ml-1 font-normal normal-case text-mc-dim/60">(optional)</span>
            </h2>
            <div className="relative">
              <input
                type={showKey ? 'text' : 'password'}
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="sk-ant-…"
                autoComplete="off"
                spellCheck={false}
                className="w-full rounded-lg px-3 py-2 pr-8 text-xs text-mc-text placeholder-mc-dim focus:outline-none focus:ring-1"
                style={{
                  backgroundColor: 'color-mix(in srgb, var(--mc-bg) 80%, transparent)',
                  border: '1px solid var(--mc-card-border)',
                }}
                onFocus={(e) => (e.currentTarget.style.borderColor = 'rgba(59,158,255,0.5)')}
                onBlur={(e) => (e.currentTarget.style.borderColor = 'var(--mc-card-border)')}
              />
              <button
                type="button"
                onClick={() => setShowKey((v) => !v)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-mc-dim hover:text-mc-text"
              >
                {showKey ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
              </button>
            </div>
            <p className="mt-1 text-[10px] text-mc-dim">Never stored. Enables "Analyze with Bragi" on failing checks.</p>
          </div>

          {/* Analyze All — sidebar trigger (visible when key set + failures exist) */}
          {apiKey.trim() && payload && payload.results.filter((r) => r.status === 'fail' || r.status === 'warning').length >= 2 && (
            <div className="rounded-lg px-3 py-2.5" style={{ border: '1px solid color-mix(in srgb, var(--mc-blue) 25%, transparent)', backgroundColor: 'color-mix(in srgb, var(--mc-blue) 6%, transparent)' }}>
              <p className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-mc-blue">Bragi Analysis</p>
              {aaState === 'idle' && (
                <button
                  type="button"
                  onClick={runAnalyzeAll}
                  className="flex w-full items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold text-white transition"
                  style={{ backgroundColor: '#3b9eff' }}
                  onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#2a8aee')}
                  onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = '#3b9eff')}
                >
                  <Sparkles className="h-3.5 w-3.5" />
                  Analyze All Failures
                </button>
              )}
              {aaState === 'loading' && (
                <div className="flex items-center justify-center gap-1.5 py-1 text-xs text-mc-blue">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Asking Bragi…
                </div>
              )}
              {aaState === 'done' && (
                <div className="flex items-center justify-between">
                  <span className="text-xs text-mc-green">Analysis ready ↓</span>
                  <button type="button" onClick={clearAnalyzeAll} className="text-[10px] text-mc-dim hover:text-mc-blue">Clear</button>
                </div>
              )}
              {aaState === 'error' && (
                <div className="space-y-1">
                  <p className="text-[10px] text-rose-400">{aaError}</p>
                  <button type="button" onClick={runAnalyzeAll} className="text-[10px] text-mc-dim underline hover:text-mc-blue">Retry</button>
                </div>
              )}
            </div>
          )}

          {/* Run button */}
          <div className="mt-auto space-y-2">
            {(invoiceFile || punchFile || timeOffFile1 || timeOffFile2 || termedPtoFile || shiftFile1 || shiftFile2 || emailFile || payload) && (
              <button
                type="button"
                onClick={reset}
                className="flex w-full items-center justify-center gap-1.5 rounded-lg px-4 py-2 text-xs font-medium text-mc-dim transition hover:text-mc-text hover:bg-mc-blue/5"
                style={{ border: '1px solid var(--mc-card-border)' }}
              >
                <RotateCcw className="h-3.5 w-3.5" />
                Reset
              </button>
            )}
            <button
              type="button"
              onClick={runAuditHandler}
              disabled={busy || !invoiceFile}
              className="flex w-full items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-bold text-white shadow-sm transition disabled:cursor-not-allowed disabled:opacity-40"
              style={{ backgroundColor: busy || !invoiceFile ? undefined : '#3b9eff' }}
              onMouseEnter={(e) => { if (!busy && invoiceFile) e.currentTarget.style.backgroundColor = '#2a8aee'; }}
              onMouseLeave={(e) => { if (!busy && invoiceFile) e.currentTarget.style.backgroundColor = '#3b9eff'; }}
            >
              {busy ? (
                <><Loader2 className="h-4 w-4 animate-spin" />{statusMsg || 'Working…'}</>
              ) : (
                <><Play className="h-4 w-4" />Run Audit</>
              )}
            </button>

            {!invoiceFile && !busy && (
              <p className="text-center text-[10px] text-mc-dim">Upload an invoice file to run</p>
            )}
          </div>

          {errorMsg && (
            <div className="rounded-md border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-400">
              {errorMsg}
            </div>
          )}
        </aside>

        {/* ── CENTER PANEL: results ── */}
        <main className="flex-1 overflow-y-auto px-6 py-6 space-y-6 bg-mc-bg">
          {!payload && !busy && (
            <div className="mt-16 rounded-xl border-2 border-dashed px-8 py-16 text-center" style={{ borderColor: 'color-mix(in srgb, var(--mc-blue) 20%, transparent)', backgroundColor: 'color-mix(in srgb, var(--mc-bg2) 40%, transparent)' }}>
              <p className="text-sm font-semibold text-mc-text">No audit run yet</p>
              <p className="mt-1 text-xs text-mc-dim">
                Upload an invoice workbook (.xlsx/.xlsb) in the left panel and click Run Audit.
              </p>
              <p className="mt-2 text-xs text-mc-dim">
                Punch Detail CSV is optional but required for checks 3 and 4.
              </p>
            </div>
          )}

          {busy && (
            <div className="mt-16 flex flex-col items-center gap-3 text-mc-dim">
              <Loader2 className="h-8 w-8 animate-spin text-mc-blue" />
              <p className="text-sm font-medium text-mc-text">{statusMsg}</p>
            </div>
          )}

          {payload && !busy && (
            <>
              {/* Summary */}
              <section>
                <h2 className="mb-2 text-xs font-bold uppercase tracking-widest text-mc-dim">Summary</h2>
                <SummaryStrip payload={payload} />
              </section>

              {/* Analyze All Failures (shows if ≥2 failures) */}
              <AnalyzeAllButton
                results={payload.results}
                apiKey={apiKey}
                state={aaState}
                output={aaOutput}
                errMsg={aaError}
                onRun={runAnalyzeAll}
                onClear={clearAnalyzeAll}
              />

              {/* Check cards */}
              <section>
                <h2 className="mb-2 text-xs font-bold uppercase tracking-widest text-mc-dim">Audit Checks</h2>
                <div className="space-y-2">
                  {payload.results.map((r) => (
                    <CheckCard
                      key={r.checkId}
                      result={r}
                      defaultOpen={r.status === 'fail' || r.status === 'warning'}
                      apiKey={apiKey}
                    />
                  ))}
                </div>
              </section>

              {/* Cross-tab notes */}
              {payload.crossTabNotes.length > 0 && (
                <section className="rounded-xl p-5 shadow-sm" style={{ border: '1px solid var(--mc-card-border)', backgroundColor: 'var(--mc-card-bg)' }}>
                  <h3 className="mb-2 text-xs font-bold uppercase tracking-widest text-mc-dim">Notes</h3>
                  <ul className="list-disc space-y-1 pl-4 text-xs text-mc-text">
                    {payload.crossTabNotes.map((n, i) => <li key={i}>{n}</li>)}
                  </ul>
                </section>
              )}

              {/* Download */}
              <div className="flex justify-end pb-6">
                <DownloadReport payload={payload} />
              </div>
            </>
          )}
        </main>

        {/* ── RIGHT PANEL: status / key summary ── */}
        <aside
          className="w-60 shrink-0 flex flex-col gap-4 px-4 py-6 overflow-y-auto"
          style={{ borderLeft: '1px solid var(--mc-card-border)', backgroundColor: 'var(--mc-bg2)' }}
        >
          <div>
            <h2 className="mb-3 text-xs font-bold uppercase tracking-widest text-mc-dim">Check Status</h2>
            {payload ? (
              <div className="space-y-1.5">
                {payload.results.map((r) => {
                  const dotColor = r.status === 'pass' ? '#22d06b'
                    : r.status === 'fail' ? '#f87171'
                    : r.status === 'warning' ? '#ffba08'
                    : 'var(--mc-text-dim)';
                  return (
                    <div key={r.checkId} className="flex items-center gap-2">
                      <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: dotColor }} />
                      <span className="text-xs text-mc-dim truncate">{r.checkName}</span>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="text-xs text-mc-dim">Run an audit to see results here.</p>
            )}
          </div>

          {payload && (
            <div className="pt-4" style={{ borderTop: '1px solid var(--mc-card-border)' }}>
              <h2 className="mb-2 text-xs font-bold uppercase tracking-widest text-mc-dim">Quick Stats</h2>
              <div className="space-y-1 text-xs text-mc-dim">
                <div className="flex justify-between">
                  <span>Pass</span>
                  <span className="font-semibold text-mc-green">
                    {payload.results.filter((r) => r.status === 'pass').length}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span>Fail</span>
                  <span className="font-semibold text-rose-400">
                    {payload.results.filter((r) => r.status === 'fail').length}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span>Warning</span>
                  <span className="font-semibold text-mc-amber">
                    {payload.results.filter((r) => r.status === 'warning').length}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span>N/A</span>
                  <span className="font-semibold text-mc-dim">
                    {payload.results.filter((r) => r.status === 'na').length}
                  </span>
                </div>
              </div>
            </div>
          )}

          <div className="mt-auto pt-4" style={{ borderTop: '1px solid var(--mc-card-border)' }}>
            <p className="text-[10px] text-mc-dim leading-relaxed">
              Tier 1: 9 deterministic checks run instantly client-side.
              <br /><br />
              Tier 2: Bragi Analysis on demand via claude-haiku-3-5. Requires API key.
            </p>
          </div>
        </aside>
      </div>

      {/* ── Audit Rules Panel — fixed right-side drawer ── */}
      {rulesOpen && (
        <div
          className="fixed inset-y-0 right-0 z-50 shadow-2xl"
          style={{ top: 53 }}
        >
          <AuditRulesPanel program={program} onClose={() => setRulesOpen(false)} />
        </div>
      )}

      {/* ── Control Table Panel — fixed right-side drawer ── */}
      {ctOpen && (
        <div
          className="fixed inset-y-0 right-0 z-50 shadow-2xl"
          style={{ top: 53 }}
        >
          <ControlTablePanel
            table={controlTable}
            onChange={(t) => { setControlTable(t); setCtTimestamp(new Date().toISOString()); }}
            onClose={() => setCtOpen(false)}
          />
        </div>
      )}
    </div>
  );
}
