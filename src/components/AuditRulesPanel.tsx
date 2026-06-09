// AuditRulesPanel.tsx — Collapsible ⚙️ Audit Rules configuration panel.
// Opens from gear icon in the header. Eight editable sections, each with
// its own Save and Reset to Default. Changes are not auto-saved.
// Unsaved edits show a yellow dot on the section header.

import { useState, useCallback, createContext, useContext } from 'react';
import {
  type AuditRules,
  type CustomRule,
  type HolidayEntry,
  type RuleType,
  DEFAULT_RULES,
  DEFAULT_SES_RULES,
  getAuditRules,
  saveRulesSection,
  resetSection,
  resetAllRules,
  writeAuditRules,
} from '../audit/auditRules';

// ── Program context (avoids prop-drilling to every section) ───────────────────

const ProgramCtx = createContext<'fsm' | 'ses'>('fsm');
function useProgram() { return useContext(ProgramCtx); }

// ── helpers ────────────────────────────────────────────────────────────────────

function tagsToString(arr: string[]): string {
  return arr.join(', ');
}

function stringToTags(s: string): string[] {
  return s
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean);
}

// ── section status dot ─────────────────────────────────────────────────────────

function DirtyDot() {
  return (
    <span
      className="inline-block h-2 w-2 rounded-full bg-mc-amber"
      title="Unsaved changes"
    />
  );
}

// ── save feedback ──────────────────────────────────────────────────────────────

type SaveState = 'idle' | 'saved' | 'error';

function SaveFeedback({ state }: { state: SaveState }) {
  if (state === 'idle') return null;
  if (state === 'saved')
    return <span className="text-xs text-mc-green font-medium">Saved ✓</span>;
  return <span className="text-xs text-rose-400 font-medium">Save failed ✗</span>;
}

// ── shared input styles ────────────────────────────────────────────────────────

const inputCls =
  'w-full rounded-md px-2.5 py-1.5 text-xs text-mc-text placeholder-mc-dim focus:outline-none focus:ring-1 focus:ring-mc-blue/50';
const inputStyle = {
  backgroundColor: 'color-mix(in srgb, var(--mc-bg) 85%, transparent)',
  border: '1px solid var(--mc-card-border)',
};

const btnSave =
  'px-3 py-1 rounded text-xs font-semibold text-white bg-mc-blue hover:bg-[#2a8aee] transition';
const btnReset =
  'px-3 py-1 rounded text-xs font-medium text-mc-dim hover:text-mc-text border border-mc-card-border hover:border-mc-dim/50 transition';

// ── Section header ─────────────────────────────────────────────────────────────

function SectionHeader({
  title,
  dirty,
}: {
  title: string;
  dirty: boolean;
}) {
  return (
    <div className="flex items-center gap-2 mb-3">
      <h3 className="text-xs font-bold uppercase tracking-widest text-mc-dim">{title}</h3>
      {dirty && <DirtyDot />}
    </div>
  );
}

// ── Section footer ─────────────────────────────────────────────────────────────

function SectionFooter({
  onSave,
  onReset,
  saveState,
}: {
  onSave: () => void;
  onReset: () => void;
  saveState: SaveState;
}) {
  return (
    <div className="flex items-center gap-2 mt-3">
      <button type="button" className={btnSave} onClick={onSave}>
        Save
      </button>
      <button type="button" className={btnReset} onClick={onReset}>
        Reset to Default
      </button>
      <SaveFeedback state={saveState} />
    </div>
  );
}

// ── useSaveState — auto-clears feedback after 2s ───────────────────────────────

function useSaveState(): [SaveState, (ok: boolean) => void] {
  const [state, setState] = useState<SaveState>('idle');
  const trigger = useCallback((ok: boolean) => {
    setState(ok ? 'saved' : 'error');
    setTimeout(() => setState('idle'), 2000);
  }, []);
  return [state, trigger];
}

// ── Section 1: Markup Rates ────────────────────────────────────────────────────

function MarkupRatesSection({ initial }: { initial: AuditRules['markupRates'] }) {
  const prog = useProgram();
  const [ft, setFt] = useState(String(initial.ft));
  const [pt, setPt] = useState(String(initial.pt));
  const [saveState, triggerSave] = useSaveState();

  const isDirty =
    parseFloat(ft) !== initial.ft || parseFloat(pt) !== initial.pt;

  function handleSave() {
    const ok = saveRulesSection('markupRates', {
      ft: parseFloat(ft) || DEFAULT_RULES.markupRates.ft,
      pt: parseFloat(pt) || DEFAULT_RULES.markupRates.pt,
    }, prog);
    triggerSave(ok);
  }

  function handleReset() {
    setFt(String(DEFAULT_RULES.markupRates.ft));
    setPt(String(DEFAULT_RULES.markupRates.pt));
    const ok = resetSection('markupRates', prog);
    triggerSave(ok);
  }

  return (
    <div className="section-block">
      <SectionHeader title="Markup Rates" dirty={isDirty} />
      <div className="grid grid-cols-2 gap-3">
        <label className="block">
          <span className="text-[11px] text-mc-dim mb-1 block">FT Rate</span>
          <input
            type="number"
            step="0.0001"
            min="0"
            value={ft}
            onChange={(e) => setFt(e.target.value)}
            className={inputCls}
            style={inputStyle}
          />
        </label>
        <label className="block">
          <span className="text-[11px] text-mc-dim mb-1 block">PT Rate</span>
          <input
            type="number"
            step="0.0001"
            min="0"
            value={pt}
            onChange={(e) => setPt(e.target.value)}
            className={inputCls}
            style={inputStyle}
          />
        </label>
      </div>
      <SectionFooter onSave={handleSave} onReset={handleReset} saveState={saveState} />
    </div>
  );
}

// ── Section 2: Hourly Rates ────────────────────────────────────────────────────

