import type { FollowupColumn, LeadRow } from '@/lib/metrics/prospects';
import { ProspectRow } from './ProspectRow';

interface ProspectsTableProps {
  columns: FollowupColumn[];
  leads: LeadRow[];
  /** Texto de búsqueda activo: diferencia el estado "sin resultados" del estado vacío. */
  query?: string;
}

const HEADER_CELL =
  'px-2 py-2 text-[11px] font-medium text-qc-textMuted border border-qc-border bg-qc-surface sticky top-0 z-20';

export function ProspectsTable({ columns, leads, query }: ProspectsTableProps) {
  const totalCols = 3 + columns.length; // Lead + 1A + MS + follow-ups
  const emptyMessage = query
    ? `Sin resultados para «${query}».`
    : 'Sin prospectos iniciados en este mes.';

  return (
    <table className="border-collapse bg-qc-surface text-left">
      <thead>
        <tr>
          {/* Columna "Lead" fija (sticky left) además de la cabecera fija (sticky top). */}
          <th className={`${HEADER_CELL} text-left sticky left-0 z-30`}>Lead</th>
          <th className={`${HEADER_CELL} text-center`}>1A</th>
          <th className={`${HEADER_CELL} text-center`}>MS</th>
          {columns.map((col) => (
            <th key={col.label} className={`${HEADER_CELL} text-center`}>
              {col.label}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {leads.length === 0 ? (
          <tr>
            <td
              colSpan={totalCols}
              className="px-3 py-6 text-center text-[12px] text-qc-textMuted border border-qc-border"
            >
              {emptyMessage}
            </td>
          </tr>
        ) : (
          leads.map((lead) => <ProspectRow key={lead.subscriberId} lead={lead} columns={columns} />)
        )}
      </tbody>
    </table>
  );
}
