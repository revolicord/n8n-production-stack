import { IconMinus, IconTrendingDown, IconTrendingUp } from '@tabler/icons-react';

interface DeltaPillProps {
  value: number;
  suffix?: string;
}

export function DeltaPill({ value, suffix }: DeltaPillProps) {
  const isUp = value > 0;
  const isFlat = value === 0;
  const Icon = isFlat ? IconMinus : isUp ? IconTrendingUp : IconTrendingDown;
  const colorCls = isFlat ? 'text-qc-textSubtle' : isUp ? 'text-qc-success' : 'text-qc-danger';
  const sign = isUp ? '+' : '';
  return (
    <div className={`flex items-center gap-1 text-[10.5px] ${colorCls}`}>
      <Icon size={12} />
      <span>
        {sign}
        {value}%
      </span>
      {suffix && <span className="text-qc-textSubtle">{suffix}</span>}
    </div>
  );
}
