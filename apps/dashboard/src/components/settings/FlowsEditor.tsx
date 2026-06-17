'use client';

import {
  type SyncResult,
  approveFlow,
  deleteFlow,
  syncFlows,
  updateFlow,
} from '@/app/(dashboard)/settings/_actions/flows';
import { toast } from '@/components/settings/ToastHost';
import { useState, useTransition } from 'react';

export type StageOption = { id: string; displayName: string; slug: string };

export type FlowRow = {
  id: string;
  humanName: string | null;
  flowNs: string;
  contentDescription: string | null;
  usageCondition: string | null;
  mediaType: string | null;
  slugId: string | null;
  isActive: boolean | null;
  stageId: string | null;
  stageDisplayName: string | null;
  stageSlug: string | null;
  stagePosition: number | null;
  pendingNs: string | null;
  syncedAt: Date | null;
};

type Run = (
  action: () => Promise<{ ok: true } | { ok: false; error: string }>,
  okMsg?: string,
) => void;

interface Props {
  tenantId: string;
  flows: FlowRow[];
  stages: StageOption[];
}

const MEDIA_COLORS: Record<string, string> = {
  audio: 'bg-amber-900/40 text-amber-300 border-amber-700',
  video: 'bg-blue-900/40 text-blue-300 border-blue-700',
  img: 'bg-purple-900/40 text-purple-300 border-purple-700',
  image: 'bg-purple-900/40 text-purple-300 border-purple-700',
  text: 'bg-qc-bg text-qc-textBody border-qc-border',
  card: 'bg-green-900/40 text-green-300 border-green-700',
  sequence: 'bg-pink-900/40 text-pink-300 border-pink-700',
};

export function FlowsEditor({ tenantId, flows, stages }: Props) {
  const [isPending, startTransition] = useTransition();
  const [syncResult, setSyncResult] = useState<SyncResult | null>(null);

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

  function handleSync() {
    startTransition(async () => {
      const result = await syncFlows(tenantId);
      if (result.ok) {
        setSyncResult(result.data);
        const newCount = result.data.synced.length;
        toast(
          newCount > 0
            ? `${newCount} flujo${newCount !== 1 ? 's' : ''} sincronizado${newCount !== 1 ? 's' : ''} — revisa los pendientes`
            : 'Sin cambios (ManyChat y DB ya están sincronizados)',
        );
      } else {
        toast(result.error, false);
      }
    });
  }

  const pending = flows.filter((f) => f.pendingNs !== null);
  const active = flows.filter((f) => f.pendingNs === null);
  const grouped = groupByStage(active, stages);

  return (
    <div className="p-6 space-y-8">
      {/* Header + sync */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold text-white mb-1">Flujos ManyChat del agente</h2>
          <p className="text-qc-textSubtle text-sm max-w-2xl">
            Los flows se crean en ManyChat con la convención{' '}
            <code className="text-qc-textBody">
              QC_{'{ETAPA}'}_{'{MEDIA}'}_{'{DESC}'}
            </code>
            . Tras sincronizar, completa aquí la <b className="text-qc-textBody">Descripción</b> y
            la <b className="text-qc-textBody">Condición de uso</b> — ManyChat trunca los nombres
            largos, así que estos campos se editan en el panel.
          </p>
        </div>
        <button
          type="button"
          onClick={handleSync}
          disabled={isPending}
          className="shrink-0 px-4 py-2 bg-qc-teal700 hover:bg-qc-teal500 text-white text-sm font-medium rounded transition-colors disabled:opacity-50 whitespace-nowrap"
        >
          {isPending ? 'Sincronizando…' : '↻ Sync desde ManyChat'}
        </button>
      </div>

      {/* Sync result banner */}
      {syncResult && (
        <div className="bg-qc-surface border border-qc-border rounded-lg p-4 text-sm space-y-1">
          <p className="text-white font-medium">Resultado del último sync</p>
          <p className="text-qc-textSubtle">
            {syncResult.synced.length} procesado{syncResult.synced.length !== 1 ? 's' : ''} ·{' '}
            {syncResult.skipped.length} omitido{syncResult.skipped.length !== 1 ? 's' : ''} (nombre
            no cumple convención)
            {syncResult.pending_approval && ' · Pendientes de aprobación abajo'}
          </p>
          {syncResult.skipped.length > 0 && (
            <p className="text-qc-textSubtle text-xs font-mono mt-1">
              Omitidos: {syncResult.skipped.join(', ')}
            </p>
          )}
        </div>
      )}

      {/* Pending approvals */}
      {pending.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold text-amber-300 mb-3 flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-amber-400 inline-block" />
            Pendientes de aprobación ({pending.length})
          </h3>
          <div className="space-y-2">
            {pending.map((f) => (
              <PendingCard key={f.id} flow={f} run={run} busy={isPending} />
            ))}
          </div>
        </div>
      )}

      {/* Active flows grouped by stage */}
      {grouped.map(({ stage, flows: stageFlows }) => (
        <StageSection
          key={stage?.id ?? 'unassigned'}
          stage={stage}
          flows={stageFlows}
          run={run}
          busy={isPending}
        />
      ))}

      {active.length === 0 && pending.length === 0 && (
        <p className="text-qc-textSubtle text-sm text-center py-8">
          No hay flows registrados. Crea flows en ManyChat con el prefijo{' '}
          <code className="text-qc-textBody">QC_</code> y luego sincroniza.
        </p>
      )}
    </div>
  );
}

