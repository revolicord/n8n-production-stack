'use client';

import { updateAgenteConfig } from '@/app/(dashboard)/settings/_actions/agente';
import { toast } from '@/components/settings/ToastHost';
import { useState, useTransition } from 'react';

interface Props {
  tenantId: string;
  personaPrompt: string;
  calendlyUrl: string;
  disqualificationReasons: string[];
}

export function AgenteEditor({
  tenantId,
  personaPrompt,
  calendlyUrl,
  disqualificationReasons,
}: Props) {
  const [persona, setPersona] = useState(personaPrompt);
  const [calendly, setCalendly] = useState(calendlyUrl);
  const [reasonsText, setReasonsText] = useState(disqualificationReasons.join('\n'));
  const [isPending, startTransition] = useTransition();

  function save() {
    const reasons = reasonsText
      .split('\n')
      .map((r) => r.trim())
      .filter(Boolean);
    startTransition(async () => {
      const result = await updateAgenteConfig(tenantId, {
        persona_prompt: persona,
        calendly_url: calendly.trim(),
        disqualification_reasons: reasons,
      });
      if (result.ok) toast('Configuración guardada');
      else toast(result.error, false);
    });
  }

  return (
    <div className="p-6 space-y-8">
      <section>
        <h2 className="text-base font-semibold text-white mb-1">Persona del agente</h2>
        <p className="text-qc-textSubtle text-sm mb-3">
          Define el tono, las restricciones y ejemplos del agente. Este texto se inyecta en el
          prompt del sistema en cada turno.
        </p>
        <textarea
          rows={10}
          value={persona}
          onChange={(e) => setPersona(e.target.value)}
          placeholder="Eres un asesor cercano y directo. Hablas de tú, sin tecnicismos…"
          className="w-full max-w-2xl bg-qc-bg border border-qc-borderHover rounded px-3 py-2 text-sm text-qc-textBody focus:border-qc-teal500 focus:outline-none"
        />
      </section>

      <section>
        <h2 className="text-base font-semibold text-white mb-1">URL de Calendly</h2>
        <p className="text-qc-textSubtle text-sm mb-3">
          Link de agendado que el agente comparte. Déjalo vacío para quitarlo.
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
