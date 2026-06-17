'use client';

import {
  createCascade,
  deleteCascade,
  updateCascade,
} from '@/app/(dashboard)/settings/_actions/cascades';
import { toast } from '@/components/settings/ToastHost';
import type { FlowDefinitionRow, StageFlowOption } from '@/lib/flow-definitions';
import type { StageOption } from '@/lib/stage-transitions';
import { type FlowDefinition, FlowDefinitionSchema } from '@dm-api/shared';
import { useState, useTransition } from 'react';

// ── Modelo de UI simplificado (se serializa a FlowDefinition al guardar) ──────

type StepConfig =
  | { kind: 'send_content'; slug_id: string }
  | { kind: 'reply_text'; text: string }
  | { kind: 'change_stage'; to_stage: string };

// uid estable para el key de React (los pasos se reordenan).
type BuilderStep = StepConfig & { uid: string };

let stepCounter = 0;
function newUid(): string {
  stepCounter += 1;
  return `step_${stepCounter}_${Date.now()}`;
}

type BuilderTrigger =
  | { kind: 'llm'; description: string }
  | { kind: 'stage_transition'; from: string; to: string }
  | { kind: 'system' };

type BuilderCascade = {
  rowId: string | null; // id de flow_definitions cuando se edita uno existente
  flowId: string;
  name: string;
  description: string;
  trigger: BuilderTrigger;
  steps: BuilderStep[];
};

