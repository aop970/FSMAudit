import { useRef } from 'react';
import { Upload, FileCheck, X } from 'lucide-react';

type FileRole = 'invoice' | 'punch' | 'timeOff' | 'termedPto' | 'reference' | 'shift' | 'unknown';

function classifyFile(name: string): FileRole {
  if (/Weekly.?Shift.?Information/i.test(name)) return 'shift';
  if (/Punch.?Detail/i.test(name))  return 'punch';
  if (/time.?off/i.test(name))      return 'timeOff';
  if (/termed/i.test(name))         return 'termedPto';
  if (/Day-SES/i.test(name) || /^FSM26/i.test(name)) return 'invoice';
  if (/\.csv$/i.test(name))         return 'reference';
  return 'unknown';
}

const ROLE_STYLE: Record<FileRole, { bg: string; text: string }> = {
  invoice:   { bg: 'color-mix(in srgb, var(--mc-blue) 15%, transparent)', text: 'var(--mc-blue)'  },
  punch:     { bg: 'rgba(34,208,107,0.15)',  text: '#22d06b' },
  timeOff:   { bg: 'rgba(255,186,8,0.15)',   text: '#ffba08' },
  termedPto: { bg: 'rgba(192,132,252,0.15)', text: '#c084fc' },
  reference: { bg: 'rgba(148,163,184,0.15)', text: '#94a3b8' },
  shift:     { bg: 'rgba(192,132,252,0.15)', text: '#c084fc' },
  unknown:   { bg: 'rgba(248,113,113,0.15)', text: '#f87171' },
};

export interface MultiDropZoneProps {
  program:       'fsm' | 'ses';
  invoiceFile:   File | null;
  punchFile:     File | null;
  timeOffFile1:  File | null;
  timeOffFile2:  File | null;
  termedPtoFile: File | null;
  refFile:       File | null;
  shiftFile1:    File | null;
  shiftFile2:    File | null;
  onInvoice:   (f: File | null) => void;
  onPunch:     (f: File | null) => void;
  onTimeOff1:  (f: File | null) => void;
  onTimeOff2:  (f: File | null) => void;
  onTermedPto: (f: File | null) => void;
  onRef:       (f: File | null) => void;
  onShift1:    (f: File | null) => void;
  onShift2:    (f: File | null) => void;
}

interface SlotDef {
  role:       FileRole;
  label:      string;
  file:       File | null;
  onFile:     (f: File | null) => void;
  accept:     string;
  visible:    boolean;
  required?:  boolean;
}

