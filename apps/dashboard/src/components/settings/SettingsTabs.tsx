'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const TABS: { href: string; label: string }[] = [
  { href: '/settings/agente', label: 'Agente' },
  { href: '/settings/funnel', label: 'Etapas' },
  { href: '/settings/flows', label: 'Flujos' },
  { href: '/settings/transiciones', label: 'Transiciones' },
  { href: '/settings/cascadas', label: 'Cascadas' },
  { href: '/settings/general', label: 'General' },
  { href: '/settings/fase-b', label: 'Fase B' },
  { href: '/settings/fase-c', label: 'Fase C' },
  { href: '/settings/follow-ups', label: 'Follow-ups' },
  { href: '/settings/booking-reminders', label: 'Recordatorios cita' },
  { href: '/settings/cierres', label: 'Cierres' },
  { href: '/settings/objeciones', label: 'Objeciones' },
  { href: '/settings/notificaciones', label: 'Notificaciones' },
];

export function SettingsTabs() {
  const pathname = usePathname();

  return (
    <nav className="flex items-center gap-1 border-b border-qc-border px-6">
      {TABS.map((tab) => {
        const active = pathname === tab.href;
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={`px-3 py-2.5 text-sm border-b-2 -mb-px transition-colors ${
              active
                ? 'border-qc-teal500 text-white'
                : 'border-transparent text-qc-textMuted hover:text-qc-textBody'
            }`}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
