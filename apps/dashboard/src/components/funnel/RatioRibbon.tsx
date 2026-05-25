import { fmtPct } from '@/lib/format';
import type { FunnelRatios } from '@/lib/metrics/funnel';

interface RatioRibbonProps {
  ratios: FunnelRatios;
}

type RatioItem = {
  label: string;
  value: number | null;
  description: string;
};

export function RatioRibbon({ ratios }: RatioRibbonProps) {
  const items: RatioItem[] = [
    { label: 'MSR', value: ratios.msr, description: 'A → MS' },
    { label: 'PRR', value: ratios.prr, description: 'A → B' },
    { label: 'CSR', value: ratios.csr, description: 'A → C' },
    { label: 'ABR', value: ratios.abr, description: 'A → D' },
    { label: 'A→MS', value: ratios.aToMs, description: 'Paso a paso' },
    { label: 'MS→B', value: ratios.msToB, description: 'Paso a paso' },
    { label: 'B→C', value: ratios.bToC, description: 'Paso a paso' },
    { label: 'C→D', value: ratios.cToD, description: 'Paso a paso' },
  ];

  return (
    <div className="grid grid-cols-8 gap-2">
      {items.map((item) => (
        <RatioCell key={item.label} item={item} />
      ))}
    </div>
  );
}

function RatioCell({ item }: { item: RatioItem }) {
  const pct = item.value;
  const color =
    pct == null
      ? 'text-qc-textMuted'
      : pct >= 0.5
        ? 'text-qc-teal500'
        : pct >= 0.25
          ? 'text-qc-warning'
          : 'text-qc-danger';

  return (
    <div className="bg-qc-surface border border-qc-border rounded-lg p-3 flex flex-col items-center gap-1">
      <span className="text-[10px] text-qc-textMuted uppercase tracking-wider font-medium">
        {item.label}
      </span>
      <span className={`text-[20px] font-medium leading-none ${color}`}>{fmtPct(pct)}</span>
      <span className="text-[9px] text-qc-textMuted">{item.description}</span>
    </div>
  );
}
