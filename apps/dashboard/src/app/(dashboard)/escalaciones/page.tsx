import { EscalationActions } from '@/components/escalaciones/EscalationActions';
import { AutoRefresh } from '@/components/shell/AutoRefresh';
import { PeriodSwitcher } from '@/components/shell/PeriodSwitcher';
import { TopBar } from '@/components/shell/TopBar';
import { type EscalationRow, getEscalations } from '@/lib/notifications';
import { getActiveTenant } from '@/lib/tenant';

export const dynamic = 'force-dynamic';

type StatusFilter = 'pending' | 'resolved' | 'all';

const KIND_LABELS: Record<string, string> = {
  audio: '🎙 Audio',
  image: '🖼 Imagen',
  video: '🎬 Video',
  location: '📍 Ubicación',
  file: '📎 Archivo',
  unknown: '❓ No soportado',
  keyword: '🚨 Keyword',
  agent: '🤖 Agente',
};

const HEADER_CELL =
  'px-3 py-2 text-[11px] font-medium text-qc-textMuted border-b border-qc-border text-left';

const dateTimeFmt = new Intl.DateTimeFormat('es-ES', {
  day: '2-digit',
  month: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  timeZone: 'UTC',
});

function isPaused(row: EscalationRow): boolean {
  return row.subscriberStatus === 'paused' && (!row.pausedUntil || row.pausedUntil > new Date());
}

export default async function EscalacionesPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const sp = await searchParams;
  const filter: StatusFilter =
    sp.status === 'resolved' ? 'resolved' : sp.status === 'all' ? 'all' : 'pending';

  const tenant = await getActiveTenant();
  const rows = await getEscalations({
    tenantId: tenant.id,
    status: filter === 'all' ? undefined : filter,
  });

  const filterOptions = [
    { label: 'Pendientes', href: '/escalaciones', active: filter === 'pending' },
    { label: 'Resueltas', href: '/escalaciones?status=resolved', active: filter === 'resolved' },
    { label: 'Todas', href: '/escalaciones?status=all', active: filter === 'all' },
  ];

  return (
    <div className="px-6 py-5">
      <AutoRefresh />
      <TopBar
        title="Escalaciones"
        subtitle="Avisos de audio, palabras clave y peticiones de humano del agente"
        right={<PeriodSwitcher options={filterOptions} />}
      />

      <div className="overflow-x-auto rounded-lg border border-qc-border bg-qc-surface">
        <table className="w-full border-collapse text-left">
          <thead>
            <tr>
              <th className={HEADER_CELL}>Tipo</th>
              <th className={HEADER_CELL}>Lead</th>
              <th className={HEADER_CELL}>Motivo</th>
              <th className={HEADER_CELL}>Fecha</th>
              <th className={HEADER_CELL}>Estado</th>
              <th className={HEADER_CELL}>Acciones</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-3 py-6 text-center text-[12px] text-qc-textMuted">
                  {filter === 'pending'
                    ? 'Sin escalaciones pendientes. 🎉'
                    : 'Sin escalaciones en este filtro.'}
                </td>
              </tr>
            ) : (
              rows.map((row) => {
                const paused = isPaused(row);
                const name = row.displayName ?? row.igUsername ?? '—';
                return (
                  <tr
                    key={row.id}
                    className={`border-b border-qc-border last:border-b-0 hover:bg-qc-surface2 ${
                      paused ? 'bg-red-500/[0.06]' : ''
                    }`}
                  >
                    <td className="px-3 py-2 text-[12px] whitespace-nowrap">
                      {KIND_LABELS[row.kind] ?? row.kind}
                    </td>
                    <td className="px-3 py-2 text-[12px] whitespace-nowrap">
                      <span className={paused ? 'text-red-400 font-medium' : 'text-qc-textBody'}>
                        {name}
                      </span>
                      {row.igUsername && (
                        <a
                          href={`https://instagram.com/${row.igUsername}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="ml-1.5 text-[11px] text-qc-teal50 hover:underline"
                        >
                          @{row.igUsername}
                        </a>
                      )}
                      {paused && (
                        <span className="ml-1.5 rounded-full bg-red-500/15 px-1.5 py-0.5 text-[10px] text-red-400">
                          ⏸ pausado
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-[12px] text-qc-textMuted max-w-md">
                      <div className="truncate">{row.reason ?? '—'}</div>
                      {row.summary && (
                        <div className="truncate text-[11px] text-qc-textSubtle">{row.summary}</div>
                      )}
                    </td>
                    <td className="px-3 py-2 text-[11px] text-qc-textSubtle whitespace-nowrap tabular-nums">
                      {dateTimeFmt.format(row.createdAt)}
                    </td>
                    <td className="px-3 py-2 text-[11px] whitespace-nowrap">
                      {row.status === 'pending' ? (
                        <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-amber-400">
                          pendiente
                        </span>
                      ) : (
                        <span className="rounded-full bg-qc-teal700/15 px-2 py-0.5 text-qc-teal50">
                          resuelta{row.resolvedBy ? ` · ${row.resolvedBy}` : ''}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <EscalationActions
                        notificationId={row.id}
                        subscriberId={row.subscriberId}
                        status={row.status}
                        isPaused={paused}
                      />
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
