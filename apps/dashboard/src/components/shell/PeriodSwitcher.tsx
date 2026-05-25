'use client';

import Link from 'next/link';

interface PeriodOption {
  label: string;
  href: string;
  active?: boolean;
}

interface PeriodSwitcherProps {
  options: PeriodOption[];
}

export function PeriodSwitcher({ options }: PeriodSwitcherProps) {
  return (
    <div className="flex gap-1 bg-qc-surface border border-qc-border rounded-md p-0.5">
      {options.map((opt) => (
        <Link
          key={opt.label}
          href={opt.href}
          className={[
            'text-[11.5px] px-2.5 py-1 rounded transition-colors',
            opt.active ? 'bg-qc-teal700 text-white' : 'text-qc-textMuted hover:text-white',
          ].join(' ')}
        >
          {opt.label}
        </Link>
      ))}
    </div>
  );
}