export function MultiDropZone({
  program,
  invoiceFile, punchFile, timeOffFile1, timeOffFile2, termedPtoFile, refFile,
  shiftFile1, shiftFile2,
  onInvoice, onPunch, onTimeOff1, onTimeOff2, onTermedPto, onRef,
  onShift1, onShift2,
}: MultiDropZoneProps) {
  // General multi-file drop input (drag-and-drop path)
  const dropInputRef  = useRef<HTMLInputElement>(null);
  // Single-slot input (individual click-to-upload path)
  const slotInputRef  = useRef<HTMLInputElement>(null);
  const activeHandler = useRef<(f: File | null) => void>(() => {});

  // ── classify + route a batch of files (drag path) ─────────────────────────
  function processFiles(incoming: File[]) {
    const newTimeOff: File[] = [];
    const newShift:   File[] = [];

    for (const file of incoming) {
      const role = classifyFile(file.name);
      switch (role) {
        case 'invoice':   onInvoice(file);        break;
        case 'punch':     onPunch(file);          break;
        case 'timeOff':   newTimeOff.push(file);  break;
        case 'termedPto': onTermedPto(file);      break;
        case 'reference': onRef(file);            break;
        case 'shift':     newShift.push(file);    break;
      }
    }

    if (newTimeOff.length > 0) {
      const existing = [timeOffFile1, timeOffFile2].filter(Boolean) as File[];
      const byName = new Map<string, File>();
      for (const f of [...existing, ...newTimeOff]) byName.set(f.name, f);
      const sorted = Array.from(byName.values()).sort((a, b) => a.name.localeCompare(b.name));
      onTimeOff1(sorted[0] ?? null);
      onTimeOff2(sorted[1] ?? null);
    }

    if (newShift.length > 0) {
      const existing = [shiftFile1, shiftFile2].filter(Boolean) as File[];
      const byName = new Map<string, File>();
      for (const f of [...existing, ...newShift]) byName.set(f.name, f);
      const sorted = Array.from(byName.values()).sort((a, b) => a.name.localeCompare(b.name));
      onShift1(sorted[0] ?? null);
      onShift2(sorted[1] ?? null);
    }
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    processFiles(Array.from(e.dataTransfer.files));
  }

  function handleDropInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    if (e.target.files) processFiles(Array.from(e.target.files));
    e.target.value = '';
  }

  // ── individual slot click-to-upload ───────────────────────────────────────
  function openSlot(accept: string, handler: (f: File | null) => void) {
    activeHandler.current = handler;
    if (slotInputRef.current) {
      slotInputRef.current.accept = accept;
      slotInputRef.current.value = '';
      slotInputRef.current.click();
    }
  }

  function handleSlotInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0] ?? null;
    e.target.value = '';
    if (file) activeHandler.current(file);
  }

  // ── slot definitions ───────────────────────────────────────────────────────
  const slots: SlotDef[] = [
    {
      role: 'invoice', label: 'Invoice', file: invoiceFile, onFile: onInvoice,
      accept: '.xlsx,.xlsb', visible: true, required: true,
    },
    {
      role: 'punch', label: 'Punch Detail', file: punchFile, onFile: onPunch,
      accept: '.csv,.xlsx,.xlsb', visible: true,
    },
    {
      role: 'timeOff', label: 'Time Off (Wk 1)', file: timeOffFile1, onFile: onTimeOff1,
      accept: '.xlsx,.xlsb', visible: true,
    },
    {
      role: 'timeOff', label: 'Time Off (Wk 2)', file: timeOffFile2, onFile: onTimeOff2,
      accept: '.xlsx,.xlsb', visible: !!timeOffFile1,
    },
    {
      role: 'termedPto', label: 'Termed PTO', file: termedPtoFile, onFile: onTermedPto,
      accept: '.xlsx,.xlsb', visible: true,
    },
    ...(program === 'fsm' ? [{
      role: 'reference' as FileRole, label: 'Reference CSV', file: refFile, onFile: onRef,
      accept: '.csv', visible: true,
    }] : []),
    ...(program === 'ses' ? [
      {
        role: 'shift' as FileRole, label: 'Shift Report (Wk 1)', file: shiftFile1, onFile: onShift1,
        accept: '.xlsx,.xlsb', visible: true,
      },
      {
        role: 'shift' as FileRole, label: 'Shift Report (Wk 2)', file: shiftFile2, onFile: onShift2,
        accept: '.xlsx,.xlsb', visible: !!shiftFile1,
      },
    ] : []),
  ];

  const visibleSlots = slots.filter((s) => s.visible);
  const anyLoaded    = visibleSlots.some((s) => s.file);

  return (
    <div>
      {/* ── Individual slot rows (primary upload method) ── */}
      <div className="space-y-1 mb-2">
        {visibleSlots.map((slot) => {
          const style = ROLE_STYLE[slot.role];
          if (slot.file) {
            return (
              <div
                key={slot.label}
                className="flex items-center gap-2 rounded-md px-2.5 py-1.5"
                style={{ backgroundColor: 'color-mix(in srgb, var(--mc-bg) 50%, transparent)', border: '1px solid var(--mc-card-border)' }}
              >
                <FileCheck className="h-3.5 w-3.5 shrink-0" style={{ color: style.text }} />
                <div className="flex-1 min-w-0">
                  <p className="text-[10px] truncate text-mc-text leading-tight">{slot.file.name}</p>
                  <p className="text-[9px] text-mc-dim">{(slot.file.size / 1024).toFixed(0)} KB</p>
                </div>
                <span
                  className="text-[9px] font-semibold px-1.5 py-0.5 rounded shrink-0 whitespace-nowrap"
                  style={{ backgroundColor: style.bg, color: style.text }}
                >
                  {slot.label}
                </span>
                <button
                  type="button"
                  className="shrink-0 text-mc-dim hover:text-rose-400 transition"
                  title="Remove"
                  onClick={() => slot.onFile(null)}
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            );
          }

          // Empty slot — clickable upload button
          return (
            <button
              key={slot.label}
              type="button"
              className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left transition"
              style={{
                backgroundColor: 'transparent',
                border: `1px dashed color-mix(in srgb, ${style.text} 25%, transparent)`,
              }}
              onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = `color-mix(in srgb, ${style.text} 6%, transparent)`)}
              onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
              onClick={() => openSlot(slot.accept, slot.onFile)}
            >
              <Upload className="h-3 w-3 shrink-0" style={{ color: style.text, opacity: 0.6 }} />
              <span className="text-[10px] font-medium flex-1" style={{ color: style.text, opacity: 0.75 }}>
                {slot.label}
              </span>
              {slot.required && (
                <span className="text-[9px] text-rose-400 font-medium shrink-0">required</span>
              )}
              <span className="text-[9px] text-mc-dim shrink-0">click to upload</span>
            </button>
          );
        })}
      </div>

      {/* Hidden per-slot input */}
      <input
        ref={slotInputRef}
        type="file"
        className="sr-only"
        onChange={handleSlotInputChange}
      />

      {/* ── General drag zone (secondary / convenience) ── */}
      <div
        className="flex items-center justify-center gap-2 rounded-md border border-dashed px-3 py-2 text-center transition cursor-pointer"
        style={{
          borderColor: anyLoaded
            ? 'color-mix(in srgb, var(--mc-green) 30%, transparent)'
            : 'color-mix(in srgb, var(--mc-blue) 25%, transparent)',
          backgroundColor: 'transparent',
        }}
        onDragOver={(e) => e.preventDefault()}
        onDrop={handleDrop}
        onClick={() => dropInputRef.current?.click()}
      >
        <input
          ref={dropInputRef}
          type="file"
          multiple
          accept=".xlsx,.xlsb,.csv"
          className="sr-only"
          onChange={handleDropInputChange}
        />
        <Upload className="h-3.5 w-3.5 text-mc-dim shrink-0" />
        <p className="text-[10px] text-mc-dim">or drag all files here at once</p>
      </div>

      {program === 'ses' && invoiceFile && !/^Day-SES/i.test(invoiceFile.name) && (
        <p className="mt-1.5 text-[10px] text-rose-400">SES invoice name should start with Day-SES</p>
      )}
    </div>
  );
}
