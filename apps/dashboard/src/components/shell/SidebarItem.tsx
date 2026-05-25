'use client';

import Link from 'next/link';
import type { FC } from 'react';

interface SidebarItemProps {
  href: string;
  icon: FC<{ size?: number }>;
  label: string;
  active?: boolean;
  external?: boolean;
}

export function SidebarItem({ href, icon: IconCmp, label, active, external }: SidebarItemProps) {
  const cls = [
    'flex items-center gap-2.5 px-4 py-2 text-[12.5px] transition-colors border-l-2',
    active
      ? 'text-qc-teal50 bg-qc-teal700/10 border-l-qc-teal500'
      : 'text-qc-textMuted hover:text-white hover:bg-white/[0.03] border-l-transparent',
  ].join(' ');

  if (external) {
    return (
      <a href={href} target="_blank" rel="noopener noreferrer" className={cls}>
        <IconCmp size={15} />
        <span>{label}</span>
      </a>
    );
  }

  return (
    <Link href={href} className={cls}>
      <IconCmp size={15} />
      <span>{label}</span>
    </Link>
  );
}
