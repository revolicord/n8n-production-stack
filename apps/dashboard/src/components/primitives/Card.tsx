import type { ReactNode } from 'react';

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div className={`bg-qc-surface border border-qc-border rounded-lg p-4 ${className}`}>
      {children}
    </div>
  );
}