function HourlyRatesSection({
  initial,
  program: programProp,
}: {
  initial: AuditRules['hourlyRates'];
  program: 'fsm' | 'ses';
}) {
  const prog = useProgram();
  const program = programProp ?? prog;
  const [fsmI, setFsmI] = useState(String(initial.fsmI));
  const [fsmII, setFsmII] = useState(String(initial.fsmII));
  const [fsmIMerit, setFsmIMerit] = useState(String(initial.fsmIMerit ?? 0));
  const [fsmIIMerit, setFsmIIMerit] = useState(String(initial.fsmIIMerit ?? 0));
  const [saveState, triggerSave] = useSaveState();

  const isDirty =
    parseFloat(fsmI) !== initial.fsmI ||
    parseFloat(fsmII) !== initial.fsmII ||
    parseFloat(fsmIMerit) !== (initial.fsmIMerit ?? 0) ||
    parseFloat(fsmIIMerit) !== (initial.fsmIIMerit ?? 0);

  function handleSave() {
    const ok = saveRulesSection('hourlyRates', {
      fsmI: parseFloat(fsmI) || 0,
      fsmII: program === 'ses' ? 0 : (parseFloat(fsmII) || 0),
      fsmIMerit: program === 'ses' ? 0 : (parseFloat(fsmIMerit) || 0),
      fsmIIMerit: program === 'ses' ? 0 : (parseFloat(fsmIIMerit) || 0),
    }, prog);
    triggerSave(ok);
  }

  function handleReset() {
    const defaults = program === 'ses' ? DEFAULT_SES_RULES : DEFAULT_RULES;
    setFsmI(String(defaults.hourlyRates.fsmI));
    setFsmII(String(defaults.hourlyRates.fsmII));
    setFsmIMerit(String(defaults.hourlyRates.fsmIMerit ?? 0));
    setFsmIIMerit(String(defaults.hourlyRates.fsmIIMerit ?? 0));
    const ok = resetSection('hourlyRates', prog);
    triggerSave(ok);
  }

  return (
    <div className="section-block">
      <SectionHeader title="Hourly Rates" dirty={isDirty} />
      <p className="text-[10px] text-mc-dim mb-2">
        {program === 'ses'
          ? 'Expected base pay rate for SES Detail rows. Set to 0 to skip rate validation.'
          : 'Expected base pay rates for FSM I, FSM II, and Merit rows. Set to 0 to skip rate validation.'}
        {' '}Check 01 will flag any row whose base rate does not match the configured value.
      </p>
      {program === 'ses' ? (
        <label className="block">
          <span className="text-[11px] text-mc-dim mb-1 block">SES $/hr</span>
          <input
            type="number"
            step="0.01"
            min="0"
            value={fsmI}
            onChange={(e) => setFsmI(e.target.value)}
            className={inputCls}
            style={{ ...inputStyle, maxWidth: 140 }}
            placeholder="0 = disabled"
          />
        </label>
      ) : (
        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="text-[11px] text-mc-dim mb-1 block">FSM I Rate ($/hr)</span>
            <input
              type="number"
              step="0.01"
              min="0"
              value={fsmI}
              onChange={(e) => setFsmI(e.target.value)}
              className={inputCls}
              style={inputStyle}
              placeholder="0 = disabled"
            />
          </label>
          <label className="block">
            <span className="text-[11px] text-mc-dim mb-1 block">FSM II Rate ($/hr)</span>
            <input
              type="number"
              step="0.01"
              min="0"
              value={fsmII}
              onChange={(e) => setFsmII(e.target.value)}
              className={inputCls}
              style={inputStyle}
              placeholder="0 = disabled"
            />
          </label>
          <label className="block">
            <span className="text-[11px] text-mc-dim mb-1 block">FSM I Merit Rate ($/hr)</span>
            <input
              type="number"
              step="0.01"
              min="0"
              value={fsmIMerit}
              onChange={(e) => setFsmIMerit(e.target.value)}
              className={inputCls}
              style={inputStyle}
              placeholder="0 = disabled"
            />
          </label>
          <label className="block">
            <span className="text-[11px] text-mc-dim mb-1 block">FSM II Merit Rate ($/hr)</span>
            <input
              type="number"
              step="0.01"
              min="0"
              value={fsmIIMerit}
              onChange={(e) => setFsmIIMerit(e.target.value)}
              className={inputCls}
              style={inputStyle}
              placeholder="0 = disabled"
            />
          </label>
        </div>
      )}
      <SectionFooter onSave={handleSave} onReset={handleReset} saveState={saveState} />
    </div>
  );
}

// ── Section 2b: OT Hourly Rates ───────────────────────────────────────────────

function OtHourlyRatesSection({ initial }: { initial: AuditRules['otHourlyRates'] }) {
  const prog = useProgram();
  const [fsmI, setFsmI] = useState(String(initial.fsmI));
  const [fsmII, setFsmII] = useState(String(initial.fsmII));
  const [fsmIMerit, setFsmIMerit] = useState(String(initial.fsmIMerit ?? 0));
  const [fsmIIMerit, setFsmIIMerit] = useState(String(initial.fsmIIMerit ?? 0));
  const [saveState, triggerSave] = useSaveState();

  const isDirty =
    parseFloat(fsmI) !== initial.fsmI ||
    parseFloat(fsmII) !== initial.fsmII ||
    parseFloat(fsmIMerit) !== (initial.fsmIMerit ?? 0) ||
    parseFloat(fsmIIMerit) !== (initial.fsmIIMerit ?? 0);

  function handleSave() {
    const ok = saveRulesSection('otHourlyRates', {
      fsmI: parseFloat(fsmI) || 0,
      fsmII: parseFloat(fsmII) || 0,
      fsmIMerit: parseFloat(fsmIMerit) || 0,
      fsmIIMerit: parseFloat(fsmIIMerit) || 0,
    }, prog);
    triggerSave(ok);
  }

  function handleReset() {
    setFsmI(String(DEFAULT_RULES.otHourlyRates.fsmI));
    setFsmII(String(DEFAULT_RULES.otHourlyRates.fsmII));
    setFsmIMerit(String(DEFAULT_RULES.otHourlyRates.fsmIMerit ?? 0));
    setFsmIIMerit(String(DEFAULT_RULES.otHourlyRates.fsmIIMerit ?? 0));
    const ok = resetSection('otHourlyRates', prog);
    triggerSave(ok);
  }

  return (
    <div className="section-block">
      <SectionHeader title="OT Hourly Rates" dirty={isDirty} />
      <p className="text-[10px] text-mc-dim mb-2">
        Expected billing rates for Overtime (non-CA), CA Daily OT, and CA Weekly OT rows. Set to 0 to skip OT billing validation.
        Check 01 uses these rates to verify OT bill and markup calculations.
      </p>
      <div className="grid grid-cols-2 gap-3">
        <label className="block">
          <span className="text-[11px] text-mc-dim mb-1 block">FSM I OT Rate ($/hr)</span>
          <input
            type="number"
            step="0.01"
            min="0"
            value={fsmI}
            onChange={(e) => setFsmI(e.target.value)}
            className={inputCls}
            style={inputStyle}
            placeholder="0 = disabled"
          />
        </label>
        <label className="block">
          <span className="text-[11px] text-mc-dim mb-1 block">FSM II OT Rate ($/hr)</span>
          <input
            type="number"
            step="0.01"
            min="0"
            value={fsmII}
            onChange={(e) => setFsmII(e.target.value)}
            className={inputCls}
            style={inputStyle}
            placeholder="0 = disabled"
          />
        </label>
        <label className="block">
          <span className="text-[11px] text-mc-dim mb-1 block">FSM I Merit OT Rate ($/hr)</span>
          <input
            type="number"
            step="0.01"
            min="0"
            value={fsmIMerit}
            onChange={(e) => setFsmIMerit(e.target.value)}
            className={inputCls}
            style={inputStyle}
            placeholder="0 = disabled"
          />
        </label>
        <label className="block">
          <span className="text-[11px] text-mc-dim mb-1 block">FSM II Merit OT Rate ($/hr)</span>
          <input
            type="number"
            step="0.01"
            min="0"
            value={fsmIIMerit}
            onChange={(e) => setFsmIIMerit(e.target.value)}
            className={inputCls}
            style={inputStyle}
            placeholder="0 = disabled"
          />
        </label>
      </div>
      <SectionFooter onSave={handleSave} onReset={handleReset} saveState={saveState} />
    </div>
  );
}

