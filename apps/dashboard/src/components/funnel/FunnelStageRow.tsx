import { fmtNumber } from '@/lib/format';

interface FunnelStageRowProps {
  letter: string;
  label: string;
  value: number;
  widthPct: number;
}

export function FunnelStageRow({ letter, label, value, widthPct }: FunnelStageRowProps) {
  return (
    <div className="flex items-center gap-2.5">
      <div className="text-[11.5px] text-qc-textMuted" style={{ width: 80, flexShrink: 0 }}>
        <span className="font-medium">{letter}</span> · {label}
      </div>
      <div className="flex-1 h-7 bg-qc-surface2 rounded relative overflow-hidden">
        <div
          className="h-full flex items-center px-2 text-[11.5px] text-white font-medium"
          style={{
            width: `${Math.max(widthPct, 0).toFixed(1)}%`,
            background: 'linear-gradient(90deg, #0f6e56 0%, #14b8a6 100%)',
            borderRadius: 4,
          }}
        >
          {fmtNumber(value)}
        </div>
      </div>
    </div>
  );
}
