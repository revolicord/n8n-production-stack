'use client';

import {
  convertTextToContent,
  createMessage,
  deleteMessage,
  updateMessage,
  updateStageConfig,
  updateTemplate,
} from '@/app/(dashboard)/settings/_actions/followups';
import { ImageField } from '@/components/settings/ImageField';
import { PlaceholderTextarea } from '@/components/settings/PlaceholderTextarea';
import { toast } from '@/components/settings/ToastHost';
import type { ActionResult } from '@/lib/admin-api';
import type { MessageRow, StageDetail, TemplateDetail } from '@/lib/followups';
import { uploadAsset } from '@/lib/upload-client';
import { useState, useTransition } from 'react';

type RunFn = (action: () => Promise<ActionResult>, okMsg?: string) => void;

interface StageEditorProps {
  tenantId: string;
  title: string;
  stage: StageDetail;
  templates: TemplateDetail[];
}

export function StageEditor({ tenantId, title, stage, templates }: StageEditorProps) {
  const [isPending, startTransition] = useTransition();

  const run: RunFn = (action, okMsg) => {
    startTransition(async () => {
      const result = await action();
      if (result.ok) {
        if (okMsg) toast(okMsg);
      } else {
        toast(result.error, false);
      }
    });
  };

  const visible = templates.filter((t) => t.sequenceNumber >= 1 && t.sequenceNumber <= 8);

  return (
    <div className="p-6">
      <h2 className="text-base font-semibold text-white mb-5">{title} — Follow-ups</h2>

      <StageConfigPanel stage={stage} run={run} busy={isPending} />

      <div className="space-y-4 mt-6">
        {visible.length === 0 ? (
          <p className="text-qc-textSubtle text-sm">No hay follow-ups en esta etapa.</p>
        ) : (
          visible.map((t) => (
            <TemplateCard
              key={t.id}
              tenantId={tenantId}
              stageSlug={stage.slug}
              template={t}
              run={run}
              busy={isPending}
            />
          ))
        )}
      </div>
    </div>
  );
}

function StageConfigPanel({
  stage,
  run,
  busy,
}: {
  stage: StageDetail;
  run: RunFn;
  busy: boolean;
}) {
  const [nurture, setNurture] = useState(stage.nurtureVideoUrl ?? '');
  const [callLink, setCallLink] = useState(stage.callLink ?? '');

  return (
    <div className="bg-qc-surface border border-qc-border rounded-lg p-4">
      <h3 className="text-xs font-semibold text-qc-textMuted uppercase tracking-wide mb-3">
        Variables de personalización
      </h3>
      <div className="grid grid-cols-1 gap-3">
        <label className="block">
          <span className="text-xs text-qc-textMuted">
            Video de nurture{' '}
            <span className="text-qc-textFaint font-mono">{'{{nurture_video}}'}</span>
          </span>
          <input
            type="url"
            value={nurture}
            onChange={(e) => setNurture(e.target.value)}
            placeholder="https://youtube.com/watch?v=..."
            className="w-full mt-1 bg-qc-bg border border-qc-borderHover rounded px-3 py-1.5 text-sm text-qc-textBody focus:border-qc-teal500 focus:outline-none"
          />
        </label>
        <label className="block">
          <span className="text-xs text-qc-textMuted">
            Link de llamada <span className="text-qc-textFaint font-mono">{'{{call_link}}'}</span>
          </span>
          <input
            type="url"
            value={callLink}
            onChange={(e) => setCallLink(e.target.value)}
            placeholder="https://calendly.com/..."
            className="w-full mt-1 bg-qc-bg border border-qc-borderHover rounded px-3 py-1.5 text-sm text-qc-textBody focus:border-qc-teal500 focus:outline-none"
          />
        </label>
      </div>
      <button
        type="button"
        disabled={busy}
        onClick={() =>
          run(
            () =>
              updateStageConfig(stage.id, {
                nurture_video_url: nurture.trim() || null,
                call_link: callLink.trim() || null,
              }),
            'Variables guardadas',
          )
        }
        className="mt-3 px-3 py-1 bg-qc-borderHover hover:bg-qc-textFaint text-white text-xs rounded transition-colors disabled:opacity-50"
      >
        Guardar variables
      </button>
    </div>
  );
}

