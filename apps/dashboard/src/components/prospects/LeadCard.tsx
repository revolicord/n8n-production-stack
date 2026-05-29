import { fmtDayMonth } from '@/lib/format';
import type { LeadRow } from '@/lib/metrics/prospects';

interface LeadCardProps {
  lead: LeadRow;
}

/**
 * Tarjeta de un lead dentro del Kanban. Muestra el nombre y el @usuario como dos campos
 * separados, más la fecha de inicio (1A). Solo lectura: el único enlace es al perfil de IG.
 */
export function LeadCard({ lead }: LeadCardProps) {
  const name = lead.displayName ?? '—';

  return (
    <div className="rounded-md border border-qc-border bg-qc-surface2 px-2.5 py-2">
      <div className="text-[12px] font-medium text-qc-textBody truncate">{name}</div>
      {lead.igUsername && lead.profileUrl ? (
        <a
          href={lead.profileUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="text-[11px] text-qc-teal50 hover:underline truncate block"
        >
          @{lead.igUsername}
        </a>
      ) : (
        <span className="text-[11px] text-qc-textSubtle">—</span>
      )}
      <div className="mt-1 text-[10px] text-qc-textSubtle tabular-nums">
        {fmtDayMonth(lead.initiatedAt)}
      </div>
    </div>
  );
}
