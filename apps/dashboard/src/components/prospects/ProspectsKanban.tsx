import type { KanbanStage } from '@/lib/metrics/prospects';
import type { Stage } from '@/lib/stages';
import Link from 'next/link';
import { LeadCard } from './LeadCard';

type HrefBuilder = (overrides: Record<string, string | number | undefined>) => string;

interface ProspectsKanbanProps {
  /** Datos por etapa (total real + leads recortados a `perColumn`), ya calculados en el data layer. */
  kanban: KanbanStage[];
  stages: Stage[];
  /** Construye el href "ver todos →" hacia la tabla filtrada por etapa. */
  buildHref: HrefBuilder;
}

interface KanbanColumn {
  slug: string;
  label: string;
  total: number;
  leads: KanbanStage['leads'];
}

/**
 * Board read-only: una columna por etapa del funnel (orden de `position`). Cada columna muestra
 * hasta `perColumn` tarjetas (las más recientes) con un badge de conteo real ("50 de 612") y, si
 * hay recorte, un enlace "ver todos →" a la tabla filtrada por esa etapa. Las etapas terminales
 * fuera del catálogo activo se añaden como columnas extra al final, de forma que ningún lead se
 * pierde. La agrupación llega ya hecha del data layer. No muta nada.
 */
export function ProspectsKanban({ kanban, stages, buildHref }: ProspectsKanbanProps) {
  const byStage = new Map(kanban.map((k) => [k.slug, k]));

  // Columnas del catálogo (ya ordenadas por position).
  const columns: KanbanColumn[] = stages.map((s) => {
    const data = byStage.get(s.slug);
    return {
      slug: s.slug,
      label: s.displayName,
      total: data?.total ?? 0,
      leads: data?.leads ?? [],
    };
  });

  // Columnas extra para etapas presentes en los datos pero no en el catálogo activo.
  const known = new Set(stages.map((s) => s.slug));
  for (const k of kanban) {
    if (!known.has(k.slug)) {
      columns.push({ slug: k.slug, label: k.slug, total: k.total, leads: k.leads });
    }
  }

  const grandTotal = kanban.reduce((sum, k) => sum + k.total, 0);
  if (grandTotal === 0) {
    return (
      <div className="px-3 py-6 text-center text-[12px] text-qc-textMuted border border-qc-border rounded-lg bg-qc-surface">
        Sin prospectos iniciados en este mes.
      </div>
    );
  }

  return (
    <div className="flex gap-3 overflow-x-auto pb-2">
      {columns.map((col) => {
        const truncated = col.total > col.leads.length;
        return (
          <div
            key={col.slug}
            className="flex w-56 min-w-56 flex-col rounded-lg border border-qc-border bg-qc-surface"
          >
            <div className="flex items-center justify-between border-b border-qc-border px-3 py-2">
              <span className="text-[12px] font-medium text-qc-textBody">{col.label}</span>
              <span className="rounded-full bg-qc-surface2 px-1.5 py-0.5 text-[10px] text-qc-textMuted tabular-nums">
                {truncated ? `${col.leads.length} de ${col.total}` : col.leads.length}
              </span>
            </div>
            <div className="flex flex-col gap-1.5 p-2">
              {col.leads.length === 0 ? (
                <span className="px-1 py-2 text-[11px] text-qc-textSubtle">Sin leads</span>
              ) : (
                col.leads.map((lead) => <LeadCard key={lead.subscriberId} lead={lead} />)
              )}
            </div>
            {truncated && (
              <Link
                href={buildHref({ view: 'table', stage: col.slug })}
                className="border-t border-qc-border px-3 py-1.5 text-[11px] text-qc-teal50 hover:underline"
              >
                ver todos →
              </Link>
            )}
          </div>
        );
      })}
    </div>
  );
}
