import { fmtNumber } from '@/lib/format';
import type { Prediction } from '@/types';
import { IconSparkles } from '@tabler/icons-react';

interface PredictionCardProps {
  prediction: Prediction;
  monthLabel: string;
}

export function PredictionCard({ prediction, monthLabel }: PredictionCardProps) {
  const pctText =
    prediction.comparison.pct == null
      ? 'sin mes previo de referencia'
      : `${prediction.comparison.pct > 0 ? '+' : ''}${Math.round(prediction.comparison.pct * 100)}% sobre el mes anterior`;

  return (
    <div
      className="rounded-lg p-4 mt-3"
      style={{
        background: 'linear-gradient(135deg, rgba(13,148,136,0.15) 0%, rgba(13,148,136,0.05) 100%)',
        border: '1px solid rgba(20,184,166,0.3)',
      }}
    >
      <div className="text-[10.5px] text-qc-teal50 uppercase tracking-wider font-medium flex items-center gap-1.5">
        <IconSparkles size={12} /> Predicción de cierre
      </div>
      <div className="text-[28px] font-medium text-white leading-none mt-2 mb-1.5 tracking-tight">
        ~{fmtNumber(prediction.projected)} bookings
      </div>
      <div className="text-[11px] text-qc-textMuted">
        proyectado fin de {monthLabel} · al ritmo actual, {pctText}
      </div>
    </div>
  );
}
