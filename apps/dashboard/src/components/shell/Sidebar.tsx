'use client';

import {
  IconBellRinging,
  IconCalendarMonth,
  IconChartArcs,
  IconChartBar,
  IconClockHour4,
  IconFilter,
  IconLayoutDashboard,
  IconSettings,
  IconUsers,
} from '@tabler/icons-react';
import { usePathname } from 'next/navigation';
import { SidebarItem } from './SidebarItem';
import { TenantSelect } from './TenantSelect';

type Stage = { id: string; slug: string; displayName: string; position: number };
type Tenant = { id: string; name: string; slug: string };

interface SidebarProps {
  tenant: Tenant;
  stages: Stage[];
  allTenants?: Tenant[];
  /** Escalaciones sin resolver — badge rojo en el item "Escalaciones". */
  pendingEscalations?: number;
}

export function Sidebar({ tenant, stages: _stages, allTenants, pendingEscalations }: SidebarProps) {
  const pathname = usePathname();
  const year = new Date().getUTCFullYear();
  const month = String(new Date().getUTCMonth() + 1).padStart(2, '0');

  async function handleLogout() {
    await fetch('/api/auth/logout', { method: 'POST' });
    window.location.href = '/login';
  }

  const tenants = allTenants ?? [tenant];

  return (
    <aside
      className="bg-qc-surface border-r border-qc-border flex flex-col flex-shrink-0"
      style={{ width: 200 }}
    >
      <div className="px-3.5 py-3.5 border-b border-qc-border flex items-center gap-2">
        <div
          className="rounded-md flex items-center justify-center flex-shrink-0"
          style={{ width: 22, height: 22, background: '#0f6e56' }}
        >
          <IconChartBar size={14} className="text-qc-teal50" />
        </div>
        <span className="text-[13px] font-medium text-white truncate">Quantum</span>
      </div>

      <div className="px-3 pt-3 pb-2">
        <TenantSelect tenants={tenants} activeId={tenant.id} />
      </div>

      <nav className="flex-1 overflow-y-auto py-2">
        <SidebarItem
          href={`/year/${year}`}
          icon={IconLayoutDashboard}
          label="Vista anual"
          active={pathname.startsWith('/year')}
        />
        <SidebarItem
          href={`/month/${year}/${month}`}
          icon={IconCalendarMonth}
          label="Vista mensual"
          active={pathname.startsWith('/month')}
        />
        <SidebarItem
          href="/funnel"
          icon={IconFilter}
          label="Funnel"
          active={pathname.startsWith('/funnel')}
        />
        <SidebarItem
          href="/prospects"
          icon={IconUsers}
          label="Prospectos"
          active={pathname.startsWith('/prospects')}
        />
        <SidebarItem
          href="/escalaciones"
          icon={IconBellRinging}
          label="Escalaciones"
          active={pathname.startsWith('/escalaciones')}
          badge={pendingEscalations}
        />

        <div className="border-t border-qc-border mx-3 my-1.5" />
        <div className="px-4 pt-1.5 pb-0.5 text-[10px] uppercase tracking-[0.08em] text-qc-textFaint font-medium">
          Análisis
        </div>
        <SidebarItem
          href="/velocity"
          icon={IconClockHour4}
          label="Velocidad"
          active={pathname.startsWith('/velocity')}
        />
        <SidebarItem
          href="/cohorts"
          icon={IconChartArcs}
          label="Cohortes"
          active={pathname.startsWith('/cohorts')}
        />

        <div className="border-t border-qc-border mx-3 my-1.5" />
        <SidebarItem
          href="/settings"
          icon={IconSettings}
          label="Settings"
          active={pathname.startsWith('/settings')}
        />
      </nav>

      <div className="px-4 py-3 border-t border-qc-border">
        <button
          type="button"
          onClick={handleLogout}
          className="text-[11px] text-qc-textSubtle hover:text-qc-textMuted transition-colors"
        >
          Cerrar sesión
        </button>
      </div>
    </aside>
  );
}