function groupByStage(flows: FlowRow[], stages: StageOption[]) {
  const map = new Map<string | null, FlowRow[]>();
  for (const f of flows) {
    const key = f.stageId ?? null;
    if (!map.has(key)) map.set(key, []);
    map.get(key)?.push(f);
  }

  const result: { stage: StageOption | null; flows: FlowRow[] }[] = [];
  for (const s of stages) {
    const sf = map.get(s.id);
    if (sf) {
      result.push({ stage: s, flows: sf });
      map.delete(s.id);
    }
  }
  const unassigned = map.get(null);
  if (unassigned && unassigned.length > 0) result.push({ stage: null, flows: unassigned });
  return result;
}

// ── Pending card ───────────────────────────────────────────────────────────────

interface PendingCardProps {
  flow: FlowRow;
  run: Run;
  busy: boolean;
}

function PendingCard({ flow, run, busy }: PendingCardProps) {
  return (
    <div className="bg-amber-950/30 border border-amber-800/50 rounded-lg px-4 py-3 flex items-center justify-between gap-4">
      <div className="min-w-0">
        <p className="text-sm text-white font-medium truncate">
          {flow.humanName ?? flow.pendingNs}
        </p>
        <p className="text-xs text-qc-textSubtle mt-0.5">
          ns pendiente: <code className="text-amber-300">{flow.pendingNs}</code>
          {flow.stageSlug && (
            <span className="ml-2 text-qc-textSubtle">etapa: {flow.stageSlug}</span>
          )}
          {flow.mediaType && <span className="ml-2 text-qc-textSubtle">{flow.mediaType}</span>}
        </p>
      </div>
      <button
        type="button"
        disabled={busy}
        onClick={() => run(() => approveFlow(flow.id), 'Flow aprobado y activado')}
        className="shrink-0 px-3 py-1.5 bg-amber-700 hover:bg-amber-600 text-white text-xs font-medium rounded transition-colors disabled:opacity-50"
      >
        Aprobar
      </button>
    </div>
  );
}

// ── Stage section ──────────────────────────────────────────────────────────────

interface StageSectionProps {
  stage: StageOption | null;
  flows: FlowRow[];
  run: Run;
  busy: boolean;
}

function StageSection({ stage, flows, run, busy }: StageSectionProps) {
  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        {stage ? (
          <>
            <span className="font-mono text-xs px-2 py-0.5 rounded bg-qc-bg border border-qc-borderHover text-qc-textBody">
              {stage.slug}
            </span>
            <span className="text-sm font-semibold text-white">{stage.displayName}</span>
          </>
        ) : (
          <span className="text-sm font-semibold text-qc-textSubtle">Sin etapa asignada</span>
        )}
        <span className="text-xs text-qc-textSubtle">
          ({flows.length} flujo{flows.length !== 1 ? 's' : ''})
        </span>
      </div>
      <div className="space-y-2">
        {flows.map((f) => (
          <FlowCard key={f.id} flow={f} run={run} busy={busy} />
        ))}
      </div>
    </div>
  );
}

// ── Flow card ──────────────────────────────────────────────────────────────────

interface FlowCardProps {
  flow: FlowRow;
  run: Run;
  busy: boolean;
}

