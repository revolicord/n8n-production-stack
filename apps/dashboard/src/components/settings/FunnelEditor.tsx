'use client';

import { createStage, deleteStage, updateStage } from '@/app/(dashboard)/settings/_actions/funnel';
import { toast } from '@/components/settings/ToastHost';
import { useState, useTransition } from 'react';

export type StageRow = {
  id: string;
  slug: string;
  displayName: string;
  description: string | null;
  goal: string | null;
  position: number;
  maxFollowups: number | null;
  isTerminal: boolean;
  isActive: boolean;
};

type Run = (
  action: () => Promise<{ ok: true } | { ok: false; error: string }>,
  okMsg?: string,
) => void;

interface Props {
  tenantId: string;
  stages: StageRow[];
}

export function FunnelEditor({ tenantId, stages }: Props) {
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
        <h2 className="text-base font-semibold text-white mb-1">Etapas del funnel</h2>
        <p className="text-qc-textSubtle text-sm">
          Cada etapa es una posición en el funnel. El <code>slug</code> se usa en las transiciones y
          no se puede cambiar tras crearlo. Una etapa terminal no recibe follow-ups.
        </p>
      </div>

      <div className="space-y-4">
        {stages.length === 0 ? (
          <p className="text-qc-textSubtle text-sm">Aún no hay etapas. Crea la primera abajo.</p>
        ) : (
          stages.map((s) => <StageCard key={s.id} stage={s} run={run} busy={isPending} />)
        )}
      </div>

      <AddStageForm tenantId={tenantId} run={run} busy={isPending} nextPosition={nextPos(stages)} />
    </div>
  );
}

function nextPos(stages: StageRow[]): number {
  return stages.reduce((max, s) => Math.max(max, s.position), 0) + 1;
}

interface CardProps {
  stage: StageRow;
  run: Run;
  busy: boolean;
}

function StageCard({ stage, run, busy }: CardProps) {
  return (
    <div
      className={`bg-qc-surface border border-qc-border rounded-lg p-4 ${
        stage.isActive ? '' : 'opacity-60'
      }`}
    >
      <div className="flex items-center justify-between gap-2 mb-3">
        <div className="flex items-center gap-2">
          <span className="font-mono text-xs px-2 py-0.5 rounded bg-qc-bg border border-qc-borderHover text-qc-textBody">
            {stage.slug}
          </span>
          {stage.isTerminal && (
            <span className="text-xs px-2 py-0.5 rounded bg-qc-bg border border-qc-borderHover text-qc-textSubtle">
              No recibe follow-ups
            </span>
          )}
          {!stage.isActive && <span className="text-xs text-qc-textSubtle">(inactiva)</span>}
        </div>
        <div className="flex items-center gap-3">
          <button
            type="button"
            disabled={busy}
            onClick={() =>
              run(
                () => updateStage(stage.id, { is_active: !stage.isActive }),
                stage.isActive ? 'Etapa desactivada' : 'Etapa reactivada',
              )
            }
            className="text-xs text-qc-textMuted hover:text-qc-textBody transition-colors disabled:opacity-50"
          >
            {stage.isActive ? 'Desactivar' : 'Reactivar'}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              if (confirm(`¿Eliminar la etapa ${stage.slug}?`)) {
                run(() => deleteStage(stage.id), 'Etapa eliminada');
              }
            }}
            className="text-xs text-qc-danger hover:text-red-300 transition-colors disabled:opacity-50"
          >
            Eliminar
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <Labeled label="Nombre visible">
          <input
            type="text"
            defaultValue={stage.displayName}
            onBlur={(e) => {
              const v = e.target.value.trim();
              if (v && v !== stage.displayName) {
                run(() => updateStage(stage.id, { display_name: v }), 'Nombre actualizado');
              }
            }}
            className="w-full bg-qc-bg border border-qc-borderHover rounded px-2 py-1 text-sm text-qc-textBody focus:border-qc-teal500 focus:outline-none"
          />
        </Labeled>
        <div className="grid grid-cols-2 gap-3">
          <Labeled label="Posición">
            <input
              type="number"
              defaultValue={stage.position}
              onBlur={(e) => {
                const v = Number(e.target.value);
                if (Number.isInteger(v) && v !== stage.position) {
                  run(() => updateStage(stage.id, { position: v }), 'Posición actualizada');
                }
              }}
              className="w-full bg-qc-bg border border-qc-borderHover rounded px-2 py-1 text-sm text-qc-textBody focus:border-qc-teal500 focus:outline-none"
            />
          </Labeled>
          <Labeled label="Máx. follow-ups">
            <input
              type="number"
              defaultValue={stage.maxFollowups ?? 0}
              onBlur={(e) => {
                const v = Number(e.target.value);
                if (Number.isInteger(v) && v !== (stage.maxFollowups ?? 0)) {
                  run(() => updateStage(stage.id, { max_followups: v }), 'Follow-ups actualizados');
                }
              }}
              className="w-full bg-qc-bg border border-qc-borderHover rounded px-2 py-1 text-sm text-qc-textBody focus:border-qc-teal500 focus:outline-none"
            />
          </Labeled>
        </div>
      </div>

      <Labeled label="Descripción" className="mt-3">
        <textarea
          rows={2}
          defaultValue={stage.description ?? ''}
          onBlur={(e) => {
            const v = e.target.value;
            if (v !== (stage.description ?? '')) {
              run(() => updateStage(stage.id, { description: v || null }));
            }
          }}
          className="w-full bg-qc-bg border border-qc-borderHover rounded px-2 py-1 text-sm text-qc-textBody focus:border-qc-teal500 focus:outline-none"
        />
      </Labeled>

      <Labeled label="Objetivo (goal)" className="mt-3">
        <textarea
          rows={2}
          defaultValue={stage.goal ?? ''}
          onBlur={(e) => {
            const v = e.target.value;
            if (v !== (stage.goal ?? '')) {
              run(() => updateStage(stage.id, { goal: v || null }));
            }
          }}
          className="w-full bg-qc-bg border border-qc-borderHover rounded px-2 py-1 text-sm text-qc-textBody focus:border-qc-teal500 focus:outline-none"
        />
      </Labeled>

      <label className="mt-3 flex items-center gap-2 text-sm text-qc-textBody">
        <input
          type="checkbox"
          defaultChecked={stage.isTerminal}
          onChange={(e) =>
            run(() => updateStage(stage.id, { is_terminal: e.target.checked }), 'Etapa actualizada')
          }
        />
        Etapa terminal (no recibe follow-ups, cancela los pendientes al llegar)
      </label>
    </div>
  );
}

