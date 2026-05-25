import { Card } from '@/components/primitives/Card';
import { SectionTitle } from '@/components/primitives/SectionTitle';
import type { Insight } from '@/types';
import { IconBulb } from '@tabler/icons-react';
import { InsightCard } from './InsightCard';

interface InsightListProps {
  insights: Insight[];
}

export function InsightList({ insights }: InsightListProps) {
  return (
    <Card>
      <SectionTitle icon={IconBulb}>Insights del agente</SectionTitle>
      {insights.length === 0 && (
        <p className="text-[11.5px] text-qc-textMuted">Sin alertas por ahora.</p>
      )}
      <div className="flex flex-col gap-2">
        {insights.map((insight, idx) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: insights have no stable id
          <InsightCard key={idx} insight={insight} />
        ))}
      </div>
    </Card>
  );
}
