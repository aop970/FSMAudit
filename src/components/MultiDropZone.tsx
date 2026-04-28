import { useRef } from 'react';
import { Upload, FileCheck, X } from 'lucide-react';

type FileRole = 'invoice' | 'punch' | 'timeOff' | 'termedPto' | 'reference' | 'unknown';

function classifyFile(name: string): FileRole {
  if (/punch.?detail/i.test(name)) return 'punch';
  if (/^FSM26/i.test(name))        return 'invoice';
  if (/time.?off/i.test(name))     return 'timeOff';
  if (/termed/i.test(name))        return 'termedPto';
  if (/\.csv$/i.test(name))        return 'reference';
  return 'unknown';
}

const ROLE_STYLE: Record<FileRole, { bg: string; text: string; label: string }> = {
  invoice:   { bg: 'rgba(59,158,255,0.15)',  text: '#3b9eff',  label: 'Invoice'       },
  punch:     { bg: 'rgba(34,208,107,0.15)',  text: '#22d06b',  label: 'Punch Detail'  },
  timeOff:   { bg: 'rgba(255,186,8,0.15)',   text: '#ffba08',  label: 'Time Off'      },
  termedPto: { bg: 'rgba(192,132,252,0.15)', text: '#c084fc',  label: 'Termed PTO'    },
  reference: { bg: 'rgba(148,163,184,0.15)', text: '#94a3b8',  label: 'Reference'     },
  unknown:   { bg: 'rgba(248,113,113,0.15)', text: '#f87171',  label: 'Unrecognized'  },
};

interface SlotEntry {
  file: File;
  role: FileRole;
  slotLabel: string;
  onRemove: () => void;
}

export interface MultiDropZoneProps {
  invoiceFile:   File | null;
  punchFile:     File | null;
  timeOffFile1:  File | null;
  timeOffFile2:  File | null;
  termedPtoFile: File | null;
  refFile:       File | null;
  onInvoice:   (f: File | null) => void;
  onPunch:     (f: File | null) => void;
  onTimeOff1:  (f: File | null) => void;
  onTimeOff2:  (f: File | null) => void;
  onTermedPto: (f: File | null) => void;
  onRef:       (f: File | null) => void;
}

export function MultiDropZone({
  invoiceFile, punchFile, timeOffFile1, timeOffFile2, termedPtoFile, refFile,
  onInvoice, onPunch, onTimeOff1, onTimeOff2, onTermedPto, onRef,
}: MultiDropZoneProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  function processFiles(incoming: File[]) {
    const newTimeOff: File[] = [];

    for (const file of incoming) {
      const role = classifyFile(file.name);
      switch (role) {
        case 'invoice':   onInvoice(file);   break;
        case 'punch':     onPunch(file);     break;
        case 'timeOff':   newTimeOff.push(file); break;
        case 'termedPto': onTermedPto(file); break;
        case 'reference': onRef(file);       break;
        // unknown: silently skip
      }
    }

    if (newTimeOff.length > 0) {
      // Merge with existing time-off files, deduplicate by name, sort (date in
      // filename means alphabetical order = chronological order = Wk1 / Wk2).
      const existing = [timeOffFile1, timeOffFile2].filter(Boolean) as File[];
      const byName = new Map<string, File>();
      for (const f of [...existing, ...newTimeOff]) byName.set(f.name, f);
      const sorted = Array.from(byName.values()).sort((a, b) => a.name.localeCompare(b.name));
      onTimeOff1(sorted[0] ?? null);
      onTimeOff2(sorted[1] ?? null);
    }
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    processFiles(Array.from(e.dataTransfer.files));
  }

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    if (e.target.files) processFiles(Array.from(e.target.files));
    e.target.value = '';
  }

  const slots: SlotEntry[] = [
    invoiceFile   && { file: invoiceFile,   role: 'invoice'   as FileRole, slotLabel: 'Invoice',         onRemove: () => onInvoice(null)   },
    punchFile     && { file: punchFile,     role: 'punch'     as FileRole, slotLabel: 'Punch Detail',    onRemove: () => onPunch(null)     },
    timeOffFile1  && { file: timeOffFile1,  role: 'timeOff'   as FileRole, slotLabel: 'Time Off (Wk 1)', onRemove: () => onTimeOff1(null)  },
    timeOffFile2  && { file: timeOffFile2,  role: 'timeOff'   as FileRole, slotLabel: 'Time Off (Wk 2)', onRemove: () => onTimeOff2(null)  },
    termedPtoFile && { file: termedPtoFile, role: 'termedPto' as FileRole, slotLabel: 'Termed PTO',      onRemove: () => onTermedPto(null) },
    refFile       && { file: refFile,       role: 'reference' as FileRole, slotLabel: 'Reference',        onRemove: () => onRef(null)       },
  ].filter(Boolean) as SlotEntry[];

  const hasFiles = slots.length > 0;

  return (
    <div>
      <div
        className="flex flex-col items-center justify-center rounded-lg border-2 border-dashed px-3 py-5 text-center transition cursor-pointer"
        style={{
          borderColor: hasFiles ? 'rgba(34,208,107,0.35)' : 'rgba(59,158,255,0.35)',
          backgroundColor: hasFiles ? 'rgba(34,208,107,0.04)' : 'rgba(13,17,32,0.6)',
        }}
        onDragOver={(e) => e.preventDefault()}
        onDrop={handleDrop}
        onClick={() => inputRef.current?.click()}
      >
        <input
          ref={inputRef}
          type="file"
          multiple
          accept=".xlsx,.xlsb,.csv"
          className="sr-only"
          onChange={handleChange}
        />
        <Upload className="mb-1.5 h-5 w-5 text-mc-dim" />
        <p className="text-xs font-semibold text-mc-text">Drop all files here</p>
        <p className="text-[10px] text-mc-dim mt-0.5 leading-relaxed">
          Invoice · Punch Detail · Time Off · Termed PTO · Reference
          <br />
          Files are auto-detected by name
        </p>
      </div>

      {hasFiles && (
        <div className="mt-2.5 space-y-1">
          {slots.map((slot, i) => {
            const style = ROLE_STYLE[slot.role];
            return (
              <div
                key={i}
                className="flex items-center gap-2 rounded-md px-2.5 py-1.5"
                style={{ backgroundColor: 'rgba(7,9,15,0.5)', border: '1px solid var(--mc-card-border)' }}
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
                  {slot.slotLabel}
                </span>
                <button
                  type="button"
                  className="shrink-0 text-mc-dim hover:text-rose-400 transition"
                  onClick={(e) => { e.stopPropagation(); slot.onRemove(); }}
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            );
          })}
        </div>
      )}

      {!invoiceFile && hasFiles && (
        <p className="mt-1.5 text-[10px] text-rose-400">
          Invoice file required — name must start with FSM26
        </p>
      )}
    </div>
  );
}
