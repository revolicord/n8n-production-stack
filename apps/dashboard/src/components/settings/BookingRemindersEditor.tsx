'use client';

import {
  type BookingReminderPatch,
  createBookingReminder,
  deleteBookingReminder,
  updateBookingReminder,
} from '@/app/(dashboard)/settings/_actions/booking-reminders';
import { toast } from '@/components/settings/ToastHost';
import { useState, useTransition } from 'react';

export interface BookingReminderRow {
  id: string;
  offsetMinutes: number;
  kind: string;
  type: string;
  textTemplate: string | null;
  flowNs: string | null;
  description: string | null;
  isActive: boolean;
  sortOrder: number;
}

type Run = (
  action: () => Promise<{ ok: true } | { ok: false; error: string }>,
  okMsg?: string,
) => void;

interface Props {
  tenantId: string;
  reminders: BookingReminderRow[];
}

/** Convierte offset_minutes con signo a texto legible ("24 h antes" / "30 min después"). */
function offsetLabel(min: number): string {
  if (min === 0) return 'a la hora de la cita';
  const abs = Math.abs(min);
  const unit = abs % 60 === 0 ? `${abs / 60} h` : `${abs} min`;
  return min < 0 ? `${unit} antes` : `${unit} después`;
}

export function BookingRemindersEditor({ tenantId, reminders }: Props) {
  const [isPending, startTransition] = useTransition();

  const run: Run = (action, okMsg) => {
    startTransition(async () => {
      const result = await action();
      if (result.ok) {
        if (okMsg) toast(okMsg);
      } else {
        toast(result.error, false);
      }
    });
  };

  return (
    <div className="p-6 space-y-6">
      <div>
        <h2 className="text-base font-semibold text-white mb-1">Recordatorios de cita</h2>
        <p className="text-qc-textSubtle text-sm">
          Mensajes que se envían automáticamente alrededor de la hora de una cita agendada por
          Calendly. El <span className="text-qc-textBody">offset</span> es relativo a la cita:
          negativo = antes, positivo = después. Usa{' '}
          <span className="text-qc-textBody">no-show</span> para hacer seguimiento si el lead no
          asistió. Placeholders: <code className="text-qc-textBody">{'{{name}}'}</code>,{' '}
          <code className="text-qc-textBody">{'{{start_time}}'}</code>,{' '}
          <code className="text-qc-textBody">{'{{join_url}}'}</code>.
        </p>
      </div>

      <div className="space-y-3">
        {reminders.length === 0 ? (
          <p className="text-qc-textSubtle text-sm">Aún no hay recordatorios de cita.</p>
        ) : (
          reminders.map((r) => <ReminderCard key={r.id} reminder={r} run={run} busy={isPending} />)
        )}
      </div>

      <AddReminderForm tenantId={tenantId} run={run} busy={isPending} />
    </div>
  );
}

function Badge({ children }: { children: React.ReactNode }) {
  return (
    <span className="font-mono text-xs px-2 py-0.5 rounded bg-qc-bg border border-qc-borderHover text-qc-textBody">
      {children}
    </span>
  );
}

function ReminderCard({
  reminder,
  run,
  busy,
}: {
  reminder: BookingReminderRow;
  run: Run;
  busy: boolean;
}) {
  const save = (patch: BookingReminderPatch, msg: string) =>
    run(() => updateBookingReminder(reminder.id, patch), msg);

  return (
    <div
      className={`bg-qc-surface border border-qc-border rounded-lg p-4 ${
        reminder.isActive ? '' : 'opacity-60'
      }`}
    >
      <div className="flex items-center justify-between gap-2 mb-2">
        <div className="flex items-center gap-2 text-sm text-qc-textSubtle">
          <Badge>{offsetLabel(reminder.offsetMinutes)}</Badge>
          <Badge>{reminder.kind === 'no_show' ? 'no-show' : 'recordatorio'}</Badge>
          <Badge>{reminder.type}</Badge>
          {!reminder.isActive && <span className="text-xs">(inactivo)</span>}
        </div>
        <div className="flex items-center gap-3">
          <button
            type="button"
            disabled={busy}
            onClick={() =>
              save(
                { is_active: !reminder.isActive },
                reminder.isActive ? 'Recordatorio desactivado' : 'Recordatorio reactivado',
              )
            }
            className="text-xs text-qc-textMuted hover:text-qc-textBody transition-colors disabled:opacity-50"
          >
            {reminder.isActive ? 'Desactivar' : 'Reactivar'}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              if (confirm('¿Eliminar este recordatorio?')) {
                run(() => deleteBookingReminder(reminder.id), 'Recordatorio eliminado');
              }
            }}
            className="text-xs text-qc-danger hover:text-red-300 transition-colors disabled:opacity-50"
          >
            Eliminar
          </button>
        </div>
      </div>

      {reminder.type === 'flow' ? (
        <input
          type="text"
          defaultValue={reminder.flowNs ?? ''}
          placeholder="flow_ns de ManyChat"
          onBlur={(e) => {
            const v = e.target.value.trim();
            if (v && v !== reminder.flowNs) save({ flow_ns: v }, 'Recordatorio actualizado');
          }}
          className="w-full bg-qc-bg border border-qc-borderHover rounded px-2 py-1 text-sm text-qc-textBody focus:border-qc-teal500 focus:outline-none"
        />
      ) : (
        <textarea
          rows={2}
          defaultValue={reminder.textTemplate ?? ''}
          placeholder="Texto del recordatorio. Ej: «Hola {{name}}, te espero {{start_time}} 🙌»"
          onBlur={(e) => {
            const v = e.target.value.trim();
            if (v && v !== reminder.textTemplate)
              save({ text_template: v }, 'Recordatorio actualizado');
          }}
          className="w-full bg-qc-bg border border-qc-borderHover rounded px-2 py-1 text-sm text-qc-textBody focus:border-qc-teal500 focus:outline-none"
        />
      )}
    </div>
  );
}

