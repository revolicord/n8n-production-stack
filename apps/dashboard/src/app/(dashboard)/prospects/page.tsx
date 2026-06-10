import { PageSizeSelect } from '@/components/prospects/PageSizeSelect';
import { Pagination } from '@/components/prospects/Pagination';
import { ProspectsKanban } from '@/components/prospects/ProspectsKanban';
import { ProspectsSearch } from '@/components/prospects/ProspectsSearch';
import { ProspectsTable } from '@/components/prospects/ProspectsTable';
import { StageFilter } from '@/components/prospects/StageFilter';
import { PeriodSwitcher } from '@/components/shell/PeriodSwitcher';
import { TopBar } from '@/components/shell/TopBar';
import { MONTH_LABELS_LONG_ES } from '@/lib/format';
import { type ProspectsSort, getProspectsKanban, getProspectsPage } from '@/lib/metrics/prospects';
import { getStagesForTenant } from '@/lib/stages';
import { getActiveTenant } from '@/lib/tenant';

export const revalidate = 30;

type ViewMode = 'table' | 'kanban';

const SIZES = [25, 50, 100];
const DEFAULT_SIZE = 50;
const KANBAN_PER_COLUMN = 50;

export default async function ProspectsPage({
  searchParams,
}: {
  searchParams: Promise<{
    year?: string;
    month?: string;
    view?: string;
    page?: string;
    size?: string;
    q?: string;
    stage?: string;
    sort?: string;
  }>;
}) {
  const sp = await searchParams;
  const now = new Date();

  const parsedYear = Number.parseInt(sp.year ?? '', 10);
  const parsedMonth = Number.parseInt(sp.month ?? '', 10);
  const year = Number.isNaN(parsedYear) ? now.getUTCFullYear() : parsedYear;
  const month =
    Number.isNaN(parsedMonth) || parsedMonth < 1 || parsedMonth > 12
      ? now.getUTCMonth() + 1
      : parsedMonth;
  const view: ViewMode = sp.view === 'kanban' ? 'kanban' : 'table';

  const parsedPage = Number.parseInt(sp.page ?? '', 10);
  const page = Number.isNaN(parsedPage) || parsedPage < 1 ? 1 : parsedPage;
  const parsedSize = Number.parseInt(sp.size ?? '', 10);
  const size = SIZES.includes(parsedSize) ? parsedSize : DEFAULT_SIZE;
  const sort: ProspectsSort = sp.sort === 'old' ? 'old' : 'recent';
  const q = sp.q?.trim() || undefined;
  const stage = sp.stage?.trim() || undefined;

  const tenant = await getActiveTenant();
  const stages = await getStagesForTenant(tenant.id);

  const monthLabel = MONTH_LABELS_LONG_ES[month - 1] ?? String(month);

  /**
   * Construye un href preservando TODOS los params actuales y aplicando `overrides`. Un valor
   * vacío/undefined elimina el param. Cambiar q/stage/size/sort resetea `page` a 1 (param fuera).
   * Solo se serializan valores no-default para mantener las URLs limpias.
   */
  function buildHref(overrides: Record<string, string | number | undefined>): string {
    const params = new URLSearchParams();
    params.set('year', String(year));
    params.set('month', String(month));
    if (view === 'kanban') params.set('view', 'kanban');
    if (q) params.set('q', q);
    if (stage) params.set('stage', stage);
    if (sort !== 'recent') params.set('sort', sort);
    if (size !== DEFAULT_SIZE) params.set('size', String(size));
    if (page > 1) params.set('page', String(page));

    for (const [k, v] of Object.entries(overrides)) {
      if (v === undefined || v === '') params.delete(k);
      else params.set(k, String(v));
    }

    // Cambiar un filtro resetea la paginación (salvo que el override fije `page` explícitamente).
    const resetsPage = ['q', 'stage', 'size', 'sort'];
    if (
      Object.keys(overrides).some((k) => resetsPage.includes(k)) &&
      overrides.page === undefined
    ) {
      params.delete('page');
    }
    // Normaliza la vista: solo `kanban` es no-default.
    if (params.get('view') !== 'kanban') params.delete('view');

    return `/prospects?${params.toString()}`;
  }

  // PeriodSwitcher: mes anterior · actual · siguiente (siguiente solo hasta el mes en curso).
  const prevMonth = month === 1 ? 12 : month - 1;
  const prevYear = month === 1 ? year - 1 : year;
  const prevLabel = (MONTH_LABELS_LONG_ES[prevMonth - 1] ?? String(prevMonth)).slice(0, 3);

  const switcherOptions = [
    { label: prevLabel, href: buildHref({ year: prevYear, month: prevMonth }) },
    { label: monthLabel.slice(0, 3), href: buildHref({}), active: true },
  ];

  const nextMonth = month === 12 ? 1 : month + 1;
  const nextYear = month === 12 ? year + 1 : year;
  const nextLabel = (MONTH_LABELS_LONG_ES[nextMonth - 1] ?? String(nextMonth)).slice(0, 3);
  if (
    nextYear < now.getUTCFullYear() ||
    (nextYear === now.getUTCFullYear() && nextMonth <= now.getUTCMonth() + 1)
  ) {
    switcherOptions.push({
      label: nextLabel,
      href: buildHref({ year: nextYear, month: nextMonth }),
    });
  }

  // Toggle de vista (Tabla ↔ Kanban). Preserva el resto de params.
  const viewOptions = [
    { label: 'Tabla', href: buildHref({ view: 'table' }), active: view === 'table' },
    { label: 'Kanban', href: buildHref({ view: 'kanban' }), active: view === 'kanban' },
  ];

  const table =
    view === 'table'
      ? await getProspectsPage({ tenantId: tenant.id, year, month, page, size, q, stage, sort })
      : null;
  const kanban =
    view === 'kanban'
      ? await getProspectsKanban({ tenantId: tenant.id, year, month, perColumn: KANBAN_PER_COLUMN })
      : null;

  return (
    <div className="px-6 py-5">
      <TopBar
        title={`Prospectos · ${monthLabel} ${year}`}
        badge={{ label: 'en vivo' }}
        right={
          <div className="flex items-center gap-2">
            <PeriodSwitcher options={viewOptions} />
            <PeriodSwitcher options={switcherOptions} />
          </div>
        }
      />
      {view === 'kanban' && kanban ? (
        <ProspectsKanban kanban={kanban} stages={stages} buildHref={buildHref} />
      ) : table ? (
        <>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <ProspectsSearch initialQuery={q ?? ''} />
            <StageFilter stages={stages} current={stage} buildHref={buildHref} />
            <PageSizeSelect size={size} buildHref={buildHref} />
          </div>
          <div className="overflow-x-auto">
            <ProspectsTable columns={table.columns} leads={table.leads} query={q} />
          </div>
          <Pagination page={page} size={size} total={table.total} buildHref={buildHref} />
        </>
      ) : null}
    </div>
  );
}
