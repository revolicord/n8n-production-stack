'use client';

import { updateAgenteConfig } from '@/app/(dashboard)/settings/_actions/agente';
import { toast } from '@/components/settings/ToastHost';
import { useState, useTransition } from 'react';

interface Props {
  tenantId: string;
  skeletonPrompt: string;
  defaultSkeletonPrompt: string;
  personaPrompt: string;
  calendlyUrl: string;
  nurturingVideoUrl: string;
  disqualificationReasons: string[];
}

type Tab = 'skeleton' | 'persona' | 'other' | 'preview';

export function AgenteEditor({
  tenantId,
  skeletonPrompt,
  defaultSkeletonPrompt,
  personaPrompt,
  calendlyUrl,
  nurturingVideoUrl,
  disqualificationReasons,
}: Props) {
  const [tab, setTab] = useState<Tab>('skeleton');
  const [skeleton, setSkeleton] = useState(skeletonPrompt);
  const [persona, setPersona] = useState(personaPrompt);
  const [calendly, setCalendly] = useState(calendlyUrl);
  const [nurturingVideo, setNurturingVideo] = useState(nurturingVideoUrl);
  const [reasonsText, setReasonsText] = useState(disqualificationReasons.join('\n'));
  const [isPending, startTransition] = useTransition();

  const effectiveSkeleton = skeleton.trim() || defaultSkeletonPrompt;

  const fullPromptPreview = [
    effectiveSkeleton,
    '',
    '## Persona del agente',
    '',
    persona.trim() || '(sin persona definida)',
    '',
    '## Contexto del diálogo',
    '',
    'Lead: [nombre del lead]',
    'Etapa actual: [etapa]',
    '(slots, repair_context, etc. se agregan aquí en runtime)',
  ].join('\n');

  function save() {
    const reasons = reasonsText
      .split('\n')
      .map((r) => r.trim())
      .filter(Boolean);
    startTransition(async () => {
      const result = await updateAgenteConfig(tenantId, {
        skeleton_prompt: skeleton.trim() || undefined,
        persona_prompt: persona,
        calendly_url: calendly.trim(),
        nurturing_video_url: nurturingVideo.trim() || undefined,
        disqualification_reasons: reasons,
      });
      if (result.ok) toast('Configuración guardada');
      else toast(result.error, false);
    });
  }

  const tabs: { id: Tab; label: string }[] = [
    { id: 'skeleton', label: 'Esqueleto de plataforma' },
    { id: 'persona', label: 'Persona del agente' },
    { id: 'other', label: 'Otros' },
    { id: 'preview', label: 'Preview completo' },
  ];

  return (
    <div className="p-6 space-y-6">
      {/* Tab bar */}
      <div className="flex gap-1 border-b border-qc-border">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={[
              'px-4 py-2 text-sm font-medium transition-colors border-b-2 -mb-px',
              tab === t.id
                ? 'border-qc-teal500 text-qc-teal500'
                : 'border-transparent text-qc-textSubtle hover:text-qc-textBody',
            ].join(' ')}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Esqueleto de plataforma */}
      {tab === 'skeleton' && (
        <section className="space-y-3">
          <div>
            <h2 className="text-base font-semibold text-white mb-1">Esqueleto de plataforma</h2>
            <p className="text-qc-textSubtle text-sm">
              Instrucciones estructurales que recibe Claude en cada turno: vocabulario de comandos,
              reglas críticas y los placeholders dinámicos. Debe incluir{' '}
              <code className="text-qc-teal500 text-xs">{'{VALID_TRANSITIONS}'}</code> y{' '}
              <code className="text-qc-teal500 text-xs">{'{CONTENT_OPTIONS}'}</code> para que el
              sistema los rellene en runtime. Si lo dejas vacío se usa el esqueleto por defecto de
              la plataforma.
            </p>
          </div>
          <textarea
            rows={24}
            value={skeleton}
            onChange={(e) => setSkeleton(e.target.value)}
            placeholder={defaultSkeletonPrompt}
            className="w-full max-w-3xl bg-qc-bg border border-qc-borderHover rounded px-3 py-2 text-sm text-qc-textBody focus:border-qc-teal500 focus:outline-none font-mono"
          />
          {!skeleton.trim() && (
            <p className="text-qc-textSubtle text-xs">
              Usando esqueleto por defecto de la plataforma (visible en el tab "Preview completo").
            </p>
          )}
        </section>
      )}

      {/* Persona del agente */}
      {tab === 'persona' && (
        <section className="space-y-3">
          <div>
            <h2 className="text-base font-semibold text-white mb-1">Persona del agente</h2>
            <p className="text-qc-textSubtle text-sm">
              Tono, restricciones y estrategia propios del negocio. Se inyecta después del esqueleto
              de plataforma bajo la sección{' '}
              <code className="text-qc-teal500 text-xs">## Persona del agente</code>.
            </p>
          </div>
          <textarea
            rows={24}
            value={persona}
            onChange={(e) => setPersona(e.target.value)}
            placeholder="Eres Alex, de Quantum Creators. Eres un SETTER…"
            className="w-full max-w-3xl bg-qc-bg border border-qc-borderHover rounded px-3 py-2 text-sm text-qc-textBody focus:border-qc-teal500 focus:outline-none font-mono"
          />
        </section>
      )}

      {/* Otros: Calendly, nurturing, descalificación */}
      {tab === 'other' && (
        <div className="space-y-8">
          <section>
            <h2 className="text-base font-semibold text-white mb-1">URL de Calendly</h2>
            <p className="text-qc-textSubtle text-sm mb-3">
              Link de agendado que el agente comparte. El sistema agrega automáticamente{' '}
              <code className="text-qc-teal500 text-xs">?utm_content=subscriber_id</code> para
              identificar quién agendó desde el webhook.
            </p>
            <input
              type="url"
              value={calendly}
              onChange={(e) => setCalendly(e.target.value)}
              placeholder="https://calendly.com/tu-negocio/llamada"
              className="w-full max-w-lg bg-qc-bg border border-qc-borderHover rounded px-3 py-2 text-sm text-qc-textBody focus:border-qc-teal500 focus:outline-none"
            />
          </section>

          <section>
            <h2 className="text-base font-semibold text-white mb-1">
              Video de nurturing post-booking
            </h2>
            <p className="text-qc-textSubtle text-sm mb-3">
              Link de YouTube que el agente envía automáticamente después de confirmar la llamada.
              Déjalo vacío para desactivarlo.
            </p>
            <input
              type="url"
              value={nurturingVideo}
              onChange={(e) => setNurturingVideo(e.target.value)}
              placeholder="https://youtu.be/..."
              className="w-full max-w-lg bg-qc-bg border border-qc-borderHover rounded px-3 py-2 text-sm text-qc-textBody focus:border-qc-teal500 focus:outline-none"
            />
          </section>

          <section>
            <h2 className="text-base font-semibold text-white mb-1">Razones de descalificación</h2>
            <p className="text-qc-textSubtle text-sm mb-3">
              Motivos válidos para que el agente descalifique a un lead. Una por línea.
            </p>
            <textarea
              rows={5}
              value={reasonsText}
              onChange={(e) => setReasonsText(e.target.value)}
              placeholder={'Fuera de jurisdicción\nSin presupuesto\nNo es decisor'}
              className="w-full max-w-lg bg-qc-bg border border-qc-borderHover rounded px-3 py-2 text-sm text-qc-textBody focus:border-qc-teal500 focus:outline-none font-mono"
            />
          </section>
        </div>
      )}

      {/* Preview completo */}
      {tab === 'preview' && (
        <section className="space-y-3">
          <div>
            <h2 className="text-base font-semibold text-white mb-1">Preview del prompt completo</h2>
            <p className="text-qc-textSubtle text-sm">
              Así recibirá Claude el system prompt en cada turno. Los placeholders{' '}
              <code className="text-qc-teal500 text-xs">{'{VALID_TRANSITIONS}'}</code> y{' '}
              <code className="text-qc-teal500 text-xs">{'{CONTENT_OPTIONS}'}</code> se rellenan en
              runtime con datos del lead y la etapa actual.
            </p>
          </div>
          <pre className="w-full max-w-3xl bg-qc-bg border border-qc-border rounded px-4 py-3 text-xs text-qc-textBody font-mono whitespace-pre-wrap overflow-auto max-h-[70vh]">
            {fullPromptPreview}
          </pre>
        </section>
      )}

      {/* Guardar — no visible en preview */}
      {tab !== 'preview' && (
        <button
          type="button"
          onClick={save}
          disabled={isPending}
          className="px-4 py-2 bg-qc-teal700 hover:bg-qc-teal500 text-white text-sm rounded transition-colors disabled:opacity-50"
        >
          {isPending ? 'Guardando…' : 'Guardar cambios'}
        </button>
      )}
    </div>
  );
}