// ── Section 3: Punch Categories (was 2) ───────────────────────────────────────

function PunchCategoriesSection({ initial }: { initial: AuditRules['punchCategories'] }) {
  const prog = useProgram();
  const [supported, setSupported] = useState(tagsToString(initial.supported));
  const [exceptions, setExceptions] = useState(tagsToString(initial.exceptions));
  const [saveState, triggerSave] = useSaveState();

  const isDirty =
    supported !== tagsToString(initial.supported) ||
    exceptions !== tagsToString(initial.exceptions);

  function handleSave() {
    const ok = saveRulesSection('punchCategories', {
      supported: stringToTags(supported),
      exceptions: stringToTags(exceptions),
    }, prog);
    triggerSave(ok);
  }

  function handleReset() {
    setSupported(tagsToString(DEFAULT_RULES.punchCategories.supported));
    setExceptions(tagsToString(DEFAULT_RULES.punchCategories.exceptions));
    const ok = resetSection('punchCategories', prog);
    triggerSave(ok);
  }

  return (
    <div className="section-block">
      <SectionHeader title="Punch Categories" dirty={isDirty} />
      <label className="block mb-2">
        <span className="text-[11px] text-mc-dim mb-1 block">Punch-Supported (comma-separated)</span>
        <input
          type="text"
          value={supported}
          onChange={(e) => setSupported(e.target.value)}
          className={inputCls}
          style={inputStyle}
          placeholder="Work, Travel, Admin…"
        />
      </label>
      <label className="block">
        <span className="text-[11px] text-mc-dim mb-1 block">Exceptions / Excluded (comma-separated)</span>
        <input
          type="text"
          value={exceptions}
          onChange={(e) => setExceptions(e.target.value)}
          className={inputCls}
          style={inputStyle}
          placeholder="Time Off, Paid Holiday…"
        />
      </label>
      <SectionFooter onSave={handleSave} onReset={handleReset} saveState={saveState} />
    </div>
  );
}

// ── Section 3: OT Threshold ────────────────────────────────────────────────────

function OtThresholdSection({ initial }: { initial: number }) {
  const prog = useProgram();
  const [value, setValue] = useState(String(initial));
  const [saveState, triggerSave] = useSaveState();

  const isDirty = parseFloat(value) !== initial;

  function handleSave() {
    const ok = saveRulesSection('otThreshold', parseFloat(value) || DEFAULT_RULES.otThreshold, prog);
    triggerSave(ok);
  }

  function handleReset() {
    setValue(String(DEFAULT_RULES.otThreshold));
    const ok = resetSection('otThreshold', prog);
    triggerSave(ok);
  }

  return (
    <div className="section-block">
      <SectionHeader title="OT Threshold" dirty={isDirty} />
      <label className="block">
        <span className="text-[11px] text-mc-dim mb-1 block">OT Hours Threshold (&gt;)</span>
        <input
          type="number"
          step="0.01"
          min="0"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          className={inputCls}
          style={{ ...inputStyle, maxWidth: 120 }}
        />
      </label>
      <SectionFooter onSave={handleSave} onReset={handleReset} saveState={saveState} />
    </div>
  );
}

// ── Section 3b: OT Blanket Approvals ─────────────────────────────────────────

type OtException = AuditRules['otExceptions'][number];

