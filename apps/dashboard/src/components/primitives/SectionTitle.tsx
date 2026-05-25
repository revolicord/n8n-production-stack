import type { FC, ReactNode } from 'react';

interface SectionTitleProps {
  icon?: FC<{ size?: number; className?: string }>;
  children: ReactNode;
}

export function SectionTitle({ icon: IconCmp, children }: SectionTitleProps) {
  return (
    <h3 className="text-[12px] font-medium text-qc-textBody flex items-center gap-1.5 mb-3.5 uppercase tracking-wider">
      {IconCmp && <IconCmp size={14} className="text-qc-teal500" />}
      {children}
    </h3>
  );
}
