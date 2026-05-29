'use client';

import { toast } from '@/components/settings/ToastHost';
import { uploadAsset } from '@/lib/upload-client';
import { useState } from 'react';

interface ImageFieldProps {
  tenantId: string;
  mediaUrl: string | null;
  // Devuelve true si la persistencia fue correcta (para mostrar/ocultar errores).
  onChange: (url: string | null) => Promise<void> | void;
  // Texto cuando no hay imagen.
  emptyLabel?: string;
  allowClear?: boolean;
}

export function ImageField({
  tenantId,
  mediaUrl,
  onChange,
  emptyLabel = 'Sin imagen',
  allowClear = true,
}: ImageFieldProps) {
  const [busy, setBusy] = useState(false);

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true);
    try {
      const url = await uploadAsset(file, tenantId);
      await onChange(url);
      toast('Imagen actualizada');
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Error subiendo imagen', false);
    } finally {
      setBusy(false);
      e.target.value = '';
    }
  }

  async function handleClear() {
    if (!confirm('¿Quitar la imagen?')) return;
    setBusy(true);
    try {
      await onChange(null);
      toast('Imagen eliminada');
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Error eliminando imagen', false);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-1">
      {mediaUrl ? (
        <img src={mediaUrl} alt="preview" className="mt-1 max-h-24 w-auto rounded" />
      ) : (
        <p className="text-xs text-qc-textSubtle">{emptyLabel}</p>
      )}
      <div className="flex items-center gap-2 mt-2">
        <input
          type="file"
          accept="image/*"
          disabled={busy}
          onChange={handleFile}
          className="text-xs text-qc-textMuted file:mr-2 file:text-xs file:bg-qc-teal700 file:text-white file:border-0 file:rounded file:px-2 file:py-1 file:cursor-pointer disabled:opacity-50"
        />
        {busy && <span className="text-xs text-qc-textSubtle">subiendo…</span>}
        {mediaUrl && allowClear && !busy && (
          <button
            type="button"
            onClick={handleClear}
            className="text-xs text-qc-danger hover:text-red-300 transition-colors"
          >
            Quitar
          </button>
        )}
      </div>
    </div>
  );
}
