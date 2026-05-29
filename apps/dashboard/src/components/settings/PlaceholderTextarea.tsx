'use client';

import { useRef, useState } from 'react';

const PLACEHOLDERS = ['{{name}}', '{{nurture_video}}', '{{call_link}}'];

interface PlaceholderTextareaProps {
  initial: string;
  onSave: (value: string) => void;
  rows?: number;
  placeholder?: string;
  withPlaceholders?: boolean;
}

export function PlaceholderTextarea({
  initial,
  onSave,
  rows = 3,
  placeholder,
  withPlaceholders = true,
}: PlaceholderTextareaProps) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [value, setValue] = useState(initial);

  function insert(ph: string) {
    const el = ref.current;
    const start = el?.selectionStart ?? value.length;
    const end = el?.selectionEnd ?? value.length;
    const next = value.slice(0, start) + ph + value.slice(end);
    setValue(next);
    requestAnimationFrame(() => {
      if (!el) return;
      el.focus();
      const pos = start + ph.length;
      el.selectionStart = pos;
      el.selectionEnd = pos;
    });
  }

  return (
    <div>
      {withPlaceholders && (
        <div className="flex flex-wrap gap-1 mb-1 items-center">
          <span className="text-xs text-qc-textSubtle">Insertar:</span>
          {PLACEHOLDERS.map((ph) => (
            <button
              key={ph}
              type="button"
              onClick={() => insert(ph)}
              className="text-xs font-mono px-1.5 py-0.5 rounded bg-qc-bg border border-qc-borderHover text-qc-textMuted hover:text-qc-teal50 hover:border-qc-teal500 transition-colors"
            >
              {ph}
            </button>
          ))}
        </div>
      )}
      <textarea
        ref={ref}
        rows={rows}
        value={value}
        placeholder={placeholder}
        onChange={(e) => setValue(e.target.value)}
        onBlur={() => {
          if (value !== initial) onSave(value);
        }}
        className="w-full bg-qc-bg border border-qc-borderHover rounded px-3 py-2 text-sm text-qc-textBody focus:border-qc-teal500 focus:outline-none"
      />
    </div>
  );
}