function slugifyFlowId(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function emptyCascade(): BuilderCascade {
  return {
    rowId: null,
    flowId: '',
    name: '',
    description: '',
    trigger: { kind: 'llm', description: '' },
    steps: [],
  };
}

// ── Deserialización de un FlowDefinition existente al modelo de UI ────────────

function fromFlowDefinition(rowId: string, def: FlowDefinition): BuilderCascade {
  const steps: BuilderStep[] = [];
  for (const step of def.steps) {
    if (step.type !== 'action') continue;
    if (step.action === 'send_content') {
      steps.push({
        kind: 'send_content',
        slug_id: String(step.config.slug_id ?? ''),
        uid: newUid(),
      });
    } else if (step.action === 'reply_text') {
      steps.push({ kind: 'reply_text', text: String(step.config.text ?? ''), uid: newUid() });
    } else if (step.action === 'change_stage') {
      steps.push({
        kind: 'change_stage',
        to_stage: String(step.config.to_stage ?? ''),
        uid: newUid(),
      });
    }
  }
  const trigger: BuilderTrigger =
    def.trigger.type === 'llm'
      ? { kind: 'llm', description: def.trigger.description }
      : def.trigger.type === 'stage_transition'
        ? { kind: 'stage_transition', from: def.trigger.from, to: def.trigger.to }
        : { kind: 'system' };

  return {
    rowId,
    flowId: def.flow_id,
    name: def.name,
    description: def.description ?? '',
    trigger,
    steps,
  };
}

// ── Componente principal ──────────────────────────────────────────────────────

interface Props {
  tenantId: string;
  flows: FlowDefinitionRow[];
  stages: StageOption[];
  stageFlows: StageFlowOption[];
}

export function CascadesEditor({ tenantId, flows, stages, stageFlows }: Props) {
  const [draft, setDraft] = useState<BuilderCascade | null>(null);
  const [isPending, startTransition] = useTransition();

  const parsedFlows = flows
    .map((f) => {
      const parsed = FlowDefinitionSchema.safeParse(f.definition);
      return parsed.success ? { row: f, def: parsed.data } : null;
    })
    .filter((x): x is { row: FlowDefinitionRow; def: FlowDefinition } => x !== null);

  function save() {
    if (!draft) return;
    const flowId = draft.rowId ? draft.flowId : slugifyFlowId(draft.name);
    if (!draft.name.trim()) {
      toast('El nombre es obligatorio', false);
      return;
    }
    if (!flowId) {
      toast('El nombre debe producir un identificador válido (letras/números)', false);
      return;
    }
    if (draft.steps.length === 0) {
      toast('Añade al menos un paso', false);
      return;
    }
    const candidate: BuilderCascade = { ...draft, flowId };
    // validación rápida en cliente antes del round-trip
    const result = FlowDefinitionSchema.safeParse(buildPlain(candidate));
    if (!result.success) {
      toast(result.error.issues[0]?.message ?? 'Cascada inválida', false);
      return;
    }
    const definition = result.data;
    startTransition(async () => {
      const res = draft.rowId
        ? await updateCascade(draft.rowId, definition)
        : await createCascade(tenantId, definition);
      if (res.ok) {
        toast(draft.rowId ? 'Cascada actualizada' : 'Cascada creada');
        setDraft(null);
      } else {
        toast(res.error, false);
      }
    });
  }

  function remove(rowId: string) {
    if (!confirm('¿Eliminar esta cascada?')) return;
    startTransition(async () => {
      const res = await deleteCascade(rowId);
      if (res.ok) toast('Cascada eliminada');
      else toast(res.error, false);
    });
  }

  return (
    <div className="p-6 space-y-6">
      <div>
        <h2 className="text-base font-semibold text-white mb-1">Cascadas</h2>
        <p className="text-qc-textSubtle text-sm">
          Una cascada es un flujo declarativo de pasos que el agente ejecuta de forma determinista
          (enviar contenido, responder texto, avanzar de etapa).
        </p>
      </div>

      <div className="space-y-3">
        {parsedFlows.length === 0 ? (
          <p className="text-qc-textSubtle text-sm">Aún no hay cascadas.</p>
        ) : (
          parsedFlows.map(({ row, def }) => (
            <div
              key={row.id}
              className="bg-qc-surface border border-qc-border rounded-lg p-4 flex items-start justify-between gap-3"
            >
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-white">{def.name}</span>
                  <span className="font-mono text-xs px-2 py-0.5 rounded bg-qc-bg border border-qc-borderHover text-qc-textSubtle">
                    {def.flow_id} · v{row.version}
                  </span>
                </div>
                <p className="text-xs text-qc-textSubtle mt-1">
                  Disparo: {triggerLabel(def)} · {def.steps.length} paso(s)
                </p>
              </div>
              <div className="flex items-center gap-3 shrink-0">
                <button
                  type="button"
                  disabled={isPending}
                  onClick={() => setDraft(fromFlowDefinition(row.id, def))}
                  className="text-xs text-qc-textMuted hover:text-qc-textBody transition-colors disabled:opacity-50"
                >
                  Editar
                </button>
                <button
                  type="button"
                  disabled={isPending}
                  onClick={() => remove(row.id)}
                  className="text-xs text-qc-danger hover:text-red-300 transition-colors disabled:opacity-50"
                >
                  Eliminar
                </button>
              </div>
            </div>
          ))
        )}
      </div>

      {draft ? (
        <CascadeBuilder
          draft={draft}
          setDraft={setDraft}
          stages={stages}
          stageFlows={stageFlows}
          onSave={save}
          onCancel={() => setDraft(null)}
          busy={isPending}
        />
      ) : (
        <button
          type="button"
          onClick={() => setDraft(emptyCascade())}
          className="px-3 py-1.5 bg-qc-teal700 hover:bg-qc-teal500 text-white text-sm rounded transition-colors"
        >
          + Nueva cascada
        </button>
      )}
    </div>
  );
}

function triggerLabel(def: FlowDefinition): string {
  if (def.trigger.type === 'llm') return 'LLM';
  if (def.trigger.type === 'stage_transition') return `${def.trigger.from} → ${def.trigger.to}`;
  return 'sistema';
}

// Convierte el BuilderCascade a la forma plana que valida FlowDefinitionSchema.
function buildPlain(c: BuilderCascade): unknown {
  const steps = c.steps.map((s, i) => {
    const id = `s${i + 1}`;
    const next = i < c.steps.length - 1 ? `s${i + 2}` : undefined;
    const base = next ? { id, next } : { id };
    if (s.kind === 'send_content')
      return { ...base, type: 'action', action: 'send_content', config: { slug_id: s.slug_id } };
    if (s.kind === 'reply_text')
      return { ...base, type: 'action', action: 'reply_text', config: { text: s.text } };
    return {
      ...base,
      type: 'action',
      action: 'change_stage',
      config: { to_stage: s.to_stage, evidence: `cascada:${c.flowId}` },
    };
  });
  const trigger =
    c.trigger.kind === 'llm'
      ? { type: 'llm', description: c.trigger.description }
      : c.trigger.kind === 'stage_transition'
        ? { type: 'stage_transition', from: c.trigger.from, to: c.trigger.to }
        : { type: 'system' };
  return {
    flow_id: c.flowId,
    name: c.name,
    description: c.description || undefined,
    trigger,
    slots: [],
    steps,
  };
}

// ── Builder ───────────────────────────────────────────────────────────────────

interface BuilderProps {
  draft: BuilderCascade;
  setDraft: (c: BuilderCascade) => void;
  stages: StageOption[];
  stageFlows: StageFlowOption[];
  onSave: () => void;
  onCancel: () => void;
  busy: boolean;
}

function CascadeBuilder({
  draft,
  setDraft,
  stages,
  stageFlows,
  onSave,
  onCancel,
  busy,
}: BuilderProps) {
  const isEditing = draft.rowId !== null;

  function patch(p: Partial<BuilderCascade>) {
    setDraft({ ...draft, ...p });
  }

  function setStep(idx: number, config: StepConfig) {
    patch({
      steps: draft.steps.map((s, i) => (i === idx ? { ...config, uid: s.uid } : s)),
    });
  }

  function addStep(kind: StepConfig['kind']) {
    const config: StepConfig =
      kind === 'send_content'
        ? { kind, slug_id: stageFlows[0]?.slugId ?? '' }
        : kind === 'reply_text'
          ? { kind, text: '' }
          : { kind, to_stage: stages[0]?.slug ?? '' };
    patch({ steps: [...draft.steps, { ...config, uid: newUid() }] });
  }

  function removeStep(idx: number) {
    patch({ steps: draft.steps.filter((_, i) => i !== idx) });
  }

  function moveStep(idx: number, dir: -1 | 1) {
    const j = idx + dir;
    if (j < 0 || j >= draft.steps.length) return;
    const copy = [...draft.steps];
    const a = copy[idx];
    const b = copy[j];
    if (!a || !b) return;
    copy[idx] = b;
    copy[j] = a;
    patch({ steps: copy });
  }

  return (
    <div className="border-t border-qc-border pt-5 space-y-4">
      <h3 className="text-sm font-semibold text-white">
        {isEditing ? `Editar cascada (${draft.flowId})` : 'Nueva cascada'}
      </h3>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 max-w-2xl">
        <label className="block">
          <span className="block text-xs text-qc-textSubtle mb-1">Nombre</span>
          <input
            type="text"
            value={draft.name}
            onChange={(e) => patch({ name: e.target.value })}
            placeholder="ej. Enviar VSL y avanzar"
            className="w-full bg-qc-bg border border-qc-borderHover rounded px-2 py-1.5 text-sm text-qc-textBody focus:border-qc-teal500 focus:outline-none"
          />
          {!isEditing && draft.name.trim() && (
            <span className="block text-xs text-qc-textSubtle mt-1 font-mono">
              id: {slugifyFlowId(draft.name) || '—'}
            </span>
          )}
        </label>
        <label className="block">
          <span className="block text-xs text-qc-textSubtle mb-1">Descripción (opcional)</span>
          <input
            type="text"
            value={draft.description}
            onChange={(e) => patch({ description: e.target.value })}
            className="w-full bg-qc-bg border border-qc-borderHover rounded px-2 py-1.5 text-sm text-qc-textBody focus:border-qc-teal500 focus:outline-none"
          />
        </label>
      </div>

      <TriggerEditor
        trigger={draft.trigger}
        stages={stages}
        onChange={(t) => patch({ trigger: t })}
      />

      <div className="space-y-2">
        <span className="block text-xs text-qc-textSubtle">Pasos (se ejecutan en orden)</span>
        {draft.steps.length === 0 && (
          <p className="text-xs text-qc-textSubtle">Sin pasos todavía.</p>
        )}
        {draft.steps.map((step, idx) => (
          <StepRow
            key={step.uid}
            step={step}
            stages={stages}
            stageFlows={stageFlows}
            onChange={(s) => setStep(idx, s)}
            onUp={() => moveStep(idx, -1)}
            onDown={() => moveStep(idx, 1)}
            onRemove={() => removeStep(idx)}
            isFirst={idx === 0}
            isLast={idx === draft.steps.length - 1}
          />
        ))}
        <div className="flex flex-wrap gap-2 pt-1">
          <AddStepButton label="+ Enviar contenido" onClick={() => addStep('send_content')} />
          <AddStepButton label="+ Responder texto" onClick={() => addStep('reply_text')} />
          <AddStepButton label="+ Cambiar etapa" onClick={() => addStep('change_stage')} />
        </div>
      </div>

      <div className="flex items-center gap-2 pt-2">
        <button
          type="button"
          onClick={onSave}
          disabled={busy}
          className="px-4 py-2 bg-qc-teal700 hover:bg-qc-teal500 text-white text-sm rounded transition-colors disabled:opacity-50"
        >
          {busy ? 'Guardando…' : 'Guardar cascada'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={busy}
          className="px-4 py-2 text-qc-textMuted hover:text-qc-textBody text-sm transition-colors disabled:opacity-50"
        >
          Cancelar
        </button>
      </div>
    </div>
  );
}

function AddStepButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="text-xs px-2 py-1 rounded bg-qc-bg border border-qc-borderHover text-qc-textMuted hover:text-qc-textBody hover:border-qc-teal500 transition-colors"
    >
      {label}
    </button>
  );
}

