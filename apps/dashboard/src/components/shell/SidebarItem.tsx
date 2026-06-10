'use client';

import Link from 'next/link';
import type { FC } from 'react';

interface SidebarItemProps {
  href: string;
  icon: FC<{ size?: number }>;
  label: string;
  active?: boolean;
  external?: boolean;
  /** Conteo pendiente (ej. escalaciones sin resolver); 0 u undefined no se muestra. */
  badge?: number;
}

export function SidebarItem({
  href,
  icon: IconCmp,
  label,
  active,
  external,
  badge,
}: SidebarItemProps) {
  const cls = [
    'flex items-center gap-2.5 px-4 py-2 text-[12.5px] transition-colors border-l-2',
    active
      ? 'text-qc-teal50 bg-qc-teal700/10 border-l-qc-teal500'
      : 'text-qc-textMuted hover:text-white hover:bg-white/[0.03] border-l-transparent',
  ].join(' ');

  const content = (
    <>
      <IconCmp size={15} />
      <span>{label}</span>
      {badge != null && badge > 0 && (
        <span className="ml-auto rounded-full bg-red-500/20 px-1.5 py-0.5 text-[10px] font-medium text-red-400 tabular-nums">
          {badge}
        </span>
      )}
    </>
  );

  if (external) {
    return (
      <a href={href} target="_blank" rel="noopener noreferrer" className={cls}>
        {content}
      </a>
    );
  }

  return (
    <Link href={href} className={cls}>
      {content}
    </Link>
  );
}
