import { useRef } from 'react';
import { Upload, FileCheck, X } from 'lucide-react';

interface DropZoneProps {
  label: string;
  sublabel: string;
  accepts: string; // e.g. ".xlsx,.xlsb" or ".csv"
  file: File | null;
  optional?: boolean;
  onFile: (f: File | null) => void;
}

export function DropZone({ label, sublabel, accepts, file, optional, onFile }: DropZoneProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    const f = e.dataTransfer.files[0];
    if (f) onFile(f);
  }

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0] ?? null;
    if (f) onFile(f);
    e.target.value = '';
  }

  return (
    <div
      className="relative flex min-h-[90px] cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed px-3 py-4 text-center transition"
      style={{
        borderColor: file ? 'rgba(34, 208, 107, 0.4)' : 'rgba(59, 158, 255, 0.35)',
        backgroundColor: file ? 'rgba(34, 208, 107, 0.05)' : 'rgba(13, 17, 32, 0.6)',
      }}
      onDragOver={(e) => e.preventDefault()}
      onDrop={handleDrop}
      onClick={() => inputRef.current?.click()}
    >
      <input
        ref={inputRef}
        type="file"
        accept={accepts}
        className="sr-only"
        onChange={handleChange}
      />

      {file ? (
        <>
          <FileCheck className="mb-1 h-5 w-5 text-mc-green" />
          <p className="text-xs font-medium text-mc-text truncate max-w-full px-4">{file.name}</p>
          <p className="text-[10px] text-mc-dim">{(file.size / 1024).toFixed(0)} KB</p>
          <button
            type="button"
            className="absolute right-2 top-2 rounded p-0.5 text-mc-dim hover:text-rose-400"
            onClick={(e) => { e.stopPropagation(); onFile(null); }}
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </>
      ) : (
        <>
          <Upload className="mb-1 h-5 w-5 text-mc-dim" />
          <p className="text-xs font-semibold text-mc-text">
            {label}
            {optional && <span className="ml-1 font-normal text-mc-dim">(optional)</span>}
          </p>
          <p className="text-[10px] text-mc-dim">{sublabel}</p>
        </>
      )}
    </div>
  );
}
