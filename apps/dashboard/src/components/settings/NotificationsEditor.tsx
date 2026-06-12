'use client';

import { updateNotificationConfig } from '@/app/(dashboard)/settings/_actions/notifications';
import { toast } from '@/components/settings/ToastHost';
import {
  CONTENT_CLASSES,
  type ContentClass,
  ESCALATING_CLASSES,
  type MediaPolicy,
  type MediaPolicyAction,
} from '@dm-api/shared';
import { useState, useTransition } from 'react';

// Clases que tiene sentido configurar (el texto siempre lo maneja el agente).
const CONFIGURABLE_CLASSES = CONTENT_CLASSES.filter((c) => c !== 'text');

const CLASS_LABELS: Record<ContentClass, string> = {
  text: 'Texto',
  audio: 'Audio / nota de voz',
  image: 'Imagen',
  video: 'Video',
  location: 'Ubicación',
  file: 'Archivo / vCard',
  share: 'Compartir / respuesta a historia',
  sticker: 'Sticker / GIF / reacción',
  unknown: 'Desconocido (fail-safe)',
};

const ACTION_LABELS: Record<MediaPolicyAction, string> = {
  escalate: 'Escalar a humano',
  annotate: 'Anotar (el agente sigue)',
  agent: 'El agente lo maneja',
};

function defaultAction(cls: ContentClass): MediaPolicyAction {
  return (ESCALATING_CLASSES as readonly ContentClass[]).includes(cls) ? 'escalate' : 'annotate';
}

interface Props {
  tenantId: string;
  keywords: string[];
  mediaPolicy: MediaPolicy;
}

export function NotificationsEditor({ tenantId, keywords, mediaPolicy }: Props) {
  const [keywordsText, setKeywordsText] = useState(keywords.join('\n'));
  const [policy, setPolicy] = useState<MediaPolicy>(mediaPolicy);
  const [isPending, startTransition] = useTransition();

  function save() {
    const parsedKeywords = keywordsText
      .split('\n')
      .map((k) => k.trim())
      .filter(Boolean);
    startTransition(async () => {
      const result = await updateNotificationConfig(tenantId, {
        notification_keywords: parsedKeywords,
        media_policy: policy,
      });
      if (result.ok) toast('Configuración guardada');
      else toast(result.error, false);
    });
  }

  function setClassAction(cls: ContentClass, action: MediaPolicyAction) {
    setPolicy((prev) => ({ ...prev, [cls]: action }));
  }

  return (
    <div className="p-6 space-y-8">
      <section>
        <h2 className="text-base font-semibold text-white mb-1">Palabras clave de escalado</h2>
        <p className="text-qc-textSubtle text-sm mb-3">
          Si el lead escribe alguna de estas frases (match por substring, sin distinguir
          mayúsculas), se notifica a un humano. Una por línea.
        </p>
        <textarea
          rows={5}
          value={keywordsText}
          onChange={(e) => setKeywordsText(e.target.value)}
          placeholder={'hablar con un humano\nasesor\nreclamo'}
          className="w-full max-w-lg bg-qc-bg border border-qc-borderHover rounded px-3 py-2 text-sm text-qc-textBody focus:border-qc-teal500 focus:outline-none font-mono"
        />
      </section>

      <section>
        <h2 className="text-base font-semibold text-white mb-1">Matriz de medios</h2>
        <p className="text-qc-textSubtle text-sm mb-3">
          Qué hacer cuando el lead envía algo que no es texto. «Escalar» avisa a un humano; «Anotar»
          deja constancia en la memoria del agente y continúa.
        </p>
        <div className="space-y-2 max-w-lg">
          {CONFIGURABLE_CLASSES.map((cls) => {
            const current = policy[cls] ?? defaultAction(cls);
            const isDefault = policy[cls] === undefined;
            return (
              <div
                key={cls}
                className="flex items-center justify-between gap-3 bg-qc-surface border border-qc-border rounded-lg px-3 py-2"
              >
                <span className="text-sm text-qc-textBody">
                  {CLASS_LABELS[cls]}
                  {isDefault && (
                    <span className="ml-2 text-xs text-qc-textSubtle">(por defecto)</span>
                  )}
                </span>
                <select
                  value={current}
                  onChange={(e) => setClassAction(cls, e.target.value as MediaPolicyAction)}
                  className="bg-qc-bg border border-qc-borderHover rounded px-2 py-1 text-sm text-qc-textBody focus:border-qc-teal500 focus:outline-none"
                >
                  {(Object.keys(ACTION_LABELS) as MediaPolicyAction[]).map((a) => (
                    <option key={a} value={a}>
                      {ACTION_LABELS[a]}
                    </option>
                  ))}
                </select>
              </div>
            );
          })}
        </div>
      </section>

      <button
        type="button"
        onClick={save}
        disabled={isPending}
        className="px-4 py-2 bg-qc-teal700 hover:bg-qc-teal500 text-white text-sm rounded transition-colors disabled:opacity-50"
      >
        {isPending ? 'Guardando…' : 'Guardar cambios'}
      </button>
    </div>
  );
}
