import Link from 'next/link';

type HrefBuilder = (overrides: Record<string, string | number | undefined>) => string;

interface PaginationProps {
  page: number;
  size: number;
  total: number;
  buildHref: HrefBuilder;
}

const CHIP = 'text-[11.5px] px-2.5 py-1 rounded transition-colors tabular-nums';
const ACTIVE = 'bg-qc-teal700 text-white';
const IDLE = 'text-qc-textMuted hover:text-white';
const DISABLED = 'text-qc-textSubtle pointer-events-none';

/** Lista compacta de páginas con elipsis: 1 … (cur-1) cur (cur+1) … total. */
function pageNumbers(current: number, total: number): (number | 'gap')[] {
  const wanted = new Set<number>([1, total, current, current - 1, current + 1]);
  const sorted = [...wanted].filter((p) => p >= 1 && p <= total).sort((a, b) => a - b);
  const result: (number | 'gap')[] = [];
  let prev = 0;
  for (const p of sorted) {
    if (p - prev > 1) result.push('gap');
    result.push(p);
    prev = p;
  }
  return result;
}

/**
 * Paginador server-side: chips « ‹ 1 … 4 5 6 … 12 › » + "Mostrando X–Y de Z". Solo enlaces
 * (`buildHref`), coherente con `PeriodSwitcher`. No muta nada.
 */
export function Pagination({ page, size, total, buildHref }: PaginationProps) {
  const totalPages = Math.max(1, Math.ceil(total / size));
  const current = Math.min(Math.max(page, 1), totalPages);
  const from = total === 0 ? 0 : (current - 1) * size + 1;
  const to = Math.min(current * size, total);

  return (
    <div className="flex items-center justify-between gap-3 pt-3">
      <span className="text-[11px] text-qc-textMuted tabular-nums">
        {total === 0 ? 'Sin resultados' : `Mostrando ${from}–${to} de ${total}`}
      </span>
      {totalPages > 1 && (
        <div className="flex gap-1 rounded-md border border-qc-border bg-qc-surface p-0.5">
          {current === 1 ? (
            <span className={`${CHIP} ${DISABLED}`}>‹</span>
          ) : (
            <Link href={buildHref({ page: current - 1 })} className={`${CHIP} ${IDLE}`}>
              ‹
            </Link>
          )}
          {pageNumbers(current, totalPages).map((p, i) =>
            p === 'gap' ? (
              // biome-ignore lint/suspicious/noArrayIndexKey: separadores estáticos sin id.
              <span key={`gap-${i}`} className={`${CHIP} ${DISABLED}`}>
                …
              </span>
            ) : (
              <Link
                key={p}
                href={buildHref({ page: p })}
                className={`${CHIP} ${p === current ? ACTIVE : IDLE}`}
              >
                {p}
              </Link>
            ),
          )}
          {current === totalPages ? (
            <span className={`${CHIP} ${DISABLED}`}>›</span>
          ) : (
            <Link href={buildHref({ page: current + 1 })} className={`${CHIP} ${IDLE}`}>
              ›
            </Link>
          )}
        </div>
      )}
    </div>
  );
}
