import { Sidebar } from '@/components/shell/Sidebar';
import { getStagesForTenant } from '@/lib/stages';
import { getActiveTenant } from '@/lib/tenant';

export const dynamic = 'force-dynamic';

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const tenant = await getActiveTenant();
  const stages = await getStagesForTenant(tenant.id);

  return (
    <div className="flex h-screen overflow-hidden bg-qc-bg text-qc-textBody">
      <Sidebar tenant={tenant} stages={stages} />
      <main className="flex-1 overflow-y-auto">{children}</main>
    </div>
  );
}
