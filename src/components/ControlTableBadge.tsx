import { Database, RefreshCw, Pencil } from 'lucide-react';
import { getControlTableTimestamp } from '../audit/controlTable';

interface ControlTableBadgeProps {
  rowCount: number;
  onUploadRef?: () => void;
  onEdit?: () => void;
}

export function ControlTableBadge({ rowCount, onUploadRef, onEdit }: ControlTableBadgeProps) {
  const ts = getControlTableTimestamp();
  const dateStr = ts
    ? new Date(ts).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
    : 'Seeded (default)';

  return (
    <div className="flex items-center justify-between rounded-lg px-3 py-2" style={{ border: '1px solid var(--mc-card-border)', backgroundColor: 'var(--mc-card-bg)' }}>
      <div className="flex items-center gap-2">
        <Database className="h-3.5 w-3.5 text-mc-blue" />
        <div>
          <p className="text-xs font-medium text-mc-text">Management Control Table</p>
          <p className="text-[10px] text-mc-dim">{rowCount} rows · Updated {dateStr}</p>
        </div>
      </div>
      <div className="ml-2 flex items-center gap-1">
        {onEdit && (
          <button
            type="button"
            onClick={onEdit}
            className="flex items-center gap-1 rounded text-[10px] text-mc-dim hover:text-mc-blue"
            title="View / edit control table"
          >
            <Pencil className="h-3 w-3" />
          </button>
        )}
        {onUploadRef && (
          <button
            type="button"
            onClick={onUploadRef}
            className="flex items-center gap-1 rounded text-[10px] text-mc-dim hover:text-mc-blue"
            title="Override via Reference CSV upload"
          >
            <RefreshCw className="h-3 w-3" />
          </button>
        )}
      </div>
    </div>
  );
}