interface TemplateCardProps {
  tenantId: string;
  stageSlug: string;
  template: TemplateDetail;
  run: RunFn;
  busy: boolean;
}

function TemplateCard({ tenantId, stageSlug, template: t, run, busy }: TemplateCardProps) {
  const stageTag = stageSlug.toUpperCase();
  const label = t.description ?? t.type;

  return (
    <div className="bg-qc-surface border border-qc-border rounded-lg p-4">
      <div className="flex items-center justify-between mb-3 gap-2">
        <span className="text-xs text-qc-textMuted font-mono flex items-center gap-1">
          {t.sequenceNumber}
          {stageTag} ·
          <input
            type="text"
            defaultValue={label}
            onBlur={(e) => {
              const v = e.target.value.trim();
              if (v && v !== label) {
                run(() => updateTemplate(t.id, { description: v }), 'Nombre actualizado');
              }
            }}
            className="bg-transparent border-b border-transparent hover:border-qc-borderHover focus:border-qc-teal500 focus:outline-none text-qc-textBody w-40"
          />
        </span>
        <div className="flex items-center gap-2">
          <span className="text-xs text-qc-textMuted">Delay (min):</span>
          <input
            type="number"
            min={1}
            defaultValue={t.delayMinutes}
            onBlur={(e) => {
              const v = Number(e.target.value);
              if (Number.isFinite(v) && v >= 1 && v !== t.delayMinutes) {
                run(() => updateTemplate(t.id, { delay_minutes: v }));
              }
            }}
            className="w-20 bg-qc-bg border border-qc-borderHover rounded px-2 py-1 text-sm text-qc-textBody focus:border-qc-teal500 focus:outline-none"
          />
        </div>
      </div>

      {t.type === 'flow' ? (
        <p className="text-xs text-qc-textSubtle">
          Flow: <code className="text-qc-textMuted">{t.flowNs ?? ''}</code>
        </p>
      ) : t.type === 'content' ? (
        <ContentBody tenantId={tenantId} template={t} run={run} busy={busy} />
      ) : (
        <TextBody tenantId={tenantId} template={t} run={run} busy={busy} />
      )}
    </div>
  );
}

// type='text' — textarea + opción de subir imagen (convierte a content)
function TextBody({
  tenantId,
  template: t,
  run,
  busy,
}: {
  tenantId: string;
  template: TemplateDetail;
  run: RunFn;
  busy: boolean;
}) {
  const [converting, setConverting] = useState(false);
  const [textSnapshot, setTextSnapshot] = useState(t.textTemplate ?? '');

  async function handleConvert(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setConverting(true);
    try {
      const url = await uploadAsset(file, tenantId);
      run(() => convertTextToContent(t.id, url, textSnapshot), 'Convertido a mensaje multimedia');
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Error subiendo imagen', false);
    } finally {
      setConverting(false);
      e.target.value = '';
    }
  }

  return (
    <div>
      <PlaceholderTextarea
        initial={t.textTemplate ?? ''}
        onSave={(value) => {
          setTextSnapshot(value);
          run(() => updateTemplate(t.id, { text_template: value }));
        }}
      />
      <div className="mt-2">
        <p className="text-xs text-qc-textSubtle mb-1">
          Imagen (opcional — convierte a mensaje multimedia)
        </p>
        <input
          type="file"
          accept="image/*"
          disabled={busy || converting}
          onChange={handleConvert}
          className="text-xs text-qc-textMuted file:mr-2 file:text-xs file:bg-qc-teal700 file:text-white file:border-0 file:rounded file:px-2 file:py-1 file:cursor-pointer disabled:opacity-50"
        />
        {converting && <span className="ml-2 text-xs text-qc-textSubtle">subiendo…</span>}
      </div>
    </div>
  );
}