interface AddProps {
  tenantId: string;
  run: Run;
  busy: boolean;
  nextPosition: number;
}

function AddStageForm({ tenantId, run, busy, nextPosition }: AddProps) {
  const [slug, setSlug] = useState('');
  const [displayName, setDisplayName] = useState('');

  function handleAdd() {
    const s = slug.trim();
    const name = displayName.trim();
    if (!s || !name) {
      toast('Slug y nombre son obligatorios', false);
      return;
    }
    setSlug('');
    setDisplayName('');
    run(
      () =>
        createStage(tenantId, {
          slug: s,
          display_name: name,
          position: nextPosition,
        }),
      'Etapa creada',
    );
  }

  return (
    <div className="border-t border-qc-border pt-5">
      <h3 className="text-sm font-semibold text-white mb-3">Añadir etapa</h3>
      <div className="flex flex-wrap items-end gap-2">
        <Labeled label="Slug">
          <input
            type="text"
            value={slug}
            onChange={(e) => setSlug(e.target.value)}
            placeholder="ej. calificado"
            className="w-40 bg-qc-bg border border-qc-borderHover rounded px-2 py-1.5 text-sm font-mono text-qc-textBody focus:border-qc-teal500 focus:outline-none"
          />
        </Labeled>
        <Labeled label="Nombre visible">
          <input
            type="text"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="ej. Calificado"
            className="w-56 bg-qc-bg border border-qc-borderHover rounded px-2 py-1.5 text-sm text-qc-textBody focus:border-qc-teal500 focus:outline-none"
          />
        </Labeled>
        <button
          type="button"
          onClick={handleAdd}
          disabled={busy || !slug.trim() || !displayName.trim()}
          className="px-3 py-1.5 bg-qc-teal700 hover:bg-qc-teal500 text-white text-sm rounded transition-colors disabled:opacity-50"
        >
          + Añadir etapa
        </button>
      </div>
    </div>
  );
}

function Labeled({
  label,
  children,
  className,
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`block ${className ?? ''}`}>
      <span className="block text-xs text-qc-textSubtle mb-1">{label}</span>
      {children}
    </div>
  );
}