function OtBlanketApprovalsSection({ initial }: { initial: OtException[] }) {
  const prog = useProgram();
  const [rows, setRows] = useState<OtException[]>(initial);
  const [saveState, triggerSave] = useSaveState();

  // Per-row edit state (editing in place)
  const [editingIdx, setEditingIdx] = useState<number | null>(null);
  const [editWeek, setEditWeek] = useState('');
  const [editMaxHours, setEditMaxHours] = useState('');
  const [editNote, setEditNote] = useState('');

  // Add-row state
  const [showAdd, setShowAdd] = useState(false);
  const [addWeek, setAddWeek] = useState('');
  const [addMaxHours, setAddMaxHours] = useState('');
  const [addNote, setAddNote] = useState('');

  const isDirty = JSON.stringify(rows) !== JSON.stringify(initial);

  function persistRows(updated: OtException[]) {
    setRows(updated);
    const ok = saveRulesSection('otExceptions', updated, prog);
    triggerSave(ok);
  }

  function handleAddRow() {
    const week = parseInt(addWeek, 10);
    const maxHours = parseFloat(addMaxHours);
    if (!Number.isFinite(week) || !Number.isFinite(maxHours) || maxHours <= 0) return;
    persistRows([...rows, { week, maxHours, note: addNote.trim() }]);
    setAddWeek('');
    setAddMaxHours('');
    setAddNote('');
    setShowAdd(false);
  }

  function handleStartEdit(idx: number) {
    setEditingIdx(idx);
    setEditWeek(String(rows[idx].week));
    setEditMaxHours(String(rows[idx].maxHours));
    setEditNote(rows[idx].note);
  }

  function handleSaveEdit(idx: number) {
    const week = parseInt(editWeek, 10);
    const maxHours = parseFloat(editMaxHours);
    if (!Number.isFinite(week) || !Number.isFinite(maxHours) || maxHours <= 0) return;
    const updated = rows.map((r, i) =>
      i === idx ? { week, maxHours, note: editNote.trim() } : r,
    );
    setEditingIdx(null);
    persistRows(updated);
  }

  function handleCancelEdit() {
    setEditingIdx(null);
  }

  function handleRemove(idx: number) {
    persistRows(rows.filter((_, i) => i !== idx));
  }

  function handleSave() {
    const ok = saveRulesSection('otExceptions', rows, prog);
    triggerSave(ok);
  }

  function handleReset() {
    persistRows([]);
    resetSection('otExceptions', prog);
  }

  const rowStyle = {
    backgroundColor: 'color-mix(in srgb, var(--mc-bg) 85%, transparent)',
    border: '1px solid var(--mc-card-border)',
  };

  return (
    <div className="section-block">
      <SectionHeader title="OT Blanket Approvals" dirty={isDirty} />
      <p className="text-[10px] text-mc-dim mb-3">
        Weeks where OT up to a set hour cap is pre-approved. Check 7 skips the OT Approval tab
        lookup for any row whose week number and hours match an entry here.
        Waived rows appear in Check 7 details as blanket-approved.
      </p>

      {rows.length > 0 ? (
        <div className="space-y-2 mb-3">
          {rows.map((row, idx) =>
            editingIdx === idx ? (
              <div key={idx} className="rounded-md px-3 py-2 space-y-2" style={rowStyle}>
                <div className="grid grid-cols-2 gap-2">
                  <label className="block">
                    <span className="text-[10px] text-mc-dim mb-0.5 block">Week #</span>
                    <input
                      type="number"
                      min="1"
                      step="1"
                      value={editWeek}
                      onChange={(e) => setEditWeek(e.target.value)}
                      className={inputCls}
                      style={inputStyle}
                      placeholder="e.g. 14"
                    />
                  </label>
                  <label className="block">
                    <span className="text-[10px] text-mc-dim mb-0.5 block">Max Hours</span>
                    <input
                      type="number"
                      min="0.01"
                      step="0.25"
                      value={editMaxHours}
                      onChange={(e) => setEditMaxHours(e.target.value)}
                      className={inputCls}
                      style={inputStyle}
                      placeholder="e.g. 10"
                    />
                  </label>
                </div>
                <label className="block">
                  <span className="text-[10px] text-mc-dim mb-0.5 block">Note (optional)</span>
                  <input
                    type="text"
                    value={editNote}
                    onChange={(e) => setEditNote(e.target.value)}
                    className={inputCls}
                    style={inputStyle}
                    placeholder="e.g. Manager approved via email 2026-01-15"
                  />
                </label>
                <div className="flex items-center gap-2">
                  <button type="button" className={btnSave} onClick={() => handleSaveEdit(idx)}>
                    Save
                  </button>
                  <button type="button" className={btnReset} onClick={handleCancelEdit}>
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <div key={idx} className="rounded-md px-3 py-2 text-xs flex items-start gap-2" style={rowStyle}>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-mc-text">Week {row.week}</span>
                    <span className="text-mc-amber text-[10px]">≤ {row.maxHours}hrs</span>
                  </div>
                  {row.note && (
                    <div className="text-mc-dim text-[10px] mt-0.5 truncate">{row.note}</div>
                  )}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => handleStartEdit(idx)}
                    className="text-mc-blue hover:text-[#2a8aee] text-[10px] px-1 transition"
                    title="Edit"
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    onClick={() => handleRemove(idx)}
                    className="text-rose-400/60 hover:text-rose-400 text-[10px] px-1 transition"
                    title="Remove"
                  >
                    ✕
                  </button>
                </div>
              </div>
            ),
          )}
        </div>
      ) : (
        <p className="text-[11px] text-mc-dim italic mb-3">No blanket approvals configured.</p>
      )}

      {/* Add row form */}
      {showAdd ? (
        <div className="rounded-md px-3 py-3 mb-3 space-y-2" style={rowStyle}>
          <p className="text-[10px] font-bold uppercase tracking-widest text-mc-dim mb-2">New Exception</p>
          <div className="grid grid-cols-2 gap-2">
            <label className="block">
              <span className="text-[10px] text-mc-dim mb-0.5 block">Week #</span>
              <input
                type="number"
                min="1"
                step="1"
                value={addWeek}
                onChange={(e) => setAddWeek(e.target.value)}
                className={inputCls}
                style={inputStyle}
                placeholder="e.g. 14"
              />
            </label>
            <label className="block">
              <span className="text-[10px] text-mc-dim mb-0.5 block">Max Hours</span>
              <input
                type="number"
                min="0.01"
                step="0.25"
                value={addMaxHours}
                onChange={(e) => setAddMaxHours(e.target.value)}
                className={inputCls}
                style={inputStyle}
                placeholder="e.g. 10"
              />
            </label>
          </div>
          <label className="block">
            <span className="text-[10px] text-mc-dim mb-0.5 block">Note (optional)</span>
            <input
              type="text"
              value={addNote}
              onChange={(e) => setAddNote(e.target.value)}
              className={inputCls}
              style={inputStyle}
              placeholder="e.g. Manager approved via email 2026-01-15"
            />
          </label>
          <div className="flex items-center gap-2 pt-1">
            <button
              type="button"
              className={btnSave}
              onClick={handleAddRow}
              disabled={!addWeek || !addMaxHours}
            >
              Add
            </button>
            <button type="button" className={btnReset} onClick={() => { setShowAdd(false); setAddWeek(''); setAddMaxHours(''); setAddNote(''); }}>
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setShowAdd(true)}
          className="text-xs text-mc-blue hover:text-[#2a8aee] font-medium mb-3 transition"
        >
          + Add Exception
        </button>
      )}

      <SectionFooter onSave={handleSave} onReset={handleReset} saveState={saveState} />
    </div>
  );
}

// ── Section 4: Tolerance Thresholds ───────────────────────────────────────────

