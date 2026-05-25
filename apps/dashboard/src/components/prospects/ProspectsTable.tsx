import type { ProspectsView } from '@/lib/metrics/prospects';
import { ProspectRow } from './ProspectRow';

type ProspectsTableProps = ProspectsView;

const HEADER_CELL = 'px-2 py-2 text-[11px] font-medium text-qc-textMuted border border-qc-border';

export function ProspectsTable({ columns, leads }: ProspectsTableProps) {
  const totalCols = 3 + columns.length; // Lead + 1A + MS + follow-ups

  return (
    <table className="border-collapse bg-qc-surface text-left">
      <thead>
        <tr>
          <th className={`${HEADER_CELL} text-left`}>Lead</th>
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
              Sin prospectos iniciados en este mes.
            </td>
          </tr>
        ) : (
          leads.map((lead) => <ProspectRow key={lead.subscriberId} lead={lead} columns={columns} />)
        )}
      </tbody>
    </table>
  );
}
