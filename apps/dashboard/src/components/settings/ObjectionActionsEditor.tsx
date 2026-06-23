'use client';

import { updateResource } from '@/app/(dashboard)/settings/_actions/resources';
import { toast } from '@/components/settings/ToastHost';
import { useState, useTransition } from 'react';

type ObjectionActionType = 'reply_text' | 'send_flow' | 'change_stage' | 'add_tag';

interface ObjectionAction {
  _key: string;
  type: ObjectionActionType;
  params: Record<string, string>;
}

interface ObjectionConfig {
  is_terminal?: boolean;
  actions?: ObjectionAction[];
}

interface ObjectionActionsEditorProps {
  resourceId: string;
  config: ObjectionConfig | null;
}

const ACTION_LABELS: Record<ObjectionActionType, string> = {
  reply_text: 'Enviar texto',
  send_flow: 'Enviar flow',
  change_stage: 'Cambiar etapa',
  add_tag: 'Añadir tag',
};

const ACTION_PARAM_LABELS: Record<ObjectionActionType, { key: string; label: string }> = {
  reply_text: { key: 'text', label: 'Texto' },
  send_flow: { key: 'flow_id', label: 'Flow ID' },
  change_stage: { key: 'stage_id', label: 'ID de etapa destino' },
  add_tag: { key: 'tag', label: 'Tag' },
};

let _keyCounter = 0;
function nextKey() {
  return `a${++_keyCounter}`;
}

function parseConfig(config: unknown): ObjectionConfig {
  if (!config || typeof config !== 'object') return { is_terminal: false, actions: [] };
  const c = config as Record<string, unknown>;
  return {
    is_terminal: Boolean(c.is_terminal),
    actions: Array.isArray(c.actions)
      ? (c.actions as Array<{ type: ObjectionActionType; params: Record<string, string> }>).map(
          (a) => ({ ...a, _key: nextKey() }),
        )
      : [],
  };
}

export function ObjectionActionsEditor({ resourceId, config }: ObjectionActionsEditorProps) {
  const parsed = parseConfig(config);
  const [isTerminal, setIsTerminal] = useState(parsed.is_terminal ?? false);
  const [actions, setActions] = useState<ObjectionAction[]>(parsed.actions ?? []);
  const [isPending, startTransition] = useTransition();

  function toStoredActions(acts: ObjectionAction[]) {
    return acts.map(({ _key: _, ...rest }) => rest);
  }

  function save(newIsTerminal: boolean, newActions: ObjectionAction[]) {
    startTransition(async () => {
      const result = await updateResource(resourceId, {
        config: { is_terminal: newIsTerminal, actions: toStoredActions(newActions) },
      });
      if (!result.ok) toast(result.error, false);
    });
  }

  function toggleTerminal() {
    const next = !isTerminal;
    setIsTerminal(next);
    save(next, actions);
  }

  function addAction() {
    const newAction: ObjectionAction = {
      _key: nextKey(),
      type: 'reply_text',
      params: { text: '' },
    };
    const next = [...actions, newAction];
    setActions(next);
  }

  function removeAction(idx: number) {
    const next = actions.filter((_, i) => i !== idx);
    setActions(next);
    save(isTerminal, next);
  }

  function updateActionType(idx: number, type: ObjectionActionType) {
    const paramKey = ACTION_PARAM_LABELS[type].key;
    const next = actions.map((a, i) =>
      i === idx ? { _key: a._key, type, params: { [paramKey]: '' } } : a,
    );
    setActions(next);
  }

  function updateActionParam(idx: number, value: string) {
    const action = actions[idx];
    if (!action) return;
    const paramKey = ACTION_PARAM_LABELS[action.type].key;
    const next = actions.map((a, i) => (i === idx ? { ...a, params: { [paramKey]: value } } : a));
    setActions(next);
  }

  function saveActions() {
    save(isTerminal, actions);
    toast('Acciones guardadas');
  }

  return (
    <div className="mt-3 border-t border-qc-border pt-3">
      <div className="flex items-center gap-3 mb-2">
        <span className="text-xs text-qc-textSubtle font-medium uppercase tracking-wider">
          Acciones
        </span>
        <label className="flex items-center gap-1.5 cursor-pointer ml-auto">
          <input
            type="checkbox"
            checked={isTerminal}
            onChange={toggleTerminal}
            disabled={isPending}
            className="accent-red-500"
          />
          <span className="text-xs text-qc-textSubtle">Terminal (cierra conversación)</span>
        </label>
      </div>

      {actions.length === 0 ? (
        <p className="text-xs text-qc-textSubtle mb-2">Sin acciones automáticas configuradas.</p>
      ) : (
        <div className="space-y-2 mb-2">
          {actions.map((action, idx) => {
            const paramInfo = ACTION_PARAM_LABELS[action.type];
            return (
              <div key={action._key} className="flex items-center gap-2">
                <select
                  value={action.type}
                  onChange={(e) => updateActionType(idx, e.target.value as ObjectionActionType)}
                  className="bg-qc-bg border border-qc-borderHover rounded px-2 py-1 text-xs text-qc-textBody focus:border-qc-teal500 focus:outline-none"
                >
                  {Object.entries(ACTION_LABELS).map(([val, label]) => (
                    <option key={val} value={val}>
                      {label}
                    </option>
                  ))}
                </select>
                <input
                  type="text"
                  value={action.params[paramInfo.key] ?? ''}
                  onChange={(e) => updateActionParam(idx, e.target.value)}
                  placeholder={paramInfo.label}
                  className="flex-1 bg-qc-bg border border-qc-borderHover rounded px-2 py-1 text-xs text-qc-textBody focus:border-qc-teal500 focus:outline-none"
                />
                <button
                  type="button"
                  onClick={() => removeAction(idx)}
                  disabled={isPending}
                  className="text-xs text-qc-danger hover:text-red-300 transition-colors disabled:opacity-50 shrink-0"
                >
                  ✕
                </button>
              </div>
            );
          })}
        </div>
      )}

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={addAction}
          disabled={isPending}
          className="text-xs px-2 py-1 bg-qc-surface border border-qc-borderHover hover:border-qc-teal500 rounded text-qc-textBody transition-colors disabled:opacity-50"
        >
          + Acción
        </button>
        {actions.length > 0 && (
          <button
            type="button"
            onClick={saveActions}
            disabled={isPending}
            className="text-xs px-2 py-1 bg-qc-teal700 hover:bg-qc-teal500 text-white rounded transition-colors disabled:opacity-50"
          >
            Guardar acciones
          </button>
        )}
      </div>
    </div>
  );
}
