import { Card } from '@/components/primitives/Card';
import { SectionTitle } from '@/components/primitives/SectionTitle';
import { fmtPct } from '@/lib/format';
import type { FollowupCell } from '@/lib/metrics/followups';
import { IconMail } from '@tabler/icons-react';

interface FollowupGridProps {
  followups: FollowupCell[];
}

export function FollowupGrid({ followups }: FollowupGridProps) {
  if (followups.length === 0) {
    return (
      <Card>
        <SectionTitle icon={IconMail}>Follow-ups del mes</SectionTitle>
        <p className="text-[11.5px] text-qc-textMuted">Sin datos de follow-ups este mes.</p>
      </Card>
    );
  }

  const stages = [...new Set(followups.map((f) => f.stageSlug))].sort();
  const sequences = [...new Set(followups.map((f) => f.sequenceNumber))].sort((a, b) => a - b);

  const cellMap = new Map<string, FollowupCell>();
  for (const f of followups) {
    cellMap.set(`${f.stageSlug}:${f.sequenceNumber}`, f);
  }

  return (
    <Card>
      <SectionTitle icon={IconMail}>Follow-ups del mes</SectionTitle>
      <div className="overflow-x-auto">
        <table className="w-full text-[11px]">
          <thead>
            <tr>
              <th className="text-left text-qc-textMuted font-normal pb-2 pr-3">Etapa</th>
              {sequences.map((seq) => (
                <th key={seq} className="text-center text-qc-textMuted font-normal pb-2 px-1">
                  FU{seq}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {stages.map((stage) => (
              <tr key={stage} className="border-t border-qc-surface2">
                <td className="text-white font-medium py-1.5 pr-3 uppercase text-[10px] tracking-wider">
                  {stage}
                </td>
                {sequences.map((seq) => {
                  const cell = cellMap.get(`${stage}:${seq}`);
                  if (!cell) {
                    return (
                      <td key={seq} className="text-center py-1.5 px-1 text-qc-textMuted">
                        —
                      </td>
                    );
                  }
                  const rr = cell.responseRate;
                  const color =
                    rr == null
                      ? 'text-qc-textMuted'
                      : rr >= 0.3
                        ? 'text-qc-teal500'
                        : rr >= 0.15
                          ? 'text-qc-warning'
                          : 'text-qc-danger';
                  return (
                    <td key={seq} className={`text-center py-1.5 px-1 font-medium ${color}`}>
                      <span title={`${cell.sent} enviados, ${cell.responded} respondidos`}>
                        {fmtPct(rr)}
                      </span>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-2.5 pt-2 border-t border-qc-surface2 flex justify-between text-[10px] text-qc-textMuted">
        <span>Tasa de respuesta por secuencia</span>
        <span>Total enviados: {followups.reduce((s, f) => s + f.sent, 0)}</span>
      </div>
    </Card>
  );
}
