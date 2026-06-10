import Link from 'next/link';

type HrefBuilder = (overrides: Record<string, string | number | undefined>) => string;

export const PAGE_SIZES = [25, 50, 100] as const;

interface PageSizeSelectProps {
  size: number;
  buildHref: HrefBuilder;
}

const CHIP = 'text-[11.5px] px-2.5 py-1 rounded transition-colors tabular-nums';
const ACTIVE = 'bg-qc-teal700 text-white';
const IDLE = 'text-qc-textMuted hover:text-white';

/** Selector de tamaño de página (25/50/100) como chips. Cambiar el tamaño resetea `page`. */
export function PageSizeSelect({ size, buildHref }: PageSizeSelectProps) {
  return (
    <div className="flex items-center gap-1">
      <span className="text-[11px] text-qc-textMuted">Por página</span>
      <div className="flex gap-1 rounded-md border border-qc-border bg-qc-surface p-0.5">
        {PAGE_SIZES.map((n) => (
          <Link
            key={n}
            href={buildHref({ size: n })}
            className={`${CHIP} ${n === size ? ACTIVE : IDLE}`}
          >
            {n}
          </Link>
        ))}
      </div>
    </div>
  );
}
