import type { FollowupColumn, LeadRow } from '@/lib/metrics/prospects';
import { StageCell } from './StageCell';

interface ProspectRowProps {
  lead: LeadRow;
  columns: FollowupColumn[];
}

export function ProspectRow({ lead, columns }: ProspectRowProps) {
  const name = lead.displayName ?? lead.igUsername ?? '—';

  return (
    <tr className="hover:bg-qc-surface2">
      {/* Nombre + link al perfil de IG */}
      <td className="px-3 py-1.5 border border-qc-border whitespace-nowrap">
        <span className="text-[12px] text-qc-textBody">{name}</span>
        {lead.igUsername && lead.profileUrl && (
          <a
            href={lead.profileUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="ml-1.5 text-[11px] text-qc-teal50 hover:underline"
          >
            @{lead.igUsername}
          </a>
        )}
      </td>

      {/* Hitos sin color */}
      <StageCell date={lead.initiatedAt} plain />
      <StageCell date={lead.mediaSentAt} plain />

      {/* Follow-ups: una celda por columna del catálogo */}
      {columns.map((col) => {
        const cell = lead.followups.find(
          (f) => f.stage === col.stage && f.sequence === col.sequence,
        );
        const responded = cell?.respondedAt != null;
        const active = cell != null && !responded && lead.currentStage === col.stage;
        return (
          <StageCell
            key={col.label}
            date={cell?.sentAt ?? null}
            responded={responded}
            active={active}
          />
        );
      })}
    </tr>
  );
}
