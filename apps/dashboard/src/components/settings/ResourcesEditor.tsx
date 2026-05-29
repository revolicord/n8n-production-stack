'use client';

import {
  createResource,
  deleteResource,
  updateResource,
} from '@/app/(dashboard)/settings/_actions/resources';
import { ImageField } from '@/components/settings/ImageField';
import { toast } from '@/components/settings/ToastHost';
import type { AgentResourceRow } from '@/lib/resources';
import { useState, useTransition } from 'react';

interface ResourcesEditorProps {
  tenantId: string;
  category: string;
  title: string;
  resources: AgentResourceRow[];
}

export function ResourcesEditor({ tenantId, category, title, resources }: ResourcesEditorProps) {
  const [newName, setNewName] = useState('');
  const [isPending, startTransition] = useTransition();

  function run(action: () => Promise<{ ok: true } | { ok: false; error: string }>, okMsg?: string) {
    startTransition(async () => {
      const result = await action();
      if (result.ok) {
        if (okMsg) toast(okMsg);
      } else {
        toast(result.error, false);
      }
    });
  }

  function handleAdd() {
    const name = newName.trim();
    if (!name) return;
    setNewName('');
    run(() => createResource(tenantId, category, name), 'Recurso creado');
  }

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-5">
        <h2 className="text-base font-semibold text-white">{title}</h2>
      </div>

      <div className="space-y-4">
        {resources.length === 0 ? (
          <p className="text-qc-textSubtle text-sm">No hay recursos en esta categoría.</p>
        ) : (
          resources.map((r) => (
            <ResourceCard key={r.id} tenantId={tenantId} resource={r} run={run} busy={isPending} />
          ))
        )}
      </div>

      <div className="mt-6 flex items-center gap-2">
        <input
          type="text"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleAdd();
          }}
          placeholder="Nombre del nuevo recurso…"
          className="flex-1 max-w-sm bg-qc-bg border border-qc-borderHover rounded px-3 py-1.5 text-sm text-qc-textBody focus:border-qc-teal500 focus:outline-none"
        />
        <button
          type="button"
          onClick={handleAdd}
          disabled={isPending || !newName.trim()}
          className="px-3 py-1.5 bg-qc-teal700 hover:bg-qc-teal500 text-white text-sm rounded transition-colors disabled:opacity-50"
        >
          + Añadir recurso
        </button>
      </div>
    </div>
  );
}

interface ResourceCardProps {
  tenantId: string;
  resource: AgentResourceRow;
  run: (action: () => Promise<{ ok: true } | { ok: false; error: string }>, okMsg?: string) => void;
  busy: boolean;
}

function ResourceCard({ tenantId, resource, run, busy }: ResourceCardProps) {
  function saveName(value: string) {
    const trimmed = value.trim();
    if (!trimmed || trimmed === resource.displayName) return;
    run(() => updateResource(resource.id, { display_name: trimmed }), 'Nombre actualizado');
  }

  function saveHint(value: string) {
    if (value === (resource.triggerHint ?? '')) return;
    run(() => updateResource(resource.id, { trigger_hint: value || null }));
  }

  function saveText(value: string) {
    if (value === (resource.textContent ?? '')) return;
    run(() => updateResource(resource.id, { text_content: value || null }));
  }

  return (
    <div className="bg-qc-surface border border-qc-border rounded-lg p-4">
      <div className="flex items-center justify-between mb-2 gap-2">
        <input
          type="text"
          defaultValue={resource.displayName}
          onBlur={(e) => saveName(e.target.value)}
          className="text-sm font-medium text-white bg-transparent border-b border-transparent hover:border-qc-borderHover focus:border-qc-teal500 focus:outline-none flex-1"
        />
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            if (confirm('¿Eliminar este recurso?')) {
              run(() => deleteResource(resource.id), 'Recurso eliminado');
            }
          }}
          className="text-xs text-qc-danger hover:text-red-300 transition-colors disabled:opacity-50"
        >
          Eliminar
        </button>
      </div>

      <input
        type="text"
        defaultValue={resource.triggerHint ?? ''}
        onBlur={(e) => saveHint(e.target.value)}
        placeholder="Hint para el agente (opcional)"
        className="w-full mb-2 bg-qc-bg border border-qc-borderHover rounded px-2 py-1 text-sm text-qc-textBody focus:border-qc-teal500 focus:outline-none"
      />
      <textarea
        rows={2}
        defaultValue={resource.textContent ?? ''}
        onBlur={(e) => saveText(e.target.value)}
        placeholder="Texto del recurso (opcional)"
        className="w-full bg-qc-bg border border-qc-borderHover rounded px-2 py-1 text-sm text-qc-textBody focus:border-qc-teal500 focus:outline-none"
      />

      <ImageField
        tenantId={tenantId}
        mediaUrl={resource.mediaUrl}
        onChange={async (url) => {
          const result = await updateResource(resource.id, { media_url: url });
          if (!result.ok) throw new Error(result.error);
        }}
      />
    </div>
  );
}
