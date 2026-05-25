import { fmtNumber } from '@/lib/format';

interface FunnelDropLineProps {
  pct: number | null;
  lost: number;
}

export function FunnelDropLine({ pct, lost }: FunnelDropLineProps) {
  if (pct == null) {
    return (
      <div className="text-[10.5px] text-qc-textSubtle pb-0.5" style={{ paddingLeft: 90 }}>
        ↓ sin datos
      </div>
    );
  }
  return (
    <div className="text-[10.5px] text-qc-textSubtle pb-0.5" style={{ paddingLeft: 90 }}>
      ↓ <span className="text-qc-danger font-medium">−{Math.round(pct * 100)}%</span> drop ·{' '}
      {fmtNumber(lost)} perdidos
    </div>
  );
}
