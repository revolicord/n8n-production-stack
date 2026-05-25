'use client';

import { useRouter } from 'next/navigation';

type Tenant = { id: string; name: string; slug: string };

interface TenantSelectProps {
  tenants: Tenant[];
  activeId: string;
}

export function TenantSelect({ tenants, activeId }: TenantSelectProps) {
  const router = useRouter();

  if (tenants.length <= 1) {
    const t = tenants[0];
    return (
      <div className="text-[11px] text-qc-textMuted bg-qc-bg border border-qc-borderHover rounded px-2 py-1.5 truncate">
        {t?.name ?? 'Sin tenant'}
      </div>
    );
  }

  return (
    <select
      value={activeId}
      onChange={(e) => {
        document.cookie = `tenant_id=${e.target.value}; path=/`;
        router.refresh();
      }}
      className="w-full bg-qc-bg border border-qc-borderHover rounded px-2 py-1 text-[11px] text-qc-textBody focus:outline-none focus:border-qc-teal500"
    >
      {tenants.map((t) => (
        <option key={t.id} value={t.id}>
          {t.name}
        </option>
      ))}
    </select>
  );
}
