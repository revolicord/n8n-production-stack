interface StageCellProps {
  /** Fecha de la acción en esta celda. Sin fecha → celda vacía. */
  date?: Date | null;
  /** Solo follow-ups: el lead respondió ese follow-up. */
  responded?: boolean;
  /** Solo follow-ups: el lead sigue AHORA en esta etapa (enviado, sin respuesta). */
  active?: boolean;
  /** Hitos sin color (1A, MS): muestra la fecha sin fondo de color. */
  plain?: boolean;
}

/** Formato "DD.M" igual que el Excel de Alex: día con padding, mes sin padding (ej. "04.2"). */
function formatCellDate(d: Date): string {
  return `${String(d.getUTCDate()).padStart(2, '0')}.${d.getUTCMonth() + 1}`;
}

/**
 * Celda individual de la tabla de prospectos. El color es por celda:
 * verde = respondió/avanzó, salmón = activo sin avanzar, naranja = enviado sin respuesta y ya pasó.
 */
export function StageCell({ date, responded, active, plain }: StageCellProps) {
  let bg = '';
  if (date && !plain) {
    if (responded) bg = 'bg-green-300';
    else if (active) bg = 'bg-red-300';
    else bg = 'bg-orange-200';
  }

  // Texto oscuro sobre los pasteles claros (la app es tema oscuro con texto blanco por defecto).
  const text = bg ? 'text-qc-bg font-medium' : 'text-qc-textBody';

  return (
    <td
      className={`px-2 py-1.5 text-[11px] text-center border border-qc-border tabular-nums ${bg} ${text}`}
    >
      {date ? formatCellDate(date) : ''}
    </td>
  );
}