function ToleranceSection({ initial }: { initial: AuditRules['tolerances'] }) {
  const prog = useProgram();
  const [dollar, setDollar] = useState(String(initial.dollar));
  const [hours, setHours] = useState(String(initial.hours));
  const [saveState, triggerSave] = useSaveState();

  const isDirty =
    parseFloat(dollar) !== initial.dollar || parseFloat(hours) !== initial.hours;

  function handleSave() {
    const ok = saveRulesSection('tolerances', {
      dollar: parseFloat(dollar) || DEFAULT_RULES.tolerances.dollar,
      hours: parseFloat(hours) || DEFAULT_RULES.tolerances.hours,
    }, prog);
    triggerSave(ok);
  }

  function handleReset() {
    setDollar(String(DEFAULT_RULES.tolerances.dollar));
    setHours(String(DEFAULT_RULES.tolerances.hours));
    const ok = resetSection('tolerances', prog);
    triggerSave(ok);
  }

  return (
    <div className="section-block">
      <SectionHeader title="Tolerance Thresholds" dirty={isDirty} />
      <div className="grid grid-cols-2 gap-3">
        <label className="block">
          <span className="text-[11px] text-mc-dim mb-1 block">Dollar (per row)</span>
          <input
            type="number"
            step="0.01"
            min="0"
            value={dollar}
            onChange={(e) => setDollar(e.target.value)}
            className={inputCls}
            style={inputStyle}
          />
        </label>
        <label className="block">
          <span className="text-[11px] text-mc-dim mb-1 block">Hours (reconciliation)</span>
          <input
            type="number"
            step="0.01"
            min="0"
            value={hours}
            onChange={(e) => setHours(e.target.value)}
            className={inputCls}
            style={inputStyle}
          />
        </label>
      </div>
      <SectionFooter onSave={handleSave} onReset={handleReset} saveState={saveState} />
    </div>
  );
}

// ── Section 5: Invoice Tab Names ───────────────────────────────────────────────

function InvoiceTabsSection({ initial }: { initial: AuditRules['invoiceTabs'] }) {
  const prog = useProgram();
  const [toLoad, setToLoad] = useState(tagsToString(initial.toLoad));
  const [alwaysExclude, setAlwaysExclude] = useState(tagsToString(initial.alwaysExclude));
  const [saveState, triggerSave] = useSaveState();

  const isDirty =
    toLoad !== tagsToString(initial.toLoad) ||
    alwaysExclude !== tagsToString(initial.alwaysExclude);

  function handleSave() {
    const ok = saveRulesSection('invoiceTabs', {
      toLoad: stringToTags(toLoad),
      alwaysExclude: stringToTags(alwaysExclude),
    }, prog);
    triggerSave(ok);
  }

  function handleReset() {
    const defaults = prog === 'ses' ? DEFAULT_SES_RULES : DEFAULT_RULES;
    setToLoad(tagsToString(defaults.invoiceTabs.toLoad));
    setAlwaysExclude(tagsToString(defaults.invoiceTabs.alwaysExclude));
    const ok = resetSection('invoiceTabs', prog);
    triggerSave(ok);
  }

  return (
    <div className="section-block">
      <SectionHeader title="Invoice Tab Names" dirty={isDirty} />
      <label className="block mb-2">
        <span className="text-[11px] text-mc-dim mb-1 block">Tabs to Load (comma-separated)</span>
        <input
          type="text"
          value={toLoad}
          onChange={(e) => setToLoad(e.target.value)}
          className={inputCls}
          style={inputStyle}
          placeholder="FSM I, FSM II, …"
        />
      </label>
      <label className="block">
        <span className="text-[11px] text-mc-dim mb-1 block">Tabs to Always Exclude (comma-separated)</span>
        <input
          type="text"
          value={alwaysExclude}
          onChange={(e) => setAlwaysExclude(e.target.value)}
          className={inputCls}
          style={inputStyle}
          placeholder="SOW"
        />
      </label>
      <p className="mt-1.5 text-[10px] text-mc-dim">
        Hidden tabs are always excluded regardless — not configurable.
      </p>
      <SectionFooter onSave={handleSave} onReset={handleReset} saveState={saveState} />
    </div>
  );
}

// ── Section 6: PO Number ──────────────────────────────────────────────────────

function PoNumberSection({ initial }: { initial: string }) {
  const prog = useProgram();
  const [value, setValue] = useState(initial);
  const [saveState, triggerSave] = useSaveState();

  const isDirty = value !== initial;

  function handleSave() {
    const defaults = prog === 'ses' ? DEFAULT_SES_RULES : DEFAULT_RULES;
    const ok = saveRulesSection('poNumber', value.trim() || defaults.poNumber, prog);
    triggerSave(ok);
  }

  function handleReset() {
    const defaults = prog === 'ses' ? DEFAULT_SES_RULES : DEFAULT_RULES;
    setValue(defaults.poNumber);
    const ok = resetSection('poNumber', prog);
    triggerSave(ok);
  }

  return (
    <div className="section-block">
      <SectionHeader title="PO Number" dirty={isDirty} />
      <label className="block">
        <span className="text-[11px] text-mc-dim mb-1 block">
          PO# (verified against cell {prog === 'ses' ? 'E19' : 'E17'} of first tab)
        </span>
        <input
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          className={inputCls}
          style={inputStyle}
          placeholder={prog === 'ses' ? 'T26C31H000163' : 'T26C31H000162'}
          spellCheck={false}
        />
      </label>
      <p className="mt-1 text-[10px] text-mc-dim">Changes quarterly — update here when it rolls over.</p>
      <SectionFooter onSave={handleSave} onReset={handleReset} saveState={saveState} />
    </div>
  );
}

// ── Section 8: Custom Rules (Check 15) ────────────────────────────────────────

const RULE_TYPE_LABELS: Record<RuleType, string> = {
  date_granularity: 'Date Granularity',
  positive_hours: 'Positive Hours',
  required_field: 'Required Field',
};