function FlowCard({ flow, run, busy }: FlowCardProps) {
  const [expanded, setExpanded] = useState(false);
  const mediaColor = flow.mediaType
    ? (MEDIA_COLORS[flow.mediaType] ?? 'bg-qc-bg text-qc-textBody border-qc-border')
    : null;

  const needsDescription = !flow.contentDescription || !flow.usageCondition;

  return (
    <div
      className={`bg-qc-surface border rounded-lg ${
        needsDescription ? 'border-yellow-700/60' : 'border-qc-border'
      } ${flow.isActive === false ? 'opacity-50' : ''}`}
    >
      {/* Header */}
      <div className="flex items-center justify-between gap-2 px-4 py-3">
        <div className="flex items-center gap-2 min-w-0">
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="text-qc-textSubtle hover:text-white text-xs transition-colors shrink-0"
          >
            {expanded ? '▼' : '▶'}
          </button>
          <span className="text-sm text-qc-textBody font-medium truncate">
            {flow.humanName ?? flow.flowNs}
          </span>
          {flow.mediaType && mediaColor && (
            <span className={`shrink-0 text-xs px-1.5 py-0.5 rounded border ${mediaColor}`}>
              {flow.mediaType}
            </span>
          )}
          {needsDescription && (
            <span
              className="shrink-0 text-xs text-yellow-500"
              title="Falta descripción o condición"
            >
              ✎ completar
            </span>
          )}
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <button
            type="button"
            disabled={busy}
            onClick={() =>
              run(
                () => updateFlow(flow.id, { is_active: !(flow.isActive !== false) }),
                flow.isActive !== false ? 'Flujo desactivado' : 'Flujo reactivado',
              )
            }
            className="text-xs text-qc-textMuted hover:text-qc-textBody transition-colors disabled:opacity-50"
          >
            {flow.isActive !== false ? 'Desactivar' : 'Reactivar'}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              if (
                confirm(
                  `¿Eliminar "${flow.humanName ?? flow.flowNs}"? Esta acción no se puede deshacer.`,
                )
              ) {
                run(() => deleteFlow(flow.id), 'Flujo eliminado');
              }
            }}
            className="text-xs text-qc-danger hover:text-red-300 transition-colors disabled:opacity-50"
          >
            Eliminar
          </button>
        </div>
      </div>

      {/* Expanded */}
      {expanded && (
        <div className="border-t border-qc-border px-4 py-4 space-y-4">
          {/* Sección readonly — lo que vino de ManyChat */}
          <div className="bg-qc-bg rounded px-3 py-2 space-y-1">
            <p className="text-xs font-semibold text-qc-textSubtle uppercase tracking-wide mb-1">
              Desde ManyChat (solo lectura)
            </p>
            <p className="text-xs text-qc-textSubtle font-mono">
              <span className="text-qc-textMuted">nombre:</span>{' '}
              <span className="text-qc-textBody">{flow.humanName ?? '—'}</span>
              {flow.humanName && flow.humanName.length >= 60 && (
                <span className="ml-2 text-yellow-500" title="ManyChat truncó el nombre">
                  ⚠ truncado
                </span>
              )}
            </p>
            <p className="text-xs text-qc-textSubtle font-mono">
              <span className="text-qc-textMuted">ns:</span>{' '}
              <span className="text-qc-textBody">{flow.flowNs}</span>
            </p>
          </div>

          {/* Sección editable — lo que hay que completar en el panel */}
          <div className="space-y-3">
            <p className="text-xs font-semibold text-qc-textSubtle uppercase tracking-wide">
              Completar en el panel
            </p>

            <Labeled label="Descripción del contenido (para el LLM)">
              <textarea
                rows={3}
                defaultValue={flow.contentDescription ?? ''}
                onBlur={(e) => {
                  const v = e.target.value || null;
                  if (v !== (flow.contentDescription ?? null)) {
                    run(
                      () => updateFlow(flow.id, { content_description: v }),
                      'Descripción guardada',
                    );
                  }
                }}
                placeholder="ej: Audio testimonial de cliente que cerró en 3 días + link video YouTube de contenido de valor"
                className={textareaCls}
              />
            </Labeled>

            <Labeled label="Cuándo usarlo (condición de uso para el LLM)">
              <textarea
                rows={3}
                defaultValue={flow.usageCondition ?? ''}
                onBlur={(e) => {
                  const v = e.target.value || null;
                  if (v !== (flow.usageCondition ?? null)) {
                    run(() => updateFlow(flow.id, { usage_condition: v }), 'Condición guardada');
                  }
                }}
                placeholder="ej: Enviar después de confirmar el agendamiento, como cierre de la conversación de la etapa D"
                className={textareaCls}
              />
            </Labeled>

            <Labeled label="Identificador (Slug ID) (ej: booking_audio, v1, testimonial-pedro)">
              <input
                type="text"
                defaultValue={flow.slugId ?? ''}
                onBlur={(e) => {
                  const v = e.target.value.trim() || null;
                  if (v !== (flow.slugId ?? null)) {
                    run(() => updateFlow(flow.id, { slug_id: v }), 'Slug ID guardado');
                  }
                }}
                placeholder="ej: booking_audio"
                className="w-full bg-qc-bg border border-qc-borderHover rounded px-2 py-1.5 text-sm text-qc-textBody focus:border-qc-teal500 focus:outline-none"
              />
            </Labeled>
          </div>
        </div>
      )}
    </div>
  );
}

function Labeled({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <span className="block text-xs text-qc-textSubtle mb-1">{label}</span>
      {children}
    </div>
  );
}

const textareaCls =
  'w-full bg-qc-bg border border-qc-borderHover rounded px-2 py-1.5 text-sm text-qc-textBody focus:border-qc-teal500 focus:outline-none resize-y';
