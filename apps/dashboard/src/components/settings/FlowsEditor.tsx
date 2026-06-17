'use client';

import { createFlow, deleteFlow, updateFlow } from '@/app/(dashboard)/settings/_actions/flows';
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

const MEDIA_TYPES = [
  { value: '', label: 'Sin tipo' },
  { value: 'audio', label: 'Audio' },
  { value: 'video', label: 'Video' },
  { value: 'image', label: 'Imagen' },
  { value: 'text', label: 'Texto' },
  { value: 'card', label: 'Card' },
  { value: 'sequence', label: 'Secuencia' },
];

const MEDIA_COLORS: Record<string, string> = {
  audio: 'bg-amber-900/40 text-amber-300 border-amber-700',
  video: 'bg-blue-900/40 text-blue-300 border-blue-700',
  image: 'bg-purple-900/40 text-purple-300 border-purple-700',
  text: 'bg-qc-bg text-qc-textBody border-qc-border',
  card: 'bg-green-900/40 text-green-300 border-green-700',
  sequence: 'bg-pink-900/40 text-pink-300 border-pink-700',
};

export function FlowsEditor({ tenantId, flows, stages }: Props) {
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

  // Group flows by stage
  const grouped = groupByStage(flows, stages);

  return (
    <div className="p-6 space-y-8">
      <div>
        <h2 className="text-base font-semibold text-white mb-1">Flujos ManyChat del agente</h2>
        <p className="text-qc-textSubtle text-sm">
          Cada flujo es un nombre de namespace de ManyChat que el agente puede enviar. El{' '}
          <code className="text-qc-textBody">flow_ns</code> debe coincidir exactamente con el nombre
          en ManyChat. El LLM usa <b>Descripción</b> para saber qué contiene y <b>Condición</b> para
          decidir cuándo enviarlo.
        </p>
      </div>

      {grouped.map(({ stage, flows: stageFlows }) => (
        <StageSection
          key={stage?.id ?? 'unassigned'}
          stage={stage}
          flows={stageFlows}
          run={run}
          busy={isPending}
        />
      ))}

      <div className="border-t border-qc-border pt-6">
        <h3 className="text-sm font-semibold text-white mb-4">Agregar nuevo flujo</h3>
        <AddFlowForm tenantId={tenantId} stages={stages} run={run} busy={isPending} />
      </div>
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

  // Add stages in order (only those with flows)
  for (const s of stages) {
    const stageFlows = map.get(s.id);
    if (stageFlows) {
      result.push({ stage: s, flows: stageFlows });
      map.delete(s.id);
    }
  }

  // Unassigned flows at the end
  const unassigned = map.get(null);
  if (unassigned && unassigned.length > 0) {
    result.push({ stage: null, flows: unassigned });
  }

  // Any remaining (stage deleted but flows still exist)
  for (const [, orphaned] of map) {
    if (orphaned.length > 0) result.push({ stage: null, flows: orphaned });
  }

  return result;
}

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
      <div className="space-y-3">
        {flows.map((f) => (
          <FlowCard key={f.id} flow={f} run={run} busy={busy} />
        ))}
      </div>
    </div>
  );
}

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

  return (
    <div
      className={`bg-qc-surface border border-qc-border rounded-lg ${flow.isActive === false ? 'opacity-50' : ''}`}
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
          <code className="shrink-0 text-xs px-1.5 py-0.5 rounded bg-qc-bg border border-qc-border text-qc-textSubtle hidden sm:inline">
            {flow.flowNs}
          </code>
          {flow.mediaType && mediaColor && (
            <span className={`shrink-0 text-xs px-1.5 py-0.5 rounded border ${mediaColor}`}>
              {flow.mediaType}
            </span>
          )}
          {flow.slugId && (
            <span className="shrink-0 text-xs text-qc-textSubtle hidden md:inline">
              #{flow.slugId}
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
                  `¿Eliminar el flujo "${flow.humanName ?? flow.flowNs}"? Esta acción no se puede deshacer.`,
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

      {/* Expanded edit form */}
      {expanded && (
        <div className="border-t border-qc-border px-4 py-4 space-y-3">
          <Labeled label="Nombre visible">
            <input
              type="text"
              defaultValue={flow.humanName ?? ''}
              onBlur={(e) => {
                const v = e.target.value.trim();
                if (v && v !== (flow.humanName ?? '')) {
                  run(() => updateFlow(flow.id, { human_name: v }), 'Nombre actualizado');
                }
              }}
              className={inputCls}
            />
          </Labeled>

          <div className="grid grid-cols-2 gap-3">
            <Labeled label="Tipo de media">
              <select
                defaultValue={flow.mediaType ?? ''}
                onChange={(e) => {
                  const v = e.target.value || null;
                  run(() => updateFlow(flow.id, { media_type: v }), 'Tipo actualizado');
                }}
                className={inputCls}
              >
                {MEDIA_TYPES.map((mt) => (
                  <option key={mt.value} value={mt.value}>
                    {mt.label}
                  </option>
                ))}
              </select>
            </Labeled>
            <Labeled label="Slug ID">
              <input
                type="text"
                defaultValue={flow.slugId ?? ''}
                onBlur={(e) => {
                  const v = e.target.value.trim() || null;
                  if (v !== (flow.slugId ?? null)) {
                    run(() => updateFlow(flow.id, { slug_id: v }), 'Slug actualizado');
                  }
                }}
                placeholder="ej: content_audio_d"
                className={inputCls}
              />
            </Labeled>
          </div>

          <Labeled label="Qué contiene este flujo (descripción del contenido)">
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
              className={textareaCls}
            />
          </Labeled>

          <Labeled label="Instrucciones para el LLM (cuándo y cómo usarlo)">
            <textarea
              rows={4}
              defaultValue={flow.usageCondition ?? ''}
              onBlur={(e) => {
                const v = e.target.value || null;
                if (v !== (flow.usageCondition ?? null)) {
                  run(() => updateFlow(flow.id, { usage_condition: v }), 'Condición guardada');
                }
              }}
              className={textareaCls}
            />
          </Labeled>
        </div>
      )}
    </div>
  );
}

interface AddFlowFormProps {
  tenantId: string;
  stages: StageOption[];
  run: Run;
  busy: boolean;
}

function AddFlowForm({ tenantId, stages, run, busy }: AddFlowFormProps) {
  const [stageId, setStageId] = useState('');
  const [flowNs, setFlowNs] = useState('');
  const [humanName, setHumanName] = useState('');
  const [mediaType, setMediaType] = useState('');
  const [slugId, setSlugId] = useState('');
  const [contentDescription, setContentDescription] = useState('');
  const [usageCondition, setUsageCondition] = useState('');
  const [open, setOpen] = useState(false);

  function handleAdd() {
    const ns = flowNs.trim();
    const name = humanName.trim();
    if (!ns || !name || !stageId) {
      toast('Etapa, namespace y nombre son obligatorios', false);
      return;
    }
    run(
      () =>
        createFlow(tenantId, {
          stage_id: stageId,
          flow_ns: ns,
          human_name: name,
          media_type: mediaType || null,
          slug_id: slugId.trim() || null,
          content_description: contentDescription.trim() || null,
          usage_condition: usageCondition.trim() || null,
        }),
      'Flujo creado',
    );
    setFlowNs('');
    setHumanName('');
    setMediaType('');
    setSlugId('');
    setContentDescription('');
    setUsageCondition('');
    setOpen(false);
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="px-3 py-1.5 bg-qc-teal700 hover:bg-qc-teal500 text-white text-sm rounded transition-colors"
      >
        + Agregar flujo
      </button>
    );
  }

  return (
    <div className="bg-qc-surface border border-qc-border rounded-lg p-4 space-y-3 max-w-2xl">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Labeled label="Etapa *">
          <select value={stageId} onChange={(e) => setStageId(e.target.value)} className={inputCls}>
            <option value="">-- Selecciona --</option>
            {stages.map((s) => (
              <option key={s.id} value={s.id}>
                {s.displayName} ({s.slug})
              </option>
            ))}
          </select>
        </Labeled>
        <Labeled label="Namespace ManyChat (flow_ns) *">
          <input
            type="text"
            value={flowNs}
            onChange={(e) => setFlowNs(e.target.value)}
            placeholder="qc_nombre_del_flujo"
            className={inputCls}
          />
        </Labeled>
        <Labeled label="Nombre visible *">
          <input
            type="text"
            value={humanName}
            onChange={(e) => setHumanName(e.target.value)}
            placeholder="ej: Audio testimonial + video YouTube"
            className={inputCls}
          />
        </Labeled>
        <Labeled label="Tipo de media">
          <select
            value={mediaType}
            onChange={(e) => setMediaType(e.target.value)}
            className={inputCls}
          >
            {MEDIA_TYPES.map((mt) => (
              <option key={mt.value} value={mt.value}>
                {mt.label}
              </option>
            ))}
          </select>
        </Labeled>
        <Labeled label="Slug ID">
          <input
            type="text"
            value={slugId}
            onChange={(e) => setSlugId(e.target.value)}
            placeholder="ej: content_audio_d"
            className={inputCls}
          />
        </Labeled>
      </div>

      <Labeled label="Descripción del contenido">
        <textarea
          rows={3}
          value={contentDescription}
          onChange={(e) => setContentDescription(e.target.value)}
          placeholder="Qué contiene este flujo de ManyChat..."
          className={textareaCls}
        />
      </Labeled>

      <Labeled label="Instrucciones para el LLM (cuándo usarlo)">
        <textarea
          rows={4}
          value={usageCondition}
          onChange={(e) => setUsageCondition(e.target.value)}
          placeholder="El agente debe enviar este flujo cuando..."
          className={textareaCls}
        />
      </Labeled>

      <div className="flex items-center gap-2 pt-1">
        <button
          type="button"
          onClick={handleAdd}
          disabled={busy || !flowNs.trim() || !humanName.trim() || !stageId}
          className="px-3 py-1.5 bg-qc-teal700 hover:bg-qc-teal500 text-white text-sm rounded transition-colors disabled:opacity-50"
        >
          Crear flujo
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="text-sm text-qc-textMuted hover:text-qc-textBody transition-colors"
        >
          Cancelar
        </button>
      </div>
    </div>
  );
}

function Labeled({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <span className="block text-xs text-qc-textSubtle mb-1">{label}</span>
      {children}
    </div>
  );
}

const inputCls =
  'w-full bg-qc-bg border border-qc-borderHover rounded px-2 py-1.5 text-sm text-qc-textBody focus:border-qc-teal500 focus:outline-none';

const textareaCls =
  'w-full bg-qc-bg border border-qc-borderHover rounded px-2 py-1.5 text-sm text-qc-textBody focus:border-qc-teal500 focus:outline-none resize-y';