function CustomRulesSection({ initial }: { initial: CustomRule[] }) {
  const prog = useProgram();
  const [rules, setRules] = useState<CustomRule[]>(initial);
  const [saveState, triggerSave] = useSaveState();
  const [showAddForm, setShowAddForm] = useState(false);

  // Add-form state
  const [newName, setNewName] = useState('');
  const [newEntryTypes, setNewEntryTypes] = useState('');
  const [newRuleType, setNewRuleType] = useState<RuleType>('date_granularity');
  const [newStateFilter, setNewStateFilter] = useState('');
  const [newFieldName, setNewFieldName] = useState('');

  const isDirty = JSON.stringify(rules) !== JSON.stringify(initial);

  function handleToggle(id: string) {
    const updated = rules.map((r) => (r.id === id ? { ...r, enabled: !r.enabled } : r));
    setRules(updated);
    saveRulesSection('customRules', updated, prog);
  }

  function handleDelete(id: string) {
    const updated = rules.filter((r) => r.id !== id);
    setRules(updated);
    saveRulesSection('customRules', updated, prog);
  }

  function handleAddRule() {
    if (!newName.trim()) return;
    const newRule: CustomRule = {
      id: String(Date.now()),
      name: newName.trim(),
      enabled: true,
      entryTypes: newEntryTypes
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
      ruleType: newRuleType,
      stateFilter: newStateFilter.trim() || undefined,
      fieldName: newRuleType === 'required_field' ? newFieldName.trim() || undefined : undefined,
    };
    const updated = [...rules, newRule];
    setRules(updated);
    saveRulesSection('customRules', updated, prog);
    // Reset form
    setNewName('');
    setNewEntryTypes('');
    setNewRuleType('date_granularity');
    setNewStateFilter('');
    setNewFieldName('');
    setShowAddForm(false);
  }

  function handleCancelAdd() {
    setNewName('');
    setNewEntryTypes('');
    setNewRuleType('date_granularity');
    setNewStateFilter('');
    setNewFieldName('');
    setShowAddForm(false);
  }

  const [clearConfirm, setClearConfirm] = useState(false);

  function handleSave() {
    const ok = saveRulesSection('customRules', rules, prog);
    triggerSave(ok);
  }

  function handleReset() {
    if (!clearConfirm) {
      setClearConfirm(true);
      setTimeout(() => setClearConfirm(false), 3000);
      return;
    }
    setClearConfirm(false);
    setRules([]);
    const ok = resetSection('customRules', prog);
    triggerSave(ok);
  }

  return (
    <div className="section-block">
      <div className="flex items-center gap-2 mb-3">
        <h3 className="text-xs font-bold uppercase tracking-widest text-mc-dim">Custom Rules (Check 15)</h3>
        {isDirty && <DirtyDot />}
        {rules.length > 0 && !isDirty && (
          <span className="text-[9px] text-mc-green font-medium">● auto-saved</span>
        )}
      </div>
      <p className="text-[10px] text-mc-dim mb-3">
        Define no-code audit constraints. Each enabled rule runs against FSM I + FSM II rows
        in Check 15. Rules are auto-saved when added, toggled, or deleted.
      </p>

      {/* Rules table */}
      {rules.length > 0 ? (
        <div className="space-y-2 mb-3">
          {rules.map((rule) => (
            <div
              key={rule.id}
              className="rounded-md px-3 py-2 text-xs flex items-start gap-2"
              style={{ backgroundColor: 'color-mix(in srgb, var(--mc-bg) 85%, transparent)', border: '1px solid var(--mc-card-border)' }}
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-semibold text-mc-text truncate">{rule.name}</span>
                  <span className="text-mc-dim text-[10px]">{RULE_TYPE_LABELS[rule.ruleType]}</span>
                  {rule.stateFilter && (
                    <span className="text-mc-amber text-[10px]">State: {rule.stateFilter}</span>
                  )}
                </div>
                {rule.entryTypes.length > 0 && (
                  <div className="text-mc-dim text-[10px] mt-0.5">
                    Applies to: {rule.entryTypes.join(', ')}
                  </div>
                )}
                {rule.ruleType === 'required_field' && rule.fieldName && (
                  <div className="text-mc-dim text-[10px]">Field: {rule.fieldName}</div>
                )}
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {/* Enabled toggle */}
                <button
                  type="button"
                  onClick={() => handleToggle(rule.id)}
                  className={`text-[10px] px-2 py-0.5 rounded font-semibold transition ${
                    rule.enabled
                      ? 'bg-mc-green/20 text-mc-green border border-mc-green/30'
                      : 'bg-mc-dim/10 text-mc-dim border border-mc-card-border'
                  }`}
                  title={rule.enabled ? 'Click to disable' : 'Click to enable'}
                >
                  {rule.enabled ? 'ON' : 'OFF'}
                </button>
                {/* Delete */}
                <button
                  type="button"
                  onClick={() => handleDelete(rule.id)}
                  className="text-rose-400/60 hover:text-rose-400 text-[10px] px-1"
                  title="Delete rule"
                >
                  ✕
                </button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-[11px] text-mc-dim italic mb-3">No custom rules defined yet.</p>
      )}

      {/* Add rule form */}
      {showAddForm ? (
        <div
          className="rounded-md px-3 py-3 mb-3 space-y-2"
          style={{ backgroundColor: 'color-mix(in srgb, var(--mc-bg) 85%, transparent)', border: '1px solid var(--mc-card-border)' }}
        >
          <p className="text-[10px] font-bold uppercase tracking-widest text-mc-dim mb-2">New Rule</p>
          <label className="block">
            <span className="text-[11px] text-mc-dim mb-1 block">Name</span>
            <input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              className={inputCls}
              style={inputStyle}
              placeholder="e.g. CA OT Date Granularity"
            />
          </label>
          <label className="block">
            <span className="text-[11px] text-mc-dim mb-1 block">Entry Types (comma-separated, matches Comments column)</span>
            <input
              type="text"
              value={newEntryTypes}
              onChange={(e) => setNewEntryTypes(e.target.value)}
              className={inputCls}
              style={inputStyle}
              placeholder="Over Time, Time Off"
            />
          </label>
          <label className="block">
            <span className="text-[11px] text-mc-dim mb-1 block">Rule Type</span>
            <select
              value={newRuleType}
              onChange={(e) => setNewRuleType(e.target.value as RuleType)}
              className={inputCls}
              style={inputStyle}
            >
              <option value="date_granularity">Date Granularity — visitDate must be a specific day (non-null)</option>
              <option value="positive_hours">Positive Hours — time hours must be &gt; 0</option>
              <option value="required_field">Required Field — a named field must be non-empty</option>
            </select>
          </label>
          <label className="block">
            <span className="text-[11px] text-mc-dim mb-1 block">State Filter (optional — substring match on Associate State column)</span>
            <input
              type="text"
              value={newStateFilter}
              onChange={(e) => setNewStateFilter(e.target.value)}
              className={inputCls}
              style={inputStyle}
              placeholder="e.g. CA"
            />
          </label>
          {newRuleType === 'required_field' && (
            <label className="block">
              <span className="text-[11px] text-mc-dim mb-1 block">Field Name (LaborRow property to check)</span>
              <input
                type="text"
                value={newFieldName}
                onChange={(e) => setNewFieldName(e.target.value)}
                className={inputCls}
                style={inputStyle}
                placeholder="e.g. comments, associateId, visitDate"
              />
            </label>
          )}
          <div className="flex items-center gap-2 pt-1">
            <button
              type="button"
              className={btnSave}
              onClick={handleAddRule}
              disabled={!newName.trim()}
            >
              Save Rule
            </button>
            <button type="button" className={btnReset} onClick={handleCancelAdd}>
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setShowAddForm(true)}
          className="text-xs text-mc-blue hover:text-[#2a8aee] font-medium mb-3 transition"
        >
          + Add Rule
        </button>
      )}

      {/* Footer: Save unsaved edits + destructive clear */}
      <div className="flex items-center gap-2 mt-3">
        {isDirty && (
          <button type="button" className={btnSave} onClick={handleSave}>
            Save
          </button>
        )}
        {rules.length > 0 && (
          <button
            type="button"
            onClick={handleReset}
            className={`px-3 py-1 rounded text-xs font-medium transition ${
              clearConfirm
                ? 'bg-rose-500/20 text-rose-400 border border-rose-500/50'
                : 'text-mc-dim border border-mc-card-border hover:border-rose-500/40 hover:text-rose-400'
            }`}
          >
            {clearConfirm ? 'Tap again to confirm clear' : 'Clear All Rules'}
          </button>
        )}
        <SaveFeedback state={saveState} />
      </div>
    </div>
  );
}

// ── Section 8b: Holiday Schedule ─────────────────────────────────────────────

function HolidayScheduleSection({ initial }: { initial: HolidayEntry[] }) {
  const prog = useProgram();
  const [rows, setRows] = useState<HolidayEntry[]>(initial);
  const [saveState, triggerSave] = useSaveState();

  // Per-row edit state
  const [editingIdx, setEditingIdx] = useState<number | null>(null);
  const [editDate, setEditDate] = useState('');
  const [editHours, setEditHours] = useState('');
  const [editName, setEditName] = useState('');

  // Add-row state
  const [showAdd, setShowAdd] = useState(false);
  const [addDate, setAddDate] = useState('');
  const [addHours, setAddHours] = useState('8');
  const [addName, setAddName] = useState('');

  const isDirty = JSON.stringify(rows) !== JSON.stringify(initial);

  function persistRows(updated: HolidayEntry[]) {
    setRows(updated);
    const ok = saveRulesSection('holidays', updated, prog);
    triggerSave(ok);
  }

  function handleAddRow() {
    if (!addDate || !addName.trim()) return;
    const hours = parseFloat(addHours);
    if (!Number.isFinite(hours) || hours <= 0) return;
    // Ensure YYYY-MM-DD format
    if (!/^\d{4}-\d{2}-\d{2}$/.test(addDate)) return;
    const updated = [...rows, { date: addDate, hours, name: addName.trim() }]
      .sort((a, b) => a.date.localeCompare(b.date));
    persistRows(updated);
    setAddDate('');
    setAddHours('8');
    setAddName('');
    setShowAdd(false);
  }

  function handleStartEdit(idx: number) {
    setEditingIdx(idx);
    setEditDate(rows[idx].date);
    setEditHours(String(rows[idx].hours));
    setEditName(rows[idx].name);
  }

  function handleSaveEdit(idx: number) {
    if (!editDate || !editName.trim()) return;
    const hours = parseFloat(editHours);
    if (!Number.isFinite(hours) || hours <= 0) return;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(editDate)) return;
    const updated = rows
      .map((r, i) => i === idx ? { date: editDate, hours, name: editName.trim() } : r)
      .sort((a, b) => a.date.localeCompare(b.date));
    setEditingIdx(null);
    persistRows(updated);
  }

  function handleCancelEdit() {
    setEditingIdx(null);
  }

  function handleRemove(idx: number) {
    persistRows(rows.filter((_, i) => i !== idx));
  }

  function handleSave() {
    const ok = saveRulesSection('holidays', rows, prog);
    triggerSave(ok);
  }

  function handleReset() {
    persistRows([]);
    resetSection('holidays', prog);
  }

  const rowStyle = {
    backgroundColor: 'color-mix(in srgb, var(--mc-bg) 85%, transparent)',
    border: '1px solid var(--mc-card-border)',
  };

  return (
    <div className="section-block">
      <SectionHeader title="Holiday Schedule" dirty={isDirty} />
      <p className="text-[10px] text-mc-dim mb-3">
        Per-program paid holiday dates used by Check 17. For each FT employee present
        in the audited period, Check 17 flags missing Paid Holiday rows, wrong hours,
        or off-schedule Paid Holiday entries.
      </p>

      {rows.length > 0 ? (
        <div className="space-y-2 mb-3">
          {rows.map((row, idx) =>
            editingIdx === idx ? (
              <div key={idx} className="rounded-md px-3 py-2 space-y-2" style={rowStyle}>
                <div className="grid grid-cols-2 gap-2">
                  <label className="block">
                    <span className="text-[10px] text-mc-dim mb-0.5 block">Date (YYYY-MM-DD)</span>
                    <input
                      type="date"
                      value={editDate}
                      onChange={(e) => setEditDate(e.target.value)}
                      className={inputCls}
                      style={inputStyle}
                    />
                  </label>
                  <label className="block">
                    <span className="text-[10px] text-mc-dim mb-0.5 block">Hours</span>
                    <input
                      type="number"
                      min="0.5"
                      step="0.5"
                      value={editHours}
                      onChange={(e) => setEditHours(e.target.value)}
                      className={inputCls}
                      style={inputStyle}
                      placeholder="e.g. 8"
                    />
                  </label>
                </div>
                <label className="block">
                  <span className="text-[10px] text-mc-dim mb-0.5 block">Holiday Name</span>
                  <input
                    type="text"
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    className={inputCls}
                    style={inputStyle}
                    placeholder="e.g. Thanksgiving"
                  />
                </label>
                <div className="flex items-center gap-2">
                  <button type="button" className={btnSave} onClick={() => handleSaveEdit(idx)}>
                    Save
                  </button>
                  <button type="button" className={btnReset} onClick={handleCancelEdit}>
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <div key={idx} className="rounded-md px-3 py-2 text-xs flex items-start gap-2" style={rowStyle}>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-mc-text">{row.date}</span>
                    <span className="text-mc-amber text-[10px]">{row.hours}h</span>
                    <span className="text-mc-dim text-[10px] truncate">{row.name}</span>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => handleStartEdit(idx)}
                    className="text-mc-blue hover:text-[#2a8aee] text-[10px] px-1 transition"
                    title="Edit"
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    onClick={() => handleRemove(idx)}
                    className="text-rose-400/60 hover:text-rose-400 text-[10px] px-1 transition"
                    title="Remove"
                  >
                    ✕
                  </button>
                </div>
              </div>
            ),
          )}
        </div>
      ) : (
        <p className="text-[11px] text-mc-dim italic mb-3">No holidays configured. Add entries to enable Paid Holiday validation.</p>
      )}

      {showAdd ? (
        <div className="rounded-md px-3 py-3 mb-3 space-y-2" style={rowStyle}>
          <p className="text-[10px] font-bold uppercase tracking-widest text-mc-dim mb-2">New Holiday</p>
          <div className="grid grid-cols-2 gap-2">
            <label className="block">
              <span className="text-[10px] text-mc-dim mb-0.5 block">Date (YYYY-MM-DD)</span>
              <input
                type="date"
                value={addDate}
                onChange={(e) => setAddDate(e.target.value)}
                className={inputCls}
                style={inputStyle}
              />
            </label>
            <label className="block">
              <span className="text-[10px] text-mc-dim mb-0.5 block">Hours</span>
              <input
                type="number"
                min="0.5"
                step="0.5"
                value={addHours}
                onChange={(e) => setAddHours(e.target.value)}
                className={inputCls}
                style={inputStyle}
                placeholder="e.g. 8"
              />
            </label>
          </div>
          <label className="block">
            <span className="text-[10px] text-mc-dim mb-0.5 block">Holiday Name</span>
            <input
              type="text"
              value={addName}
              onChange={(e) => setAddName(e.target.value)}
              className={inputCls}
              style={inputStyle}
              placeholder="e.g. Thanksgiving"
            />
          </label>
          <div className="flex items-center gap-2 pt-1">
            <button
              type="button"
              className={btnSave}
              onClick={handleAddRow}
              disabled={!addDate || !addName.trim() || !addHours}
            >
              Add
            </button>
            <button
              type="button"
              className={btnReset}
              onClick={() => { setShowAdd(false); setAddDate(''); setAddHours('8'); setAddName(''); }}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setShowAdd(true)}
          className="text-xs text-mc-blue hover:text-[#2a8aee] font-medium mb-3 transition"
        >
          + Add Holiday
        </button>
      )}

      <SectionFooter onSave={handleSave} onReset={handleReset} saveState={saveState} />
    </div>
  );
}

