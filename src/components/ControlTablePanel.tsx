import { useState } from 'react';
import { X, Plus, Trash2, RotateCcw } from 'lucide-react';
import type { ControlTableEntry } from '../audit/types';
import { DEFAULT_CONTROL_TABLE, saveControlTable } from '../audit/controlTable';

interface Props {
  table: ControlTableEntry[];
  onChange: (t: ControlTableEntry[]) => void;
  onClose: () => void;
}

const cellCls = 'px-2 py-1 text-xs text-mc-text bg-transparent focus:outline-none focus:ring-1 focus:ring-mc-blue/50 rounded w-full';

function EditCell({
  value,
  onChange,
  type = 'text',
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  type?: string;
  placeholder?: string;
}) {
  return (
    <input
      type={type}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className={cellCls}
      style={{ minWidth: 0 }}
    />
  );
}

export function ControlTablePanel({ table, onChange, onClose }: Props) {
  const [saved, setSaved] = useState(false);

  function update(index: number, field: keyof ControlTableEntry, raw: string) {
    const next = table.map((row, i) => {
      if (i !== index) return row;
      if (field === 'hourlyRate') {
        return { ...row, hourlyRate: parseFloat(raw) || 0 };
      }
      if (field === 'allocationPct') {
        const n = parseFloat(raw);
        return { ...row, allocationPct: isNaN(n) ? 0 : n > 1 ? n / 100 : n };
      }
      return { ...row, [field]: raw };
    });
    commit(next);
  }

  function addRow() {
    commit([
      ...table,
      { name: '', associateId: '', title: '', hourlyRate: 0, allocationPct: 0 },
    ]);
  }

  function deleteRow(index: number) {
    commit(table.filter((_, i) => i !== index));
  }

  function resetToDefault() {
    if (confirm('Reset to built-in defaults? This cannot be undone.')) {
      commit([...DEFAULT_CONTROL_TABLE]);
    }
  }

  function commit(next: ControlTableEntry[]) {
    saveControlTable(next);
    onChange(next);
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  }

  return (
    <div
      className="flex h-full flex-col overflow-hidden"
      style={{
        width: 780,
        backgroundColor: 'var(--mc-bg2)',
        borderLeft: '1px solid var(--mc-card-border)',
      }}
    >
      {/* Header */}
      <div
        className="flex shrink-0 items-center justify-between px-5 py-4"
        style={{ borderBottom: '1px solid var(--mc-card-border)' }}
      >
        <div>
          <h2 className="text-sm font-bold text-mc-text">Management Control Table</h2>
          <p className="mt-0.5 text-[10px] text-mc-dim">
            {table.length} rows · edits save automatically to browser storage
          </p>
        </div>
        <div className="flex items-center gap-3">
          {saved && <span className="text-xs font-medium text-mc-green">Saved ✓</span>}
          <button
            type="button"
            onClick={resetToDefault}
            className="flex items-center gap-1 rounded-md px-2.5 py-1.5 text-xs text-mc-dim hover:text-mc-text"
            style={{ border: '1px solid var(--mc-card-border)' }}
            title="Reset to default"
          >
            <RotateCcw className="h-3 w-3" />
            Reset defaults
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-mc-dim hover:text-mc-text"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto px-5 py-4">
        <table className="w-full border-collapse text-xs">
          <thead>
            <tr style={{ borderBottom: '1px solid var(--mc-card-border)' }}>
              <th className="pb-2 text-left text-[10px] font-bold uppercase tracking-widest text-mc-dim w-8">#</th>
              <th className="pb-2 text-left text-[10px] font-bold uppercase tracking-widest text-mc-dim">Name</th>
              <th className="pb-2 text-left text-[10px] font-bold uppercase tracking-widest text-mc-dim">Associate ID</th>
              <th className="pb-2 text-left text-[10px] font-bold uppercase tracking-widest text-mc-dim">Title</th>
              <th className="pb-2 text-right text-[10px] font-bold uppercase tracking-widest text-mc-dim w-24">Rate ($/hr)</th>
              <th className="pb-2 text-right text-[10px] font-bold uppercase tracking-widest text-mc-dim w-24">Alloc %</th>
              <th className="w-8" />
            </tr>
          </thead>
          <tbody>
            {table.map((row, i) => (
              <tr
                key={i}
                className="group"
                style={{ borderBottom: '1px solid rgba(90,106,136,0.15)' }}
              >
                <td className="py-1 pr-2 text-mc-dim">{i + 1}</td>
                <td className="py-1 pr-1">
                  <EditCell
                    value={row.name}
                    onChange={(v) => update(i, 'name', v)}
                    placeholder="Full name"
                  />
                </td>
                <td className="py-1 pr-1">
                  <EditCell
                    value={row.associateId}
                    onChange={(v) => update(i, 'associateId', v)}
                    placeholder="ID"
                  />
                </td>
                <td className="py-1 pr-1">
                  <EditCell
                    value={row.title}
                    onChange={(v) => update(i, 'title', v)}
                    placeholder="Title"
                  />
                </td>
                <td className="py-1 pr-1">
                  <input
                    type="number"
                    step="0.01"
                    value={row.hourlyRate}
                    onChange={(e) => update(i, 'hourlyRate', e.target.value)}
                    className={cellCls + ' text-right'}
                    style={{ minWidth: 0 }}
                  />
                </td>
                <td className="py-1 pr-1">
                  <input
                    type="number"
                    step="0.0001"
                    min="0"
                    max="1"
                    value={row.allocationPct}
                    onChange={(e) => update(i, 'allocationPct', e.target.value)}
                    className={cellCls + ' text-right'}
                    style={{ minWidth: 0 }}
                    title="Enter as decimal (0.37 = 37%)"
                  />
                </td>
                <td className="py-1">
                  <button
                    type="button"
                    onClick={() => deleteRow(i)}
                    className="rounded p-1 text-mc-dim opacity-0 group-hover:opacity-100 hover:text-rose-400 transition-opacity"
                    title="Delete row"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <button
          type="button"
          onClick={addRow}
          className="mt-4 flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs text-mc-dim hover:text-mc-text"
          style={{ border: '1px solid var(--mc-card-border)' }}
        >
          <Plus className="h-3.5 w-3.5" />
          Add row
        </button>
      </div>
    </div>
  );
}
