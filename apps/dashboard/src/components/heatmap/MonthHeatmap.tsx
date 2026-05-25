import { Card } from '@/components/primitives/Card';
import { SectionTitle } from '@/components/primitives/SectionTitle';
import type { HeatmapDay } from '@/lib/metrics/heatmap';
import { levelFor } from '@/lib/metrics/heatmap';
import { IconCalendar } from '@tabler/icons-react';

interface MonthHeatmapProps {
  heatmap: HeatmapDay[];
  year: number;
  month: number;
}

const DOW_LABELS = ['D', 'L', 'M', 'X', 'J', 'V', 'S'];

const LEVEL_BG: Record<0 | 1 | 2 | 3 | 4, string> = {
  0: 'bg-qc-surface2',
  1: 'bg-teal-900/40',
  2: 'bg-teal-700/50',
  3: 'bg-teal-600/70',
  4: 'bg-qc-teal500',
};

export function MonthHeatmap({ heatmap, year, month }: MonthHeatmapProps) {
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const firstDow = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();

  const countMap = new Map<string, number>();
  for (const h of heatmap) {
    countMap.set(h.day, h.count);
  }
  const max = Math.max(0, ...heatmap.map((h) => h.count));

  const cells: Array<{ day: number | null; count: number }> = [];
  for (let i = 0; i < firstDow; i++) {
    cells.push({ day: null, count: 0 });
  }
  for (let d = 1; d <= daysInMonth; d++) {
    const key = `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    cells.push({ day: d, count: countMap.get(key) ?? 0 });
  }

  return (
    <Card>
      <SectionTitle icon={IconCalendar}>Actividad diaria · Iniciados</SectionTitle>
      <div className="grid grid-cols-7 gap-1 mb-2">
        {DOW_LABELS.map((l) => (
          <div key={l} className="text-center text-[9px] text-qc-textMuted">
            {l}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {cells.map((cell, idx) => {
          if (cell.day == null) {
            // biome-ignore lint/suspicious/noArrayIndexKey: empty padding cells have no stable id
            return <div key={`empty-${idx}`} className="aspect-square" />;
          }
          const level = levelFor(cell.count, max);
          const bg = LEVEL_BG[level];
          return (
            <div
              key={cell.day}
              className={`aspect-square rounded-sm ${bg} flex items-center justify-center`}
              title={`Día ${cell.day}: ${cell.count} iniciados`}
            >
              <span className="text-[8px] text-qc-textMuted leading-none">{cell.day}</span>
            </div>
          );
        })}
      </div>
      <div className="flex items-center justify-end gap-1.5 mt-3">
        <span className="text-[9px] text-qc-textMuted">Menos</span>
        {([0, 1, 2, 3, 4] as const).map((l) => (
          <div key={l} className={`w-3 h-3 rounded-sm ${LEVEL_BG[l]}`} />
        ))}
        <span className="text-[9px] text-qc-textMuted">Más</span>
      </div>
    </Card>
  );
}
