// AuditRulesPanel.tsx — Collapsible ⚙️ Audit Rules configuration panel.
// Opens from gear icon in the header. Six editable sections, each with
// its own Save and Reset to Default. Changes are not auto-saved.
// Unsaved edits show a yellow dot on the section header.

import { useState, useCallback } from 'react';
import {
  type AuditRules,
  DEFAULT_RULES,
  getAuditRules,
  saveRulesSection,
  resetSection,
  resetAllRules,
} from '../audit/auditRules';

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
  backgroundColor: 'rgba(7, 9, 15, 0.85)',
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
  const [ft, setFt] = useState(String(initial.ft));
  const [pt, setPt] = useState(String(initial.pt));
  const [saveState, triggerSave] = useSaveState();

  const isDirty =
    parseFloat(ft) !== initial.ft || parseFloat(pt) !== initial.pt;

  function handleSave() {
    const ok = saveRulesSection('markupRates', {
      ft: parseFloat(ft) || DEFAULT_RULES.markupRates.ft,
      pt: parseFloat(pt) || DEFAULT_RULES.markupRates.pt,
    });
    triggerSave(ok);
  }

  function handleReset() {
    setFt(String(DEFAULT_RULES.markupRates.ft));
    setPt(String(DEFAULT_RULES.markupRates.pt));
    const ok = resetSection('markupRates');
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

// ── Section 2: Punch Categories ────────────────────────────────────────────────

function PunchCategoriesSection({ initial }: { initial: AuditRules['punchCategories'] }) {
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
    });
    triggerSave(ok);
  }

  function handleReset() {
    setSupported(tagsToString(DEFAULT_RULES.punchCategories.supported));
    setExceptions(tagsToString(DEFAULT_RULES.punchCategories.exceptions));
    const ok = resetSection('punchCategories');
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
  const [value, setValue] = useState(String(initial));
  const [saveState, triggerSave] = useSaveState();

  const isDirty = parseFloat(value) !== initial;

  function handleSave() {
    const ok = saveRulesSection('otThreshold', parseFloat(value) || DEFAULT_RULES.otThreshold);
    triggerSave(ok);
  }

  function handleReset() {
    setValue(String(DEFAULT_RULES.otThreshold));
    const ok = resetSection('otThreshold');
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

// ── Section 4: Tolerance Thresholds ───────────────────────────────────────────

function ToleranceSection({ initial }: { initial: AuditRules['tolerances'] }) {
  const [dollar, setDollar] = useState(String(initial.dollar));
  const [hours, setHours] = useState(String(initial.hours));
  const [saveState, triggerSave] = useSaveState();

  const isDirty =
    parseFloat(dollar) !== initial.dollar || parseFloat(hours) !== initial.hours;

  function handleSave() {
    const ok = saveRulesSection('tolerances', {
      dollar: parseFloat(dollar) || DEFAULT_RULES.tolerances.dollar,
      hours: parseFloat(hours) || DEFAULT_RULES.tolerances.hours,
    });
    triggerSave(ok);
  }

  function handleReset() {
    setDollar(String(DEFAULT_RULES.tolerances.dollar));
    setHours(String(DEFAULT_RULES.tolerances.hours));
    const ok = resetSection('tolerances');
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
    });
    triggerSave(ok);
  }

  function handleReset() {
    setToLoad(tagsToString(DEFAULT_RULES.invoiceTabs.toLoad));
    setAlwaysExclude(tagsToString(DEFAULT_RULES.invoiceTabs.alwaysExclude));
    const ok = resetSection('invoiceTabs');
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

// ── Section 6: Bragi AI System Prompt ─────────────────────────────────────────

function BragiPromptSection({ initial }: { initial: string }) {
  const [value, setValue] = useState(initial);
  const [saveState, triggerSave] = useSaveState();

  const isDirty = value !== initial;

  function handleSave() {
    const ok = saveRulesSection('bragiSystemPrompt', value || DEFAULT_RULES.bragiSystemPrompt);
    triggerSave(ok);
  }

  function handleReset() {
    setValue(DEFAULT_RULES.bragiSystemPrompt);
    const ok = resetSection('bragiSystemPrompt');
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

export function AuditRulesPanel({ onClose }: { onClose: () => void }) {
  // Load current rules fresh on panel open
  const [rules] = useState<AuditRules>(() => getAuditRules());
  const [resetAllState, triggerResetAll] = useSaveState();

  function handleResetAll() {
    const ok = resetAllRules();
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
          <h2 className="text-sm font-bold text-mc-text">Audit Rules</h2>
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
        <MarkupRatesSection initial={rules.markupRates} />
        <PunchCategoriesSection initial={rules.punchCategories} />
        <OtThresholdSection initial={rules.otThreshold} />
        <ToleranceSection initial={rules.tolerances} />
        <InvoiceTabsSection initial={rules.invoiceTabs} />
        <BragiPromptSection initial={rules.bragiSystemPrompt} />

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