function AddReminderForm({ tenantId, run, busy }: { tenantId: string; run: Run; busy: boolean }) {
  const [amount, setAmount] = useState(24);
  const [unit, setUnit] = useState<'hours' | 'minutes'>('hours');
  const [when, setWhen] = useState<'before' | 'after'>('before');
  const [kind, setKind] = useState<'reminder' | 'no_show'>('reminder');
  const [type, setType] = useState<'text' | 'flow'>('text');
  const [body, setBody] = useState('');

  function handleAdd() {
    const value = unit === 'hours' ? amount * 60 : amount;
    const offset = when === 'before' ? -value : value;
    const trimmed = body.trim();
    if (!trimmed) {
      toast(type === 'flow' ? 'Indica el flow_ns' : 'Escribe el texto del recordatorio', false);
      return;
    }
    setBody('');
    run(
      () =>
        createBookingReminder(tenantId, {
          offset_minutes: offset,
          kind,
          type,
          ...(type === 'flow' ? { flow_ns: trimmed } : { text_template: trimmed }),
        }),
      'Recordatorio creado',
    );
  }

  return (
    <div className="border-t border-qc-border pt-5 space-y-3">
      <h3 className="text-sm font-semibold text-white">Añadir recordatorio</h3>
      <div className="flex flex-wrap items-end gap-2">
        <label className="block">
          <span className="block text-xs text-qc-textSubtle mb-1">Cantidad</span>
          <input
            type="number"
            min={0}
            value={amount}
            onChange={(e) => setAmount(Number(e.target.value))}
            className="w-20 bg-qc-bg border border-qc-borderHover rounded px-2 py-1.5 text-sm text-qc-textBody focus:border-qc-teal500 focus:outline-none"
          />
        </label>
        <Select
          label="Unidad"
          value={unit}
          onChange={(v) => setUnit(v as 'hours' | 'minutes')}
          options={[
            ['hours', 'horas'],
            ['minutes', 'minutos'],
          ]}
        />
        <Select
          label="Cuándo"
          value={when}
          onChange={(v) => setWhen(v as 'before' | 'after')}
          options={[
            ['before', 'antes de la cita'],
            ['after', 'después de la cita'],
          ]}
        />
        <Select
          label="Tipo"
          value={kind}
          onChange={(v) => setKind(v as 'reminder' | 'no_show')}
          options={[
            ['reminder', 'recordatorio'],
            ['no_show', 'no-show'],
          ]}
        />
        <Select
          label="Formato"
          value={type}
          onChange={(v) => setType(v as 'text' | 'flow')}
          options={[
            ['text', 'texto'],
            ['flow', 'flow'],
          ]}
        />
      </div>
      <textarea
        rows={2}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder={
          type === 'flow'
            ? 'flow_ns de ManyChat'
            : 'Texto. Ej: «Hola {{name}}, te recuerdo tu llamada {{start_time}}»'
        }
        className="w-full max-w-2xl bg-qc-bg border border-qc-borderHover rounded px-2 py-1.5 text-sm text-qc-textBody focus:border-qc-teal500 focus:outline-none"
      />
      <button
        type="button"
        onClick={handleAdd}
        disabled={busy || !body.trim()}
        className="px-3 py-1.5 bg-qc-teal700 hover:bg-qc-teal500 text-white text-sm rounded transition-colors disabled:opacity-50"
      >
        + Añadir recordatorio
      </button>
    </div>
  );
}

function Select({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: [string, string][];
}) {
  return (
    <label className="block">
      <span className="block text-xs text-qc-textSubtle mb-1">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="bg-qc-bg border border-qc-borderHover rounded px-2 py-1.5 text-sm text-qc-textBody focus:border-qc-teal500 focus:outline-none"
      >
        {options.map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </select>
    </label>
  );
}
