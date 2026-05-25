import { fmtNumber } from '@/lib/format';
import { DeltaPill } from './DeltaPill';
import { LetterBadge } from './LetterBadge';
import { Sparkline } from './Sparkline';

interface KpiCardProps {
  label: string;
  letter: 'A' | 'MS' | 'B' | 'C' | 'D';
  value: number;
  delta?: { value: number; suffix: string };
  sparkline?: number[];
  hint?: string;
}

export function KpiCard({ label, letter, value, delta, sparkline, hint }: KpiCardProps) {
  return (
    <div className="bg-qc-surface border border-qc-border rounded-lg px-3.5 py-3">
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-[10.5px] uppercase tracking-wider text-qc-textSubtle font-medium">
          {label}
        </span>
        <LetterBadge letter={letter} />
      </div>
      <div className="text-[24px] font-medium text-white leading-none tracking-tight mb-1">
        {fmtNumber(value)}
      </div>
      {delta && <DeltaPill value={delta.value} suffix={delta.suffix} />}
      {hint && !delta && <div className="text-[10px] text-qc-textSubtle mt-1">{hint}</div>}
      {sparkline && sparkline.length > 0 && <Sparkline data={sparkline} />}
    </div>
  );
}