// ── Section 9: Bragi AI System Prompt ─────────────────────────────────────────

function BragiPromptSection({ initial }: { initial: string }) {
  const prog = useProgram();
  const [value, setValue] = useState(initial);
  const [saveState, triggerSave] = useSaveState();

  const isDirty = value !== initial;

  function handleSave() {
    const ok = saveRulesSection('bragiSystemPrompt', value || DEFAULT_RULES.bragiSystemPrompt, prog);
    triggerSave(ok);
  }

  function handleReset() {
    setValue(DEFAULT_RULES.bragiSystemPrompt);
    const ok = resetSection('bragiSystemPrompt', prog);
    triggerSave(ok);
  }

  return (
    <div className="section-block">
      <SectionHeader title="Bragi AI System Prompt" dirty={isDirty} />
      <textarea
        rows={6}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        className="w-full rounded-md px-2.5 py-2 text-xs font-mono text-mc-text placeholder-mc-dim focus:outline-none focus:ring-1 focus:ring-mc-blue/50 resize-y"
        style={{ ...inputStyle, lineHeight: 1.6 }}
        placeholder="System prompt sent to claude-haiku-3-5 when Analyze with Bragi is clicked…"
      />
      <p className="mt-1 text-[10px] text-mc-dim">
        Sent to <span className="font-mono">claude-haiku-3-5</span> on "Analyze with Bragi".
      </p>
      <SectionFooter onSave={handleSave} onReset={handleReset} saveState={saveState} />
    </div>
  );
}