function TriggerEditor({
  trigger,
  stages,
  onChange,
}: {
  trigger: BuilderTrigger;
  stages: StageOption[];
  onChange: (t: BuilderTrigger) => void;
}) {
  return (
    <div className="space-y-2 max-w-2xl">
      <span className="block text-xs text-qc-textSubtle">Disparo</span>
      <select
        value={trigger.kind}
        onChange={(e) => {
          const kind = e.target.value as BuilderTrigger['kind'];
          if (kind === 'llm') onChange({ kind: 'llm', description: '' });
          else if (kind === 'stage_transition')
            onChange({
              kind: 'stage_transition',
              from: stages[0]?.slug ?? '',
              to: stages[1]?.slug ?? stages[0]?.slug ?? '',
            });
          else onChange({ kind: 'system' });
        }}
        className="bg-qc-bg border border-qc-borderHover rounded px-2 py-1.5 text-sm text-qc-textBody focus:border-qc-teal500 focus:outline-none"
      >
        <option value="llm">El LLM la inicia</option>
        <option value="stage_transition">Al cambiar de etapa</option>
        <option value="system">Sistema</option>
      </select>

      {trigger.kind === 'llm' && (
        <textarea
          rows={2}
          value={trigger.description}
          onChange={(e) => onChange({ kind: 'llm', description: e.target.value })}
          placeholder="Cuándo debe el LLM iniciar esta cascada"
          className="w-full bg-qc-bg border border-qc-borderHover rounded px-2 py-1.5 text-sm text-qc-textBody focus:border-qc-teal500 focus:outline-none"
        />
      )}
      {trigger.kind === 'stage_transition' && (
        <div className="flex items-end gap-2">
          <div className="block">
            <span className="block text-xs text-qc-textSubtle mb-1">De</span>
            <StageSelect
              value={trigger.from}
              onChange={(v) => onChange({ ...trigger, from: v })}
              stages={stages}
            />
          </div>
          <div className="block">
            <span className="block text-xs text-qc-textSubtle mb-1">A</span>
            <StageSelect
              value={trigger.to}
              onChange={(v) => onChange({ ...trigger, to: v })}
              stages={stages}
            />
          </div>
        </div>
      )}
    </div>
  );
}

