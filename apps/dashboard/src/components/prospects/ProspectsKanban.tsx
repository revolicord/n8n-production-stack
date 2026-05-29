import type { LeadRow } from '@/lib/metrics/prospects';
import type { Stage } from '@/lib/stages';
import { LeadCard } from './LeadCard';

interface ProspectsKanbanProps {
  leads: LeadRow[];
  stages: Stage[];
}

interface KanbanColumn {
  /** Slug de la etapa: la clave por la que se agrupan los leads (`currentStage`). */
  slug: string;
  /** Etiqueta visible de la columna. */
  label: string;
  leads: LeadRow[];
}

/**
 * Board read-only: una columna por etapa del funnel (orden de `position`), cada lead una
 * tarjeta dentro de su `currentStage`. Las etapas terminales que no estén en el catálogo
 * activo (`disqualified`, `lost`, `escalated_human_call`…) se añaden como columnas extra al
 * final, de forma que ningún lead se pierda. No muta nada.
 */
export function ProspectsKanban({ leads, stages }: ProspectsKanbanProps) {
  // Agrupar leads por etapa actual.
  const byStage = new Map<string, LeadRow[]>();
  for (const lead of leads) {
    const list = byStage.get(lead.currentStage);
    if (list) list.push(lead);
    else byStage.set(lead.currentStage, [lead]);
  }

  // Columnas del catálogo (ya ordenadas por position).
  const columns: KanbanColumn[] = stages.map((s) => ({
    slug: s.slug,
    label: s.displayName,
    leads: byStage.get(s.slug) ?? [],
  }));

  // Columnas extra para etapas presentes en los datos pero no en el catálogo activo.
  const known = new Set(stages.map((s) => s.slug));
  for (const [slug, stageLeads] of byStage) {
    if (!known.has(slug)) {
      columns.push({ slug, label: slug, leads: stageLeads });
    }
  }

  if (leads.length === 0) {
    return (
      <div className="px-3 py-6 text-center text-[12px] text-qc-textMuted border border-qc-border rounded-lg bg-qc-surface">
        Sin prospectos iniciados en este mes.
      </div>
    );
  }

  return (
    <div className="flex gap-3 overflow-x-auto pb-2">
      {columns.map((col) => (
        <div
          key={col.slug}
          className="flex w-56 min-w-56 flex-col rounded-lg border border-qc-border bg-qc-surface"
        >
          <div className="flex items-center justify-between border-b border-qc-border px-3 py-2">
            <span className="text-[12px] font-medium text-qc-textBody">{col.label}</span>
            <span className="rounded-full bg-qc-surface2 px-1.5 py-0.5 text-[10px] text-qc-textMuted tabular-nums">
              {col.leads.length}
            </span>
          </div>
          <div className="flex flex-col gap-1.5 p-2">
            {col.leads.length === 0 ? (
              <span className="px-1 py-2 text-[11px] text-qc-textSubtle">Sin leads</span>
            ) : (
              col.leads.map((lead) => <LeadCard key={lead.subscriberId} lead={lead} />)
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