// type='content' — mensaje texto + mensaje imagen + descripción IA + mensajes extra
function ContentBody({
  tenantId,
  template: t,
  run,
  busy,
}: {
  tenantId: string;
  template: TemplateDetail;
  run: RunFn;
  busy: boolean;
}) {
  const imgMsg = t.messages.find((m) => m.messageType === 'image');
  const txtMsg = t.messages.find((m) => m.messageType === 'text');
  const extras = t.messages.filter((m) => m.id !== imgMsg?.id && m.id !== txtMsg?.id);

  function saveText(value: string) {
    if (txtMsg) {
      run(() => updateMessage(txtMsg.id, { text_content: value }));
    } else {
      run(() =>
        createMessage(t.id, { message_type: 'text', text_content: value || ' ', sort_order: 1 }),
      );
    }
  }

  async function setImage(url: string | null) {
    if (url === null) {
      if (imgMsg) {
        const r = await deleteMessage(imgMsg.id);
        if (!r.ok) throw new Error(r.error);
      }
      return;
    }
    const r = imgMsg
      ? await updateMessage(imgMsg.id, { media_url: url })
      : await createMessage(t.id, { message_type: 'image', media_url: url, sort_order: 0 });
    if (!r.ok) throw new Error(r.error);
  }

  return (
    <div>
      <PlaceholderTextarea initial={txtMsg?.textContent ?? ''} onSave={saveText} />

      <ImageField
        tenantId={tenantId}
        mediaUrl={imgMsg?.mediaUrl ?? null}
        onChange={setImage}
        emptyLabel="Sin imagen"
      />

      {imgMsg && (
        <div className="mt-2">
          <span className="text-xs text-qc-textSubtle block mb-1">
            Descripción de la imagen para la IA (no se envía al lead)
          </span>
          <textarea
            rows={2}
            defaultValue={imgMsg.aiImageContext ?? ''}
            placeholder="Ej: Meme de esqueleto esperando en una silla"
            onBlur={(e) => {
              const v = e.target.value;
              if (v !== (imgMsg.aiImageContext ?? '')) {
                run(() => updateMessage(imgMsg.id, { ai_image_context: v || null }));
              }
            }}
            className="w-full bg-qc-bg border border-qc-borderHover rounded px-2 py-1 text-xs text-qc-textBody focus:border-qc-teal500 focus:outline-none"
          />
        </div>
      )}

      {extras.length > 0 && (
        <details className="mt-3">
          <summary className="text-xs text-qc-textSubtle cursor-pointer">
            Ver mensajes adicionales ({extras.length})
          </summary>
          <div className="mt-2 space-y-2">
            {extras.map((m) => (
              <ExtraMessage key={m.id} tenantId={tenantId} message={m} run={run} busy={busy} />
            ))}
          </div>
        </details>
      )}
    </div>
  );
}

function ExtraMessage({
  tenantId,
  message: m,
  run,
  busy,
}: {
  tenantId: string;
  message: MessageRow;
  run: RunFn;
  busy: boolean;
}) {
  return (
    <div className="border border-qc-border rounded p-3">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs text-qc-textSubtle">
          Tipo: {m.messageType} · orden: {m.sortOrder}
        </span>
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            if (confirm('¿Eliminar este mensaje?')) {
              run(() => deleteMessage(m.id), 'Mensaje eliminado');
            }
          }}
          className="text-xs text-qc-danger hover:text-red-300 transition-colors disabled:opacity-50"
        >
          Eliminar
        </button>
      </div>
      {m.messageType === 'image' ? (
        <ImageField
          tenantId={tenantId}
          mediaUrl={m.mediaUrl}
          allowClear={false}
          onChange={async (url) => {
            if (url === null) return;
            const r = await updateMessage(m.id, { media_url: url });
            if (!r.ok) throw new Error(r.error);
          }}
        />
      ) : (
        <textarea
          rows={2}
          defaultValue={m.textContent ?? ''}
          onBlur={(e) => {
            if (e.target.value !== (m.textContent ?? '')) {
              run(() => updateMessage(m.id, { text_content: e.target.value }));
            }
          }}
          className="w-full bg-qc-bg border border-qc-borderHover rounded px-2 py-1 text-sm text-qc-textBody focus:border-qc-teal500 focus:outline-none"
        />
      )}
    </div>
  );
}