function StepRow({
  step,
  stages,
  stageFlows,
  onChange,
  onUp,
  onDown,
  onRemove,
  isFirst,
  isLast,
}: {
  step: BuilderStep;
  stages: StageOption[];
  stageFlows: StageFlowOption[];
  onChange: (s: StepConfig) => void;
  onUp: () => void;
  onDown: () => void;
  onRemove: () => void;
  isFirst: boolean;
  isLast: boolean;
}) {
  return (
    <div className="bg-qc-surface border border-qc-border rounded-lg p-3 flex items-start gap-3">
      <div className="flex flex-col gap-1 pt-1">
        <button
          type="button"
          onClick={onUp}
          disabled={isFirst}
          className="text-xs text-qc-textMuted hover:text-qc-textBody disabled:opacity-30"
        >
          ↑
        </button>
        <button
          type="button"
          onClick={onDown}
          disabled={isLast}
          className="text-xs text-qc-textMuted hover:text-qc-textBody disabled:opacity-30"
        >
          ↓
        </button>
      </div>

      <div className="flex-1">
        {step.kind === 'send_content' && (
          <div className="block">
            <span className="block text-xs text-qc-textSubtle mb-1">Enviar contenido</span>
            {stageFlows.length === 0 ? (
              <p className="text-xs text-qc-textSubtle">
                No hay stage_flows con slug_id. Sincroniza los flows de ManyChat primero.
              </p>
            ) : (
              <select
                value={step.slug_id}
                onChange={(e) => onChange({ kind: 'send_content', slug_id: e.target.value })}
                className="w-full bg-qc-bg border border-qc-borderHover rounded px-2 py-1.5 text-sm text-qc-textBody focus:border-qc-teal500 focus:outline-none"
              >
                {stageFlows.map((sf) => (
                  <option key={sf.slugId} value={sf.slugId}>
                    {sf.humanName ?? sf.slugId} ({sf.slugId})
                  </option>
                ))}
              </select>
            )}
          </div>
        )}
        {step.kind === 'reply_text' && (
          <label className="block">
            <span className="block text-xs text-qc-textSubtle mb-1">
              Responder texto · variables: {'{{name}}'} {'{{call_link}}'}
            </span>
            <textarea
              rows={2}
              value={step.text}
              onChange={(e) => onChange({ kind: 'reply_text', text: e.target.value })}
              className="w-full bg-qc-bg border border-qc-borderHover rounded px-2 py-1.5 text-sm text-qc-textBody focus:border-qc-teal500 focus:outline-none"
            />
          </label>
        )}
        {step.kind === 'change_stage' && (
          <div className="block">
            <span className="block text-xs text-qc-textSubtle mb-1">Cambiar a etapa</span>
            <StageSelect
              value={step.to_stage}
              onChange={(v) => onChange({ kind: 'change_stage', to_stage: v })}
              stages={stages}
            />
          </div>
        )}
      </div>

      <button
        type="button"
        onClick={onRemove}
        className="text-xs text-qc-danger hover:text-red-300 transition-colors pt-1"
      >
        Quitar
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
