import { SettingsTabs } from '@/components/settings/SettingsTabs';
import { ToastHost } from '@/components/settings/ToastHost';

export const dynamic = 'force-dynamic';

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-col h-full">
      <div className="px-6 pt-5 pb-1">
        <h1 className="text-lg font-semibold text-white">Configuración del agente</h1>
        <p className="text-xs text-qc-textSubtle mt-0.5">
          Recursos, follow-ups y variables que consume el agente de IA.
        </p>
      </div>
      <SettingsTabs />
      <div className="flex-1 overflow-y-auto">{children}</div>
      <ToastHost />
    </div>
  );
}
