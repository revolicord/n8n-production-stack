'use client';

import {
  createTransition,
  deleteTransition,
  updateTransition,
} from '@/app/(dashboard)/settings/_actions/transitions';
import { toast } from '@/components/settings/ToastHost';
import type { StageOption, TransitionRuleRow } from '@/lib/stage-transitions';
import { useState, useTransition } from 'react';

type Run = (
  action: () => Promise<{ ok: true } | { ok: false; error: string }>,
  okMsg?: string,
) => void;

interface Props {
  tenantId: string;
  transitions: TransitionRuleRow[];
  stages: StageOption[];
}

export function TransitionsEditor({ tenantId, transitions, stages }: Props) {
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
        <h2 className="text-base font-semibold text-white mb-1">Transiciones de etapa</h2>
        <p className="text-qc-textSubtle text-sm">
          Cada regla le dice al agente cuándo puede mover un lead de una etapa a otra. El campo
          <span className="text-qc-textBody"> «cuándo usar»</span> se inyecta literal en el prompt
          como instrucción de routing.
        </p>
      </div>

      <div className="space-y-3">
        {transitions.length === 0 ? (
          <p className="text-qc-textSubtle text-sm">Aún no hay reglas de transición.</p>
        ) : (
          transitions.map((t) => (
            <TransitionCard key={t.id} transition={t} run={run} busy={isPending} />
          ))
        )}
      </div>

      {stages.length < 1 ? (
        <p className="text-qc-textSubtle text-sm border-t border-qc-border pt-5">
          Crea etapas en la pestaña «Etapas» antes de definir transiciones.
        </p>
      ) : (
        <AddTransitionForm tenantId={tenantId} stages={stages} run={run} busy={isPending} />
      )}
    </div>
  );
}

function StageBadge({ slug }: { slug: string }) {
  return (
    <span className="font-mono text-xs px-2 py-0.5 rounded bg-qc-bg border border-qc-borderHover text-qc-textBody">
      {slug}
    </span>
  );
}

interface CardProps {
  transition: TransitionRuleRow;
  run: Run;
  busy: boolean;
}

function TransitionCard({ transition, run, busy }: CardProps) {
  return (
    <div
      className={`bg-qc-surface border border-qc-border rounded-lg p-4 ${
        transition.isActive ? '' : 'opacity-60'
      }`}
    >
      <div className="flex items-center justify-between gap-2 mb-2">
        <div className="flex items-center gap-2 text-sm text-qc-textSubtle">
          De <StageBadge slug={transition.fromStageSlug} /> a{' '}
          <StageBadge slug={transition.toStageSlug} />
          {!transition.isActive && <span className="text-xs">(inactiva)</span>}
        </div>
        <div className="flex items-center gap-3">
          <button
            type="button"
            disabled={busy}
            onClick={() =>
              run(
                () => updateTransition(transition.id, { is_active: !transition.isActive }),
                transition.isActive ? 'Regla desactivada' : 'Regla reactivada',
              )
            }
            className="text-xs text-qc-textMuted hover:text-qc-textBody transition-colors disabled:opacity-50"
          >
            {transition.isActive ? 'Desactivar' : 'Reactivar'}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              if (confirm('¿Eliminar esta regla de transición?')) {
                run(() => deleteTransition(transition.id), 'Regla eliminada');
              }
            }}
            className="text-xs text-qc-danger hover:text-red-300 transition-colors disabled:opacity-50"
          >
            Eliminar
          </button>
        </div>
      </div>
      <textarea
        rows={2}
        defaultValue={transition.whenToUse}
        onBlur={(e) => {
          const v = e.target.value.trim();
          if (v && v !== transition.whenToUse) {
            run(() => updateTransition(transition.id, { when_to_use: v }), 'Regla actualizada');
          }
        }}
        className="w-full bg-qc-bg border border-qc-borderHover rounded px-2 py-1 text-sm text-qc-textBody focus:border-qc-teal500 focus:outline-none"
      />
    </div>
  );
}

interface AddProps {
  tenantId: string;
  stages: StageOption[];
  run: Run;
  busy: boolean;
}

function AddTransitionForm({ tenantId, stages, run, busy }: AddProps) {
  const [from, setFrom] = useState(stages[0]?.slug ?? '');
  const [to, setTo] = useState(stages[1]?.slug ?? stages[0]?.slug ?? '');
  const [whenToUse, setWhenToUse] = useState('');

  function handleAdd() {
    const when = whenToUse.trim();
    if (!from || !to || !when) {
      toast('Completa las etapas y el «cuándo usar»', false);
      return;
    }
    setWhenToUse('');
    run(
      () =>
        createTransition(tenantId, {
          from_stage_slug: from,
          to_stage_slug: to,
          when_to_use: when,
        }),
      'Regla creada',
    );
  }

  return (
    <div className="border-t border-qc-border pt-5 space-y-3">
      <h3 className="text-sm font-semibold text-white">Añadir transición</h3>
      <div className="flex flex-wrap items-end gap-2">
        <div className="block">
          <span className="block text-xs text-qc-textSubtle mb-1">De</span>
          <StageSelect value={from} onChange={setFrom} stages={stages} />
        </div>
        <div className="block">
          <span className="block text-xs text-qc-textSubtle mb-1">A</span>
          <StageSelect value={to} onChange={setTo} stages={stages} />
        </div>
      </div>
      <textarea
        rows={2}
        value={whenToUse}
        onChange={(e) => setWhenToUse(e.target.value)}
        placeholder="Cuándo usar esta transición, ej. «El intake está completo y la jurisdicción es válida»"
        className="w-full max-w-2xl bg-qc-bg border border-qc-borderHover rounded px-2 py-1.5 text-sm text-qc-textBody focus:border-qc-teal500 focus:outline-none"
      />
      <button
        type="button"
        onClick={handleAdd}
        disabled={busy || !whenToUse.trim()}
        className="px-3 py-1.5 bg-qc-teal700 hover:bg-qc-teal500 text-white text-sm rounded transition-colors disabled:opacity-50"
      >
        + Añadir transición
      </button>
    </div>
  );
}

function StageSelect({
  value,
  onChange,
  stages,
}: {
  value: string;
  onChange: (v: string) => void;
  stages: StageOption[];
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="bg-qc-bg border border-qc-borderHover rounded px-2 py-1.5 text-sm text-qc-textBody focus:border-qc-teal500 focus:outline-none"
    >
      {stages.map((s) => (
        <option key={s.slug} value={s.slug}>
          {s.slug} — {s.displayName}
        </option>
      ))}
    </select>
  );
}
