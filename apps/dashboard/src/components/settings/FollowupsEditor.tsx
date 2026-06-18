'use client';

import { updateFollowupConfig } from '@/app/(dashboard)/settings/_actions/follow-ups';
import { toast } from '@/components/settings/ToastHost';
import { useState, useTransition } from 'react';

interface Props {
  tenantId: string;
  followupsEnabled: boolean;
  resetOnReply: boolean;
  window: { timezone: string; start_hour: number; end_hour: number } | null;
}

export function FollowupsEditor({ tenantId, followupsEnabled, resetOnReply, window }: Props) {
  const [isPending, startTransition] = useTransition();
  const [enabled, setEnabled] = useState(followupsEnabled);
  const [reset, setReset] = useState(resetOnReply);
  const [quietEnabled, setQuietEnabled] = useState(window !== null);
  const [tz, setTz] = useState(window?.timezone ?? 'America/Santo_Domingo');
  const [startHour, setStartHour] = useState(window?.start_hour ?? 8);
  const [endHour, setEndHour] = useState(window?.end_hour ?? 21);

  function run(action: () => Promise<{ ok: true } | { ok: false; error: string }>, okMsg: string) {
    startTransition(async () => {
      const result = await action();
      if (result.ok) toast(okMsg);
      else toast(result.error, false);
    });
  }

  function saveWindow(nextQuietEnabled: boolean) {
    if (!nextQuietEnabled) {
      run(
        () => updateFollowupConfig(tenantId, { followup_window: null }),
        'Quiet hours desactivado',
      );
      return;
    }
    if (endHour <= startHour) {
      toast('La hora de fin debe ser mayor que la de inicio', false);
      return;
    }
    run(
      () =>
        updateFollowupConfig(tenantId, {
          followup_window: { timezone: tz.trim(), start_hour: startHour, end_hour: endHour },
        }),
      'Horario de envío actualizado',
    );
  }

  return (
    <div className="p-6 space-y-6 max-w-2xl">
      <div>
        <h2 className="text-base font-semibold text-white mb-1">Follow-ups automáticos</h2>
        <p className="text-qc-textSubtle text-sm">
          El runner revisa periódicamente los leads sin respuesta y les envía la secuencia
          configurada por etapa. Aquí controlas el comportamiento global del tenant.
        </p>
      </div>

      <Toggle
        label="Follow-ups activados"
        description="Si lo apagas, no se envía ningún follow-up automático a este tenant."
        checked={enabled}
        busy={isPending}
        onChange={(v) => {
          setEnabled(v);
          run(
            () => updateFollowupConfig(tenantId, { followups_enabled: v }),
            v ? 'Follow-ups activados' : 'Follow-ups desactivados',
          );
        }}
      />

      <Toggle
        label="Reiniciar al responder"
        description="Si el lead responde, cancelar sus follow-ups pendientes. El agente los re-programa si la conversación se enfría de nuevo."
        checked={reset}
        busy={isPending}
        onChange={(v) => {
          setReset(v);
          run(
            () => updateFollowupConfig(tenantId, { followup_reset_on_reply: v }),
            'Preferencia guardada',
          );
        }}
      />

      <div className="border-t border-qc-border pt-5 space-y-3">
        <Toggle
          label="Horario permitido (quiet hours)"
          description="No enviar follow-ups fuera de la ventana indicada (hora local del lead). Los recordatorios de cita no se ven afectados."
          checked={quietEnabled}
          busy={isPending}
          onChange={(v) => {
            setQuietEnabled(v);
            saveWindow(v);
          }}
        />

        {quietEnabled && (
          <div className="flex flex-wrap items-end gap-3 pl-1">
            <label className="block">
              <span className="block text-xs text-qc-textSubtle mb-1">Zona horaria (IANA)</span>
              <input
                type="text"
                value={tz}
                onChange={(e) => setTz(e.target.value)}
                placeholder="America/Santo_Domingo"
                className="bg-qc-bg border border-qc-borderHover rounded px-2 py-1.5 text-sm text-qc-textBody focus:border-qc-teal500 focus:outline-none"
              />
            </label>
            <label className="block">
              <span className="block text-xs text-qc-textSubtle mb-1">Desde (hora)</span>
              <input
                type="number"
                min={0}
                max={23}
                value={startHour}
                onChange={(e) => setStartHour(Number(e.target.value))}
                className="w-20 bg-qc-bg border border-qc-borderHover rounded px-2 py-1.5 text-sm text-qc-textBody focus:border-qc-teal500 focus:outline-none"
              />
            </label>
            <label className="block">
              <span className="block text-xs text-qc-textSubtle mb-1">Hasta (hora)</span>
              <input
                type="number"
                min={1}
                max={24}
                value={endHour}
                onChange={(e) => setEndHour(Number(e.target.value))}
                className="w-20 bg-qc-bg border border-qc-borderHover rounded px-2 py-1.5 text-sm text-qc-textBody focus:border-qc-teal500 focus:outline-none"
              />
            </label>
            <button
              type="button"
              disabled={isPending}
              onClick={() => saveWindow(true)}
              className="px-3 py-1.5 bg-qc-teal700 hover:bg-qc-teal500 text-white text-sm rounded transition-colors disabled:opacity-50"
            >
              Guardar horario
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function Toggle({
  label,
  description,
  checked,
  busy,
  onChange,
}: {
  label: string;
  description: string;
  checked: boolean;
  busy: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div>
        <p className="text-sm text-white">{label}</p>
        <p className="text-xs text-qc-textSubtle">{description}</p>
      </div>
      <button
        type="button"
        disabled={busy}
        onClick={() => onChange(!checked)}
        className={`shrink-0 px-3 py-1.5 text-sm rounded transition-colors disabled:opacity-50 ${
          checked
            ? 'bg-qc-teal700 hover:bg-qc-teal500 text-white'
            : 'bg-qc-bg border border-qc-borderHover text-qc-textMuted hover:text-qc-textBody'
        }`}
      >
        {checked ? 'Activado' : 'Desactivado'}
      </button>
    </div>
  );
}
