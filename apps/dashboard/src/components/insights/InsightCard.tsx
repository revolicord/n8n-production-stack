import type { Insight } from '@/types';
import * as TablerIcons from '@tabler/icons-react';
import { IconBulb } from '@tabler/icons-react';

interface InsightCardProps {
  insight: Insight;
}

const TONE: Record<Insight['type'], { iconColor: string; iconBg: string }> = {
  warning: { iconColor: '#fbbf24', iconBg: 'rgba(251,191,36,0.12)' },
  ok: { iconColor: '#5dcaa5', iconBg: 'rgba(93,202,165,0.12)' },
  info: { iconColor: '#60a5fa', iconBg: 'rgba(96,165,250,0.12)' },
  ai: { iconColor: '#c084fc', iconBg: 'rgba(192,132,252,0.12)' },
};

export function InsightCard({ insight }: InsightCardProps) {
  const icons = TablerIcons as unknown as Record<
    string,
    React.FC<{ size?: number; color?: string }>
  >;
  const Icon = icons[insight.iconName] ?? IconBulb;
  const tone = TONE[insight.type];

  return (
    <div className="flex gap-2.5 p-3 bg-qc-surface2 border border-qc-border rounded-md text-[11.5px] leading-relaxed items-start">
      <div
        className="w-6 h-6 rounded-md flex items-center justify-center flex-shrink-0"
        style={{ background: tone.iconBg }}
      >
        <Icon size={14} color={tone.iconColor} />
      </div>
      <div className="flex-1">
        <div className="text-white font-medium mb-0.5">{insight.title}</div>
        <div className="text-qc-textMuted">{insight.body}</div>
        {insight.actionHref && insight.actionLabel && (
          <a
            href={insight.actionHref}
            className="text-[10.5px] text-qc-teal500 mt-1 inline-block hover:underline"
          >
            {insight.actionLabel}
          </a>
        )}
      </div>
    </div>
  );
}
