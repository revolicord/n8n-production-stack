import { ProspectsKanban } from '@/components/prospects/ProspectsKanban';
import { ProspectsTable } from '@/components/prospects/ProspectsTable';
import { PeriodSwitcher } from '@/components/shell/PeriodSwitcher';
import { TopBar } from '@/components/shell/TopBar';
import { MONTH_LABELS_LONG_ES } from '@/lib/format';
import { getLeadsForMonth } from '@/lib/metrics/prospects';
import { getStagesForTenant } from '@/lib/stages';
import { getActiveTenant } from '@/lib/tenant';

export const revalidate = 30;

type ViewMode = 'table' | 'kanban';

export default async function ProspectsPage({
  searchParams,
}: {
  searchParams: Promise<{ year?: string; month?: string; view?: string }>;
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

  const tenant = await getActiveTenant();
  const data = await getLeadsForMonth({ tenantId: tenant.id, year, month });
  const stages = view === 'kanban' ? await getStagesForTenant(tenant.id) : [];

  const monthLabel = MONTH_LABELS_LONG_ES[month - 1] ?? String(month);

  // PeriodSwitcher: mes anterior · actual · siguiente (siguiente solo hasta el mes en curso).
  // El parámetro `view` se preserva al cambiar de periodo.
  const viewQs = view === 'kanban' ? '&view=kanban' : '';
  const prevMonth = month === 1 ? 12 : month - 1;
  const prevYear = month === 1 ? year - 1 : year;
  const prevLabel = (MONTH_LABELS_LONG_ES[prevMonth - 1] ?? String(prevMonth)).slice(0, 3);

  const switcherOptions = [
    { label: prevLabel, href: `/prospects?year=${prevYear}&month=${prevMonth}${viewQs}` },
    {
      label: monthLabel.slice(0, 3),
      href: `/prospects?year=${year}&month=${month}${viewQs}`,
      active: true,
    },
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
      href: `/prospects?year=${nextYear}&month=${nextMonth}${viewQs}`,
    });
  }

  // Toggle de vista (Tabla ↔ Kanban). Preserva el periodo seleccionado.
  const viewOptions = [
    {
      label: 'Tabla',
      href: `/prospects?year=${year}&month=${month}`,
      active: view === 'table',
    },
    {
      label: 'Kanban',
      href: `/prospects?year=${year}&month=${month}&view=kanban`,
      active: view === 'kanban',
    },
  ];

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
      {view === 'kanban' ? (
        <ProspectsKanban leads={data.leads} stages={stages} />
      ) : (
        <div className="overflow-x-auto">
          <ProspectsTable columns={data.columns} leads={data.leads} />
        </div>
      )}
    </div>
  );
}
