import type { ReactNode } from 'react';

interface TopBarProps {
  title: string;
  subtitle?: string;
  right?: ReactNode;
  badge?: { label: string; tone?: 'teal' };
}

export function TopBar({ title, subtitle, right, badge }: TopBarProps) {
  return (
    <div className="flex items-center justify-between mb-4.5">
      <div>
        {subtitle && <div className="text-[11.5px] text-qc-textSubtle mb-0.5">{subtitle}</div>}
        <div className="text-lg font-medium text-white flex items-center gap-2.5">
          {title}
          {badge && (
            <span className="text-[10.5px] bg-qc-teal700/15 text-qc-teal50 px-2 py-0.5 rounded-full font-medium tracking-wider uppercase">
              {badge.label}
            </span>
          )}
        </div>
      </div>
      {right}
    </div>
  );
}
