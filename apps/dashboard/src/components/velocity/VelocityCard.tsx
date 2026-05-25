import { Card } from '@/components/primitives/Card';
import { SectionTitle } from '@/components/primitives/SectionTitle';
import { fmtDays } from '@/lib/format';
import type { Velocity } from '@/types';
import { IconClockHour4 } from '@tabler/icons-react';

interface VelocityCardProps {
  velocity: Velocity;
}

const ROWS: Array<{ from: string; to: string; key: keyof Velocity }> = [
  { from: 'A', to: 'MS', key: 'aToMs' },
  { from: 'MS', to: 'B', key: 'msToB' },
  { from: 'B', to: 'C', key: 'bToC' },
  { from: 'C', to: 'D', key: 'cToD' },
];

export function VelocityCard({ velocity }: VelocityCardProps) {
  return (
    <Card>
      <SectionTitle icon={IconClockHour4}>Velocidad del funnel</SectionTitle>
      {ROWS.map((r) => (
        <div
          key={`${r.from}-${r.to}`}
          className="flex items-center justify-between py-1.5 border-b border-qc-surface2 last:border-0 text-[11.5px]"
        >
          <span className="text-qc-textMuted">
            {r.from} <span className="text-qc-teal500 text-[10px] font-medium">→</span> {r.to}
          </span>
          <span className="text-white font-medium">{fmtDays(velocity[r.key])}</span>
        </div>
      ))}
      <div className="mt-2.5 pt-2.5 border-t border-qc-border flex justify-between text-[12px]">
        <span className="text-qc-textMuted">A → D promedio</span>
        <span className="text-qc-teal50 font-medium text-[16px]">{fmtDays(velocity.aToD)}</span>
      </div>
    </Card>
  );
}
