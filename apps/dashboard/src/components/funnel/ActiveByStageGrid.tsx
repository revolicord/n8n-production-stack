import type { ActiveByStage } from '@/types';

interface ActiveByStageGridProps {
  data: ActiveByStage;
}

const STAGE_META: Array<{ key: keyof ActiveByStage; letter: string; hint: string }> = [
  { key: 'a', letter: 'A', hint: 'esperando MS' },
  { key: 'ms', letter: 'MS', hint: 'esperando B' },
  { key: 'b', letter: 'B', hint: 'en conversación' },
  { key: 'c', letter: 'C', hint: 'link enviado' },
  { key: 'd', letter: 'D', hint: 'por confirmar' },
];

export function ActiveByStageGrid({ data }: ActiveByStageGridProps) {
  return (
    <div>
      <div className="text-[11px] text-qc-textSubtle uppercase tracking-wider mb-2 font-medium">
        Prospectos activos ahora
      </div>
      <div className="grid grid-cols-5 gap-2 mb-4">
        {STAGE_META.map(({ key, letter, hint }) => (
          <div
            key={key}
            className="bg-qc-surface2 border border-qc-border rounded-md px-2.5 py-2.5 hover:border-qc-teal500 transition-colors cursor-pointer"
          >
            <div className="text-[10px] text-qc-teal500 font-medium tracking-wider">{letter}</div>
            <div className="text-[19px] font-medium text-white leading-none my-1 tracking-tight">
              {data[key]}
            </div>
            <div className="text-[9.5px] text-qc-textSubtle">{hint}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