// ── AuditRulesPanel main ───────────────────────────────────────────────────────

export function AuditRulesPanel({
  program = 'fsm',
  onClose,
}: {
  program?: 'fsm' | 'ses';
  onClose: () => void;
}) {
  // Load current rules fresh on panel open
  const [rules] = useState<AuditRules>(() => getAuditRules(program));
  const [resetAllState, triggerResetAll] = useSaveState();

  function handleResetAll() {
    const defaults = program === 'ses' ? DEFAULT_SES_RULES : DEFAULT_RULES;
    const ok = program === 'ses' ? writeAuditRules(defaults, 'ses') : resetAllRules();
    triggerResetAll(ok);
    // Brief delay then close so user sees the confirm, then re-open will re-seed
    if (ok) setTimeout(() => window.location.reload(), 800);
  }

  return (
    <div
      className="flex flex-col overflow-y-auto"
      style={{
        width: 380,
        height: '100%',
        borderLeft: '1px solid var(--mc-card-border)',
        backgroundColor: 'var(--mc-bg2)',
      }}
    >
      {/* Panel header */}
      <div
        className="flex items-center justify-between px-5 py-4 shrink-0"
        style={{ borderBottom: '1px solid var(--mc-card-border)' }}
      >
        <div className="flex items-center gap-2">
          <span className="text-base">⚙️</span>
          <h2 className="text-sm font-bold text-mc-text">
            Audit Rules {program === 'ses' && <span className="ml-1 text-xs font-normal text-mc-dim">(SES)</span>}
          </h2>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="text-mc-dim hover:text-mc-text text-sm leading-none px-1"
          title="Close"
        >
          ✕
        </button>
      </div>

      {/* Scrollable sections */}
      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
        <ProgramCtx.Provider value={program}>
        <MarkupRatesSection initial={rules.markupRates} />
        {program === 'fsm' && <HourlyRatesSection initial={rules.hourlyRates} program={program} />}
        {program === 'fsm' && <OtHourlyRatesSection initial={rules.otHourlyRates} />}
        <PunchCategoriesSection initial={rules.punchCategories} />
        <OtThresholdSection initial={rules.otThreshold} />
        <OtBlanketApprovalsSection initial={rules.otExceptions} />
        <HolidayScheduleSection initial={rules.holidays ?? []} />
        <ToleranceSection initial={rules.tolerances} />
        <InvoiceTabsSection initial={rules.invoiceTabs} />
        <PoNumberSection initial={rules.poNumber} />
        <CustomRulesSection initial={rules.customRules} />
        <BragiPromptSection initial={rules.bragiSystemPrompt} />
        </ProgramCtx.Provider>

        {/* Reset all */}
        <div
          className="pt-4"
          style={{ borderTop: '1px solid var(--mc-card-border)' }}
        >
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={handleResetAll}
              className="px-3 py-1.5 rounded text-xs font-semibold text-rose-400 border border-rose-500/30 hover:bg-rose-500/10 transition"
            >
              Reset All to Defaults
            </button>
            <SaveFeedback state={resetAllState} />
          </div>
          <p className="mt-1.5 text-[10px] text-mc-dim">
            Restores all factory values and reloads the page.
          </p>
        </div>

        <div className="pb-2" />
      </div>
    </div>
  );
}
