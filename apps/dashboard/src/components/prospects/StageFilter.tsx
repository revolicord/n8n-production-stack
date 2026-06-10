import type { Stage } from '@/lib/stages';
import Link from 'next/link';

type HrefBuilder = (overrides: Record<string, string | number | undefined>) => string;

interface StageFilterProps {
  stages: Stage[];
  current?: string;
  buildHref: HrefBuilder;
}

const CHIP = 'text-[11.5px] px-2.5 py-1 rounded transition-colors';
const ACTIVE = 'bg-qc-teal700 text-white';
const IDLE = 'text-qc-textMuted hover:text-white';

/**
 * Chips de filtro por etapa para la tabla (incluye "Todas"). Cada chip setea `?stage=` (vacío =
 * todas) y resetea `page` vía `buildHref`. Solo enlaces; reutiliza el catálogo del tenant.
 */
export function StageFilter({ stages, current, buildHref }: StageFilterProps) {
  return (
    <div className="flex flex-wrap gap-1 rounded-md border border-qc-border bg-qc-surface p-0.5">
      <Link href={buildHref({ stage: '' })} className={`${CHIP} ${current ? IDLE : ACTIVE}`}>
        Todas
      </Link>
      {stages.map((s) => (
        <Link
          key={s.slug}
          href={buildHref({ stage: s.slug })}
          className={`${CHIP} ${current === s.slug ? ACTIVE : IDLE}`}
        >
          {s.displayName}
        </Link>
      ))}
    </div>
  );
}
