import type { FunnelView } from '@/types';
import { FunnelDropLine } from './FunnelDropLine';
import { FunnelStageRow } from './FunnelStageRow';

interface FunnelBarsProps {
  view: FunnelView;
}

export function FunnelBars({ view }: FunnelBarsProps) {
  const { counts, drops } = view;
  const total = counts.a || 1;

  return (
    <div className="flex flex-col gap-1">
      <FunnelStageRow letter="A" label="Initiated" value={counts.a} widthPct={100} />
      <FunnelDropLine pct={drops.aToMs.pct} lost={drops.aToMs.lost} />
      <FunnelStageRow
        letter="MS"
        label="Media seen"
        value={counts.ms}
        widthPct={(counts.ms / total) * 100}
      />
      <FunnelDropLine pct={drops.msToB.pct} lost={drops.msToB.lost} />
      <FunnelStageRow
        letter="B"
        label="Engaged"
        value={counts.b}
        widthPct={(counts.b / total) * 100}
      />
      <FunnelDropLine pct={drops.bToC.pct} lost={drops.bToC.lost} />
      <FunnelStageRow
        letter="C"
        label="Calendly"
        value={counts.c}
        widthPct={(counts.c / total) * 100}
      />
      <FunnelDropLine pct={drops.cToD.pct} lost={drops.cToD.lost} />
      <FunnelStageRow
        letter="D"
        label="Booked"
        value={counts.d}
        widthPct={(counts.d / total) * 100}
      />
    </div>
  );
}
